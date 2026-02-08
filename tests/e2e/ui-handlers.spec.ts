import { chromium, test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLocalFiles, extractText } from '../helpers.js';
import type { TestMessage, TestResponse, UiMessage, UiResponse, UiBuildEpubResponse } from '../../src/extension/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../dist');
const baseUrl = 'https://example.test';
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'utf8');

interface ExtensionLaunchResult {
  context: BrowserContext;
  testPage: Page;
  extensionId: string;
}

function resolveChromiumExecutable(): string | undefined {
  const expected = chromium.executablePath();
  if (fs.existsSync(expected)) {
    return expected;
  }
  const cacheRoot =
    process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(os.homedir(), 'Library/Caches/ms-playwright');
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(cacheRoot);
  } catch {
    return undefined;
  }
  const chromiumDir = entries.find((entry) => entry.startsWith('chromium-'));
  if (!chromiumDir) {
    return undefined;
  }
  const arm64Path = path.join(
    cacheRoot,
    chromiumDir,
    'chrome-mac-arm64',
    'Google Chrome for Testing.app',
    'Contents',
    'MacOS',
    'Google Chrome for Testing'
  );
  return fs.existsSync(arm64Path) ? arm64Path : undefined;
}

type TestApi = {
  send: (message: TestMessage) => Promise<TestResponse>;
  sendUi: (message: UiMessage) => Promise<UiResponse>;
};

