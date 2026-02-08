import { emailAttachmentsToKindle, splitAttachmentsForKindle } from './kindle-email.js';
import { ensureUniqueFilename } from './pdf.js';

const EPUB_MIME_TYPE = 'application/epub+zip';
const PDF_MIME_TYPE = 'application/pdf';
const TOO_LARGE_EMAIL_PREFIX = 'TOO LARGE FOR EMAIL ';

export interface EmailArtifact {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export type SendKindleAttachmentsFn = (
  attachments: Array<{ filename: string; mimeType: string; bytes: Uint8Array }>,
  kindleEmail: string
) => Promise<void>;

function isTooLargeEmailError(message: string): boolean {
  return /too large to send via gmail/i.test(message);
}

function toKindleAttachment(artifact: EmailArtifact): { filename: string; mimeType: string; bytes: Uint8Array } {
  return {
    filename: artifact.filename,
    mimeType: artifact.mimeType,
    bytes: artifact.bytes
  };
}

export async function emailArtifactsToKindleCollectTooLarge(
  artifacts: EmailArtifact[],
  kindleEmail: string,
  sendKindleAttachments: SendKindleAttachmentsFn = emailAttachmentsToKindle
): Promise<string[]> {
  const sendBatch = async (
    batch: Array<{ filename: string; mimeType: string; bytes: Uint8Array }>,
    tooLarge: Set<string>
  ): Promise<void> => {
    try {
      await sendKindleAttachments(batch, kindleEmail);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isTooLargeEmailError(message)) {
        batch.forEach((attachment) => tooLarge.add(attachment.filename));
        return;
      }
      throw err;
    }
  };

  const epubArtifacts = artifacts.filter((artifact) => artifact.mimeType === EPUB_MIME_TYPE);
  const pdfAttachments = artifacts.filter((artifact) => artifact.mimeType === PDF_MIME_TYPE).map(toKindleAttachment);
  const tooLarge = new Set<string>();

  for (const artifact of epubArtifacts) {
    await sendBatch([toKindleAttachment(artifact)], tooLarge);
  }

  const pdfBatches = splitAttachmentsForKindle(pdfAttachments);
  for (const batch of pdfBatches) {
    await sendBatch(batch, tooLarge);
  }
  return Array.from(tooLarge);
}

export function applyTooLargeEmailPrefix(artifacts: EmailArtifact[], tooLargeOriginalNames: string[]): string[] {
  if (tooLargeOriginalNames.length === 0) {
    return [];
  }
  const tooLarge = new Set(tooLargeOriginalNames.map((name) => name.toLowerCase()));
  const updated: EmailArtifact[] = [];
  const used = new Set<string>();
  const renamed: string[] = [];

  for (const artifact of artifacts) {
    const flagged = tooLarge.has(artifact.filename.toLowerCase());
    const nextFilename = ensureUniqueFilename(
      flagged ? `${TOO_LARGE_EMAIL_PREFIX}${artifact.filename}` : artifact.filename,
      used
    );
    updated.push({ ...artifact, filename: nextFilename });
    if (flagged) {
      renamed.push(nextFilename);
    }
  }

  artifacts.splice(0, artifacts.length, ...updated);
  return renamed;
}
