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
  type BoilerplatePruner = {
    pruneDocument: (doc: Document) => void;
  };
  const boilerplatePruner = (
    globalThis as typeof globalThis & {
      TabToEpubBoilerplate?: BoilerplatePruner;
    }
  ).TabToEpubBoilerplate;

  function preCleanDocument(doc: Document): void {
    PRE_CLEAN_SELECTORS.forEach((selector) => {
      doc.querySelectorAll(selector).forEach((node) => node.remove());
    });
    boilerplatePruner?.pruneDocument(doc);
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
