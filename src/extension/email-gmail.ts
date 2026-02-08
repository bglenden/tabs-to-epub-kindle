export interface GmailAttachment {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface GmailSendRequest {
  to: string;
  subject: string;
  bodyText: string;
  attachments: GmailAttachment[];
}

export interface GmailTokenClient {
  getToken(interactive: boolean): Promise<string>;
  clearToken(token: string): Promise<void>;
}

export class GmailApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GmailApiError';
    this.status = status;
  }
}

function sanitizeHeaderValue(value: string): string {
  return String(value).replace(/[\r\n]+/g, ' ').trim();
}

function sanitizeFilename(filename: string): string {
  const clean = String(filename).replace(/["\\\r\n]+/g, '_').trim();
  return clean || 'document.bin';
}

function wrapBase64(value: string, lineLength = 76): string {
  if (value.length === 0) {
    return '';
  }
  const lines: string[] = [];
  for (let i = 0; i < value.length; i += lineLength) {
    lines.push(value.slice(i, i + lineLength));
  }
  return lines.join('\r\n');
}

function base64FromBytes(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const base64 = base64FromBytes(bytes);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function isAuthRetryStatus(status: number): boolean {
  return status === 401 || status === 403;
}

async function readApiErrorMessage(response: Response): Promise<string> {
  try {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = (await response.json()) as {
        error?: { message?: string };
      };
      const message = json?.error?.message;
      if (message) {
        return message;
      }
    }
    const text = await response.text();
    return text ? text.slice(0, 300) : '';
  } catch {
    return '';
  }
}

async function postGmailSend(raw: string, accessToken: string, fetchFn: typeof fetch): Promise<void> {
  const response = await fetchFn('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw })
  });

  if (response.ok) {
    return;
  }

  const details = await readApiErrorMessage(response);
  const message = details
    ? `Gmail send failed (${response.status}): ${details}`
    : `Gmail send failed (${response.status})`;
  throw new GmailApiError(response.status, message);
}

export function buildMimeMessage(request: GmailSendRequest): string {
  const to = sanitizeHeaderValue(request.to);
  const subject = sanitizeHeaderValue(request.subject);
  const bodyText = String(request.bodyText || '');
  const attachments = Array.isArray(request.attachments) ? request.attachments : [];
  if (attachments.length === 0) {
    throw new Error('Gmail message requires at least one attachment.');
  }
  const boundary = `tabstoepub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const sections: string[] = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    bodyText,
    ''
  ];

  for (const attachment of attachments) {
    const filename = sanitizeFilename(attachment.filename);
    const mimeType = sanitizeHeaderValue(attachment.mimeType || 'application/octet-stream');
    const attachmentBase64 = wrapBase64(base64FromBytes(attachment.bytes));
    sections.push(
      `--${boundary}`,
      `Content-Type: ${mimeType}; name="${filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${filename}"`,
      '',
      attachmentBase64,
      ''
    );
  }

  sections.push(`--${boundary}--`, '');
  return sections.join('\r\n');
}

// Gmail API request body limit: 35 MB
const GMAIL_MAX_BODY_BYTES = 35 * 1024 * 1024;

export async function sendGmailMessage(
  request: GmailSendRequest,
  tokenClient: GmailTokenClient,
  fetchFn: typeof fetch = fetch
): Promise<void> {
  const attachments = Array.isArray(request.attachments) ? request.attachments : [];
  if (attachments.length === 0) {
    throw new Error('Cannot send a Gmail message without attachments.');
  }

  const totalBytes = attachments.reduce((sum, attachment) => sum + attachment.bytes.length, 0);
  const raw = encodeBase64Url(buildMimeMessage(request));

  // The JSON body is {"raw":"<base64url>"} — all ASCII, so length === byte size.
  if (raw.length + 10 > GMAIL_MAX_BODY_BYTES) {
    const sizeMB = (totalBytes / (1024 * 1024)).toFixed(1);
    throw new Error(
      `Attachments are too large to send via Gmail (${sizeMB} MB total). ` +
        'The Gmail API limit is 35 MB, which allows roughly 20 MB attachments after encoding.'
    );
  }

  let token = await tokenClient.getToken(true);

  try {
    await postGmailSend(raw, token, fetchFn);
    return;
  } catch (err) {
    if (!(err instanceof GmailApiError) || !isAuthRetryStatus(err.status)) {
      throw err;
    }
  }

  await tokenClient.clearToken(token).catch(() => {
    // Cache clear failure should not block a fresh token request.
  });
  token = await tokenClient.getToken(true);
  await postGmailSend(raw, token, fetchFn);
}
