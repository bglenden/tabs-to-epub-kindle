import { chromium, test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLocalFiles, extractText } from '../helpers.js';
import type { TestMessage, TestResponse, UiMessage, UiResponse } from '../../src/extension/types.js';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO4B9pUAAAAASUVORK5CYII=';
const PNG_BYTES = Buffer.from(PNG_BASE64, 'base64');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../dist');
const baseUrl = 'https://example.test';

const COMPLEX_ARTICLES = [
  {
    path: '/complex-1.html',
    title: 'Complex Article One',
    lead: 'Lead paragraph for complex article one.',
    body: 'Body content for complex article one. It has enough text to be meaningful.',
    tail: 'Closing paragraph for complex article one.',
    includeImage: true
  },
  {
    path: '/complex-2.html',
    title: 'Complex Article Two',
    lead: 'Lead paragraph for complex article two.',
    body: 'Body content for complex article two. It also has enough text to be meaningful.',
    tail: 'Closing paragraph for complex article two.',
    includeImage: false
  },
  {
    path: '/complex-3.html',
    title: 'Complex Article Three',
    lead: 'Lead paragraph for complex article three.',
    body: 'Body content for complex article three. This one mentions a unique phrase: yellow submarine.',
    tail: 'Closing paragraph for complex article three.',
    includeImage: false
  },
  {
    path: '/complex-4.html',
    title: 'Complex Article Four',
    lead: 'Lead paragraph for complex article four.',
    body: 'Body content for complex article four. This one mentions a unique phrase: polar night.',
    tail: 'Closing paragraph for complex article four.',
    includeImage: true
  }
];

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
  await testPage.waitForFunction(
    () => Boolean((window as { TabToEpubTest?: TestApi }).TabToEpubTest),
    undefined,
    {
      timeout: 10000
    }
  );
  await sendTestMessage(testPage, { type: 'TEST_SET_MODE', enabled: true });
  await sendTestMessage(testPage, { type: 'TEST_RESET_STATE' });

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

type TestApi = {
  send: (message: TestMessage) => Promise<TestResponse>;
  sendUi?: (message: UiMessage) => Promise<UiResponse>;
};

async function sendTestMessage<T extends TestResponse>(page: Page, message: TestMessage): Promise<T> {
  return page.evaluate((msg) => {
    const api = (window as { TabToEpubTest?: TestApi }).TabToEpubTest;
    if (!api) {
      throw new Error('TabToEpubTest API not available');
    }
    return api.send(msg);
  }, message) as Promise<T>;
}

function decodeZip(result: TestSaveResult) {
  const bytes = new Uint8Array(Buffer.from(result.bytesBase64, 'base64'));
  const files = readLocalFiles(bytes);
  const text = (data: Uint8Array) => new TextDecoder().decode(data);
  const fileMap = new Map(files.map((file) => [file.name, text(file.data)]));
  return { files, fileMap };
}

function getSectionText(fileMap: Map<string, string>, index: number): string {
  const html = fileMap.get(`OEBPS/section-${index}.xhtml`) || '';
  return extractText(html);
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

function makeComplexArticleHtml({
  title,
  lead,
  body,
  tail,
  includeImage
}: {
  title: string;
  lead: string;
  body: string;
  tail: string;
  includeImage: boolean;
}): string {
  const imageBlock = includeImage
    ? `<figure>
        <img src="${baseUrl}/image.png" alt="Pixel" />
        <figcaption>Photo by Example</figcaption>
      </figure>`
    : '';
  const relatedList = Array.from({ length: 10 })
    .map((_, i) => `<li><a href="${baseUrl}/related-${i}.html">Related headline ${i + 1}</a></li>`)
    .join('\n');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
  </head>
  <body>
    <header class="site-header">
      <nav class="nav primary-nav">
        <a href="${baseUrl}/home">Home</a>
        <a href="${baseUrl}/world">World</a>
        <a href="${baseUrl}/politics">Politics</a>
      </nav>
    </header>
    <div role="dialog" aria-label="Manage Cookies" class="cookie-banner">
      <p>Manage Cookies</p>
      <button>Accept</button>
    </div>
    <main>
      <article>
        <h1>${title}</h1>
        <p>${lead}</p>
        <p>${body}</p>
        ${imageBlock}
        <p>${tail}</p>
      </article>
      <aside class="promo subscribe">Subscribe now for updates.</aside>
      <section class="recirc-widget" data-uri="/_components/recirc/instances/example@published">
        <h2>Related stories</h2>
        <ul class="container_list-headlines-ranked">
          ${relatedList}
        </ul>
      </section>
      <div class="ad-slot">Advertisement</div>
    </main>
    <footer class="site-footer">Footer links</footer>
  </body>
</html>`;
}

async function setupComplexRoutes(context: BrowserContext): Promise<void> {
  await context.route(`${baseUrl}/image.png`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: PNG_BYTES
    })
  );

  for (const article of COMPLEX_ARTICLES) {
    await context.route(`${baseUrl}${article.path}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: makeComplexArticleHtml(article)
      })
    );
  }
}

