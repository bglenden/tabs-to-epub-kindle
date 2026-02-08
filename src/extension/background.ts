import { buildEpub } from '../core/epub.js';
import { buildFilenameForArticles } from './filename.js';
import { embedImages } from './image-assets.js';
import {
  isKindleEmailValid,
  normalizeKindleEmail,
  requireKindleEmail
} from './kindle-email.js';
import { clearHandle, loadHandle, writeFile } from './directory-handle.js';
import { applyTooLargeEmailPrefix, emailArtifactsToKindleCollectTooLarge } from './email-artifacts.js';
import { discoverPdfSourcesFromTabDom } from './pdf-dom-discovery.js';
import { buildPdfFilename, detectPdfTab, ensureUniqueFilename } from './pdf.js';
import type {
  ExtractMessage,
  ExtractResponse,
  ExtractedArticleWithTab,
  Settings,
  TestMessage,
  TestResponse,
  TestSaveResponse,
  UiBuildEpubResponse,
  UiMessage,
  UiResponse
} from './types.js';

const MENU_PARENT = 'tabstoepub-root';
const MENU_SAVE = 'tabstoepub-save';
const MENU_SAVE_CLOSE = 'tabstoepub-save-close';
const MENU_EMAIL_KINDLE = 'tabstoepub-email-kindle';
const SETTINGS_KEY = 'tabstoepub-settings';

const DEFAULT_SETTINGS: Settings = {
  testMode: false,
  kindleEmail: null,
  useDefaultDownloads: false,
  emailToKindle: false
};

const pendingDownloads = new Map<number, string>();

const EPUB_MIME_TYPE = 'application/epub+zip';
const PDF_MIME_TYPE = 'application/pdf';

interface OutputArtifact {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

interface PdfTabCandidate {
  tab: chrome.tabs.Tab;
  sourceUrl: string;
}

function parseContentType(value: string | null): string {
  return value ? String(value).split(';')[0].trim().toLowerCase() : '';
}

function storageGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      resolve(result[key] as T | undefined);
    });
  });
}

function storageSet(value: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(value, () => resolve());
  });
}

async function getSettings(): Promise<Settings> {
  const stored = await storageGet<Settings>(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored || {}) };
}

async function setSettings(next: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const updated = { ...current, ...next };
  await storageSet({ [SETTINGS_KEY]: updated });
  return updated;
}

function tabsQuery(query: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(query, (tabs) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(err);
        return;
      }
      resolve(tabs || []);
    });
  });
}

function tabsSendMessage(tabId: number, message: ExtractMessage): Promise<ExtractResponse> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(err);
        return;
      }
      resolve(response as ExtractResponse);
    });
  });
}

function tabsRemove(tabIds: number[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.tabs.remove(tabIds, () => resolve());
  });
}

function executeScript(tabId: number, files: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript({ target: { tabId }, files }, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function downloadsDownload(options: chrome.downloads.DownloadOptions): Promise<number> {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(err);
        return;
      }
      if (typeof downloadId !== 'number') {
        reject(new Error('Download failed'));
        return;
      }
      resolve(downloadId);
    });
  });
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function isTrustedSender(sender: chrome.runtime.MessageSender | undefined): boolean {
  return Boolean(
    sender &&
      sender.id === chrome.runtime.id &&
      sender.url &&
      sender.url.startsWith(`chrome-extension://${chrome.runtime.id}/`)
  );
}

function getTargetTabs(clickedTab?: chrome.tabs.Tab): Promise<chrome.tabs.Tab[]> {
  return tabsQuery({ highlighted: true, currentWindow: true }).then((tabs) => {
    if (tabs.length > 1) {
      return tabs;
    }
    return clickedTab ? [clickedTab] : tabs;
  });
}

async function ensureContentScript(tabId: number): Promise<void> {
  await executeScript(tabId, [
    'extension/vendor/readability.js',
    'extension/extractor-readability.js',
    'extension/content-extract.js'
  ]);
}

