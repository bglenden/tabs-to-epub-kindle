import { createZip } from './zip.js';
import { escapeXml, safeFileName, formatTimestamp, isoDateTime } from './strings.js';
import type { ArticleInput, BuildEpubOptions, BuildEpubResult, EpubAsset, NormalizedArticle } from './types.js';
import type { ZipEntry } from './zip.js';

function randomUuid(): string {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

const INTERACTIVE_TAGS: string[] = [
  'script',
  'style',
  'iframe',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'video',
  'audio',
  'canvas',
  'svg',
  'math',
  'object',
  'embed',
  'noscript'
];

function stripInteractive(html: string): string {
  let output = html || '';
  for (const tag of INTERACTIVE_TAGS) {
    const re = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi');
    output = output.replace(re, '');
    const reSelf = new RegExp(`<${tag}\\b[^>]*\\/?\\s*>`, 'gi');
    output = output.replace(reSelf, '');
  }
  output = output.replace(/\son\w+\s*=\s*"[^"]*"/gi, '');
  output = output.replace(/\son\w+\s*=\s*'[^']*'/gi, '');
  output = output.replace(/\son\w+\s*=\s*[^\s>]+/gi, '');
  output = output.replace(/href\s*=\s*"javascript:[^"]*"/gi, 'href="#"');
  output = output.replace(/href\s*=\s*'javascript:[^']*'/gi, "href='#'");
  output = output.replace(/src\s*=\s*"javascript:[^"]*"/gi, '');
  output = output.replace(/src\s*=\s*'javascript:[^']*'/gi, '');
  return output;
}

function defaultTitle(articles: NormalizedArticle[]): string {
  if (articles.length === 1 && articles[0].title) {
    return articles[0].title;
  }
  const stamp = formatTimestamp();
  return `Saved Tabs ${stamp}`;
}

function normalizeArticle(article: ArticleInput, index: number): NormalizedArticle {
  const title = article.title || `Article ${index + 1}`;
  return {
    ...article,
    title,
    content: stripInteractive(article.content || '')
  };
}

function buildArticleXhtml(article: NormalizedArticle, index: number, lang: string): string {
  const title = escapeXml(article.title || `Article ${index + 1}`);
  const byline = article.byline ? `<p class="byline">${escapeXml(article.byline)}</p>` : '';
  const source = article.url
    ? `<p class="source">Source: <a href="${escapeXml(article.url)}">${escapeXml(article.url)}</a></p>`
    : '';
  const content =
    article.content || (article.excerpt ? `<p>${escapeXml(article.excerpt)}</p>` : '<p>(No content extracted.)</p>');

  return `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" lang="${escapeXml(lang)}">\n<head>\n  <meta charset="utf-8"/>\n  <title>${title}</title>\n  <link rel="stylesheet" href="styles.css"/>\n</head>\n<body>\n  <article>\n    <h1>${title}</h1>\n    ${byline}\n    ${content}\n    ${source}\n  </article>\n</body>\n</html>`;
}

function buildNavXhtml(articles: NormalizedArticle[], lang: string): string {
  const items = articles
    .map((article, index) => {
      const label = escapeXml(article.title || `Article ${index + 1}`);
      const href = `section-${index + 1}.xhtml`;
      return `      <li><a href="${href}">${label}</a></li>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(lang)}">\n<head>\n  <meta charset="utf-8"/>\n  <title>Table of Contents</title>\n  <link rel="stylesheet" href="styles.css"/>\n</head>\n<body>\n  <nav epub:type="toc">\n    <h1>Contents</h1>\n    <ol>\n${items}\n    </ol>\n  </nav>\n</body>\n</html>`;
}

function buildNcx(articles: NormalizedArticle[], title: string, uuid: string): string {
  const navPoints = articles
    .map((article, index) => {
      const label = escapeXml(article.title || `Article ${index + 1}`);
      const href = `section-${index + 1}.xhtml`;
      const playOrder = index + 1;
      return `    <navPoint id="navPoint-${playOrder}" playOrder="${playOrder}">\n      <navLabel><text>${label}</text></navLabel>\n      <content src="${href}"/>\n    </navPoint>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n  <head>\n    <meta name="dtb:uid" content="urn:uuid:${uuid}"/>\n    <meta name="dtb:depth" content="1"/>\n    <meta name="dtb:totalPageCount" content="0"/>\n    <meta name="dtb:maxPageNumber" content="0"/>\n  </head>\n  <docTitle><text>${escapeXml(title)}</text></docTitle>\n  <navMap>\n${navPoints}\n  </navMap>\n</ncx>`;
}

function buildOpf({
  title,
  uuid,
  lang,
  articles,
  assets,
  modified
}: {
  title: string;
  uuid: string;
  lang: string;
  articles: NormalizedArticle[];
  assets: EpubAsset[];
  modified: string;
}): string {
  const manifestItems = articles
    .map((article, index) => {
      return `    <item id="item-${index + 1}" href="section-${index + 1}.xhtml" media-type="application/xhtml+xml"/>`;
    })
    .join('\n');

  const assetItems = (assets || [])
    .filter((asset) => asset && (asset.href || asset.path) && asset.mediaType)
    .map((asset, index) => {
      const href = asset.href || asset.path.replace(/^OEBPS\//, '');
      return `    <item id="asset-${index + 1}" href="${escapeXml(href)}" media-type="${escapeXml(asset.mediaType)}"/>`;
    })
    .join('\n');

  const spineItems = articles
    .map((_, index) => `    <itemref idref="item-${index + 1}"/>`)
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0">\n  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n    <dc:identifier id="bookid">urn:uuid:${uuid}</dc:identifier>\n    <dc:title>${escapeXml(title)}</dc:title>\n    <dc:language>${escapeXml(lang)}</dc:language>\n    <dc:creator>Tabs to EPUB</dc:creator>\n    <meta property="dcterms:modified">${escapeXml(modified)}</meta>\n  </metadata>\n  <manifest>\n    <item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>\n    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n    <item id="css" href="styles.css" media-type="text/css"/>\n${manifestItems}\n${assetItems}\n  </manifest>\n  <spine toc="ncx">\n${spineItems}\n  </spine>\n</package>`;
}

function defaultCss(): string {
  return `body {\n  font-family: "Georgia", "Times New Roman", serif;\n  line-height: 1.6;\n  margin: 5%;\n  color: #1f1f1f;\n}\n\narticle h1 {\n  font-size: 1.6em;\n  margin-bottom: 0.4em;\n}\n\n.byline {\n  font-style: italic;\n  color: #666;\n  margin-top: 0;\n}\n\n.source {\n  margin-top: 2em;\n  font-size: 0.9em;\n  color: #555;\n}\n\nimg {\n  max-width: 100%;\n  height: auto;\n}\n\npre, code {\n  font-family: "Courier New", monospace;\n  font-size: 0.9em;\n}`;
}

export function buildEpub(rawArticles: ArticleInput[], options: BuildEpubOptions = {}): BuildEpubResult {
  if (!rawArticles || rawArticles.length === 0) {
    throw new Error('No articles provided.');
  }

  const articles = rawArticles.map((article, index) => normalizeArticle(article, index));
  const lang = options.language || articles[0].lang || 'en';
  const title = options.title || defaultTitle(articles);
  const uuid = options.identifier || randomUuid();
  const modified = isoDateTime(options.modified || new Date());
  const assets = Array.isArray(options.assets) ? options.assets : [];

  const files: ZipEntry[] = [];

  files.push({
    path: 'mimetype',
    data: 'application/epub+zip'
  });

  files.push({
    path: 'META-INF/container.xml',
    data: `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>`
  });

  const nav = buildNavXhtml(articles, lang);
  const ncx = buildNcx(articles, title, uuid);
  const opf = buildOpf({ title, uuid, lang, articles, assets, modified });
  const css = defaultCss();

  files.push({ path: 'OEBPS/nav.xhtml', data: nav });
  files.push({ path: 'OEBPS/toc.ncx', data: ncx });
  files.push({ path: 'OEBPS/content.opf', data: opf });
  files.push({ path: 'OEBPS/styles.css', data: css });

  articles.forEach((article, index) => {
    files.push({
      path: `OEBPS/section-${index + 1}.xhtml`,
      data: buildArticleXhtml(article, index, lang)
    });
  });

  assets.forEach((asset) => {
    if (!asset || !asset.path || !asset.data) {
      return;
    }
    files.push({
      path: asset.path,
      data: asset.data
    });
  });

  const bytes = createZip(files, { mtime: options.modified || new Date() });
  const filename = options.filename || safeFileName(articles.length === 1 ? articles[0].title : `tabs-${formatTimestamp()}`);

  return { bytes, filename };
}
