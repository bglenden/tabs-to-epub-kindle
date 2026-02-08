import { buildEpub } from '../core/epub.js';
import type { EpubAsset } from '../core/types.js';
import { buildFilenameForArticles } from './filename.js';
import { emailEpubToKindle, isKindleEmailValid, normalizeKindleEmail, requireKindleEmail } from './kindle-email.js';
import { clearHandle, loadHandle, writeFile } from './directory-handle.js';
import type {
  ExtractMessage,
  ExtractResponse,
  ExtractedArticleWithTab,
  EmbeddedResult,
  ImageToken,
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

const IMAGE_TYPE_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico'
};

const IMAGE_EXT_TO_TYPE: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon'
};

function parseContentType(value: string | null): string {
  if (!value) return '';
  return String(value).split(';')[0].trim().toLowerCase();
}

function extensionFromUrl(url: string): string {
  try {
    const { pathname } = new URL(url);
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    if (match) {
      return match[1].toLowerCase();
    }
  } catch {
    // ignore
  }
  return '';
}

async function fetchImageBytes(
  url: string
): Promise<{ buffer: Uint8Array; contentType: string }> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Image fetch failed (${response.status})`);
  }
  const contentType = parseContentType(response.headers.get('content-type'));
  const buffer = new Uint8Array(await response.arrayBuffer());
  return { buffer, contentType };
}

async function embedImages(articles: ExtractedArticleWithTab[]): Promise<EmbeddedResult> {
  const assets: EpubAsset[] = [];
  let imageIndex = 0;
  const updatedArticles: ExtractedArticleWithTab[] = [];

  for (const article of articles) {
    const images: ImageToken[] = Array.isArray(article.images) ? article.images : [];
    let content = article.content ?? '';

    for (const image of images) {
      const token = image.token;
      const sourceUrl = image.src;
      let replacement = sourceUrl;

      if (sourceUrl && /^https?:/i.test(sourceUrl)) {
        try {
          const { buffer, contentType } = await fetchImageBytes(sourceUrl);
          let ext = IMAGE_TYPE_TO_EXT[contentType] || extensionFromUrl(sourceUrl);
          let mediaType = contentType || IMAGE_EXT_TO_TYPE[ext];

          if (ext && !mediaType) {
            mediaType = IMAGE_EXT_TO_TYPE[ext];
          }
          if (!ext && mediaType) {
            ext = IMAGE_TYPE_TO_EXT[mediaType];
          }

          if (ext && mediaType) {
            imageIndex += 1;
            const href = `images/image-${imageIndex}.${ext}`;
            assets.push({
              path: `OEBPS/${href}`,
              href,
              mediaType,
              data: buffer
            });
            replacement = href;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn('Image fetch failed:', sourceUrl, message);
        }
      }

      if (token && content.includes(token)) {
        content = content.replaceAll(token, replacement);
      }
    }

    const { images: _images, ...rest } = article;
    void _images;
    updatedArticles.push({
      ...rest,
      content
    });
  }

  return { articles: updatedArticles, assets };
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

async function downloadEpub(bytes: Uint8Array, filename: string): Promise<number> {
  // Try writing directly via stored directory handle
  try {
    const handle = await loadHandle();
    if (handle) {
      const permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission === 'granted') {
        await writeFile(handle, filename, bytes);
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
    const blobPart: BlobPart = bytes.slice().buffer;
    const blob = new Blob([blobPart], { type: 'application/epub+zip' });
    url = URL.createObjectURL(blob);
    shouldRevoke = true;
  } else {
    const base64 = base64FromBytes(bytes);
    url = `data:application/epub+zip;base64,${base64}`;
  }

  const downloadId = await downloadsDownload({
    url,
    filename,
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

async function buildEpubFromTabs(tabs: chrome.tabs.Tab[]): Promise<BuildTabsResult> {
  const { articles, failures } = await extractArticles(tabs);
  if (articles.length === 0) {
    return { bytes: null, filename: null, failures, articleCount: 0, assetsCount: 0 };
  }
  const embedded = await embedImages(articles);
  const title = articles.length === 1 ? articles[0].title : undefined;
  const outputFilename = buildFilenameForArticles(embedded.articles);
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

async function handleSaveTabs(
  tabs: chrome.tabs.Tab[],
  { closeTabs = false, emailToKindle = false }: { closeTabs?: boolean; emailToKindle?: boolean } = {}
): Promise<void> {
  const result = await buildEpubFromTabs(tabs);
  if (!result.bytes) {
    console.warn('No articles extracted', result.failures);
    return;
  }

  let emailError: Error | null = null;
  if (emailToKindle) {
    try {
      const settings = await getSettings();
      const kindleEmail = requireKindleEmail(settings.kindleEmail);
      if (!settings.testMode) {
        await emailEpubToKindle(result.bytes, result.filename, kindleEmail);
      }
    } catch (err) {
      emailError = err instanceof Error ? err : new Error(String(err));
      console.error('Email delivery failed:', emailError.message);
    }
  }

  await downloadEpub(result.bytes, result.filename);

  if (emailError) {
    throw new Error(`EPUB was downloaded, but email delivery failed: ${emailError.message}`);
  }

  if (closeTabs) {
    const ids = tabs.map((tab) => tab.id).filter((id): id is number => typeof id === 'number');
    if (ids.length > 0) {
      await tabsRemove(ids);
    }
  }
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
      await handleSaveTabs(tabs, { closeTabs: false, emailToKindle: settings.emailToKindle });
      break;
    case MENU_SAVE_CLOSE:
      await handleSaveTabs(tabs, { closeTabs: true, emailToKindle: settings.emailToKindle });
      break;
    default:
      break;
  }
});

chrome.action.onClicked.addListener(async () => {
  const tabs = await tabsQuery({ active: true, currentWindow: true });
  if (tabs.length > 0) {
    await handleSaveTabs(tabs, { closeTabs: false });
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
          await handleSaveTabs(selected, {
            closeTabs: Boolean(message.closeTabs),
            emailToKindle: Boolean(message.emailToKindle)
          });
          return { ok: true };
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
          const result = await buildEpubFromTabs(selected);
          if (!result.bytes) {
            return { ok: false, error: 'No articles extracted' };
          }

          if (message.emailToKindle) {
            const settings = await getSettings();
            const kindleEmail = requireKindleEmail(settings.kindleEmail);
            if (!settings.testMode) {
              await emailEpubToKindle(result.bytes, result.filename, kindleEmail);
            }
          }

          if (message.closeTabs) {
            const ids = selected.map((tab) => tab.id).filter((id): id is number => typeof id === 'number');
            if (ids.length > 0) {
              await tabsRemove(ids);
            }
          }

          const response: UiBuildEpubResponse = {
            ok: true,
            epubBase64: base64FromBytes(result.bytes),
            filename: result.filename
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
