export interface ZipFileEntry {
  name: string;
  data: Uint8Array;
}

export function readLocalFiles(zipBytes: Uint8Array): ZipFileEntry[] {
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const files: ZipFileEntry[] = [];
  let offset = 0;
  while (offset + 4 <= zipBytes.length) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x04034b50) {
      break;
    }
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const nameBytes = zipBytes.slice(nameStart, nameStart + nameLength);
    const name = new TextDecoder().decode(nameBytes);
    const data = zipBytes.slice(dataStart, dataStart + compressedSize);
    files.push({ name, data });
    offset = dataStart + compressedSize;
  }
  return files;
}

export function extractText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
