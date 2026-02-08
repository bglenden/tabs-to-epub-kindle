import { sendGmailMessage } from './email-gmail.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export async function emailEpubToKindle(bytes: Uint8Array, filename: string, kindleEmail: string): Promise<void> {
  try {
    await sendGmailMessage(
      {
        to: kindleEmail,
        subject: `Tabs to EPUB: ${filename}`,
        bodyText: `Attached: ${filename}`,
        attachment: {
          filename,
          mimeType: 'application/epub+zip',
          bytes
        }
      },
      {
        getToken: identityGetAuthToken,
        clearToken: identityRemoveCachedAuthToken
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to email EPUB via Gmail: ${message}`);
  }
}
