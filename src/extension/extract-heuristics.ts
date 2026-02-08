(() => {
  type BoilerplatePruner = {
    pruneDocument: (doc: Document) => void;
  };

  const globalState = globalThis as typeof globalThis & {
    TabToEpubBoilerplate?: BoilerplatePruner;
  };

  if (globalState.TabToEpubBoilerplate) {
    return;
  }

  const BOILERPLATE_ROLE = new Set(['navigation', 'banner', 'contentinfo', 'complementary', 'dialog', 'alertdialog']);
  const BOILERPLATE_ARIA_RE =
    /(navigation|nav|breadcrumb|share|social|related|advert|sponsor|promo|newsletter|subscribe|comment|consent|privacy|cookie|preference|optout)/i;
  const BOILERPLATE_CLASS_RE =
    /(^|[\s_-])(nav|navbar|subnav|menu|header|footer|related|recirc|recirculation|promo|sponsor|advert|adslot|ads?|newsletter|subscribe|social|share|comment|comments|breadcrumb|cookie|consent|privacy|preference|optout|gdpr|onetrust|outbrain|taboola|recommend|recommended|bottom-sheet|bottomsheet|slug)([\s_-]|$)/i;
  const BOILERPLATE_TEXT_RE =
    /^(advertisement(\s*skip\s*advertisement)?|skip\s*advertisement|related content|sponsored(\s*content)?|paid post|recommended for you)$/i;
  const IMAGE_LABEL_RE = /^image$/i;

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

  globalState.TabToEpubBoilerplate = { pruneDocument };
})();
