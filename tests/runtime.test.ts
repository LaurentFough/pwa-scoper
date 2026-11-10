import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { installNavigation } from '../src/navigation/runtime';
import { app } from './fixtures';

function page(policy = app, href = 'https://app.test/work/') {
  const assigned: string[] = [], native: unknown[][] = [];
  const listeners = new Set<(event: any) => void>();
  const win: any = { open: (...args: unknown[]) => { native.push(args); return 'native-handle'; }, addEventListener: (_: string, fn: any) => listeners.add(fn), removeEventListener: (_: string, fn: any) => listeners.delete(fn) };
  win.top = win;
  class Anchor {
    href: string; attrs: Record<string, string>;
    relList = { contains: (s: string) => this.attrs.rel === s };
    constructor(url: string, attrs: Record<string, string> = {}) { this.href = new URL(url, href).href; this.attrs = attrs; }
    hasAttribute(key: string) { return key in this.attrs; }
    getAttribute(key: string) { return this.attrs[key] ?? null; }
  }
  const context = { window: win, document: { baseURI: href, querySelector: () => null }, location: { href, assign: (url: string) => assigned.push(url) }, URL, HTMLAnchorElement: Anchor };
  // The actual function is serialized just as executeScript does: no module closure.
  const install = runInNewContext(`(${installNavigation.toString()})`, context);
  install(policy);
  const click = (url: string, attrs = {}, event = {}) => {
    let prevented = false;
    const e = { isTrusted: true, defaultPrevented: false, button: 0, composedPath: () => [new Anchor(url, attrs)], preventDefault: () => { prevented = true; }, ...event };
    for (const handler of listeners) handler(e);
    return prevented;
  };
  return { win, click, assigned, native, install, listeners, context };
}
test('ordinary and _blank internal links navigate same context; approved exact host works', () => {
  const p = page();
  expect(p.click('/work/next')).toBe(true);
  expect(p.click('https://docs.test/guide', { target: '_blank' })).toBe(true);
  expect(p.assigned).toEqual(['https://app.test/work/next', 'https://docs.test/guide']);
});
for (const url of ['https://outside.test/', 'https://docs.test.evil/', 'https://sub.docs.test/', 'http://docs.test/', 'https://docs.test:8443/', 'mailto:a@test', 'javascript:alert(1)', 'https://u:p@app.test/work/', 'https://app.test/elsewhere/', 'https://app.test/work/login', 'https://docs.test/oauth2/authorize', 'https://app.test/work/?code=x&state=y'])
  test(`native navigation retained for ${url}`, () => { const p = page(); expect(p.click(url, { target: '_blank' })).toBe(false); expect(p.win.open(url)).toBe('native-handle'); });
test('auth domain exclusions override approved domain and scope', () => {
  const p = page({ ...app, approvedDomains: ['login.test'], authenticationDomains: ['login.test'] });
  expect(p.click('https://login.test/ordinary')).toBe(false);
  const excluded = page({ ...app, authenticationDomains: ['app.test'] });
  expect(excluded.listeners.size).toBe(0);
});
for (const event of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }, { isTrusted: false }])
  test(`preserves user gesture ${JSON.stringify(event)}`, () => expect(page().click('/work/next', {}, event)).toBe(false));
for (const attrs of [{ download: '' }, { ping: '/tracker' }, { target: 'login-popup' }, { target: '_parent' }, { rel: 'external' }])
  test(`preserves link semantics ${JSON.stringify(attrs)}`, () => expect(page().click('/work/next', attrs)).toBe(false));
test('window.open is opt-in and preserves named, blank, featureful, auth and external requests', () => {
  const p = page();
  expect(p.win.open('/work/next', '_blank')).toBe(null);
  expect(p.assigned).toEqual(['https://app.test/work/next']);
  for (const args of [[''], [], ['/work/next', 'auth'], ['/work/next', '_blank', 'popup,width=400'], ['/work/next', '_blank', 'noopener=false'], ['https://login.test/'], ['about:blank']]) expect(p.win.open(...args)).toBe('native-handle');
  const off = page({ ...app, interceptWindowOpen: false });
  expect(off.win.open('/work/next')).toBe('native-handle');
});
test('idempotent updates, disable and page overrides are preserved', () => {
  const p = page();
  p.install(app); expect(p.listeners.size).toBe(1);
  const custom = () => 'site'; p.win.open = custom;
  p.install(null); expect(p.listeners.size).toBe(0); expect(p.win.open).toBe(custom);
});
test('no activation on external document, auth document or disabled app', () => {
  expect(page(app, 'https://outside.test/').listeners.size).toBe(0);
  expect(page(app, 'https://app.test/work/login').listeners.size).toBe(0);
  expect(page({ ...app, enabled: false }).listeners.size).toBe(0);
});
test('SPA auth navigation suspends routing without a document reload', () => {
  const p = page(); p.context.location.href = 'https://app.test/work/callback?code=secret';
  expect(p.click('/work/next')).toBe(false);
  expect(p.win.open('/work/next')).toBe('native-handle');
});
test('navigation assignment failures preserve native click and open behavior', () => {
  const p = page();
  p.context.location.assign = () => { throw new Error('Navigation denied'); };
  expect(p.click('/work/next')).toBe(false);
  expect(p.win.open('/work/next')).toBe('native-handle');
});
