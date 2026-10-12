export function setupPWA({ notify, openSettings }) {
  const install = document.getElementById('install-button');
  const help = document.getElementById('install-help'); let installPrompt;
  help.textContent = 'In Chrome/Edge, use Install app when offered. On iPhone/iPad, use Safari → Share → Add to Home Screen. Install after loading omd over HTTPS. Once cached, your notebook can open offline.';
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; install.hidden = false; });
  install.addEventListener('click', async () => {
    if (!installPrompt) { openSettings(); return; }
    await installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; install.hidden = true;
  });
  window.addEventListener('appinstalled', () => { installPrompt = null; install.hidden = true; notify('omd is installed. A little space of your own.'); });
  function connectivity() { document.getElementById('offline-status').textContent = navigator.onLine ? 'Saved on this device' : 'Offline · saved on this device'; }
  window.addEventListener('online', connectivity); window.addEventListener('offline', connectivity); connectivity();
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register(new URL('../service-worker.js', import.meta.url), { scope: new URL('../', import.meta.url).pathname }).catch(() => notify('Offline caching could not start. Your notebook still saves in this browser.', 'error', true));
  } else help.textContent += ' Offline caching requires HTTPS or localhost.';
}
