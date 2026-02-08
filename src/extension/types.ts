import type { ArticleInput, EpubAsset } from '../core/types.js';

export interface ImageToken {
  token: string;
  src: string;
}

export interface ExtractedArticle extends ArticleInput {
  images?: ImageToken[];
}

export interface ExtractedArticleWithTab extends ExtractedArticle {
  tabId: number;
  tabTitle: string;
}

export interface EmbeddedResult {
  articles: ExtractedArticleWithTab[];
  assets: EpubAsset[];
}

export interface Settings {
  testMode: boolean;
  kindleEmail: string | null;
}

export interface QueueEntry {
  tabId: number;
  title: string;
}

export interface ExtractMessage {
  type: 'EXTRACT';
}

export interface ExtractSuccessResponse {
  ok: true;
  article: ExtractedArticle;
}

export interface ExtractErrorResponse {
  ok: false;
  error: string;
}

export type ExtractResponse = ExtractSuccessResponse | ExtractErrorResponse;

export type TestMessage =
  | { type: 'TEST_SET_MODE'; enabled: boolean }
  | { type: 'TEST_RESET_STATE' }
  | { type: 'TEST_LIST_TABS' }
  | { type: 'TEST_SAVE_ACTIVE_TAB' }
  | { type: 'TEST_SAVE_TAB_IDS'; tabIds: number[] }
  | { type: 'TEST_GET_QUEUE' }
  | { type: 'TEST_CLEAR_QUEUE' };

export type UiMessage =
  | { type: 'UI_SAVE_TAB_IDS'; tabIds: number[]; closeTabs?: boolean; emailToKindle?: boolean }
  | { type: 'UI_ADD_QUEUE'; tabIds: number[] }
  | { type: 'UI_SAVE_QUEUE' }
  | { type: 'UI_CLEAR_QUEUE' }
  | { type: 'UI_CLEAR_DIRECTORY' }
  | { type: 'UI_BUILD_EPUB'; tabIds: number[]; closeTabs?: boolean; emailToKindle?: boolean }
  | { type: 'UI_SET_KINDLE_EMAIL'; email: string | null }
  | { type: 'UI_GET_SETTINGS' };

export interface TestSuccessBase {
  ok: true;
}

export interface TestErrorResponse {
  ok: false;
  error: string;
  failures?: Array<{ tab?: chrome.tabs.Tab; error: string }>;
}

export interface TestSaveResponse extends TestSuccessBase {
  bytesBase64: string;
  filename: string;
  failures: Array<{ tab?: chrome.tabs.Tab; error: string }>;
  articleCount: number;
  assetsCount: number;
}

export interface TestListTabsResponse extends TestSuccessBase {
  tabs: Array<{
    id?: number;
    url?: string;
    title?: string;
    active?: boolean;
  }>;
}

export interface TestQueueResponse extends TestSuccessBase {
  queue: QueueEntry[];
}

export interface UiSettingsResponse extends TestSuccessBase {
  settings: Settings;
}

export type TestResponse =
  | TestSaveResponse
  | TestListTabsResponse
  | TestQueueResponse
  | TestSuccessBase
  | TestErrorResponse;

export interface UiBuildEpubResponse extends TestSuccessBase {
  epubBase64: string;
  filename: string;
}

export type UiResponse = TestSuccessBase | TestErrorResponse | UiSettingsResponse | UiBuildEpubResponse;