test('embeds images from article content', async () => {
  const { context, testPage } = await launchWithExtension();

  try {
    await setupRoutes(context);
    const page = await context.newPage();
    await page.goto(`${baseUrl}/article.html`, { waitUntil: 'load' });
    await page.bringToFront();

    const result = await sendTestMessage<TestSaveResponse>(testPage, { type: 'TEST_SAVE_ACTIVE_TAB' });

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

    const list = await sendTestMessage<TestListTabsResponse>(testPage, { type: 'TEST_LIST_TABS' });

    const tabByUrl = new Map(list.tabs.map((tab) => [tab.url, tab.id]));
    const tabIds = [`${baseUrl}/article.html`, `${baseUrl}/article2.html`]
      .map((url) => tabByUrl.get(url))
      .filter((id): id is number => typeof id === 'number');

    expect(tabIds.length).toBe(2);

    const result = await sendTestMessage<TestSaveResponse>(testPage, {
      type: 'TEST_SAVE_TAB_IDS',
      tabIds
    });

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

test('extracts from complex layouts and strips boilerplate', async () => {
  const { context, testPage } = await launchWithExtension();

  try {
    await setupComplexRoutes(context);
    const page = await context.newPage();
    await page.goto(`${baseUrl}${COMPLEX_ARTICLES[0].path}`, { waitUntil: 'load' });
    await page.bringToFront();

    const result = await sendTestMessage<TestSaveResponse>(testPage, { type: 'TEST_SAVE_ACTIVE_TAB' });

    expect(result.ok).toBeTruthy();
    expect(result.assetsCount).toBeGreaterThan(0);

    const { files, fileMap } = decodeZip(result);
    expect(files.some((file) => file.name === 'OEBPS/images/image-1.png')).toBeTruthy();

    const sectionText = getSectionText(fileMap, 1);
    expect(sectionText).toContain(COMPLEX_ARTICLES[0].lead);
    expect(sectionText).toContain(COMPLEX_ARTICLES[0].tail);
    expect(sectionText).not.toContain('Manage Cookies');
    expect(sectionText).not.toContain('Subscribe now');
    expect(sectionText).not.toContain('Related stories');
    expect(sectionText).not.toContain('Advertisement');
  } finally {
    await context.close();
  }
});

test('creates a TOC for multiple complex tabs', async () => {
  const { context, testPage } = await launchWithExtension();

  try {
    await setupComplexRoutes(context);
    for (const article of COMPLEX_ARTICLES) {
      const page = await context.newPage();
      await page.goto(`${baseUrl}${article.path}`, { waitUntil: 'load' });
    }

    const list = await sendTestMessage<TestListTabsResponse>(testPage, { type: 'TEST_LIST_TABS' });

    const tabIds = list.tabs
      .filter((tab) => tab.url && tab.url.startsWith(baseUrl))
      .map((tab) => tab.id)
      .filter((id): id is number => typeof id === 'number');

    expect(tabIds.length).toBe(COMPLEX_ARTICLES.length);

    const result = await sendTestMessage<TestSaveResponse>(testPage, {
      type: 'TEST_SAVE_TAB_IDS',
      tabIds
    });

    expect(result.ok).toBeTruthy();
    expect(result.articleCount).toBe(COMPLEX_ARTICLES.length);

    const { fileMap } = decodeZip(result);
    const nav = fileMap.get('OEBPS/nav.xhtml') || '';
    for (const article of COMPLEX_ARTICLES) {
      expect(nav).toContain(article.title);
    }

    COMPLEX_ARTICLES.forEach((article, index) => {
      const sectionText = getSectionText(fileMap, index + 1);
      expect(sectionText).toContain(article.lead);
      expect(sectionText).toContain(article.tail);
      expect(sectionText).not.toContain('Manage Cookies');
      expect(sectionText).not.toContain('Subscribe now');
      expect(sectionText).not.toContain('Related stories');
      expect(sectionText).not.toContain('Advertisement');
    });
  } finally {
    await context.close();
  }
});

const realWebUrls = (process.env.REAL_WEB_URLS || '')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);

test.describe('real web (optional)', () => {
  test.skip(realWebUrls.length === 0, 'Set REAL_WEB_URLS to run live-site extraction.');

  test('extracts from live pages', async () => {
    const { context, testPage } = await launchWithExtension();

    try {
      const pages: Page[] = [];
      const resolvedUrls: string[] = [];
      for (const url of realWebUrls) {
        const page = await context.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        pages.push(page);
        resolvedUrls.push(page.url());
      }

      const list = await sendTestMessage<TestListTabsResponse>(testPage, { type: 'TEST_LIST_TABS' });

      const tabIds = resolvedUrls
        .map((url) => list.tabs.find((tab) => tab.url && tab.url.startsWith(url))?.id)
        .filter((id): id is number => typeof id === 'number');

      expect(tabIds.length).toBe(resolvedUrls.length);

      const result = await sendTestMessage<TestSaveResponse>(testPage, {
        type: 'TEST_SAVE_TAB_IDS',
        tabIds
      });

      expect(result.ok).toBeTruthy();
      expect(result.articleCount).toBe(resolvedUrls.length);

      const { fileMap } = decodeZip(result);
      resolvedUrls.forEach((url, index) => {
        const sectionText = getSectionText(fileMap, index + 1);
        expect(sectionText.length).toBeGreaterThan(2000);
        expect(sectionText).toContain('Source: ' + url);
      });

      await Promise.all(pages.map((page) => page.close()));
    } finally {
      await context.close();
    }
  });
});
