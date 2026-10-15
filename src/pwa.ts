import {isCloudflare} from './runtime.js';
import type {Notify} from './types.js';
import {byId as domId} from './dom.js';
export function setupPWA({notify,openSettings}:{notify:Notify;openSettings:()=>unknown}) {
  const install = domId('install-button');
  const help = domId('install-help'); let installPrompt:BeforeInstallPromptEvent|null=null;
  if(isCloudflare){install.hidden=true;help.textContent='The cloud edition requires a connection to read and save the shared notebook. You can bookmark this page or add it to your home screen.';return;}
  help.textContent = 'In Chrome/Edge, use Install app when offered. On iPhone/iPad, use Safari → Share → Add to Home Screen. Install after loading omd over HTTPS. Once cached, your notebook can open offline.';
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; install.hidden = false; });
  install.addEventListener('click', async () => {
    if (!installPrompt) { openSettings(); return; }
    await installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; install.hidden = true;
  });
  window.addEventListener('appinstalled', () => { installPrompt = null; install.hidden = true; notify('omd is installed. A little space of your own.'); });
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register(new URL('../service-worker.js', import.meta.url), { scope: new URL('../', import.meta.url).pathname }).catch(() => notify('Offline caching could not start. Your notebook still saves in this browser.', 'error', true));
  } else help.textContent += ' Offline caching requires HTTPS or localhost.';
}
