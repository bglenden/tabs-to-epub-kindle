import assert from 'node:assert/strict';
import { applyTooLargeEmailPrefix, emailArtifactsToKindleCollectTooLarge } from '../src/extension/email-artifacts.js';

function artifact(filename: string, mimeType: string, size: number) {
  return {
    filename,
    mimeType,
    bytes: new Uint8Array(size)
  };
}

{
  const artifacts = [
    artifact('paper.pdf', 'application/pdf', 10),
    artifact('paper.pdf', 'application/pdf', 10),
    artifact('book.epub', 'application/epub+zip', 10)
  ];

  const renamed = applyTooLargeEmailPrefix(artifacts, ['paper.pdf']);
  assert.equal(renamed.length, 2);
  assert.match(renamed[0], /^TOO LARGE FOR EMAIL paper\.pdf$/);
  assert.match(renamed[1], /^TOO LARGE FOR EMAIL paper-01\.pdf$/);
  assert.equal(artifacts[0].filename, renamed[0]);
  assert.equal(artifacts[1].filename, renamed[1]);
}

{
  const sentBatches: Array<string[]> = [];
  const tooLarge = await emailArtifactsToKindleCollectTooLarge(
    [
      artifact('chapter.epub', 'application/epub+zip', 1024),
      artifact('big-paper.pdf', 'application/pdf', 20 * 1024 * 1024),
      artifact('small-paper.pdf', 'application/pdf', 1024)
    ],
    'kindle@example.com',
    async (attachments) => {
      sentBatches.push(attachments.map((entry) => entry.filename));
      if (attachments.some((entry) => entry.filename === 'big-paper.pdf')) {
        throw new Error('Attachments are too large to send via Gmail (20.1 MB total).');
      }
    }
  );

  assert.deepEqual(tooLarge, ['big-paper.pdf']);
  assert.deepEqual(sentBatches, [['chapter.epub'], ['big-paper.pdf'], ['small-paper.pdf']]);
}

{
  await assert.rejects(
    () =>
      emailArtifactsToKindleCollectTooLarge(
        [artifact('paper.pdf', 'application/pdf', 1024)],
        'kindle@example.com',
        async () => {
          throw new Error('Token exchange failed');
        }
      ),
    /Token exchange failed/
  );
}