async function extractFromTab(tab: chrome.tabs.Tab): Promise<ExtractedArticleWithTab> {
  if (typeof tab.id !== 'number') {
    throw new Error('Missing tab.');
  }
  if (tab.url && (tab.url.startsWith('chrome') || tab.url.startsWith('chrome-extension'))) {
    throw new Error(`Cannot access ${tab.url}`);
  }
  await ensureContentScript(tab.id);
  const response = await tabsSendMessage(tab.id, { type: 'EXTRACT' });
  if (!response || response.ok === false) {
    const errorMessage = response && 'error' in response && response.error ? response.error : 'Extraction failed';
    throw new Error(errorMessage);
  }
  return {
    ...response.article,
    tabId: tab.id,
    tabTitle: tab.title || response.article.title || 'Untitled'
  };
}

async function extractArticles(
  tabs: chrome.tabs.Tab[]
): Promise<{ articles: ExtractedArticleWithTab[]; failures: Array<{ tab: chrome.tabs.Tab; error: string }> }> {
  const articles: ExtractedArticleWithTab[] = [];
  const failures: Array<{ tab: chrome.tabs.Tab; error: string }> = [];

  for (const tab of tabs) {
    try {
      const article = await extractFromTab(tab);
      articles.push(article);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      failures.push({ tab, error: errorMessage });
    }
  }

  return { articles, failures };
}

function hasPdfMagicBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

async function fetchPdfBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`PDF fetch failed (${response.status})`);
  }
  const contentType = parseContentType(response.headers.get('content-type'));
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (contentType && contentType !== PDF_MIME_TYPE && !hasPdfMagicBytes(buffer)) {
    throw new Error(`Resource is not a PDF (${contentType})`);
  }
  if (!contentType && !hasPdfMagicBytes(buffer)) {
    throw new Error('Resource is not a PDF');
  }
  return buffer;
}

async function splitTabsByPdf(tabs: chrome.tabs.Tab[]): Promise<{
  articleTabs: chrome.tabs.Tab[];
  pdfTabs: PdfTabCandidate[];
  failures: Array<{ tab: chrome.tabs.Tab; error: string }>;
}> {
  const articleTabs: chrome.tabs.Tab[] = [];
  const pdfTabs: PdfTabCandidate[] = [];
  const failures: Array<{ tab: chrome.tabs.Tab; error: string }> = [];

  for (const tab of tabs) {
    try {
      const detection = await detectPdfTab({
        url: tab.url,
        pendingUrl: tab.pendingUrl,
        title: tab.title
      });
      if (detection.isPdf) {
        if (!detection.sourceUrl) {
          failures.push({ tab, error: 'PDF tab has no downloadable source URL' });
          continue;
        }
        pdfTabs.push({ tab, sourceUrl: detection.sourceUrl });
        continue;
      }

      const domCandidates = await discoverPdfSourcesFromTabDom(tab);
      let resolvedPdfSource: string | null = null;
      for (const candidateUrl of domCandidates.slice(0, 6)) {
        const candidateDetection = await detectPdfTab(
          { url: candidateUrl },
          fetch,
          { verifyUrlPath: true }
        );
        if (candidateDetection.isPdf && candidateDetection.sourceUrl) {
          resolvedPdfSource = candidateDetection.sourceUrl;
          break;
        }
      }
      if (resolvedPdfSource) {
        pdfTabs.push({ tab, sourceUrl: resolvedPdfSource });
        continue;
      }

      articleTabs.push(tab);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      failures.push({ tab, error: errorMessage });
    }
  }

  return { articleTabs, pdfTabs, failures };
}

