import {byId as domId} from './dom.js';
import { ready, getStore, notify, openSettings, openPalette, openCanvas, closeCanvas, getView, setView, flushPending, downloadJson, confirmAction, deliverReminder } from './app.js';
import { registerWebMCP } from './webmcp.js';
import { registerBridge } from './bridge.js';
import { setupPWA } from './pwa.js';

await ready;
const store = getStore();
if (store) {
  setupPWA({ notify, openSettings });
  registerBridge(store,{flushPending,getView},window);
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
    status.textContent = count ? `Agent-ready · ${count} tools` : 'Agent-ready';
    detail.textContent = 'Use the desktop agent sidebar or Lime to work with your notebook. ' + (error ? `WebMCP registration failed: ${error}. The notebook remains usable.` : supported ? `${count} native WebMCP tools are also available in this browser.` : 'Native WebMCP is not available in this browser. OMD does not require an AI API key.');
  } }).then(registration => {
    // Register once. A BFCache restore retains the same document and tool registry.
    window.addEventListener('pagehide', event => { if (!event.persisted) registration.cleanup(); });
  });
}
