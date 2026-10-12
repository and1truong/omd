import {byId as domId} from './dom.js';
import { ready, getStore, notify, openSettings, openPalette, openCanvas, closeCanvas, getView, setView, flushPending, downloadJson, confirmAction, deliverReminder } from './app.js';
import { registerWebMCP } from './webmcp.js';
import { setupPWA } from './pwa.js';

await ready;
const store = getStore();
if (store) {
  setupPWA({ notify, openSettings });
  registerWebMCP(store, {
    download: downloadJson, openSettings, openPalette,openCanvas,closeCanvas,getView,setView,flushPending,
    notificationPermission: () => 'Notification' in window ? Notification.permission : 'unsupported',
    confirmImport: signal => {
      const dialog = domId('confirm-dialog');
      const abort = () => dialog.close();
      signal?.addEventListener('abort', abort, { once: true });
      return confirmAction('Replace this notebook?', 'The agent wants to import a notebook. All your current pages will be downloaded as a backup before replacement.', 'Back up & import').finally(() => signal?.removeEventListener('abort', abort));
    },
    testReminder: () => deliverReminder({ id: 'test', title: 'A little nudge. Your reminders are ready.' }, store.getState().notificationMode)
  }, { onStatus: ({ supported, count, error }) => {
    const status = domId('agent-status'); const detail = domId('agent-detail');
    status.textContent = count ? `Agent-ready · ${count} tools` : error ? 'Agent registration failed' : 'Browser agents';
    detail.textContent = error ? `WebMCP registration failed: ${error}. The notebook remains usable.` : supported ? `${count} WebMCP tools registered. A compatible browser agent or extension can read and edit this page, including hidden content.` : 'WebMCP is not available in this browser. In supporting Chrome builds, enable the WebMCP testing flag and use the Model Context Tool Inspector or a compatible extension. Gemini-enabled test extensions are separate from Gemini in Chrome. omd does not require an AI API key.';
  } }).then(registration => {
    // Register once. A BFCache restore retains the same document and tool registry.
    window.addEventListener('pagehide', event => { if (!event.persisted) registration.cleanup(); });
  });
}
