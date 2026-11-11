import { beforeEach, expect, test } from 'bun:test';
import { navigationMessage, syncNavigationScripts } from '../src/navigation/background';
import { app } from './fixtures';
let local: any, session: Record<string, string>, injected: any[], registered: any[], grants: boolean;
const sender = { id: 'test-extension', tab: { id: 7 }, frameId: 0, documentId: 'doc-a', url: app.scope } as chrome.runtime.MessageSender;
beforeEach(() => {
  local = { navigationPolicies: { version: 1, apps: [app] } }; session = {}; injected = []; registered = []; grants = true;
  (globalThis as any).chrome = {
    runtime: { id: 'test-extension', getURL: (path: string) => `chrome-extension://test-extension/${path}` },
    storage: { local: { get: async () => local }, session: { get: async () => session, set: async (value: any) => Object.assign(session, value), remove: async (key: string) => { delete session[key]; } } },
    tabs: { query: async () => [{ id: 7, url: app.scope }] },
    permissions: { contains: async () => grants },
    scripting: {
      executeScript: async (value: any) => { injected.push(value); return []; },
      getRegisteredContentScripts: async () => registered,
      registerContentScripts: async (value: any) => { registered = value; },
      updateContentScripts: async (value: any) => { registered = value; },
      unregisterContentScripts: async () => { registered = []; },
    },
  };
});
test('registers only granted, enabled app hosts and removes stale registration', async () => {
  await syncNavigationScripts();
  expect(registered[0].runAt).toBe('document_start'); expect(registered[0].allFrames).toBe(false);
  expect(registered[0].matches).toContain('https://docs.test/*');
  grants = false; await syncNavigationScripts(); expect(registered).toEqual([]);
});
test('normal browser tabs are untouched; standalone matches only one scope', async () => {
  await navigationMessage({ action: 'navigation_ready', standalone: false }, sender); expect(injected.length).toBe(0);
  await navigationMessage({ action: 'navigation_ready', standalone: true }, sender);
  expect(injected[0].target).toEqual({ tabId: 7, documentIds: ['doc-a'] }); expect(session['navigation-tab-7']).toBe('demo');
});
test('ambiguous standalone app scope does not guess', async () => {
  local.navigationPolicies.apps.push({ ...app, id: 'other' });
  await navigationMessage({ action: 'navigation_ready', standalone: true }, sender); expect(injected.length).toBe(0);
});
test('binding survives worker restart and approved-domain document navigation', async () => {
  session['navigation-tab-7'] = app.id;
  await navigationMessage({ action: 'navigation_ready', standalone: false }, { ...sender, documentId: 'doc-b', url: 'https://docs.test/' });
  expect(injected[0].args[0].id).toBe(app.id); expect(injected[0].target.documentIds).toEqual(['doc-b']);
});
test('page and iframe messages cannot bind or change app configuration', async () => {
  await expect(navigationMessage({ action: 'navigation_bind', appId: app.id }, sender)).rejects.toThrow();
  await navigationMessage({ action: 'navigation_ready', standalone: true }, { ...sender, frameId: 1 });
  expect(injected.length).toBe(0);
  await expect(navigationMessage({ action: 'navigation_ready' }, { ...sender, id: 'other' })).rejects.toThrow();
});
test('popup binds explicitly, disables through reload, and rejects unknown app', async () => {
  const popup = { id: 'test-extension', url: 'chrome-extension://test-extension/popup/index.html' };
  await navigationMessage({ action: 'navigation_bind', appId: app.id }, popup);
  expect(session['navigation-tab-7']).toBe(app.id);
  await navigationMessage({ action: 'navigation_unbind' }, popup);
  expect(injected.at(-1).args).toEqual([null]);
  const count = injected.length;
  await navigationMessage({ action: 'navigation_ready', standalone: true }, sender); expect(injected.length).toBe(count);
  await expect(navigationMessage({ action: 'navigation_bind', appId: 'missing' }, popup)).rejects.toThrow();
});
test('disabled policies cannot activate and invalid version fails before injection', async () => {
  local.navigationPolicies.apps[0] = { ...app, enabled: false };
  await navigationMessage({ action: 'navigation_ready', standalone: true }, sender); expect(injected.length).toBe(0);
  local.navigationPolicies.version = 9;
  await expect(syncNavigationScripts()).rejects.toThrow(); expect(injected.length).toBe(0);
});
