const COMMON_SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'edu']);
const MAX_FILENAME_LENGTH = 180;
const MAX_MAGIC_BYTES = 8;

export interface TabLike {
  url?: string;
  pendingUrl?: string;
  title?: string;
}

export type PdfDetectionReason =
  | 'url-extension'
  | 'viewer-src'
  | 'content-type'
  | 'magic-bytes'
  | 'not-pdf';

export interface PdfDetectionResult {
  isPdf: boolean;
  sourceUrl: string | null;
  reason: PdfDetectionReason;
}

export interface DetectPdfTabOptions {
  verifyUrlPath?: boolean;
}

function parseContentType(value: string | null): string {
  if (!value) return '';
  return String(value).split(';')[0].trim().toLowerCase();
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isPdfPath(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /\.pdf$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function hasPdfMagicBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 5) {
    return false;
  }
  return (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

async function readMagicBytes(response: Response, maxBytes = MAX_MAGIC_BYTES): Promise<Uint8Array> {
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    return buffer.subarray(0, maxBytes);
  }

  const reader = response.body.getReader();
  const bytes = new Uint8Array(maxBytes);
  let offset = 0;

  try {
    while (offset < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) {
        break;
      }
      const take = Math.min(value.length, maxBytes - offset);
      bytes.set(value.subarray(0, take), offset);
      offset += take;
      if (offset >= maxBytes) {
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {
      // Ignore cancellation failures.
    });
  }

  return bytes.subarray(0, offset);
}

export function extractPdfSourceFromViewerUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'chrome-extension:') {
      return null;
    }

    const srcParam = parsed.searchParams.get('src') || parsed.searchParams.get('file');
    if (!srcParam) {
      return null;
    }

    const source = srcParam.trim();
    if (!source) {
      return null;
    }

    return source;
  } catch {
    return null;
  }
}

export async function detectPdfTab(
  tab: TabLike,
  fetchFn: typeof fetch = fetch,
  options: DetectPdfTabOptions = {}
): Promise<PdfDetectionResult> {
  const verifyUrlPath = Boolean(options.verifyUrlPath);
  const directCandidates = [tab.pendingUrl, tab.url]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const candidate of directCandidates) {
    if (!seen.has(candidate)) {
      seen.add(candidate);
      candidates.push(candidate);
    }
    const embedded = extractPdfSourceFromViewerUrl(candidate);
    if (embedded && !seen.has(embedded)) {
      seen.add(embedded);
      candidates.push(embedded);
    }
  }

  for (const candidate of candidates) {
    if (!verifyUrlPath && isPdfPath(candidate)) {
      return { isPdf: true, sourceUrl: candidate, reason: 'url-extension' };
    }

    const embedded = extractPdfSourceFromViewerUrl(candidate);
    if (!verifyUrlPath && embedded && isPdfPath(embedded)) {
      return { isPdf: true, sourceUrl: embedded, reason: 'viewer-src' };
    }
  }

  const httpCandidates = candidates.filter((candidate) => isHttpUrl(candidate));
  for (const candidate of httpCandidates) {
    let shouldTryRangeFallback = true;
    try {
      const head = await fetchFn(candidate, {
        method: 'HEAD',
        redirect: 'follow',
        credentials: 'include'
      });
      const contentType = parseContentType(head.headers.get('content-type'));
      if (contentType === 'application/pdf') {
        return { isPdf: true, sourceUrl: candidate, reason: 'content-type' };
      }
      if (contentType) {
        const isTextLike =
          contentType.startsWith('text/') ||
          contentType.includes('html') ||
          contentType.includes('json') ||
          contentType.includes('xml');
        const isGenericBinary = contentType === 'application/octet-stream' || contentType === 'binary/octet-stream';
        shouldTryRangeFallback = isGenericBinary || !isTextLike;
      }
    } catch {
      // Continue with a range request fallback.
    }

    if (!shouldTryRangeFallback) {
      continue;
    }

    try {
      const range = await fetchFn(candidate, {
        method: 'GET',
        redirect: 'follow',
        credentials: 'include',
        headers: {
          Range: 'bytes=0-1023'
        }
      });
      const contentType = parseContentType(range.headers.get('content-type'));
      if (contentType === 'application/pdf') {
        return { isPdf: true, sourceUrl: candidate, reason: 'content-type' };
      }

      const magic = await readMagicBytes(range);
      if (hasPdfMagicBytes(magic)) {
        return { isPdf: true, sourceUrl: candidate, reason: 'magic-bytes' };
      }
    } catch {
      // Ignore and continue with remaining candidates.
    }
  }

  return { isPdf: false, sourceUrl: null, reason: 'not-pdf' };
}

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

function basenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const last = parts.length > 0 ? parts[parts.length - 1] : '';
    const decoded = decodeURIComponent(last);
    return decoded.replace(/\.pdf$/i, '').trim() || 'document';
  } catch {
    return 'document';
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
  return cleaned || 'document';
}

function truncateToLength(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(0, maxLength).trim();
}

function removePdfSuffix(value: string): string {
  return value.replace(/\.pdf$/i, '').trim();
}

export function ensureUniqueFilename(filename: string, used: Set<string>): string {
  const lower = filename.toLowerCase();
  if (!used.has(lower)) {
    used.add(lower);
    return filename;
  }

  const dot = filename.lastIndexOf('.');
  const base = dot >= 0 ? filename.slice(0, dot) : filename;
  const ext = dot >= 0 ? filename.slice(dot) : '';

  for (let index = 1; index < 1000; index += 1) {
    const suffix = `-${String(index).padStart(2, '0')}`;
    const candidateBase = truncateToLength(base, MAX_FILENAME_LENGTH - ext.length - suffix.length);
    const candidate = `${candidateBase}${suffix}${ext}`;
    const key = candidate.toLowerCase();
    if (!used.has(key)) {
      used.add(key);
      return candidate;
    }
  }

  const fallback = `${base}-${Date.now()}${ext}`;
  used.add(fallback.toLowerCase());
  return fallback;
}

export function buildPdfFilename(
  tab: TabLike,
  sourceUrl: string,
  now: Date = new Date(),
  used?: Set<string>
): string {
  const stamp = formatTimestampForFilename(now);
  const domain = domainLabelFromUrl(sourceUrl);
  const title = removePdfSuffix(String(tab.title || '').trim());
  const sourceBase = basenameFromUrl(sourceUrl);
  const preferred = title || sourceBase;
  const base = [stamp, domain, preferred].filter(Boolean).join(' ');
  const trimmed = truncateToLength(base, MAX_FILENAME_LENGTH - 4);
  const sanitized = sanitizeFilenameBase(trimmed);
  const filename = `${sanitized}.pdf`;
  if (!used) {
    return filename;
  }
  return ensureUniqueFilename(filename, used);
}
