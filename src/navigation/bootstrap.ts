// Isolated world, top frame only. No page-to-extension message bridge.
chrome.runtime.sendMessage({ action: 'navigation_ready', standalone: matchMedia('(display-mode: standalone)').matches })
  .catch(() => console.warn('[PWA Scope(Fixe)r] Navigation unavailable; native navigation retained.'));
