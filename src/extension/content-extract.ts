interface ImageToken {
  token: string;
  src: string;
}

interface ExtractedArticle {
  title?: string;
  byline?: string | null;
  content?: string;
  excerpt?: string;
  siteName?: string;
  url?: string;
  lang?: string;
  images?: ImageToken[];
}

interface ExtractMessage {
  type: 'EXTRACT';
}

type ExtractResponse =
  | { ok: true; article: ExtractedArticle }
  | { ok: false; error: string };

(() => {
  const globalFlags = globalThis as typeof globalThis & {
    __tabstoepubContentExtractLoaded?: boolean;
  };
  if (globalFlags.__tabstoepubContentExtractLoaded) {
    return;
  }
  globalFlags.__tabstoepubContentExtractLoaded = true;

  const REMOVE_SELECTORS: string[] = [
    'script',
    'style',
    'iframe',
    'dialog',
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

  const BOILERPLATE_ROLE = new Set(['navigation', 'banner', 'contentinfo', 'complementary', 'dialog', 'alertdialog']);
  const BOILERPLATE_ARIA_RE =
    /(navigation|nav|breadcrumb|share|social|related|advert|sponsor|promo|newsletter|subscribe|comment|consent|privacy|cookie|preference|optout)/i;
  const BOILERPLATE_CLASS_RE =
    /(^|[\s_-])(nav|navbar|subnav|menu|header|footer|related|recirc|recirculation|promo|sponsor|advert|adslot|ads?|newsletter|subscribe|social|share|comment|comments|breadcrumb|cookie|consent|privacy|preference|optout|gdpr|onetrust|outbrain|taboola|recommend|recommended|bottom-sheet|bottomsheet|slug)([\s_-]|$)/i;
  const BOILERPLATE_TEXT_RE =
    /^(advertisement(\s*skip\s*advertisement)?|skip\s*advertisement|related content|sponsored(\s*content)?|paid post|recommended for you)$/i;
  const IMAGE_LABEL_RE = /^image$/i;

  const VOID_ELEMENTS = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr'
  ]);

  const BOOLEAN_ATTRIBUTES = new Set([
    'allowfullscreen',
    'async',
    'autofocus',
    'autoplay',
    'checked',
    'controls',
    'default',
    'defer',
    'disabled',
    'formnovalidate',
    'hidden',
    'ismap',
    'loop',
    'multiple',
    'muted',
    'novalidate',
    'open',
    'playsinline',
    'readonly',
    'required',
    'reversed',
    'selected'
  ]);

  function escapeText(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeAttribute(value: string): string {
    return escapeText(value).replace(/"/g, '&quot;');
  }

  function serializeNode(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeText(node.nodeValue || '');
    }

    if (node.nodeType === Node.COMMENT_NODE) {
      return '';
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const attrs = Array.from(el.attributes)
      .map((attr) => {
        const name = attr.name;
        const rawValue = attr.value ?? '';
        const value = rawValue === '' && BOOLEAN_ATTRIBUTES.has(name.toLowerCase()) ? name : rawValue;
        return ` ${name}="${escapeAttribute(value)}"`;
      })
      .join('');

    if (VOID_ELEMENTS.has(tag)) {
      return `<${tag}${attrs} />`;
    }

    const children = Array.from(el.childNodes).map(serializeNode).join('');
    return `<${tag}${attrs}>${children}</${tag}>`;
  }

  function serializeXhtml(root: Element | null): string {
    if (!root) return '';
    return Array.from(root.childNodes).map(serializeNode).join('');
  }

  function isBoilerplateNode(node: Element): boolean {
    const tag = node.tagName.toLowerCase();
    if (tag === 'article' || tag === 'main' || tag === 'body') {
      return false;
    }
    if (tag === 'nav' || tag === 'header' || tag === 'footer' || tag === 'aside') {
      return true;
    }
    const role = (node.getAttribute('role') || '').toLowerCase();
    if (role && BOILERPLATE_ROLE.has(role)) {
      return true;
    }
    const ariaLabel = node.getAttribute('aria-label') || '';
    if (ariaLabel && BOILERPLATE_ARIA_RE.test(ariaLabel)) {
      return true;
    }
    const id = node.id || '';
    if (id && BOILERPLATE_CLASS_RE.test(id)) {
      return true;
    }
    const className = node.getAttribute('class') || '';
    if (className && BOILERPLATE_CLASS_RE.test(className)) {
      return true;
    }
    const dataUri = node.getAttribute('data-uri') || '';
    if (dataUri && BOILERPLATE_CLASS_RE.test(dataUri)) {
      return true;
    }
    return false;
  }

  function normalizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  function isLinkHeavy(node: Element): boolean {
    const text = normalizeText(node.textContent || '');
    const tag = node.tagName.toLowerCase();
    if (tag === 'article' || tag === 'main' || tag === 'body') {
      return false;
    }
    const links = Array.from(node.querySelectorAll('a'));
    if (links.length < 3) {
      return false;
    }
    let linkTextLength = 0;
    for (const link of links) {
      linkTextLength += (link.textContent || '').replace(/\s+/g, ' ').trim().length;
    }
    if (text.length === 0) {
      return true;
    }
    const density = linkTextLength / text.length;
    if (density > 0.6 && text.length < 1000) {
      return true;
    }
    if ((tag === 'ul' || tag === 'ol') && density > 0.3 && text.length < 1500) {
      return true;
    }
    if (links.length >= 8 && density > 0.2 && text.length < 2000) {
      return true;
    }
    return false;
  }

  type BoilerplateTextKind = 'generic' | 'image' | null;

  function getBoilerplateTextKind(node: Element): BoilerplateTextKind {
    const text = normalizeText(node.textContent || '');
    if (!text || text.length > 140) {
      return null;
    }
    if (IMAGE_LABEL_RE.test(text)) {
      return 'image';
    }
    if (BOILERPLATE_TEXT_RE.test(text)) {
      return 'generic';
    }
    return null;
  }

  function findBoilerplateContainer(node: Element): Element {
    let current: Element | null = node;
    for (let depth = 0; depth < 4 && current; depth += 1) {
      const tag = current.tagName.toLowerCase();
      if (tag === 'article' || tag === 'main' || tag === 'body') {
        break;
      }
      const text = normalizeText(current.textContent || '');
      if (
        (tag === 'section' || tag === 'aside' || tag === 'div' || tag === 'nav') &&
        (text.length <= 400 || isLinkHeavy(current) || isBoilerplateNode(current))
      ) {
        return current;
      }
      current = current.parentElement;
    }
    return node;
  }

  function pruneDocument(doc: Document): void {
    const root = doc.body;
    if (!root) return;
    const toRemove = new Set<Element>();
    root.querySelectorAll('*').forEach((node) => {
      if (isBoilerplateNode(node) || isLinkHeavy(node)) {
        toRemove.add(node);
        return;
      }
      const boilerplateKind = getBoilerplateTextKind(node);
      if (!boilerplateKind) {
        return;
      }
      if (boilerplateKind === 'image') {
        if (!node.querySelector('img')) {
          toRemove.add(node);
        }
        return;
      }
      if (boilerplateKind === 'generic') {
        toRemove.add(findBoilerplateContainer(node));
      }
    });
    toRemove.forEach((node) => node.remove());
  }

  function absolutizeAttribute(node: Element, attr: string, baseUrl: string): void {
    const value = node.getAttribute(attr);
    if (!value) return;
    if (value.startsWith('data:') || value.startsWith('mailto:') || value.startsWith('tel:')) {
      return;
    }
    try {
      const absolute = new URL(value, baseUrl).href;
      node.setAttribute(attr, absolute);
    } catch {
      // Ignore invalid URLs.
    }
  }

  function sanitizeContent(html: string, baseUrl: string): string {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    REMOVE_SELECTORS.forEach((selector) => {
      doc.querySelectorAll(selector).forEach((node) => node.remove());
    });

    doc.querySelectorAll('*').forEach((node) => {
      [...node.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on') || name === 'style') {
          node.removeAttribute(attr.name);
        }
        if (name === 'href' && attr.value.toLowerCase().startsWith('javascript:')) {
          node.setAttribute('href', '#');
        }
        if (name === 'src' && attr.value.toLowerCase().startsWith('javascript:')) {
          node.removeAttribute('src');
        }
      });
    });

    doc.querySelectorAll('a[href]').forEach((node) => absolutizeAttribute(node, 'href', baseUrl));
    doc.querySelectorAll('img[src]').forEach((node) => absolutizeAttribute(node, 'src', baseUrl));
    pruneDocument(doc);

    return doc.body?.innerHTML ?? '';
  }

  function collectImages(html: string): { html: string; images: ImageToken[] } {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const images: ImageToken[] = [];
    let index = 0;

    doc.querySelectorAll('img[src]').forEach((node) => {
      const src = (node.getAttribute('src') || '').trim();
      if (!src) {
        return;
      }
      node.removeAttribute('srcset');
      if (src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('chrome:')) {
        return;
      }
      index += 1;
      const token = `tabstoepub-image:${index}`;
      images.push({ token, src });
      node.setAttribute('src', token);
    });

    return { html: serializeXhtml(doc.body), images };
  }

  type ExtractorResult = {
    title?: string;
    byline?: string | null;
    content?: string;
    excerpt?: string;
    siteName?: string;
    length?: number;
  } | null;

  function runExtractor(doc: Document): ExtractorResult {
    if (!globalThis.TabToEpubExtractor || typeof globalThis.TabToEpubExtractor.extract !== 'function') {
      return null;
    }
    try {
      return globalThis.TabToEpubExtractor.extract(doc);
    } catch {
      return null;
    }
  }

  function extractArticle(): ExtractedArticle {
    const article = runExtractor(document);

    if (!article) {
      const fallbackContent = document.body ? document.body.innerHTML : '';
      const sanitized = sanitizeContent(fallbackContent, document.baseURI);
      const collected = collectImages(sanitized);
      return {
        title: document.title || 'Untitled',
        byline: null,
        content: collected.html,
        images: collected.images,
        excerpt: '',
        siteName: location.hostname,
        url: location.href,
        lang: document.documentElement.lang || 'en'
      };
    }

    const sanitized = sanitizeContent(article.content || '', document.baseURI);
    const collected = collectImages(sanitized);

    return {
      ...article,
      title: article.title || document.title || 'Untitled',
      content: collected.html,
      images: collected.images,
      url: location.href,
      lang: document.documentElement.lang || 'en'
    };
  }

  function isExtractMessage(message: unknown): message is ExtractMessage {
    return Boolean(message) && typeof message === 'object' && (message as ExtractMessage).type === 'EXTRACT';
  }

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isExtractMessage(message)) {
      return;
    }

    try {
      const article = extractArticle();
      const response: ExtractResponse = { ok: true, article };
      sendResponse(response);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Extraction failed';
      const response: ExtractResponse = { ok: false, error: errorMessage };
      sendResponse(response);
    }

    return true;
  });
})();
