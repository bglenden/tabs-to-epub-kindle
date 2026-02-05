import type { ExtractedArticleWithTab } from './types.js';

const COMMON_SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'edu']);
const MAX_FILENAME_LENGTH = 180;

function formatTimestampForFilename(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}-${mm}-${dd}T${hh}_${min}_${ss}`;
}

function domainLabelFromHost(hostname: string): string | null {
  let host = hostname.toLowerCase();
  if (!host) return null;
  if (host.startsWith('www.')) {
    host = host.slice(4);
  }
  const parts = host.split('.').filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];

  const last = parts[parts.length - 1];
  const second = parts[parts.length - 2];
  if (last.length === 2 && COMMON_SECOND_LEVEL.has(second) && parts.length >= 3) {
    return parts[parts.length - 3];
  }
  return second;
}

function domainLabelFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    return domainLabelFromHost(host);
  } catch {
    return null;
  }
}

function sanitizeFilenameBase(value: string): string {
  const invalidChars = /[\\/:*?"<>|]+/g;
  const cleaned = value
    .replace(invalidChars, '-')
    .replace(/[\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return cleaned || 'tabs-to-epub';
}

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
  const sanitized = sanitizeFilenameBase(baseName);
  return `${sanitized}.epub`;
}
