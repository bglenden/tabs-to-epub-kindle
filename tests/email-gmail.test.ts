import assert from 'node:assert/strict';
import { buildMimeMessage, encodeBase64Url, sendGmailMessage } from '../src/extension/email-gmail.js';

const request = {
  to: 'kindle@example.com',
  subject: 'Tabs to EPUB',
  bodyText: 'Attached EPUB from Tabs to EPUB.',
  attachment: {
    filename: 'example.epub',
    mimeType: 'application/epub+zip',
    bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
  }
};

const mime = buildMimeMessage(request);
assert.match(mime, /To: kindle@example\.com/);
assert.match(mime, /Subject: Tabs to EPUB/);
assert.match(mime, /Content-Type: multipart\/mixed; boundary="/);
assert.match(mime, /Content-Disposition: attachment; filename="example\.epub"/);

const encoded = encodeBase64Url('hello');
assert.equal(encoded, 'aGVsbG8');

const clearedTokens: string[] = [];
let tokenCalls = 0;
const retryTokenClient = {
  async getToken(): Promise<string> {
    tokenCalls += 1;
    return tokenCalls === 1 ? 'token-first' : 'token-second';
  },
  async clearToken(token: string): Promise<void> {
    clearedTokens.push(token);
  }
};

const authHeaders: string[] = [];
let sendCalls = 0;
const retryFetch: typeof fetch = async (_url, init) => {
  sendCalls += 1;
  const headers = (init?.headers || {}) as Record<string, string>;
  authHeaders.push(headers.Authorization || '');
  if (sendCalls === 1) {
    return new Response(JSON.stringify({ error: { message: 'Invalid credentials' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    });
  }
  return new Response('{}', {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
};

await sendGmailMessage(request, retryTokenClient, retryFetch);
assert.equal(sendCalls, 2);
assert.deepEqual(clearedTokens, ['token-first']);
assert.deepEqual(authHeaders, ['Bearer token-first', 'Bearer token-second']);

let badRequestTokenCalls = 0;
const badRequestClient = {
  async getToken(): Promise<string> {
    badRequestTokenCalls += 1;
    return 'token-once';
  },
  async clearToken(): Promise<void> {
    throw new Error('should not clear token on non-auth errors');
  }
};

let badRequestCalls = 0;
const badRequestFetch: typeof fetch = async () => {
  badRequestCalls += 1;
  return new Response(JSON.stringify({ error: { message: 'Bad request payload' } }), {
    status: 400,
    headers: { 'content-type': 'application/json' }
  });
};

await assert.rejects(() => sendGmailMessage(request, badRequestClient, badRequestFetch), /Bad request payload/);
assert.equal(badRequestTokenCalls, 1);
assert.equal(badRequestCalls, 1);
