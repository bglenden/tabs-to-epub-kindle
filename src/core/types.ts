export interface ArticleInput {
  title?: string;
  byline?: string | null;
  content?: string;
  excerpt?: string;
  siteName?: string;
  url?: string;
  lang?: string;
}

export interface NormalizedArticle extends ArticleInput {
  title: string;
  content: string;
}

export interface EpubAsset {
  path: string;
  href?: string;
  mediaType: string;
  data: Uint8Array;
}

export interface BuildEpubOptions {
  title?: string;
  language?: string;
  identifier?: string;
  modified?: Date;
  filename?: string;
  assets?: EpubAsset[];
}

export interface BuildEpubResult {
  bytes: Uint8Array;
  filename: string;
}
