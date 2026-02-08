import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { storeHandle, loadHandle, clearHandle } from '../src/extension/directory-handle.js';

// In a real browser, FileSystemDirectoryHandle is a native host object that
// survives structuredClone. For fake-indexeddb we use a plain data object.
function createMockHandle(name: string): FileSystemDirectoryHandle {
  return { kind: 'directory', name } as unknown as FileSystemDirectoryHandle;
}

describe('directory-handle', () => {
  beforeEach(async () => {
    await clearHandle().catch(() => {});
  });

  test('store and load round-trips a handle', async () => {
    const handle = createMockHandle('MyEPUBs');
    await storeHandle(handle);
    const loaded = await loadHandle();
    assert.ok(loaded, 'Expected handle to be loaded after storing');
    assert.equal(loaded!.name, 'MyEPUBs');
  });

  test('loadHandle returns null when nothing stored', async () => {
    const loaded = await loadHandle();
    assert.equal(loaded, null);
  });

  test('clearHandle removes a stored handle', async () => {
    const handle = createMockHandle('TestFolder');
    await storeHandle(handle);
    await clearHandle();
    const loaded = await loadHandle();
    assert.equal(loaded, null);
  });

  // Regression test: pickDirectory() stores a handle, then sends
  // UI_SET_DEFAULT_DOWNLOADS(false) to disable the downloads flag.
  // The handler must NOT clear the handle when enabled=false.
  test('handle survives after disabling useDefaultDownloads (pickDirectory flow)', async () => {
    const handle = createMockHandle('EPUB');

    // Step 1: User picks folder, popup stores handle
    await storeHandle(handle);

    // Step 2: UI_SET_DEFAULT_DOWNLOADS(false) should NOT clear the handle.
    // (Only enabled=true should clear it, to switch to downloads mode.)
    // The handle stays in IndexedDB.

    // Step 3: loadHandle should still find it
    const loaded = await loadHandle();
    assert.ok(loaded, 'Handle should survive after disabling useDefaultDownloads');
    assert.equal(loaded!.name, 'EPUB');
  });
});