async function launchWithExtension(): Promise<ExtensionLaunchResult> {
  const userDataDir = path.join(
    os.tmpdir(),
    `tabstoepub-playwright-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );

  const executablePath = resolveChromiumExecutable();
  const launchOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--disable-crashpad',
      '--disable-crash-reporter',
      '--disable-features=Crashpad'
    ],
    env: { ...process.env, HOME: userDataDir }
  };
  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }

  const context = await chromium.launchPersistentContext(userDataDir, launchOptions);

  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    try {
      serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    } catch {
      throw new Error(
        'Extension service worker did not start. Check that Chrome allows extensions in automation and that dist/ exists.'
      );
    }
  }
  const extensionId = new URL(serviceWorker.url()).host;

  const testPage = await context.newPage();
  await testPage.goto(`chrome-extension://${extensionId}/extension/test.html`);
  await testPage.waitForFunction(
    () => Boolean((window as { TabToEpubTest?: TestApi }).TabToEpubTest),
    undefined,
    { timeout: 10000 }
  );
  await sendTestMessage(testPage, { type: 'TEST_SET_MODE', enabled: true });
  await sendTestMessage(testPage, { type: 'TEST_RESET_STATE' });

  return { context, testPage, extensionId };
}

async function sendTestMessage<T extends TestResponse>(page: Page, message: TestMessage): Promise<T> {
  return page.evaluate((msg) => {
    const api = (window as { TabToEpubTest?: TestApi }).TabToEpubTest;
    if (!api) {
      throw new Error('TabToEpubTest API not available');
    }
    return api.send(msg);
  }, message) as Promise<T>;
}

async function sendUiMessage<T extends UiResponse>(page: Page, message: UiMessage): Promise<T> {
  return page.evaluate((msg) => {
    const api = (window as { TabToEpubTest?: TestApi }).TabToEpubTest;
    if (!api?.sendUi) {
      throw new Error('TabToEpubTest.sendUi API not available');
    }
    return api.sendUi(msg);
  }, message) as Promise<T>;
}

function decodeZip(base64: string) {
  const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
  const files = readLocalFiles(bytes);
  const text = (data: Uint8Array) => new TextDecoder().decode(data);
  const fileMap = new Map(files.map((file) => [file.name, text(file.data)]));
  return { files, fileMap };
}

// --- Tests ---

test('UI_GET_SETTINGS returns default settings after reset', async () => {
  const { context, testPage } = await launchWithExtension();

  try {
    const response = await sendUiMessage(testPage, { type: 'UI_GET_SETTINGS' });
    expect(response.ok).toBe(true);
    expect('settings' in response).toBe(true);
    if ('settings' in response) {
      expect(response.settings.kindleEmail).toBeNull();
      expect(response.settings.emailToKindle).toBe(false);
      expect(response.settings.useDefaultDownloads).toBe(false);
    }
  } finally {
    await context.close();
  }
});

test('UI_SET_KINDLE_EMAIL persists and validates', async () => {
  const { context, testPage } = await launchWithExtension();

  try {
    // Set a valid email
    const setResponse = await sendUiMessage(testPage, {
      type: 'UI_SET_KINDLE_EMAIL',
      email: 'Test@Kindle.com'
    });
    expect(setResponse.ok).toBe(true);

    // Verify it persists (normalized to lowercase)
    const settings = await sendUiMessage(testPage, { type: 'UI_GET_SETTINGS' });
    expect('settings' in settings && settings.settings.kindleEmail).toBe('test@kindle.com');

    // Invalid email should be rejected
    const invalid = await sendUiMessage(testPage, {
      type: 'UI_SET_KINDLE_EMAIL',
      email: 'not-an-email'
    });
    expect(invalid.ok).toBe(false);

    // Clear email
    const cleared = await sendUiMessage(testPage, {
      type: 'UI_SET_KINDLE_EMAIL',
      email: null
    });
    expect(cleared.ok).toBe(true);

    const afterClear = await sendUiMessage(testPage, { type: 'UI_GET_SETTINGS' });
    expect('settings' in afterClear && afterClear.settings.kindleEmail).toBeNull();
  } finally {
    await context.close();
  }
});

test('UI_SET_EMAIL_TO_KINDLE toggles setting', async () => {
  const { context, testPage } = await launchWithExtension();

  try {
    await sendUiMessage(testPage, { type: 'UI_SET_EMAIL_TO_KINDLE', enabled: true });
    const on = await sendUiMessage(testPage, { type: 'UI_GET_SETTINGS' });
    expect('settings' in on && on.settings.emailToKindle).toBe(true);

    await sendUiMessage(testPage, { type: 'UI_SET_EMAIL_TO_KINDLE', enabled: false });
    const off = await sendUiMessage(testPage, { type: 'UI_GET_SETTINGS' });
    expect('settings' in off && off.settings.emailToKindle).toBe(false);
  } finally {
    await context.close();
  }
});

test('UI_SET_DEFAULT_DOWNLOADS toggles setting', async () => {
  const { context, testPage } = await launchWithExtension();

  try {
    await sendUiMessage(testPage, { type: 'UI_SET_DEFAULT_DOWNLOADS', enabled: true });
    const on = await sendUiMessage(testPage, { type: 'UI_GET_SETTINGS' });
    expect('settings' in on && on.settings.useDefaultDownloads).toBe(true);

    await sendUiMessage(testPage, { type: 'UI_SET_DEFAULT_DOWNLOADS', enabled: false });
    const off = await sendUiMessage(testPage, { type: 'UI_GET_SETTINGS' });
    expect('settings' in off && off.settings.useDefaultDownloads).toBe(false);
  } finally {
    await context.close();
  }
});

test('UI_CLEAR_DIRECTORY resets useDefaultDownloads', async () => {
  const { context, testPage } = await launchWithExtension();

  try {
    // Enable downloads first
    await sendUiMessage(testPage, { type: 'UI_SET_DEFAULT_DOWNLOADS', enabled: true });
    const before = await sendUiMessage(testPage, { type: 'UI_GET_SETTINGS' });
    expect('settings' in before && before.settings.useDefaultDownloads).toBe(true);

    // Clear directory should reset useDefaultDownloads to false
    await sendUiMessage(testPage, { type: 'UI_CLEAR_DIRECTORY' });
    const after = await sendUiMessage(testPage, { type: 'UI_GET_SETTINGS' });
    expect('settings' in after && after.settings.useDefaultDownloads).toBe(false);
  } finally {
    await context.close();
  }
});

test('UI_BUILD_EPUB returns base64 epub and filename', async () => {
  const { context, testPage } = await launchWithExtension();

  try {
    await context.route(`${baseUrl}/build-test.html`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Build Test Article</title></head>
  <body>
    <article>
      <h1>Build Test Article</h1>
      <p>Content for the UI_BUILD_EPUB test.</p>
    </article>
  </body>
</html>`
      })
    );

    const page = await context.newPage();
    await page.goto(`${baseUrl}/build-test.html`, { waitUntil: 'load' });
    await page.bringToFront();

    // Get the tab ID
    interface TestListTabsResponse {
      ok: boolean;
      tabs: Array<{ id?: number; url?: string }>;
    }
    const list = await sendTestMessage<TestListTabsResponse>(testPage, { type: 'TEST_LIST_TABS' });
    const tab = list.tabs.find((t) => t.url === `${baseUrl}/build-test.html`);
    expect(tab?.id).toBeDefined();

    const result = await sendUiMessage<UiBuildEpubResponse>(testPage, {
      type: 'UI_BUILD_EPUB',
      tabIds: [tab!.id!]
    });

    expect(result.ok).toBe(true);
    expect(result.files.length).toBe(1);
    expect(result.epubBase64).toBeDefined();
    expect(result.filename).toMatch(/\.epub$/);
    const epubFile = result.files.find((file) => file.mimeType === 'application/epub+zip');
    expect(epubFile).toBeDefined();

    // Verify the EPUB content
    const { fileMap } = decodeZip(epubFile!.base64);
    const section = fileMap.get('OEBPS/section-1.xhtml') || '';
    const sectionText = extractText(section);
    expect(sectionText).toContain('Build Test Article');
    expect(sectionText).toContain('Content for the UI_BUILD_EPUB test');
  } finally {
    await context.close();
  }
});

test('UI_BUILD_EPUB returns a PDF file for PDF tabs', async () => {
  const { context, testPage } = await launchWithExtension();

  try {
    await context.route(`${baseUrl}/paper.pdf`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        body: PDF_BYTES
      })
    );

    const page = await context.newPage();
    await page.goto(`${baseUrl}/paper.pdf`, { waitUntil: 'load' });
    await page.bringToFront();

    interface TestListTabsResponse {
      ok: boolean;
      tabs: Array<{ id?: number; url?: string }>;
    }
    const list = await sendTestMessage<TestListTabsResponse>(testPage, { type: 'TEST_LIST_TABS' });
    const tab = list.tabs.find((entry) => entry.url?.includes('paper.pdf'));
    expect(tab?.id).toBeDefined();

    const result = await sendUiMessage<UiBuildEpubResponse>(testPage, {
      type: 'UI_BUILD_EPUB',
      tabIds: [tab!.id!]
    });

    expect(result.ok).toBe(true);
    expect(result.files.length).toBe(1);
    const pdf = result.files[0];
    expect(pdf.mimeType).toBe('application/pdf');
    expect(pdf.filename).toMatch(/\.pdf$/);
    expect(Buffer.from(pdf.base64, 'base64').subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(result.epubBase64).toBeUndefined();
  } finally {
    await context.close();
  }
});

test('UI_BUILD_EPUB detects PDF source from wrapper page heuristics', async () => {
  const { context, testPage } = await launchWithExtension();

  try {
    await context.route(`${baseUrl}/wrapped-paper.html`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Wrapped Paper</title></head>
  <body>
    <h1>Wrapper UI</h1>
    <script>
      (function () {
        // Simulates a PDF wrapper app that fetches the true PDF URL at runtime.
        const url = '${baseUrl}/fetcher/paper-heuristic-v1.pdf';
        window.__paperPromise = fetch(url);
      })();
    </script>
  </body>
</html>`
      })
    );
    await context.route(`${baseUrl}/fetcher/paper-heuristic-v1.pdf`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        body: PDF_BYTES
      })
    );

    const page = await context.newPage();
    await page.goto(`${baseUrl}/wrapped-paper.html`, { waitUntil: 'load' });
    await page.bringToFront();

    interface TestListTabsResponse {
      ok: boolean;
      tabs: Array<{ id?: number; url?: string }>;
    }
    const list = await sendTestMessage<TestListTabsResponse>(testPage, { type: 'TEST_LIST_TABS' });
    const tab = list.tabs.find((entry) => entry.url === `${baseUrl}/wrapped-paper.html`);
    expect(tab?.id).toBeDefined();

    const result = await sendUiMessage<UiBuildEpubResponse>(testPage, {
      type: 'UI_BUILD_EPUB',
      tabIds: [tab!.id!]
    });

    expect(result.ok).toBe(true);
    expect(result.files.length).toBe(1);
    expect(result.files[0].mimeType).toBe('application/pdf');
    expect(result.files[0].filename).toMatch(/\.pdf$/);
    expect(Buffer.from(result.files[0].base64, 'base64').subarray(0, 5).toString('utf8')).toBe('%PDF-');
  } finally {
    await context.close();
  }
});

