import assert from 'node:assert/strict';
import { embedImages } from '../src/extension/image-assets.js';

const sampleArticle = {
  tabId: 1,
  tabTitle: 'Sample tab',
  title: 'Sample article',
  content: '<p><img src="tabstoepub-image:1" alt="sample" /></p>',
  images: [{ token: 'tabstoepub-image:1', src: 'https://example.test/image?id=1&size=large' }]
};

{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('Not found', { status: 404 })) as typeof fetch;
  try {
    const result = await embedImages([sampleArticle]);
    assert.equal(result.assets.length, 0);
    assert.equal(result.articles.length, 1);
    assert.match(result.articles[0].content || '', /<img[^>]*src=""/);
    assert.doesNotMatch(result.articles[0].content || '', /https:\/\/example\.test\/image\?id=1&size=large/);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('plain text', { status: 200, headers: { 'content-type': 'text/plain' } })) as typeof fetch;
  try {
    const result = await embedImages([sampleArticle]);
    assert.equal(result.assets.length, 0);
    assert.match(result.articles[0].content || '', /<img[^>]*src=""/);
    assert.doesNotMatch(result.articles[0].content || '', /https:\/\/example\.test\/image\?id=1&size=large/);
  } finally {
    globalThis.fetch = originalFetch;
  }
}
