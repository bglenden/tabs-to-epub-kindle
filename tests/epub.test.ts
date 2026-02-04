import assert from 'node:assert/strict';
import { buildEpub } from '../src/core/epub.js';
import { readLocalFiles } from './helpers.js';

const articles = [
  {
    title: 'First Article',
    content: '<p>Hello</p><script>alert(\"x\")</script><button onclick=\"alert(1)\">Click</button>',
    url: 'https://example.com/1',
    lang: 'en'
  },
  {
    title: 'Second Article',
    content: '<p>World</p>',
    url: 'https://example.com/2',
    lang: 'en'
  }
];

const assets = [
  {
    path: 'OEBPS/images/image-1.png',
    href: 'images/image-1.png',
    mediaType: 'image/png',
    data: new Uint8Array([137, 80, 78, 71])
  }
];

const { bytes } = buildEpub(articles, { title: 'Test Collection', assets });
const files = readLocalFiles(bytes);
const text = (data: Uint8Array) => new TextDecoder().decode(data);
const fileMap = new Map(files.map((file) => [file.name, text(file.data)]));

assert.equal(files[0].name, 'mimetype');
assert.ok(fileMap.has('OEBPS/content.opf'));
assert.ok(fileMap.has('OEBPS/nav.xhtml'));
assert.ok(fileMap.has('OEBPS/section-1.xhtml'));
assert.ok(fileMap.has('OEBPS/section-2.xhtml'));
assert.ok(fileMap.has('OEBPS/images/image-1.png'));

const opf = fileMap.get('OEBPS/content.opf');
assert.match(opf, /section-1.xhtml/);
assert.match(opf, /section-2.xhtml/);
assert.match(opf, /Test Collection/);
assert.match(opf, /images\/image-1\.png/);

const nav = fileMap.get('OEBPS/nav.xhtml');
assert.match(nav, /First Article/);
assert.match(nav, /Second Article/);

const section1 = fileMap.get('OEBPS/section-1.xhtml');
assert.ok(section1);
assert.doesNotMatch(section1, /<script/i);
assert.doesNotMatch(section1, /onclick=/i);