async function buildPdfArtifacts(
  pdfTabs: PdfTabCandidate[],
  now: Date,
  usedFilenames: Set<string>
): Promise<{
  artifacts: OutputArtifact[];
  failures: Array<{ tab: chrome.tabs.Tab; error: string }>;
}> {
  const artifacts: OutputArtifact[] = [];
  const failures: Array<{ tab: chrome.tabs.Tab; error: string }> = [];

  for (const candidate of pdfTabs) {
    try {
      const bytes = await fetchPdfBytes(candidate.sourceUrl);
      const baseFilename = buildPdfFilename(
        {
          title: candidate.tab.title,
          url: candidate.tab.url,
          pendingUrl: candidate.tab.pendingUrl
        },
        candidate.sourceUrl,
        now
      );
      const filename = ensureUniqueFilename(baseFilename, usedFilenames);
      artifacts.push({
        filename,
        mimeType: PDF_MIME_TYPE,
        bytes
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      failures.push({ tab: candidate.tab, error: errorMessage });
    }
  }

  return { artifacts, failures };
}

async function downloadArtifact(artifact: OutputArtifact): Promise<number> {
  // Try writing directly via stored directory handle
  try {
    const handle = await loadHandle();
    if (handle) {
      const permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission === 'granted') {
        await writeFile(handle, artifact.filename, artifact.bytes);
        return -1; // No download ID needed
      }
    }
  } catch {
    // Fall through to chrome.downloads
  }

  const settings = await getSettings();

  let url = '';
  let shouldRevoke = false;
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const blobPart: BlobPart = artifact.bytes.slice().buffer;
    const blob = new Blob([blobPart], { type: artifact.mimeType });
    url = URL.createObjectURL(blob);
    shouldRevoke = true;
  } else {
    const base64 = base64FromBytes(artifact.bytes);
    url = `data:${artifact.mimeType};base64,${base64}`;
  }

  const downloadId = await downloadsDownload({
    url,
    filename: artifact.filename,
    saveAs: !settings.useDefaultDownloads
  });

  if (shouldRevoke) {
    pendingDownloads.set(downloadId, url);
  }
  return downloadId;
}

chrome.downloads.onChanged.addListener((delta: chrome.downloads.DownloadDelta) => {
  if (!delta.state) {
    return;
  }
  if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
    const url = pendingDownloads.get(delta.id);
    if (url) {
      URL.revokeObjectURL(url);
      pendingDownloads.delete(delta.id);
    }
  }
});

type BuildTabsResult =
  | {
      bytes: Uint8Array;
      filename: string;
      failures: Array<{ tab: chrome.tabs.Tab; error: string }>;
      articleCount: number;
      assetsCount: number;
    }
  | {
      bytes: null;
      filename: null;
      failures: Array<{ tab: chrome.tabs.Tab; error: string }>;
      articleCount: 0;
      assetsCount: 0;
    };

async function buildEpubFromTabs(tabs: chrome.tabs.Tab[], now: Date = new Date()): Promise<BuildTabsResult> {
  const { articles, failures } = await extractArticles(tabs);
  if (articles.length === 0) {
    return { bytes: null, filename: null, failures, articleCount: 0, assetsCount: 0 };
  }
  const embedded = await embedImages(articles);
  const title = articles.length === 1 ? articles[0].title : undefined;
  const outputFilename = buildFilenameForArticles(embedded.articles, now);
  const { bytes, filename } = buildEpub(embedded.articles, {
    title,
    assets: embedded.assets,
    filename: outputFilename
  });
  return {
    bytes,
    filename,
    failures,
    articleCount: embedded.articles.length,
    assetsCount: embedded.assets.length
  };
}

interface BuildOutputsResult {
  artifacts: OutputArtifact[];
  failures: Array<{ tab: chrome.tabs.Tab; error: string }>;
  articleCount: number;
  assetsCount: number;
}

interface SaveWarningResult {
  warning: string | null;
  tooLargeForEmail: string[];
}

async function buildOutputArtifactsFromTabs(tabs: chrome.tabs.Tab[], now: Date = new Date()): Promise<BuildOutputsResult> {
  const split = await splitTabsByPdf(tabs);
  const failures: Array<{ tab: chrome.tabs.Tab; error: string }> = [...split.failures];
  const artifacts: OutputArtifact[] = [];
  const usedFilenames = new Set<string>();
  let articleCount = 0;
  let assetsCount = 0;

  if (split.articleTabs.length > 0) {
    const epubResult = await buildEpubFromTabs(split.articleTabs, now);
    failures.push(...epubResult.failures);
    articleCount = epubResult.articleCount;
    assetsCount = epubResult.assetsCount;
    if (epubResult.bytes && epubResult.filename) {
      const epubFilename = ensureUniqueFilename(epubResult.filename, usedFilenames);
      artifacts.push({
        filename: epubFilename,
        mimeType: EPUB_MIME_TYPE,
        bytes: epubResult.bytes
      });
    }
  }

  if (split.pdfTabs.length > 0) {
    const pdfResult = await buildPdfArtifacts(split.pdfTabs, now, usedFilenames);
    artifacts.push(...pdfResult.artifacts);
    failures.push(...pdfResult.failures);
  }

  return {
    artifacts,
    failures,
    articleCount,
    assetsCount
  };
}

