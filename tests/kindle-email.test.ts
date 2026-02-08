import assert from 'node:assert/strict';
import { splitAttachmentsForKindle } from '../src/extension/kindle-email.js';

function attachment(filename: string, size: number) {
  return {
    filename,
    mimeType: 'application/pdf',
    bytes: new Uint8Array(size)
  };
}

{
  const batches = splitAttachmentsForKindle(
    [attachment('a.pdf', 5), attachment('b.pdf', 5), attachment('c.pdf', 5), attachment('d.pdf', 5)],
    { maxAttachmentsPerEmail: 2, maxTotalAttachmentBytes: 12 }
  );
  assert.equal(batches.length, 2);
  assert.deepEqual(
    batches.map((batch) => batch.map((entry) => entry.filename)),
    [
      ['a.pdf', 'b.pdf'],
      ['c.pdf', 'd.pdf']
    ]
  );
}

{
  const batches = splitAttachmentsForKindle(
    [attachment('big.pdf', 20), attachment('small.pdf', 5), attachment('small-2.pdf', 5)],
    { maxAttachmentsPerEmail: 25, maxTotalAttachmentBytes: 10 }
  );
  assert.equal(batches.length, 2);
  assert.deepEqual(
    batches.map((batch) => batch.map((entry) => entry.filename)),
    [
      ['big.pdf'],
      ['small.pdf', 'small-2.pdf']
    ]
  );
}
