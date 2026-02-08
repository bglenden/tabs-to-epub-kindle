export function parseContentType(value: string | null): string {
  if (!value) {
    return '';
  }
  return String(value).split(';')[0].trim().toLowerCase();
}
