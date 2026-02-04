import assert from 'node:assert/strict';
import { createZip } from '../src/core/zip.js';
import { readLocalFiles } from './helpers.js';

const bytes = createZip([
  { path: 'mimetype', data: 'application/epub+zip' },
  { path: 'foo.txt', data: 'hello world' }
]);

const files = readLocalFiles(bytes);

assert.equal(files[0].name, 'mimetype');
assert.equal(new TextDecoder().decode(files[0].data), 'application/epub+zip');
assert.equal(files[1].name, 'foo.txt');
assert.equal(new TextDecoder().decode(files[1].data), 'hello world');
