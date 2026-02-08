import { storeHandle, getDirectoryState, writeFile, clearHandle } from './directory-handle.js';
import type { Settings, UiBuildEpubResponse, UiMessage, UiResponse } from './types.js';

const statusEl = document.getElementById('status');
const kindleInputEl = document.getElementById('kindle-email') as HTMLInputElement;
const kindleSaveBtn = document.getElementById('kindle-email-save') as HTMLButtonElement;
const emailKindleCheckbox = document.getElementById('email-kindle') as HTMLInputElement;
const dirStatusEl = document.getElementById('dir-status') as HTMLSpanElement;
const dirPickBtn = document.getElementById('dir-pick') as HTMLButtonElement;
const dirDownloadsBtn = document.getElementById('dir-downloads') as HTMLButtonElement;
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
  emailKindleCheckbox.disabled = isBusy;
}

function isSettingsResponse(response: UiResponse): response is UiResponse & { settings: Settings } {
  return response.ok && 'settings' in response;
}

function isBuildEpubResponse(response: UiResponse): response is UiBuildEpubResponse {
  return response.ok && 'files' in response && Array.isArray(response.files);
}

function getResponseWarning(response: UiResponse): string | null {
  if (!response.ok) {
    return null;
  }
  if (!('warning' in response)) {
    return null;
  }
  return typeof response.warning === 'string' && response.warning.trim() ? response.warning : null;
}

function getTooLargeForEmail(response: UiResponse): string[] {
  if (!response.ok || !('tooLargeForEmail' in response) || !Array.isArray(response.tooLargeForEmail)) {
    return [];
  }
  return response.tooLargeForEmail.filter((name): name is string => typeof name === 'string' && Boolean(name.trim()));
}

function showTooLargeEmailAlert(filenames: string[]): void {
  if (filenames.length === 0) {
    return;
  }
  window.alert(
    `Some files are too large for Kindle email and were saved only:\n\n${filenames.map((name) => `- ${name}`).join('\n')}`
  );
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
  const settings = await getSettings().catch(() => null);
  if (settings?.useDefaultDownloads) {
    dirStatusEl.textContent = 'Using Downloads (Chrome default)';
    dirPickBtn.textContent = 'Choose Folder';
    dirDownloadsBtn.style.display = 'none';
    dirClearBtn.style.display = '';
    return;
  }

  try {
    const state = await getDirectoryState();
    if (!state.handle) {
      dirStatusEl.textContent = 'No output folder chosen';
      dirPickBtn.textContent = 'Choose Folder';
      dirDownloadsBtn.style.display = '';
      dirClearBtn.style.display = 'none';
      return;
    }
    if (state.permission === 'granted') {
      dirStatusEl.textContent = `Folder: ${state.name}`;
      dirPickBtn.textContent = 'Change';
      dirDownloadsBtn.style.display = 'none';
      dirClearBtn.style.display = '';
    } else {
      dirStatusEl.textContent = `Folder: ${state.name} (re-authorize needed)`;
      dirPickBtn.textContent = 'Re-authorize';
      dirDownloadsBtn.style.display = 'none';
      dirClearBtn.style.display = '';
    }
  } catch {
    dirStatusEl.textContent = 'No output folder chosen';
    dirPickBtn.textContent = 'Choose Folder';
    dirDownloadsBtn.style.display = '';
    dirClearBtn.style.display = 'none';
  }
}

async function pickDirectory(): Promise<void> {
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'downloads' });
    await storeHandle(handle);
    await sendMessage({ type: 'UI_SET_DEFAULT_DOWNLOADS', enabled: false });
    await updateDirectoryDisplay();
    setStatus('Output folder set.');
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return; // User cancelled
    }
    if (err instanceof DOMException && err.name === 'SecurityError') {
      setStatus('Chrome blocks that folder directly. Try creating a sub-folder (e.g. Downloads/EPUB).', true);
      return;
    }
    setStatus(err instanceof Error ? err.message : 'Failed to pick folder', true);
  }
}

async function useDefaultDownloads(): Promise<void> {
  await clearHandle();
  await sendMessage({ type: 'UI_SET_DEFAULT_DOWNLOADS', enabled: true });
  await updateDirectoryDisplay();
  setStatus('Using Chrome Downloads folder.');
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
): Promise<{ savedCount: number; warning: string | null; tooLargeForEmail: string[] }> {
  const state = await getDirectoryState();
  if (!state.handle) return { savedCount: 0, warning: null, tooLargeForEmail: [] };

  if (state.permission === 'prompt') {
    const result = await state.handle.requestPermission({ mode: 'readwrite' });
    if (result !== 'granted') return { savedCount: 0, warning: null, tooLargeForEmail: [] };
  } else if (state.permission !== 'granted') {
    return { savedCount: 0, warning: null, tooLargeForEmail: [] };
  }

  const response = await sendMessage({
    type: 'UI_BUILD_EPUB',
    tabIds,
    closeTabs: options.closeTabs,
    emailToKindle: options.emailToKindle
  });
  if (!response.ok) throw new Error(response.error);
  if (!isBuildEpubResponse(response)) throw new Error('Unexpected response');

  for (const file of response.files) {
    const bytes = base64ToBytes(file.base64);
    await writeFile(state.handle, file.filename, bytes);
  }

  return {
    savedCount: response.files.length,
    warning: getResponseWarning(response),
    tooLargeForEmail: getTooLargeForEmail(response)
  };
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
    const tabIds = await getSelectedTabIds();
    if (tabIds.length === 0) {
      setStatus('No tabs selected.', true);
      return;
    }

    const emailToKindle = emailKindleCheckbox.checked;
    const closeTabs = action === 'save-close';
    const options = { closeTabs, emailToKindle };

    // Try writing directly via directory handle
    const directResult = await saveViaDirectoryHandle(tabIds, options);
    if (directResult.savedCount > 0) {
      const savedMessage =
        directResult.savedCount === 1 ? 'Saved 1 file to folder.' : `Saved ${directResult.savedCount} files to folder.`;
      setStatus(directResult.warning ? `${savedMessage} ${directResult.warning}` : savedMessage, Boolean(directResult.warning));
      showTooLargeEmailAlert(directResult.tooLargeForEmail);
      return;
    }

    // Fall back to chrome.downloads (handles both "Use Downloads" and Save As)
    const response = await sendMessage({
      type: 'UI_SAVE_TAB_IDS',
      tabIds,
      closeTabs,
      emailToKindle
    });
    if (!response.ok) throw new Error(response.error);
    const warning = getResponseWarning(response);
    setStatus(warning ? `Save started. ${warning}` : 'Save started.', Boolean(warning));
    showTooLargeEmailAlert(getTooLargeForEmail(response));
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
      emailKindleCheckbox.checked = settings.emailToKindle;
      setStatus('Ready.');
    })
    .catch(() => setStatus('Ready.'));
  void updateDirectoryDisplay();
  dirPickBtn.addEventListener('click', () => void pickDirectory());
  dirDownloadsBtn.addEventListener('click', () => void useDefaultDownloads());
  dirClearBtn.addEventListener('click', () => void clearDirectory());
  emailKindleCheckbox.addEventListener('change', () => {
    void sendMessage({ type: 'UI_SET_EMAIL_TO_KINDLE', enabled: emailKindleCheckbox.checked });
  });
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
