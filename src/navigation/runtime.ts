import type { AppPolicy } from './policy';

// Serialized by chrome.scripting: keep every runtime dependency inside this function.
export function installNavigation(policy: AppPolicy | null) {
  const state = window as unknown as { __pwaScopeFixerNavigation?: { dispose: () => void } };
  state.__pwaScopeFixerNavigation?.dispose();
  delete state.__pwaScopeFixerNavigation;
  if (!policy || !policy.enabled || window.top !== window) return;
  const scope = new URL(policy.scope);
  const internal = (value: string) => {
    try {
      const url = new URL(value, document.baseURI);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || policy.authenticationDomains.includes(url.hostname)) return false;
      // Conservative auth escape hatch; explicit domain exclusions remain necessary for arbitrary endpoints.
      if (/(?:^|\/)(?:oauth2?|authorize|saml|sso|login|signin|logout|callback)(?:\/|$)/i.test(url.pathname) ||
          ['client_id', 'redirect_uri', 'response_type', 'SAMLRequest', 'SAMLResponse', 'code', 'state'].some(key => url.searchParams.has(key))) return false;
      return (url.origin === scope.origin && url.pathname.startsWith(scope.pathname)) ||
        (policy.approvedDomains.includes(url.hostname) && url.protocol === scope.protocol && url.port === scope.port);
    } catch { return false; }
  };
  // Do not activate on authentication or external documents, even with a retained tab binding.
  if (!internal(location.href)) return;
  const originalOpen = window.open;
  const click = (event: MouseEvent) => {
    if (!internal(location.href) || !event.isTrusted || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const anchor = event.composedPath().find(node => node instanceof HTMLAnchorElement) as HTMLAnchorElement | undefined;
    if (!anchor || anchor.hasAttribute('download') || anchor.hasAttribute('ping') || anchor.relList.contains('external') || !internal(anchor.href)) return;
    const target = (anchor.getAttribute('target') ?? document.querySelector('base[target]')?.getAttribute('target') ?? '_self').toLowerCase();
    if (!['', '_self', '_blank'].includes(target)) return;
    // Let site handlers run first; unhandled internal links navigate this browsing context.
    try {
      location.assign(anchor.href);
      event.preventDefault();
    } catch { console.warn('[PWA Scope Fixer] Navigation failed; native link behavior retained.'); }
  };
  const wrappedOpen: typeof window.open = function(url, target, features) {
    if (internal(location.href) && typeof url === 'string' && url && (!target || target.toLowerCase() === '_blank') &&
        (!features || features.split(',').every(f => ['noopener', 'noreferrer'].includes(f.trim().toLowerCase()))) && internal(url)) {
      try {
        location.assign(new URL(url, document.baseURI).href);
        return null; // Explicit opt-in: never fabricate a popup WindowProxy.
      } catch { console.warn('[PWA Scope Fixer] Navigation failed; using native window.open.'); }
    }
    return originalOpen.call(window, url, target, features);
  };
  window.addEventListener('click', click);
  if (policy.interceptWindowOpen) window.open = wrappedOpen;
  state.__pwaScopeFixerNavigation = { dispose() {
    window.removeEventListener('click', click);
    if (window.open === wrappedOpen) window.open = originalOpen;
  } };
}
