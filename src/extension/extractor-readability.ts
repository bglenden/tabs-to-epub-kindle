/* global Readability */

type ReadabilityArticle = {
  title?: string;
  byline?: string | null;
  content?: string;
  excerpt?: string;
  siteName?: string;
  length?: number;
} | null;

type ReadabilityConstructor = new (doc: Document) => { parse(): ReadabilityArticle };

(function () {
  if (globalThis.TabToEpubExtractor) {
    return;
  }

  const ReadabilityCtor = (globalThis as { Readability?: ReadabilityConstructor }).Readability;
  if (!ReadabilityCtor) {
    return;
  }

  const ctor = ReadabilityCtor;

  const PRE_CLEAN_SELECTORS = [
    'nav',
    'header',
    'footer',
    'aside',
    'dialog',
    'form',
    'input',
    'button',
    'select',
    'textarea',
    'iframe',
    'script',
    'style',
    'noscript',
    'svg',
    'canvas',
    'video',
    'audio',
    'object',
    'embed'
  ];

  const BOILERPLATE_ROLE = new Set(['navigation', 'banner', 'contentinfo', 'complementary', 'dialog', 'alertdialog']);
  const BOILERPLATE_ARIA_RE =
    /(navigation|nav|breadcrumb|share|social|related|advert|sponsor|promo|newsletter|subscribe|comment|consent|privacy|cookie|preference|optout)/i;
  const BOILERPLATE_CLASS_RE =
    /(^|[\s_-])(nav|navbar|subnav|menu|header|footer|related|recirc|promo|sponsor|advert|adslot|ads?|newsletter|subscribe|social|share|comment|comments|breadcrumb|cookie|consent|privacy|preference|optout|gdpr|onetrust|outbrain|taboola|recommend|recommended)([\s_-]|$)/i;

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

  function isLinkHeavy(node: Element): boolean {
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    const tag = node.tagName.toLowerCase();
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

  function preCleanDocument(doc: Document): void {
    PRE_CLEAN_SELECTORS.forEach((selector) => {
      doc.querySelectorAll(selector).forEach((node) => node.remove());
    });
    const toRemove: Element[] = [];
    doc.body?.querySelectorAll('*').forEach((node) => {
      if (isBoilerplateNode(node) || isLinkHeavy(node)) {
        toRemove.push(node);
      }
    });
    toRemove.forEach((node) => node.remove());
  }

  function extractWithReadability(doc: Document): ReadabilityArticle {
    const cloned = doc.cloneNode(true) as Document;
    preCleanDocument(cloned);
    const reader = new ctor(cloned);
    return reader.parse();
  }

  globalThis.TabToEpubExtractor = {
    id: 'readability',
    extract: (doc: Document) => extractWithReadability(doc)
  };
})();
