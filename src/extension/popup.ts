import { storeHandle, getDirectoryState, writeFile, clearHandle } from './directory-handle.js';
import type { Settings, UiBuildEpubResponse, UiMessage, UiResponse } from './types.js';

const statusEl = document.getElementById('status');
const kindleInputEl = document.getElementById('kindle-email') as HTMLInputElement;
const kindleSaveBtn = document.getElementById('kindle-email-save') as HTMLButtonElement;
const dirStatusEl = document.getElementById('dir-status') as HTMLSpanElement;
const dirPickBtn = document.getElementById('dir-pick') as HTMLButtonElement;
const dirClearBtn = document.getElementById('dir-clear') as HTMLButtonElement;

function setStatus(message: string, isError = false): void {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#b00020' : '#444';
}

function setBusy(isBusy: boolean): void {
  document.querySelectorAll('button').forEach((button) => {
    (button as HTMLButtonElement).disabled = isBusy;
  });
}

function isSettingsResponse(response: UiResponse): response is UiResponse & { settings: Settings } {
  return response.ok && 'settings' in response;
}

function isBuildEpubResponse(response: UiResponse): response is UiBuildEpubResponse {
  return response.ok && 'epubBase64' in response;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getSelectedTabIds(): Promise<number[]> {
  const highlighted = await chrome.tabs.query({ currentWindow: true, highlighted: true });
  const selected = highlighted.length > 0 ? highlighted : await chrome.tabs.query({ currentWindow: true, active: true });
  return selected.map((tab) => tab.id).filter((id): id is number => typeof id === 'number');
}

async function sendMessage(message: UiMessage): Promise<UiResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        resolve({ ok: false, error: err.message || 'Message failed' });
        return;
      }
      resolve(response as UiResponse);
    });
  });
}

async function getSettings(): Promise<Settings> {
  const response = await sendMessage({ type: 'UI_GET_SETTINGS' });
  if (!response.ok) {
    throw new Error(response.error);
  }
  if (!isSettingsResponse(response)) {
    throw new Error('Settings response was malformed');
  }
  return response.settings;
}

async function updateDirectoryDisplay(): Promise<void> {
  try {
    const state = await getDirectoryState();
    if (!state.handle) {
      dirStatusEl.textContent = 'No output folder chosen';
      dirPickBtn.textContent = 'Choose Folder';
      dirClearBtn.style.display = 'none';
      return;
    }
    if (state.permission === 'granted') {
      dirStatusEl.textContent = `Folder: ${state.name}`;
      dirPickBtn.textContent = 'Change';
      dirClearBtn.style.display = '';
    } else {
      dirStatusEl.textContent = `Folder: ${state.name} (re-authorize needed)`;
      dirPickBtn.textContent = 'Re-authorize';
      dirClearBtn.style.display = '';
    }
  } catch {
    dirStatusEl.textContent = 'No output folder chosen';
    dirPickBtn.textContent = 'Choose Folder';
    dirClearBtn.style.display = 'none';
  }
}

async function pickDirectory(): Promise<void> {
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'downloads' });
    await storeHandle(handle);
    await updateDirectoryDisplay();
    setStatus('Output folder set.');
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return; // User cancelled
    }
    if (err instanceof DOMException && err.name === 'SecurityError') {
      setStatus('Chrome blocks Downloads/Desktop/Documents directly. Pick a subfolder instead.', true);
      return;
    }
    setStatus(err instanceof Error ? err.message : 'Failed to pick folder', true);
  }
}

async function clearDirectory(): Promise<void> {
  await clearHandle();
  await sendMessage({ type: 'UI_CLEAR_DIRECTORY' });
  await updateDirectoryDisplay();
  setStatus('Output folder cleared.');
}

