const COMMON_SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'edu']);
export const MAX_FILENAME_LENGTH = 180;

export function formatTimestampForFilename(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}-${mm}-${dd}T${hh}_${min}_${ss}`;
}

export function domainLabelFromHost(hostname: string): string | null {
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

export function domainLabelFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    return domainLabelFromHost(host);
  } catch {
    return null;
  }
}

export function sanitizeFilenameBase(value: string, fallback: string): string {
  const invalidChars = /[\\/:*?"<>|]+/g;
  const cleaned = value
    .replace(invalidChars, '-')
    .replace(/[\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return cleaned || fallback;
}

export function truncateToLength(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(0, maxLength).trim();
}
