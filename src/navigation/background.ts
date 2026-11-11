import { emptyPolicies, inScope, permissionOrigins, validatePolicies } from './policy';
import { syncManifestScripts } from '../content/registration';
import { installNavigation } from './runtime';

const SCRIPT_ID = 'pwa-scope-fixer-navigation';
export async function syncNavigationScripts() {
  const { navigationPolicies = emptyPolicies } = await chrome.storage.local.get('navigationPolicies');
  const policies = validatePolicies(navigationPolicies);
  const matches: string[] = [];
  for (const app of policies.apps.filter(a => a.enabled)) {
    for (const origin of permissionOrigins(app)) {
      if (await chrome.permissions.contains({ origins: [origin] })) matches.push(origin);
    }
  }
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (!matches.length) {
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  } else {
    const script = { id: SCRIPT_ID, matches: [...new Set(matches)], js: ['navigation.js'], runAt: 'document_start' as const, allFrames: false };
    if (existing.length) await chrome.scripting.updateContentScripts([script]);
    else await chrome.scripting.registerContentScripts([script]);
  }
}
export async function navigationMessage(message: any, sender: chrome.runtime.MessageSender) {
  if (sender.id !== chrome.runtime.id) throw new Error('Unknown sender.');
  const { navigationPolicies = emptyPolicies } = await chrome.storage.local.get('navigationPolicies');
  const { apps } = validatePolicies(navigationPolicies);
  if (message.action === 'navigation_bind' || message.action === 'navigation_unbind') {
    if (sender.tab || sender.url !== chrome.runtime.getURL('popup/index.html')) throw new Error('Use the extension popup.');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined || !tab.url) throw new Error('No web page selected.');
    const key = `navigation-tab-${tab.id}`;
    const app = apps.find(a => a.id === message.appId && a.enabled && inScope(tab.url!, a));
    if (message.action === 'navigation_bind' && !app) throw new Error('Open the enabled app scope before activating.');
    if (app && message.action === 'navigation_bind') await chrome.storage.session.set({ [key]: app.id });
    else await chrome.storage.session.set({ [key]: '__disabled__' });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: installNavigation, args: [message.action === 'navigation_bind' ? app! : null] });
    return { success: true };
  }
  if (message.action !== 'navigation_ready' || sender.tab?.id === undefined || sender.frameId !== 0 || !sender.url) return;
  const tabId = sender.tab.id;
  const key = `navigation-tab-${tabId}`;
  const binding = (await chrome.storage.session.get(key))[key];
  let app = apps.find(a => a.id === binding && a.enabled);
  if (!binding && message.standalone === true) {
    const candidates = apps.filter(a => a.enabled && inScope(sender.url!, a));
    if (candidates.length === 1) {
      app = candidates[0];
      await chrome.storage.session.set({ [key]: app!.id });
    }
  }
  // documentId prevents a late response injecting into a newer document.
  if (app && sender.documentId) await chrome.scripting.executeScript({ target: { tabId, documentIds: [sender.documentId] }, injectImmediately: true, world: 'MAIN', func: installNavigation, args: [app] });
  return { success: true };
}
export function startNavigation() {
  let pending = Promise.resolve();
  const sync = () => { pending = pending.then(() => Promise.allSettled([syncNavigationScripts(), syncManifestScripts()])).then(results => {
    if (results.some(result => result.status === 'rejected')) throw new Error('Registration failed');
  }).catch(() => console.warn('[PWA Scope(Fixe)r] Script registration failed; check settings and site access.')); };
  const disposeLive = () => {
    void chrome.tabs.query({}).then(tabs => Promise.allSettled(tabs.filter(t => t.id !== undefined).map(t =>
      chrome.scripting.executeScript({ target: { tabId: t.id! }, world: 'MAIN', func: installNavigation, args: [null] })))).then(results => {
      if (results.some(result => result.status === 'rejected')) console.warn('[PWA Scope(Fixe)r] Reload app windows to clear navigation handlers after site-access changes.');
    }).catch(() => console.warn('[PWA Scope(Fixe)r] Reload app windows to clear navigation handlers.'));
  };
  chrome.runtime.onInstalled.addListener(sync);
  chrome.runtime.onStartup.addListener(sync);
  chrome.permissions.onAdded.addListener(sync);
  chrome.permissions.onRemoved.addListener(() => { sync(); disposeLive(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.siteSettings || changes.autoScopeFix)) sync();
    if (area === 'local' && changes.navigationPolicies) {
      sync();
      // Remove live handlers immediately when policies change; reload to apply the new policy.
      disposeLive();
    }
  });
  chrome.tabs.onRemoved.addListener(id => {
    void chrome.storage.session.remove(`navigation-tab-${id}`).catch(() => console.warn('[PWA Scope(Fixe)r] Session cleanup failed.'));
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.action === 'manifest_sync') {
      if (sender.id !== chrome.runtime.id || sender.tab || sender.url !== chrome.runtime.getURL('popup/index.html')) return;
      syncManifestScripts().then(() => respond({ success: true })).catch(() => respond({ success: false }));
      return true;
    }
    if (!['navigation_ready', 'navigation_bind', 'navigation_unbind'].includes(message?.action)) return;
    navigationMessage(message, sender).then(respond).catch(() => {
      console.warn('[PWA Scope(Fixe)r] Navigation request failed; native navigation retained.');
      respond({ success: false, error: 'Navigation unavailable. Check scope and site access, then reload.' });
    });
    return true;
  });
  sync();
}