async function saveViaDirectoryHandle(
  tabIds: number[],
  options: { closeTabs?: boolean; emailToKindle?: boolean } = {}
): Promise<boolean> {
  const state = await getDirectoryState();
  if (!state.handle) return false;

  if (state.permission === 'prompt') {
    const result = await state.handle.requestPermission({ mode: 'readwrite' });
    if (result !== 'granted') return false;
  } else if (state.permission !== 'granted') {
    return false;
  }

  const response = await sendMessage({
    type: 'UI_BUILD_EPUB',
    tabIds,
    closeTabs: options.closeTabs,
    emailToKindle: options.emailToKindle
  });
  if (!response.ok) throw new Error(response.error);
  if (!isBuildEpubResponse(response)) throw new Error('Unexpected response');

  const bytes = base64ToBytes(response.epubBase64);
  await writeFile(state.handle, response.filename, bytes);
  return true;
}

async function saveKindleEmail(): Promise<void> {
  const email = kindleInputEl.value.trim().toLowerCase();
  setBusy(true);
  setStatus('Saving…');
  try {
    const response = await sendMessage({ type: 'UI_SET_KINDLE_EMAIL', email: email || null });
    if (!response.ok) throw new Error(response.error);
    setStatus(email ? `Kindle email saved.` : 'Kindle email cleared.');
  } catch (err) {
    setStatus(err instanceof Error ? err.message : 'Failed to save email', true);
  } finally {
    setBusy(false);
  }
}

async function handleAction(action: string): Promise<void> {
  setBusy(true);
  setStatus('Working…');

  try {
    if (action === 'queue-save') {
      const response = await sendMessage({ type: 'UI_SAVE_QUEUE' });
      if (!response.ok) throw new Error(response.error);
      setStatus('Queued tabs saved.');
      return;
    }
    if (action === 'queue-clear') {
      const response = await sendMessage({ type: 'UI_CLEAR_QUEUE' });
      if (!response.ok) throw new Error(response.error);
      setStatus('Queue cleared.');
      return;
    }

    const tabIds = await getSelectedTabIds();
    if (tabIds.length === 0) {
      setStatus('No tabs selected.', true);
      return;
    }

    const isSaveAction = action === 'save' || action === 'save-close' || action === 'save-email';
    if (isSaveAction) {
      const options = {
        closeTabs: action === 'save-close',
        emailToKindle: action === 'save-email'
      };
      const wroteDirectly = await saveViaDirectoryHandle(tabIds, options);
      if (wroteDirectly) {
        setStatus('Saved to folder.');
        return;
      }
    }

    if (action === 'save') {
      const response = await sendMessage({ type: 'UI_SAVE_TAB_IDS', tabIds });
      if (!response.ok) throw new Error(response.error);
      setStatus('Save started.');
      return;
    }
    if (action === 'save-email') {
      const response = await sendMessage({ type: 'UI_SAVE_TAB_IDS', tabIds, emailToKindle: true });
      if (!response.ok) throw new Error(response.error);
      setStatus('Save + email started.');
      return;
    }
    if (action === 'save-close') {
      const response = await sendMessage({ type: 'UI_SAVE_TAB_IDS', tabIds, closeTabs: true });
      if (!response.ok) throw new Error(response.error);
      setStatus('Save started, closing tabs.');
      return;
    }
    if (action === 'queue-add') {
      const response = await sendMessage({ type: 'UI_ADD_QUEUE', tabIds });
      if (!response.ok) throw new Error(response.error);
      setStatus('Tabs added to queue.');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Request failed';
    setStatus(message, true);
  } finally {
    setBusy(false);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  void getSettings()
    .then((settings) => {
      kindleInputEl.value = settings.kindleEmail || '';
      setStatus('Ready.');
    })
    .catch(() => setStatus('Ready.'));
  void updateDirectoryDisplay();
  dirPickBtn.addEventListener('click', () => void pickDirectory());
  dirClearBtn.addEventListener('click', () => void clearDirectory());
  kindleSaveBtn.addEventListener('click', () => void saveKindleEmail());
  kindleInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void saveKindleEmail();
  });
  document.querySelectorAll('button[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = (button as HTMLButtonElement).dataset.action;
      if (action) {
        void handleAction(action);
      }
    });
  });
});
