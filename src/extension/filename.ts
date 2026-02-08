import type { ExtractedArticleWithTab } from './types.js';
import {
  MAX_FILENAME_LENGTH,
  domainLabelFromUrl,
  formatTimestampForFilename,
  sanitizeFilenameBase
} from './filename-utils.js';

function buildBaseName(stamp: string, domains: string[], maxLength: number): string {
  const selected: string[] = [];
  let remaining = domains.length;
  for (const domain of domains) {
    const candidate = [stamp, ...selected, domain].join(' ');
    if (candidate.length > maxLength) {
      break;
    }
    selected.push(domain);
    remaining -= 1;
  }

  if (remaining > 0) {
    const plusToken = `plus ${remaining}`;
    const candidate = [stamp, ...selected, plusToken].join(' ');
    if (candidate.length <= maxLength) {
      selected.push(plusToken);
    }
  }

  return [stamp, ...selected].join(' ');
}

export function buildFilenameForArticles(articles: ExtractedArticleWithTab[], now: Date = new Date()): string {
  const stamp = formatTimestampForFilename(now);
  const domains: string[] = [];
  const seen = new Set<string>();

  for (const article of articles) {
    if (!article.url) continue;
    const label = domainLabelFromUrl(article.url);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    domains.push(label);
  }

  const baseName = buildBaseName(stamp, domains, MAX_FILENAME_LENGTH);
  const sanitized = sanitizeFilenameBase(baseName, 'tabs-to-epub');
  return `${sanitized}.epub`;
}