async function maybeEmailArtifacts(artifacts: OutputArtifact[], emailToKindle: boolean): Promise<SaveWarningResult> {
  if (!emailToKindle) {
    return { warning: null, tooLargeForEmail: [] };
  }

  try {
    const settings = await getSettings();
    const kindleEmail = requireKindleEmail(settings.kindleEmail);
    if (settings.testMode) {
      return { warning: null, tooLargeForEmail: [] };
    }
    const tooLargeOriginal = await emailArtifactsToKindleCollectTooLarge(artifacts, kindleEmail);
    const tooLargeForEmail = applyTooLargeEmailPrefix(artifacts, tooLargeOriginal);
    if (tooLargeForEmail.length > 0) {
      return {
        warning: 'Some files are too large for Kindle email and were saved with "TOO LARGE FOR EMAIL" prefixes.',
        tooLargeForEmail
      };
    }
    return { warning: null, tooLargeForEmail: [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Email delivery failed:', message);
    return { warning: `Email delivery failed: ${message}`, tooLargeForEmail: [] };
  }
}

async function handleSaveTabs(
  tabs: chrome.tabs.Tab[],
  { closeTabs = false, emailToKindle = false }: { closeTabs?: boolean; emailToKindle?: boolean } = {}
): Promise<SaveWarningResult> {
  const result = await buildOutputArtifactsFromTabs(tabs);
  if (result.artifacts.length === 0) {
    console.warn('No output files generated', result.failures);
    return { warning: 'No output files generated.', tooLargeForEmail: [] };
  }
  const emailResult = await maybeEmailArtifacts(result.artifacts, emailToKindle);

  const saveErrors: string[] = [];
  for (const artifact of result.artifacts) {
    try {
      await downloadArtifact(artifact);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      saveErrors.push(`${artifact.filename}: ${message}`);
    }
  }

  if (saveErrors.length > 0) {
    throw new Error(`Some files could not be saved: ${saveErrors.join('; ')}`);
  }

  if (closeTabs) {
    const ids = tabs.map((tab) => tab.id).filter((id): id is number => typeof id === 'number');
    if (ids.length > 0) {
      await tabsRemove(ids);
    }
  }
  return emailResult;
}

async function registerContextMenus(): Promise<void> {
  const menuContexts: chrome.contextMenus.ContextType[] = ['page', 'action'];
  const settings = await getSettings();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_PARENT,
      title: 'Tabs to EPUB & Kindle',
      contexts: menuContexts
    });
    chrome.contextMenus.create({
      id: MENU_SAVE,
      parentId: MENU_PARENT,
      title: 'Save tab(s) to EPUB',
      contexts: menuContexts
    });
    chrome.contextMenus.create({
      id: MENU_SAVE_CLOSE,
      parentId: MENU_PARENT,
      title: 'Save tab(s) to EPUB and close',
      contexts: menuContexts
    });
    chrome.contextMenus.create({
      id: MENU_EMAIL_KINDLE,
      parentId: MENU_PARENT,
      title: 'Email to Kindle',
      type: 'checkbox',
      checked: settings.emailToKindle,
      contexts: menuContexts
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  registerContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  registerContextMenus();
});

// Ensure menus exist if the service worker wakes outside install/startup events.
registerContextMenus();

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_EMAIL_KINDLE) {
    const checked = Boolean(info.checked);
    await setSettings({ emailToKindle: checked });
    return;
  }
  const settings = await getSettings();
  const tabs = await getTargetTabs(tab);
  switch (info.menuItemId) {
    case MENU_SAVE:
      {
        const saveResult = await handleSaveTabs(tabs, { closeTabs: false, emailToKindle: settings.emailToKindle });
        if (saveResult.warning) {
          console.warn(saveResult.warning);
        }
      }
      break;
    case MENU_SAVE_CLOSE:
      {
        const saveResult = await handleSaveTabs(tabs, { closeTabs: true, emailToKindle: settings.emailToKindle });
        if (saveResult.warning) {
          console.warn(saveResult.warning);
        }
      }
      break;
    default:
      break;
  }
});

chrome.action.onClicked.addListener(async () => {
  const tabs = await tabsQuery({ active: true, currentWindow: true });
  if (tabs.length > 0) {
    const saveResult = await handleSaveTabs(tabs, { closeTabs: false });
    if (saveResult.warning) {
      console.warn(saveResult.warning);
    }
  }
});

