interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
export interface InstallStatus { ready: boolean; reason: string }

export function createInstallController(win: Window, doc: Document) {
  let deferred: InstallPromptEvent | null = null;
  let installed = false;
  let prompting = false;
  let panel: HTMLElement | null = null;
  const close = () => { panel?.remove(); panel = null; };
  const status = (): InstallStatus => {
    if (installed) return { ready: false, reason: 'App installed.' };
    if (win.matchMedia('(display-mode: standalone)').matches)
      return { ready: false, reason: 'Already running as an app. Open the site in a normal browser tab to install.' };
    if (!win.isSecureContext) return { ready: false, reason: 'Installation requires a secure page (HTTPS or localhost).' };
    if (prompting) return { ready: false, reason: 'Installation prompt is open.' };
    if (deferred) return { ready: true, reason: 'Installation available. Continue on the page to confirm.' };
    return { ready: false, reason: 'Chromium has not offered an install prompt. Use the browser’s Install page as app menu if available. The app may already be installed or may not meet install criteria.' };
  };
  win.addEventListener('beforeinstallprompt', event => {
    const prompt = event as InstallPromptEvent;
    if (!event.isTrusted || typeof prompt.prompt !== 'function' || installed) return;
    event.preventDefault();
    deferred = prompt;
    close();
  });
  win.addEventListener('appinstalled', () => { installed = true; deferred = null; prompting = false; close(); });
  return {
    status,
    // A message can show this UI, but prompt() is called only from a trusted page click.
    show() {
      const current = status();
      if (!current.ready) return { success: false, ...current };
      if (panel) return { success: true, ...current };
      panel = doc.createElement('div');
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', 'Install PWA Scope(Fixe)r app');
      panel.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;background:white;color:#172033;padding:20px;border:1px solid #94a3b8;border-radius:12px;box-shadow:0 8px 30px #0003;max-width:360px;font:14px system-ui';
      const message = doc.createElement('p');
      message.textContent = 'Install this app using Chromium’s confirmation dialog.';
      const button = doc.createElement('button');
      button.textContent = 'Install app';
      button.style.cssText = 'padding:8px 12px;background:#2563eb;color:white;border:0;border-radius:6px;cursor:pointer;margin-right:12px';
      button.onclick = async event => {
        if (!event.isTrusted || !status().ready || !deferred) return;
        const prompt = deferred;
        // A deferred event is single-use. Clear it before awaiting to prevent double clicks.
        deferred = null;
        prompting = true;
        button.disabled = true;
        try {
          await prompt.prompt();
          const choice = await prompt.userChoice;
          if (choice.outcome === 'accepted') close();
          else message.textContent = 'Installation dismissed. Use the browser menu or wait for a new install offer.';
        } catch {
          message.textContent = 'Chromium could not open the prompt. Use the browser’s Install page as app menu if available.';
          console.warn('[PWA Scope(Fixe)r] Installation prompt failed.');
        } finally { prompting = false; }
      };
      const dismiss = doc.createElement('button');
      dismiss.textContent = 'Close';
      dismiss.onclick = close;
      panel.append(message, button, dismiss);
      (doc.body || doc.documentElement).appendChild(panel);
      button.focus();
      return { success: true, ...current };
    },
  };
}
