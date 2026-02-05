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
  outputDir: string | null;
  testMode: boolean;
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
  | { type: 'UI_SAVE_TAB_IDS'; tabIds: number[]; closeTabs?: boolean }
  | { type: 'UI_ADD_QUEUE'; tabIds: number[] }
  | { type: 'UI_SAVE_QUEUE' }
  | { type: 'UI_CLEAR_QUEUE' }
  | { type: 'UI_RESET_OUTPUT' };

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

export type TestResponse =
  | TestSaveResponse
  | TestListTabsResponse
  | TestQueueResponse
  | TestSuccessBase
  | TestErrorResponse;

export type UiResponse = TestSuccessBase | TestErrorResponse;
