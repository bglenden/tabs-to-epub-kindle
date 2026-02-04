import { chromium, test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLocalFiles } from '../helpers.js';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO4B9pUAAAAASUVORK5CYII=';
const PNG_BYTES = Buffer.from(PNG_BASE64, 'base64');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../dist');
const baseUrl = 'https://example.test';

interface ExtensionLaunchResult {
  context: BrowserContext;
  testPage: Page;
  extensionId: string;
}

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
    // Keep all profile data inside the temp directory for sandboxed runs.
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
  await testPage.waitForFunction(() => Boolean((window as any).TabToEpubTest), undefined, {
    timeout: 10000
  });
  await testPage.evaluate(() =>
    (window as any).TabToEpubTest.send({ type: 'TEST_SET_MODE', enabled: true })
  );
  await testPage.evaluate(() => (window as any).TabToEpubTest.send({ type: 'TEST_RESET_STATE' }));

  return { context, testPage, extensionId };
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

interface TestSaveResult {
  bytesBase64: string;
}

interface TestSaveResponse extends TestSaveResult {
  ok: boolean;
  assetsCount: number;
  articleCount: number;
  filename?: string;
}

interface TestListTabsResponse {
  ok: boolean;
  tabs: Array<{ id?: number; url?: string; title?: string; active?: boolean }>;
}

function decodeZip(result: TestSaveResult) {
  const bytes = new Uint8Array(Buffer.from(result.bytesBase64, 'base64'));
  const files = readLocalFiles(bytes);
  const text = (data: Uint8Array) => new TextDecoder().decode(data);
  const fileMap = new Map(files.map((file) => [file.name, text(file.data)]));
  return { files, fileMap };
}

async function setupRoutes(context: BrowserContext): Promise<void> {
  await context.route(`${baseUrl}/image.png`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: PNG_BYTES
    })
  );

  await context.route(`${baseUrl}/article.html`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Article One</title>
  </head>
  <body>
    <article>
      <h1>Article One</h1>
      <p>Hello from the first article.</p>
      <img src="${baseUrl}/image.png" alt="Pixel" />
    </article>
  </body>
</html>`
    })
  );

  await context.route(`${baseUrl}/article2.html`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Article Two</title>
  </head>
  <body>
    <article>
      <h1>Article Two</h1>
      <p>Second article content.</p>
    </article>
  </body>
</html>`
    })
  );
}

test('embeds images from article content', async () => {
  const { context, testPage } = await launchWithExtension();

  try {
    await setupRoutes(context);
    const page = await context.newPage();
    await page.goto(`${baseUrl}/article.html`, { waitUntil: 'load' });
    await page.bringToFront();

    const result = await testPage.evaluate<TestSaveResponse>(() =>
      (window as any).TabToEpubTest.send({ type: 'TEST_SAVE_ACTIVE_TAB' })
    );

    expect(result.ok).toBeTruthy();
    expect(result.assetsCount).toBeGreaterThan(0);

    const { files, fileMap } = decodeZip(result);
    expect(files.some((file) => file.name === 'OEBPS/images/image-1.png')).toBeTruthy();

    const section = fileMap.get('OEBPS/section-1.xhtml');
    expect(section).toContain('images/image-1.png');
  } finally {
    await context.close();
  }
});

test('creates a TOC for multiple tabs', async () => {
  const { context, testPage } = await launchWithExtension();

  try {
    await setupRoutes(context);
    const page1 = await context.newPage();
    await page1.goto(`${baseUrl}/article.html`, { waitUntil: 'load' });
    const page2 = await context.newPage();
    await page2.goto(`${baseUrl}/article2.html`, { waitUntil: 'load' });

    const list = await testPage.evaluate<TestListTabsResponse>(() =>
      (window as any).TabToEpubTest.send({ type: 'TEST_LIST_TABS' })
    );

    const tabIds = list.tabs
      .filter((tab) => tab.url && tab.url.startsWith(baseUrl))
      .map((tab) => tab.id)
      .filter((id): id is number => typeof id === 'number');

    expect(tabIds.length).toBe(2);

    const result = await testPage.evaluate<TestSaveResponse>(
      (ids) => (window as any).TabToEpubTest.send({ type: 'TEST_SAVE_TAB_IDS', tabIds: ids }),
      tabIds
    );

    expect(result.ok).toBeTruthy();
    expect(result.articleCount).toBe(2);

    const { fileMap } = decodeZip(result);
    const nav = fileMap.get('OEBPS/nav.xhtml');
    expect(nav).toContain('Article One');
    expect(nav).toContain('Article Two');
  } finally {
    await context.close();
  }
});