test('UI_BUILD_EPUB skips invalid high-priority PDF candidates from wrapper pages', async () => {
  const { context, testPage } = await launchWithExtension();

  try {
    await context.route(`${baseUrl}/wrapped-priority.html`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Wrapped Priority</title></head>
  <body>
    <h1>Wrapper Priority</h1>
    <iframe src="${baseUrl}/broken-priority.pdf"></iframe>
    <script>
      (function () {
        const url = '${baseUrl}/valid-priority.pdf';
        window.__paperPromise = fetch(url);
      })();
    </script>
  </body>
</html>`
      })
    );
    await context.route(`${baseUrl}/broken-priority.pdf`, (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: '{"error":"not available"}'
      })
    );
    await context.route(`${baseUrl}/valid-priority.pdf`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        body: PDF_BYTES
      })
    );

    const page = await context.newPage();
    await page.goto(`${baseUrl}/wrapped-priority.html`, { waitUntil: 'load' });
    await page.bringToFront();

    interface TestListTabsResponse {
      ok: boolean;
      tabs: Array<{ id?: number; url?: string }>;
    }
    const list = await sendTestMessage<TestListTabsResponse>(testPage, { type: 'TEST_LIST_TABS' });
    const tab = list.tabs.find((entry) => entry.url === `${baseUrl}/wrapped-priority.html`);
    expect(tab?.id).toBeDefined();

    const result = await sendUiMessage<UiBuildEpubResponse>(testPage, {
      type: 'UI_BUILD_EPUB',
      tabIds: [tab!.id!]
    });

    expect(result.ok).toBe(true);
    expect(result.files.length).toBe(1);
    expect(result.files[0].mimeType).toBe('application/pdf');
    expect(Buffer.from(result.files[0].base64, 'base64').subarray(0, 5).toString('utf8')).toBe('%PDF-');
  } finally {
    await context.close();
  }
});

test('UI_BUILD_EPUB returns EPUB and PDF files for mixed tabs', async () => {
  const { context, testPage } = await launchWithExtension();

  try {
    await context.route(`${baseUrl}/mixed-article.html`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Mixed Test Article</title></head>
  <body>
    <article>
      <h1>Mixed Test Article</h1>
      <p>Content for mixed HTML and PDF tab testing.</p>
    </article>
  </body>
</html>`
      })
    );
    await context.route(`${baseUrl}/mixed-paper.pdf`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        body: PDF_BYTES
      })
    );

    const articlePage = await context.newPage();
    await articlePage.goto(`${baseUrl}/mixed-article.html`, { waitUntil: 'load' });
    const pdfPage = await context.newPage();
    await pdfPage.goto(`${baseUrl}/mixed-paper.pdf`, { waitUntil: 'load' });
    await pdfPage.bringToFront();

    interface TestListTabsResponse {
      ok: boolean;
      tabs: Array<{ id?: number; url?: string }>;
    }
    const list = await sendTestMessage<TestListTabsResponse>(testPage, { type: 'TEST_LIST_TABS' });
    const articleTab = list.tabs.find((entry) => entry.url === `${baseUrl}/mixed-article.html`);
    const pdfTab = list.tabs.find((entry) => entry.url?.includes('mixed-paper.pdf'));
    const articleTabId = articleTab?.id;
    const pdfTabId = pdfTab?.id;
    expect(articleTabId).toBeDefined();
    expect(pdfTabId).toBeDefined();

    const result = await sendUiMessage<UiBuildEpubResponse>(testPage, {
      type: 'UI_BUILD_EPUB',
      tabIds: [articleTabId!, pdfTabId!]
    });

    expect(result.ok).toBe(true);
    expect(result.files.length).toBe(2);
    const epubFile = result.files.find((file) => file.mimeType === 'application/epub+zip');
    const pdfFile = result.files.find((file) => file.mimeType === 'application/pdf');
    expect(epubFile).toBeDefined();
    expect(pdfFile).toBeDefined();

    const { fileMap } = decodeZip(epubFile!.base64);
    const section = fileMap.get('OEBPS/section-1.xhtml') || '';
    expect(extractText(section)).toContain('Content for mixed HTML and PDF tab testing');
    expect(Buffer.from(pdfFile!.base64, 'base64').subarray(0, 5).toString('utf8')).toBe('%PDF-');
  } finally {
    await context.close();
  }
});

test('UI_BUILD_EPUB with no tabs returns error', async () => {
  const { context, testPage } = await launchWithExtension();

  try {
    const result = await sendUiMessage(testPage, {
      type: 'UI_BUILD_EPUB',
      tabIds: []
    });
    expect(result.ok).toBe(false);
    expect('error' in result && result.error).toMatch(/No tabs/i);
  } finally {
    await context.close();
  }
});
