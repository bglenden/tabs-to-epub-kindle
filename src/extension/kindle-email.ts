import { sendGmailMessage } from './email-gmail.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_MAX_ATTACHMENTS_PER_EMAIL = 25;
// Keeps batches comfortably below Gmail's 35 MB request-body limit after base64 expansion.
const DEFAULT_MAX_TOTAL_ATTACHMENT_BYTES = 18 * 1024 * 1024;

export interface KindleAttachment {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export function normalizeKindleEmail(value: string | null | undefined): string | null {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return normalized || null;
}

export function isKindleEmailValid(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}

export function requireKindleEmail(kindleEmail: string | null): string {
  const normalized = normalizeKindleEmail(kindleEmail);
  if (!normalized) {
    throw new Error('Kindle email is not set. Use "Set Kindle email address" in the popup first.');
  }
  if (!isKindleEmailValid(normalized)) {
    throw new Error('Kindle email is invalid. Update it in the popup and try again.');
  }
  return normalized;
}

export function splitAttachmentsForKindle(
  attachments: KindleAttachment[],
  options?: {
    maxAttachmentsPerEmail?: number;
    maxTotalAttachmentBytes?: number;
  }
): KindleAttachment[][] {
  const maxAttachments = Math.max(1, Math.floor(options?.maxAttachmentsPerEmail || DEFAULT_MAX_ATTACHMENTS_PER_EMAIL));
  const maxBytes = Math.max(1, Math.floor(options?.maxTotalAttachmentBytes || DEFAULT_MAX_TOTAL_ATTACHMENT_BYTES));
  const batches: KindleAttachment[][] = [];
  let current: KindleAttachment[] = [];
  let currentBytes = 0;

  for (const attachment of attachments) {
    const size = attachment.bytes.length;
    const exceedsCount = current.length >= maxAttachments;
    const exceedsBytes = current.length > 0 && currentBytes + size > maxBytes;

    if (exceedsCount || exceedsBytes) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }

    current.push(attachment);
    currentBytes += size;

    // Keep very large files isolated so later files can still be batched efficiently.
    if (currentBytes > maxBytes) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

function identityGetAuthToken(interactive: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message || 'Failed to authenticate with Google.'));
        return;
      }
      if (!token) {
        reject(new Error('Google authentication did not return an access token.'));
        return;
      }
      resolve(token);
    });
  });
}

function identityRemoveCachedAuthToken(token: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

export async function emailAttachmentsToKindle(
  attachments: KindleAttachment[],
  kindleEmail: string
): Promise<void> {
  if (attachments.length === 0) {
    throw new Error('No attachments to send.');
  }

  const subject =
    attachments.length === 1
      ? `Tabs to EPUB & Kindle: ${attachments[0].filename}`
      : `Tabs to EPUB & Kindle: ${attachments.length} documents`;
  const bodyText =
    attachments.length === 1
      ? `Attached: ${attachments[0].filename}`
      : `Attached documents:\n${attachments.map((attachment) => `- ${attachment.filename}`).join('\n')}`;

  try {
    await sendGmailMessage(
      {
        to: kindleEmail,
        subject,
        bodyText,
        attachments
      },
      {
        getToken: identityGetAuthToken,
        clearToken: identityRemoveCachedAuthToken
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to email document(s) via Gmail: ${message}`);
  }
}

export async function emailEpubToKindle(bytes: Uint8Array, filename: string, kindleEmail: string): Promise<void> {
  await emailAttachmentsToKindle(
    [
      {
        filename,
        mimeType: 'application/epub+zip',
        bytes
      }
    ],
    kindleEmail
  );
}
