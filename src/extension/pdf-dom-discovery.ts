function executeTabFunction<T>(tabId: number, func: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript({ target: { tabId }, func }, (results) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(err);
        return;
      }
      if (!results || results.length === 0) {
        reject(new Error('Script execution returned no result'));
        return;
      }
      resolve(results[0].result as T);
    });
  });
}

function canInspectTabDom(tab: chrome.tabs.Tab): boolean {
  const url = String(tab.url || '').toLowerCase();
  if (!url) {
    return false;
  }
  return !url.startsWith('chrome:') && !url.startsWith('chrome-extension:');
}

export async function discoverPdfSourcesFromTabDom(tab: chrome.tabs.Tab): Promise<string[]> {
  if (typeof tab.id !== 'number' || !canInspectTabDom(tab)) {
    return [];
  }

  try {
    const candidates = await executeTabFunction<string[]>(tab.id, () => {
      const scored = new Map<string, number>();

      const toAbsoluteUrl = (value: string): string | null => {
        const raw = String(value || '').trim();
        if (!raw) {
          return null;
        }
        try {
          const absolute = new URL(raw, window.location.href).href;
          if (!/^https?:/i.test(absolute)) {
            return null;
          }
          return absolute;
        } catch {
          return null;
        }
      };

      const isPdfLike = (value: string): boolean => {
        try {
          const parsed = new URL(value, window.location.href);
          const path = parsed.pathname.toLowerCase();
          if (path.endsWith('.pdf')) return true;
          if (/\/pdf(?:\/|$)/i.test(path)) return true;
          return false;
        } catch {
          return false;
        }
      };

      const addCandidate = (value: string | null | undefined, score: number): void => {
        if (!value) {
          return;
        }
        const absolute = toAbsoluteUrl(value);
        if (!absolute) {
          return;
        }
        const nextScore = Math.max(score, scored.get(absolute) || 0);
        scored.set(absolute, nextScore);
      };

      const addElementUrl = (
        selector: string,
        attr: string,
        baseScore: number,
        textBoost = false
      ): void => {
        document.querySelectorAll(selector).forEach((node) => {
          if (!(node instanceof Element)) return;
          const value = node.getAttribute(attr);
          if (!value) return;
          let score = baseScore;
          if (textBoost) {
            const label = `${node.getAttribute('aria-label') || ''} ${node.getAttribute('title') || ''} ${
              node.textContent || ''
            }`.toLowerCase();
            if (/download|pdf|paper/.test(label)) {
              score += 10;
            }
          }
          const absolute = toAbsoluteUrl(value);
          if (!absolute) return;
          if (isPdfLike(absolute)) {
            score += 10;
          }
          addCandidate(absolute, score);
        });
      };

      addElementUrl('iframe[src]', 'src', 95);
      addElementUrl('embed[src]', 'src', 95);
      addElementUrl('object[data]', 'data', 95);
      addElementUrl('source[src]', 'src', 90);
      addElementUrl('a[href]', 'href', 78, true);
      addElementUrl('link[href]', 'href', 76, true);

      document.querySelectorAll('meta[content]').forEach((meta) => {
        const content = meta.getAttribute('content');
        if (!content) return;
        const key = `${meta.getAttribute('name') || ''} ${meta.getAttribute('property') || ''}`.toLowerCase();
        if (key.includes('citation_pdf_url')) {
          addCandidate(content, 100);
          return;
        }
        if (key.includes('pdf')) {
          addCandidate(content, 90);
          return;
        }
        if (isPdfLike(content)) {
          addCandidate(content, 82);
        }
      });

      const absoluteUrlRegex = /https?:\/\/[^\s"'<>\\)]+(?:\.pdf(?:[?#][^\s"'<>\\)]*)?|\/pdf\/[^\s"'<>\\)]*)/gi;
      const relativePdfRegex = /["'`](\/[^"'`<>\\]+\.pdf(?:[?#][^"'`<>\\]*)?)["'`]/gi;
      const fetchPdfRegex = /fetch\(\s*["'`]([^"'`]+(?:\.pdf|\/pdf\/[^"'`]+))["'`]/gi;

      let scannedChars = 0;
      const maxScannedChars = 500_000;
      for (const script of Array.from(document.scripts)) {
        const text = script.textContent || '';
        if (!text) continue;
        if (scannedChars > maxScannedChars) break;
        scannedChars += text.length;

        let match: RegExpExecArray | null;
        while ((match = absoluteUrlRegex.exec(text)) !== null) {
          addCandidate(match[0], 88);
        }
        while ((match = relativePdfRegex.exec(text)) !== null) {
          addCandidate(match[1], 84);
        }
        while ((match = fetchPdfRegex.exec(text)) !== null) {
          addCandidate(match[1], 96);
        }
      }

      const host = window.location.hostname.toLowerCase();
      const path = window.location.pathname;
      const arxivIdMatch = path.match(/\/(?:abs|paper|article)\/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)/i);
      if (arxivIdMatch) {
        const id = arxivIdMatch[1];
        addCandidate(`https://arxiv.org/pdf/${id}.pdf`, 79);
        const withoutVersion = id.replace(/v\d+$/i, '');
        addCandidate(`https://arxiv.org/pdf/${withoutVersion}.pdf`, 78);
      }

      if (host.endsWith('alphaxiv.org')) {
        const alphaAbsMatch = path.match(/^\/abs\/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)/i);
        if (alphaAbsMatch) {
          const id = alphaAbsMatch[1];
          addCandidate(`https://fetcher.alphaxiv.org/v2/pdf/${id}.pdf`, 90);
          addCandidate(`https://arxiv.org/pdf/${id}.pdf`, 89);
          addCandidate(`https://arxiv.org/pdf/${id.replace(/v\d+$/i, '')}.pdf`, 88);
        }
      }

      return Array.from(scored.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([url]) => url)
        .slice(0, 12);
    });
    return Array.isArray(candidates) ? candidates : [];
  } catch {
    return [];
  }
}
