import type { EpubAsset } from '../core/types.js';
import type { EmbeddedResult, ExtractedArticleWithTab, ImageToken } from './types.js';

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

    const { images: _images, ...rest } = article;
    void _images;
    updatedArticles.push({
      ...rest,
      content
    });
  }

  return { articles: updatedArticles, assets };
}
