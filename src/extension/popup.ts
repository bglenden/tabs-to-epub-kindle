type UiMessage =
  | { type: 'UI_SAVE_TAB_IDS'; tabIds: number[]; closeTabs?: boolean }
  | { type: 'UI_ADD_QUEUE'; tabIds: number[] }
  | { type: 'UI_SAVE_QUEUE' }
  | { type: 'UI_CLEAR_QUEUE' }
  | { type: 'UI_RESET_OUTPUT' };

type UiResponse = { ok: true } | { ok: false; error: string };

const statusEl = document.getElementById('status');

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
    if (action === 'reset-output') {
      const response = await sendMessage({ type: 'UI_RESET_OUTPUT' });
      if (!response.ok) throw new Error(response.error);
      setStatus('Output folder reset.');
      return;
    }

    const tabIds = await getSelectedTabIds();
    if (tabIds.length === 0) {
      setStatus('No tabs selected.', true);
      return;
    }

    if (action === 'save') {
      const response = await sendMessage({ type: 'UI_SAVE_TAB_IDS', tabIds });
      if (!response.ok) throw new Error(response.error);
      setStatus('Save started.');
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
  document.querySelectorAll('button[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = (button as HTMLButtonElement).dataset.action;
      if (action) {
        void handleAction(action);
      }
    });
  });
});
