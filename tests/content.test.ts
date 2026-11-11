import { beforeAll, expect, test } from 'bun:test';
import { createContext, runInContext } from 'node:vm';
let script: string;
beforeAll(async () => {
  const build = await Bun.build({ entrypoints: ['src/content/index.ts'], target: 'browser', minify: true });
  if (!build.success) throw new Error(String(build.logs));
  script = await build.outputs[0]!.text();
});
function page(data: any = {}) {
  const events: Record<string, ((event: any) => void)[]> = {};
  const messages: any[] = [];
  const links: any[] = [];
  const canvases: any[] = [];
  const domEvents: Record<string, () => void> = {};
  const doc: any = {
    title: 'Test app', readyState: 'loading',
    querySelector: () => null,
    querySelectorAll: (selector: string) => selector === 'link[rel="manifest"]' ? [...links] : [{ href: 'https://app.test/favicon.png', getAttribute: (key: string) => key === 'sizes' ? '16x16' : 'image/png' }],
    addEventListener: (name: string, fn: () => void) => { domEvents[name] = fn; },
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        const canvas = { width: 0, height: 0, getContext: () => ({ fillRect() {}, fillText() {} }), toDataURL: () => 'data:image/png;base64,fixture' };
        canvases.push(canvas); return canvas;
      }
      const link = { href: '', rel: '', remove: () => { links.splice(links.indexOf(link), 1); } };
      return link;
    },
  };
  doc.head = { prepend: (link: any) => links.unshift(link) }; doc.documentElement = {}; doc.body = {};
  const win: any = { isSecureContext: true, matchMedia: () => ({ matches: false }), getComputedStyle: () => ({ backgroundColor: '#ffffff' }), addEventListener: (name: string, fn: any) => (events[name] ??= []).push(fn) };
  const chrome = { runtime: { id: 'test-extension', onMessage: { addListener: (fn: any) => messages.push(fn) } }, storage: { local: { get: (_keys: any, callback: any) => callback(data) } } };
  const context = createContext({ window: win, document: doc, location: new URL('https://app.test/'), chrome, URL, console });
  const inject = () => runInContext(script, context);
  const message = (request: any) => {
    let response: any;
    messages.forEach(fn => fn(request, { id: 'test-extension' }, (result: any) => { response = result; }));
    return response;
  };
  const manifest = () => JSON.parse(decodeURIComponent(links[0].href.split(',')[1]));
  return { events, links, canvases, inject, message, manifest, messages, domReady: () => domEvents.DOMContentLoaded?.() };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
test('production content reinjection preserves the captured event and one message listener', async () => {
  const p = page(); p.inject();
  p.events.beforeinstallprompt![0]!({ isTrusted: true, preventDefault() {}, prompt() {}, userChoice: Promise.resolve({ outcome: 'dismissed' }) });
  p.inject(); p.inject();
  expect(p.events.beforeinstallprompt!.length).toBe(1); expect(p.messages.length).toBe(1);
  expect(p.message({ action: 'check_install_status' }).ready).toBe(true);
  p.domReady(); await flush();
});
test('registered early listener survives reload while saved manifest reapplies with real icon sizes', async () => {
  const p = page({ autoScopeFix: true, siteSettings: { 'app.test': { startUrl: 'https://app.test/work/', origin: 'https://app.test' } } });
  p.inject(); expect(p.links.length).toBe(0);
  p.domReady(); await flush();
  expect(p.manifest().start_url).toBe('https://app.test/work/');
  expect(p.canvases.map(c => [c.width, c.height])).toEqual([[192, 192], [512, 512]]);
  expect(p.message({ action: 'check_install_status' }).ready).toBe(false); // Injected is not installable.
});
test('auto fix off, cross-origin settings, and mismatched saved origin never reapply', async () => {
  for (const data of [
    { autoScopeFix: false, siteSettings: { 'app.test': { startUrl: 'https://app.test/' } } },
    { autoScopeFix: true, siteSettings: { 'app.test': { startUrl: 'https://other.test/' } } },
    { autoScopeFix: true, siteSettings: { 'app.test': { startUrl: 'https://app.test/', origin: 'http://app.test' } } },
  ]) { const p = page(data); p.inject(); p.domReady(); await flush(); expect(p.links.length).toBe(0); }
});
test('manual apply is validated and is not overwritten by a pending old auto fix', async () => {
  const p = page({ autoScopeFix: true, siteSettings: { 'app.test': { startUrl: 'https://app.test/old/' } } });
  p.inject();
  expect(p.message({ action: 'fix_scope', settings: { startUrl: 'https://other.test/' } }).success).toBe(false);
  expect(p.links.length).toBe(0);
  expect(p.message({ action: 'fix_scope', settings: { startUrl: 'https://app.test/new/' } }).success).toBe(true);
  p.domReady(); await flush(); expect(p.manifest().start_url).toBe('https://app.test/new/'); expect(p.links.length).toBe(1);
});
