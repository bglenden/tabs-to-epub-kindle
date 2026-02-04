export {};

declare global {
  type TestMessage =
    | { type: 'TEST_SET_MODE'; enabled: boolean }
    | { type: 'TEST_RESET_STATE' }
    | { type: 'TEST_LIST_TABS' }
    | { type: 'TEST_SAVE_ACTIVE_TAB' }
    | { type: 'TEST_SAVE_TAB_IDS'; tabIds: number[] }
    | { type: 'TEST_GET_QUEUE' }
    | { type: 'TEST_CLEAR_QUEUE' };

  type TestResponse =
    | { ok: true }
    | {
        ok: true;
        bytesBase64: string;
        filename: string;
        failures: Array<{ tab?: chrome.tabs.Tab; error: string }>;
        articleCount: number;
        assetsCount: number;
      }
    | { ok: true; tabs: Array<{ id?: number; url?: string; title?: string; active?: boolean }> }
    | { ok: true; queue: Array<{ tabId: number; title: string }> }
    | { ok: false; error: string; failures?: Array<{ tab?: chrome.tabs.Tab; error: string }> };

  interface TabToEpubExtractor {
    id: string;
    extract: (doc: Document) => {
      title?: string;
      byline?: string | null;
      content?: string;
      excerpt?: string;
      siteName?: string;
      length?: number;
    } | null;
  }

  interface TabToEpubTestApi {
    send: (message: TestMessage) => Promise<TestResponse>;
  }

  var TabToEpubExtractor: TabToEpubExtractor | undefined;

  interface Window {
    TabToEpubTest?: TabToEpubTestApi;
  }
}
