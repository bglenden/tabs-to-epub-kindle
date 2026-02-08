import type { EpubAsset } from '../core/types.js';
import type { EmbeddedResult, ExtractedArticleWithTab, ImageToken } from './types.js';
import { mapWithConcurrency } from './async-limit.js';
import { parseContentType } from './http.js';

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
const IMAGE_FETCH_CONCURRENCY = 4;

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

async function fetchImageBytes(url: string): Promise<{ buffer: Uint8Array; contentType: string }> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Image fetch failed (${response.status})`);
  }
  const contentType = parseContentType(response.headers.get('content-type'));
  const buffer = new Uint8Array(await response.arrayBuffer());
  return { buffer, contentType };
}

export async function embedImages(articles: ExtractedArticleWithTab[]): Promise<EmbeddedResult> {
  const assets: EpubAsset[] = [];
  const plannedImages: Array<{
    articleIndex: number;
    token: string;
    sourceUrl: string;
  }> = [];
  for (let articleIndex = 0; articleIndex < articles.length; articleIndex += 1) {
    const article = articles[articleIndex];
    const images: ImageToken[] = Array.isArray(article.images) ? article.images : [];
    for (const image of images) {
      plannedImages.push({
        articleIndex,
        token: image.token,
        sourceUrl: image.src
      });
    }
  }

  const fetchCache = new Map<string, Promise<{ buffer: Uint8Array; contentType: string }>>();
  const fetchCachedImageBytes = (url: string): Promise<{ buffer: Uint8Array; contentType: string }> => {
    const existing = fetchCache.get(url);
    if (existing) {
      return existing;
    }
    const next = fetchImageBytes(url);
    fetchCache.set(url, next);
    return next;
  };

  const fetched = await mapWithConcurrency(plannedImages, IMAGE_FETCH_CONCURRENCY, async (plannedImage) => {
    const sourceUrl = plannedImage.sourceUrl;
    if (!sourceUrl || !/^https?:/i.test(sourceUrl)) {
      return {
        ...plannedImage,
        buffer: null as Uint8Array | null,
        ext: '',
        mediaType: ''
      };
    }

    try {
      const { buffer, contentType } = await fetchCachedImageBytes(sourceUrl);
      let ext = IMAGE_TYPE_TO_EXT[contentType] || extensionFromUrl(sourceUrl);
      let mediaType = contentType || IMAGE_EXT_TO_TYPE[ext];

      if (ext && !mediaType) {
        mediaType = IMAGE_EXT_TO_TYPE[ext];
      }
      if (!ext && mediaType) {
        ext = IMAGE_TYPE_TO_EXT[mediaType];
      }

      if (ext && mediaType) {
        return {
          ...plannedImage,
          buffer,
          ext,
          mediaType
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('Image fetch failed:', sourceUrl, message);
    }

    return {
      ...plannedImage,
      buffer: null as Uint8Array | null,
      ext: '',
      mediaType: ''
    };
  });

  const replacementsByArticle = new Map<number, Map<string, string>>();
  let imageIndex = 0;
  for (const result of fetched) {
    let replacement = '';
    if (result.buffer && result.ext && result.mediaType) {
      imageIndex += 1;
      const href = `images/image-${imageIndex}.${result.ext}`;
      assets.push({
        path: `OEBPS/${href}`,
        href,
        mediaType: result.mediaType,
        data: result.buffer
      });
      replacement = href;
    }

    if (!replacementsByArticle.has(result.articleIndex)) {
      replacementsByArticle.set(result.articleIndex, new Map<string, string>());
    }
    replacementsByArticle.get(result.articleIndex)?.set(result.token, replacement);
  }

  const updatedArticles: ExtractedArticleWithTab[] = [];
  for (let articleIndex = 0; articleIndex < articles.length; articleIndex += 1) {
    const article = articles[articleIndex];
    let content = article.content ?? '';
    const replacements = replacementsByArticle.get(articleIndex);
    if (replacements) {
      for (const [token, replacement] of replacements.entries()) {
        if (token && content.includes(token)) {
          content = content.replaceAll(token, replacement);
        }
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
