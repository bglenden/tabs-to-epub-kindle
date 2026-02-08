import assert from 'node:assert/strict';
import { buildPdfFilename, detectPdfTab, ensureUniqueFilename, extractPdfSourceFromViewerUrl } from '../src/extension/pdf.js';

{
  const result = await detectPdfTab({ url: 'https://example.test/paper.pdf' });
  assert.equal(result.isPdf, true);
  assert.equal(result.sourceUrl, 'https://example.test/paper.pdf');
  assert.equal(result.reason, 'url-extension');
}

{
  const viewerUrl =
    'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html?src=https%3A%2F%2Farxiv.org%2Fpdf%2F2310.01234.pdf';
  const source = extractPdfSourceFromViewerUrl(viewerUrl);
  assert.equal(source, 'https://arxiv.org/pdf/2310.01234.pdf');

  const result = await detectPdfTab({ url: viewerUrl });
  assert.equal(result.isPdf, true);
  assert.equal(result.sourceUrl, 'https://arxiv.org/pdf/2310.01234.pdf');
  assert.equal(result.reason, 'viewer-src');
}

{
  const calls: Array<{ url: string; method: string }> = [];
  const fetchByType: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = String(init?.method || 'GET').toUpperCase();
    calls.push({ url, method });
    if (method === 'HEAD') {
      return new Response('', {
        status: 200,
        headers: { 'content-type': 'application/pdf' }
      });
    }
    throw new Error('Unexpected GET call');
  };
  const result = await detectPdfTab({ url: 'https://example.test/download?id=123' }, fetchByType);
  assert.equal(result.isPdf, true);
  assert.equal(result.reason, 'content-type');
  assert.deepEqual(calls.map((call) => call.method), ['HEAD']);
}

{
  const fetchByMagic: typeof fetch = async (_input, init) => {
    const method = String(init?.method || 'GET').toUpperCase();
    if (method === 'HEAD') {
      return new Response('', {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' }
      });
    }
    return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]), {
      status: 206,
      headers: { 'content-type': 'application/octet-stream' }
    });
  };
  const result = await detectPdfTab({ url: 'https://example.test/blob?id=abc' }, fetchByMagic);
  assert.equal(result.isPdf, true);
  assert.equal(result.reason, 'magic-bytes');
}

{
  let calls = 0;
  const rejectPdfFetch: typeof fetch = async () => {
    calls += 1;
    return new Response('{"error":"invalid"}', {
      status: 400,
      headers: { 'content-type': 'application/json' }
    });
  };

  const optimistic = await detectPdfTab({ url: 'https://fetcher.alphaxiv.org/v2/pdf/2602.04770.pdf' }, rejectPdfFetch);
  assert.equal(optimistic.isPdf, true);
  assert.equal(optimistic.reason, 'url-extension');
  assert.equal(calls, 0);

  const verified = await detectPdfTab(
    { url: 'https://fetcher.alphaxiv.org/v2/pdf/2602.04770.pdf' },
    rejectPdfFetch,
    { verifyUrlPath: true }
  );
  assert.equal(verified.isPdf, false);
  assert.equal(verified.reason, 'not-pdf');
  assert.equal(calls > 0, true);
}

{
  const filename = buildPdfFilename(
    {
      title: 'Attention Is All You Need / Draft.pdf'
    },
    'https://arxiv.org/pdf/1706.03762.pdf'
  );
  assert.match(filename, /\.pdf$/);
  assert.match(filename, /arxiv/i);
  assert.doesNotMatch(filename, /[\\/:*?"<>|]/);
}

{
  const used = new Set<string>();
  const first = ensureUniqueFilename('paper.pdf', used);
  const second = ensureUniqueFilename('paper.pdf', used);
  const third = ensureUniqueFilename('paper.pdf', used);
  assert.equal(first, 'paper.pdf');
  assert.equal(second, 'paper-01.pdf');
  assert.equal(third, 'paper-02.pdf');
}
