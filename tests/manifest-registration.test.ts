import { expect, test } from 'bun:test';
import { siteOrigin, syncManifestScripts } from '../src/content/registration';
test('registration derives granted site hosts without broad access or foreign origins', () => {
  expect(siteOrigin('app.test', { startUrl: 'https://app.test/work/' })).toBe('https://app.test/*');
  expect(siteOrigin('app.test', { startUrl: 'https://elsewhere.test/' })).toBe(null);
  expect(siteOrigin('app.test', { startUrl: 'javascript:alert(1)' })).toBe(null);
  expect(siteOrigin('app.test', { startUrl: 'https://app.test/', origin: 'https://evil.test' })).toBe(null);
});
test('manifest capture registers independently of navigation and unregisters on revoked access', async () => {
  let granted = true, registered: any[] = [], creates = 0;
  (globalThis as any).chrome = {
    storage: { local: { get: async () => ({ siteSettings: { 'app.test': { startUrl: 'https://app.test/' } } }) } },
    permissions: { contains: async () => granted },
    scripting: {
      getRegisteredContentScripts: async () => registered,
      registerContentScripts: async (scripts: any[]) => { creates++; registered = scripts; },
      updateContentScripts: async (scripts: any[]) => { registered = scripts; },
      unregisterContentScripts: async () => { registered = []; },
    },
  };
  await Promise.all([syncManifestScripts(), syncManifestScripts()]);
  expect(creates).toBe(1); expect(registered[0].js).toEqual(['content.js']);
  expect(registered[0].runAt).toBe('document_start'); expect(registered[0].matches).toEqual(['https://app.test/*']);
  granted = false; await syncManifestScripts(); expect(registered.length).toBe(0);
});