async function requireTestMode(): Promise<void> {
  const settings = await getSettings();
  if (!settings.testMode) {
    throw new Error('Test mode disabled');
  }
}

function serializeTestResult(result: BuildTabsResult & { bytes: Uint8Array; filename: string }): TestSaveResponse {
  return {
    ok: true,
    bytesBase64: base64FromBytes(result.bytes),
    filename: result.filename,
    failures: result.failures,
    articleCount: result.articleCount,
    assetsCount: result.assetsCount
  };
}

function isTestMessage(message: unknown): message is TestMessage {
  return Boolean(message) && typeof message === 'object' && typeof (message as TestMessage).type === 'string';
}

function isUiMessage(message: unknown): message is UiMessage {
  return Boolean(message) && typeof message === 'object' && typeof (message as UiMessage).type === 'string';
}

chrome.runtime.onMessage.addListener(
  (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: TestResponse) => void) => {
    if (!isTestMessage(message) || !message.type.startsWith('TEST_')) {
      return;
    }

    if (!isTrustedSender(sender)) {
      sendResponse({ ok: false, error: 'Unauthorized' });
      return;
    }

    (async (): Promise<TestResponse> => {
      switch (message.type) {
        case 'TEST_SET_MODE': {
          const enabled = Boolean(message.enabled);
          await setSettings({ testMode: enabled });
          return { ok: true };
        }
        case 'TEST_RESET_STATE': {
          await setSettings({ testMode: true, kindleEmail: null, useDefaultDownloads: false, emailToKindle: false });
          return { ok: true };
        }
        case 'TEST_LIST_TABS': {
          await requireTestMode();
          const tabs = await tabsQuery({ currentWindow: true });
          return {
            ok: true,
            tabs: tabs.map((tab) => ({
              id: tab.id,
              url: tab.url,
              title: tab.title,
              active: tab.active
            }))
          };
        }
        case 'TEST_SAVE_ACTIVE_TAB': {
          await requireTestMode();
          const tabs = await tabsQuery({ active: true, currentWindow: true });
          const result = await buildEpubFromTabs(tabs);
          if (!result.bytes || !result.filename) {
            return { ok: false, error: 'No articles extracted', failures: result.failures };
          }
          return serializeTestResult({ ...result, bytes: result.bytes, filename: result.filename });
        }
        case 'TEST_SAVE_TAB_IDS': {
          await requireTestMode();
          const requested = Array.isArray(message.tabIds) ? message.tabIds : [];
          const tabs = await tabsQuery({ currentWindow: true });
          const tabMap = new Map<number, chrome.tabs.Tab>();
          tabs.forEach((tab) => {
            if (typeof tab.id === 'number') {
              tabMap.set(tab.id, tab);
            }
          });
          const selected = requested
            .map((id) => tabMap.get(id))
            .filter((tab): tab is chrome.tabs.Tab => Boolean(tab));
          const result = await buildEpubFromTabs(selected);
          if (!result.bytes || !result.filename) {
            return { ok: false, error: 'No articles extracted', failures: result.failures };
          }
          return serializeTestResult({ ...result, bytes: result.bytes, filename: result.filename });
        }
        default:
          return { ok: false, error: 'Unknown test command' };
      }
    })()
      .then((response) => sendResponse(response))
      .catch((err) => {
        const errorMessage = err instanceof Error ? err.message : 'Test command failed';
        sendResponse({ ok: false, error: errorMessage });
      });

    return true;
  }
);

