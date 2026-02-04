import { buildEpub } from '../core/epub.js';
import type { EpubAsset } from '../core/types.js';
import type {
  ExtractMessage,
  ExtractResponse,
  ExtractedArticleWithTab,
  EmbeddedResult,
  ImageToken,
  QueueEntry,
  Settings,
  TestMessage,
  TestQueueResponse,
  TestResponse,
  TestSaveResponse
} from './types.js';

const MENU_PARENT = 'tabstoepub-root';
const MENU_SAVE = 'tabstoepub-save';
const MENU_SAVE_CLOSE = 'tabstoepub-save-close';
const MENU_ADD_QUEUE = 'tabstoepub-add-queue';
const MENU_SAVE_QUEUE = 'tabstoepub-save-queue';
const MENU_CLEAR_QUEUE = 'tabstoepub-clear-queue';
const MENU_RESET_OUTPUT = 'tabstoepub-reset-output';

const SETTINGS_KEY = 'tabstoepub-settings';
const QUEUE_KEY = 'tabstoepub-queue';

const DEFAULT_SETTINGS: Settings = {
  outputDir: null,
  testMode: false
};

const pendingDownloads = new Map<number, string>();
const pendingDirCapture = new Set<number>();

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

    const { images: _ignored, ...rest } = article;
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

async function getQueue(): Promise<QueueEntry[]> {
  const queue = await storageGet<QueueEntry[]>(QUEUE_KEY);
  return Array.isArray(queue) ? queue : [];
}

async function setQueue(queue: QueueEntry[]): Promise<void> {
  await storageSet({ [QUEUE_KEY]: queue });
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

function downloadsSearch(query: chrome.downloads.DownloadQuery): Promise<chrome.downloads.DownloadItem[]> {
  return new Promise((resolve) => {
    chrome.downloads.search(query, (items) => resolve(items || []));
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

function buildOutputPath(outputDir: string | null, filename: string): string {
  if (!outputDir) {
    return filename;
  }
  const sanitized = outputDir.replace(/\\/g, '/').replace(/\/+$/, '');
  return `${sanitized}/${filename}`;
}

function dirname(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.slice(0, idx) : '';
}

async function downloadEpub(bytes: Uint8Array, filename: string): Promise<number> {
  const settings = await getSettings();
  const blobPart: BlobPart = bytes.slice().buffer;
  const blob = new Blob([blobPart], { type: 'application/epub+zip' });
  const url = URL.createObjectURL(blob);
  let downloadId: number;

  try {
    downloadId = await downloadsDownload({
      url,
      filename: buildOutputPath(settings.outputDir, filename),
      saveAs: !settings.outputDir
    });
  } catch (err) {
    await setSettings({ outputDir: null });
    downloadId = await downloadsDownload({
      url,
      filename,
      saveAs: true
    });
  }

  pendingDownloads.set(downloadId, url);
  if (!settings.outputDir) {
    pendingDirCapture.add(downloadId);
  }
  return downloadId;
}

chrome.downloads.onChanged.addListener(async (delta: chrome.downloads.DownloadDelta) => {
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
  if (delta.state.current === 'complete' && pendingDirCapture.has(delta.id)) {
    const items = await downloadsSearch({ id: delta.id });
    const item = items[0];
    if (item && item.filename) {
      const dir = dirname(item.filename);
      if (dir) {
        await setSettings({ outputDir: dir });
      }
    }
    pendingDirCapture.delete(delta.id);
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
  const { bytes, filename } = buildEpub(embedded.articles, {
    title,
    assets: embedded.assets
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
  { closeTabs = false }: { closeTabs?: boolean } = {}
): Promise<void> {
  const result = await buildEpubFromTabs(tabs);
  if (!result.bytes) {
    console.warn('No articles extracted', result.failures);
    return;
  }
  await downloadEpub(result.bytes, result.filename);
  if (closeTabs) {
    const ids = tabs.map((tab) => tab.id).filter((id): id is number => typeof id === 'number');
    if (ids.length > 0) {
      await tabsRemove(ids);
    }
  }
}

async function handleAddToQueue(tabs: chrome.tabs.Tab[]): Promise<void> {
  const queue = await getQueue();
  const existing = new Set(queue.map((entry) => entry.tabId));
  const additions = tabs
    .filter((tab) => typeof tab.id === 'number' && !existing.has(tab.id))
    .map((tab) => ({ tabId: tab.id as number, title: tab.title || 'Untitled' }));
  await setQueue([...queue, ...additions]);
}

async function handleSaveQueue(): Promise<void> {
  const queue = await getQueue();
  if (queue.length === 0) {
    return;
  }
  const tabs = await tabsQuery({ currentWindow: true });
  const tabMap = new Map<number, chrome.tabs.Tab>();
  tabs.forEach((tab) => {
    if (typeof tab.id === 'number') {
      tabMap.set(tab.id, tab);
    }
  });
  const queuedTabs = queue
    .map((entry) => tabMap.get(entry.tabId))
    .filter((tab): tab is chrome.tabs.Tab => Boolean(tab));
  await handleSaveTabs(queuedTabs, { closeTabs: false });
  await setQueue([]);
}

async function handleClearQueue(): Promise<void> {
  await setQueue([]);
}

async function handleResetOutput(): Promise<void> {
  await setSettings({ outputDir: null });
}

function registerContextMenus(): void {
  // Omit contexts entirely to use Chrome's default ("all") and avoid
  // platform-specific context validation failures.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_PARENT,
      title: 'Tabs to EPUB'
    });
    chrome.contextMenus.create({
      id: MENU_SAVE,
      parentId: MENU_PARENT,
      title: 'Save tab(s) to EPUB'
    });
    chrome.contextMenus.create({
      id: MENU_SAVE_CLOSE,
      parentId: MENU_PARENT,
      title: 'Save tab(s) to EPUB and close'
    });
    chrome.contextMenus.create({
      id: MENU_ADD_QUEUE,
      parentId: MENU_PARENT,
      title: 'Add tab(s) to EPUB queue'
    });
    chrome.contextMenus.create({
      id: MENU_SAVE_QUEUE,
      parentId: MENU_PARENT,
      title: 'Save queued tabs to EPUB'
    });
    chrome.contextMenus.create({
      id: MENU_CLEAR_QUEUE,
      parentId: MENU_PARENT,
      title: 'Clear EPUB queue'
    });
    chrome.contextMenus.create({
      id: MENU_RESET_OUTPUT,
      parentId: MENU_PARENT,
      title: 'Change output folder (prompt next save)'
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
  const tabs = await getTargetTabs(tab);
  switch (info.menuItemId) {
    case MENU_SAVE:
      await handleSaveTabs(tabs, { closeTabs: false });
      break;
    case MENU_SAVE_CLOSE:
      await handleSaveTabs(tabs, { closeTabs: true });
      break;
    case MENU_ADD_QUEUE:
      await handleAddToQueue(tabs);
      break;
    case MENU_SAVE_QUEUE:
      await handleSaveQueue();
      break;
    case MENU_CLEAR_QUEUE:
      await handleClearQueue();
      break;
    case MENU_RESET_OUTPUT:
      await handleResetOutput();
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
          await setQueue([]);
          await setSettings({ outputDir: null, testMode: true });
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
        case 'TEST_GET_QUEUE': {
          await requireTestMode();
          const queue = await getQueue();
          const response: TestQueueResponse = { ok: true, queue };
          return response;
        }
        case 'TEST_CLEAR_QUEUE': {
          await requireTestMode();
          await setQueue([]);
          return { ok: true };
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
