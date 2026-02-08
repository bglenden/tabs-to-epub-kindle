export {};

declare global {
  type TestMessage =
    | { type: 'TEST_SET_MODE'; enabled: boolean }
    | { type: 'TEST_RESET_STATE' }
    | { type: 'TEST_LIST_TABS' }
    | { type: 'TEST_SAVE_ACTIVE_TAB' }
    | { type: 'TEST_SAVE_TAB_IDS'; tabIds: number[] };

  type TestResponse =
    | { ok: true; warning?: string; tooLargeForEmail?: string[] }
    | {
        ok: true;
        bytesBase64: string;
        filename: string;
        failures: Array<{ tab?: chrome.tabs.Tab; error: string }>;
        articleCount: number;
        assetsCount: number;
        warning?: string;
        tooLargeForEmail?: string[];
      }
    | { ok: true; tabs: Array<{ id?: number; url?: string; title?: string; active?: boolean }> }
    | { ok: false; error: string; failures?: Array<{ tab?: chrome.tabs.Tab; error: string }> };

  type UiMessage =
    | { type: 'UI_SAVE_TAB_IDS'; tabIds: number[]; closeTabs?: boolean; emailToKindle?: boolean }
    | { type: 'UI_CLEAR_DIRECTORY' }
    | { type: 'UI_SET_DEFAULT_DOWNLOADS'; enabled: boolean }
    | { type: 'UI_BUILD_EPUB'; tabIds: number[]; closeTabs?: boolean; emailToKindle?: boolean }
    | { type: 'UI_SET_KINDLE_EMAIL'; email: string | null }
    | { type: 'UI_SET_EMAIL_TO_KINDLE'; enabled: boolean }
    | { type: 'UI_GET_SETTINGS' };

  type UiResponse =
    | { ok: true; warning?: string; tooLargeForEmail?: string[] }
    | { ok: false; error: string }
    | {
        ok: true;
        warning?: string;
        tooLargeForEmail?: string[];
        settings: { testMode: boolean; kindleEmail: string | null; useDefaultDownloads: boolean; emailToKindle: boolean };
      }
    | {
        ok: true;
        warning?: string;
        tooLargeForEmail?: string[];
        files: Array<{ filename: string; mimeType: string; base64: string }>;
        epubBase64?: string;
        filename?: string;
      };

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
    sendUi: (message: UiMessage) => Promise<UiResponse>;
  }

  var TabToEpubExtractor: TabToEpubExtractor | undefined;

  interface Window {
    TabToEpubTest?: TabToEpubTestApi;
  }
}