chrome.runtime.onMessage.addListener(
  (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: UiResponse) => void) => {
    if (!isUiMessage(message) || !message.type.startsWith('UI_')) {
      return;
    }

    if (!isTrustedSender(sender)) {
      sendResponse({ ok: false, error: 'Unauthorized' });
      return;
    }

    (async (): Promise<UiResponse> => {
      switch (message.type) {
        case 'UI_SAVE_TAB_IDS': {
          const requested = Array.isArray(message.tabIds) ? message.tabIds : [];
          if (requested.length === 0) {
            return { ok: false, error: 'No tabs selected' };
          }
          const tabs = await tabsQuery({ currentWindow: true });
          const tabMap = new Map<number, chrome.tabs.Tab>();
          tabs.forEach((tab) => {
            if (typeof tab.id === 'number') {
              tabMap.set(tab.id, tab);
            }
          });
          const selected = requested
            .map((id) => tabMap.get(id))
            .filter((tab): tab is chrome.tabs.Tab => Boolean(tab));
          if (selected.length === 0) {
            return { ok: false, error: 'No tabs selected' };
          }
          const saveResult = await handleSaveTabs(selected, {
            closeTabs: Boolean(message.closeTabs),
            emailToKindle: Boolean(message.emailToKindle)
          });
          return saveResult.warning || saveResult.tooLargeForEmail.length > 0
            ? { ok: true, ...(saveResult.warning ? { warning: saveResult.warning } : {}), ...(saveResult.tooLargeForEmail.length > 0 ? { tooLargeForEmail: saveResult.tooLargeForEmail } : {}) }
            : { ok: true };
        }
        case 'UI_CLEAR_DIRECTORY': {
          await clearHandle();
          await setSettings({ useDefaultDownloads: false });
          return { ok: true };
        }
        case 'UI_SET_DEFAULT_DOWNLOADS': {
          const enabled = Boolean(message.enabled);
          if (enabled) {
            await clearHandle();
          }
          await setSettings({ useDefaultDownloads: enabled });
          return { ok: true };
        }
        case 'UI_BUILD_EPUB': {
          const requested = Array.isArray(message.tabIds) ? message.tabIds : [];
          if (requested.length === 0) {
            return { ok: false, error: 'No tabs selected' };
          }
          const allTabs = await tabsQuery({ currentWindow: true });
          const tabMap = new Map<number, chrome.tabs.Tab>();
          allTabs.forEach((tab) => {
            if (typeof tab.id === 'number') {
              tabMap.set(tab.id, tab);
            }
          });
          const selected = requested
            .map((id) => tabMap.get(id))
            .filter((tab): tab is chrome.tabs.Tab => Boolean(tab));
          if (selected.length === 0) {
            return { ok: false, error: 'No tabs selected' };
          }
          const result = await buildOutputArtifactsFromTabs(selected);
          if (result.artifacts.length === 0) {
            return { ok: false, error: 'No output files generated' };
          }

          const emailResult = await maybeEmailArtifacts(result.artifacts, Boolean(message.emailToKindle));

          if (message.closeTabs) {
            const ids = selected.map((tab) => tab.id).filter((id): id is number => typeof id === 'number');
            if (ids.length > 0) {
              await tabsRemove(ids);
            }
          }

          const files = result.artifacts.map((artifact) => ({
            filename: artifact.filename,
            mimeType: artifact.mimeType,
            base64: base64FromBytes(artifact.bytes)
          }));
          const epubArtifact = result.artifacts.find((artifact) => artifact.mimeType === EPUB_MIME_TYPE);
          const response: UiBuildEpubResponse = {
            ok: true,
            files,
            ...(emailResult.warning ? { warning: emailResult.warning } : {}),
            ...(emailResult.tooLargeForEmail.length > 0 ? { tooLargeForEmail: emailResult.tooLargeForEmail } : {}),
            ...(epubArtifact
              ? {
                  epubBase64: base64FromBytes(epubArtifact.bytes),
                  filename: epubArtifact.filename
                }
              : {})
          };
          return response;
        }
        case 'UI_SET_EMAIL_TO_KINDLE': {
          const enabled = Boolean(message.enabled);
          await setSettings({ emailToKindle: enabled });
          chrome.contextMenus.update(MENU_EMAIL_KINDLE, { checked: enabled });
          return { ok: true };
        }
        case 'UI_SET_KINDLE_EMAIL': {
          const kindleEmail = normalizeKindleEmail(message.email);
          if (kindleEmail && !isKindleEmailValid(kindleEmail)) {
            return { ok: false, error: 'Invalid Kindle email address' };
          }
          await setSettings({ kindleEmail });
          return { ok: true };
        }
        case 'UI_GET_SETTINGS': {
          const settings = await getSettings();
          return { ok: true, settings };
        }
        default:
          return { ok: false, error: 'Unknown command' };
      }
    })()
      .then((response) => sendResponse(response))
      .catch((err) => {
        const errorMessage = err instanceof Error ? err.message : 'Request failed';
        sendResponse({ ok: false, error: errorMessage });
      });

    return true;
  }
);
