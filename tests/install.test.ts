import { expect, test } from 'bun:test';
import { fakePage } from './install-fixtures';

test('no event means no install UI, no false-ready result or error modal', () => {
  const p = fakePage();
  expect(p.controller.status().ready).toBe(false);
  expect(p.controller.show().success).toBe(false);
  expect(p.doc.body.children.length).toBe(0);
});
test('opening install UI does not invoke prompt; only the trusted page click does', async () => {
  const p = fakePage(); let calls = 0;
  p.offer(() => { calls++; return Promise.resolve(); });
  expect(p.controller.show().success).toBe(true);
  expect(calls).toBe(0);
  await p.button().onclick!({ isTrusted: false }); expect(calls).toBe(0);
  await p.button().onclick!({ isTrusted: true }); expect(calls).toBe(1);
  expect(p.controller.status().ready).toBe(false);
});
test('prompt is consumed before awaiting, and double clicks cannot reuse it', async () => {
  const p = fakePage(); let calls = 0;
  let resolve!: () => void;
  p.offer(() => { calls++; return new Promise<void>(done => { resolve = done; }); });
  p.controller.show();
  const first = p.button().onclick!({ isTrusted: true });
  const second = p.button().onclick!({ isTrusted: true });
  expect(calls).toBe(1); expect(p.controller.status().reason).toContain('open');
  resolve(); await Promise.all([first, second]);
});
test('repeated show does not duplicate UI; closing does not discard unused prompt', () => {
  const p = fakePage(); p.offer();
  p.controller.show(); p.controller.show(); expect(p.doc.body.children.length).toBe(1);
  p.panel().children[2]!.onclick!({});
  expect(p.controller.status().ready).toBe(true);
  p.controller.show(); expect(p.doc.body.children.length).toBe(2);
});
test('dismissal consumes old event; a new offer can be used', async () => {
  const p = fakePage(); p.offer(); p.controller.show();
  await p.button().onclick!({ isTrusted: true });
  expect(p.panel().children[0]!.textContent).toContain('dismissed');
  expect(p.controller.status().ready).toBe(false);
  p.offer(); expect(p.controller.status().ready).toBe(true);
});
test('failed prompt is consumed and offers browser-menu fallback', async () => {
  const p = fakePage(); p.offer(() => Promise.reject(new Error('No activation'))); p.controller.show();
  await p.button().onclick!({ isTrusted: true });
  expect(p.panel().children[0]!.textContent).toContain('browser');
  expect(p.controller.status().ready).toBe(false);
});
test('installed, standalone and insecure states do not advertise installation', () => {
  const p = fakePage(); p.offer(); p.controller.show(); p.fire('appinstalled');
  expect(p.controller.status().reason).toBe('App installed.'); expect(p.panel().removed).toBe(true);
  const standalone = fakePage(); standalone.offer(); standalone.standalone(); expect(standalone.controller.status().ready).toBe(false);
  const insecure = fakePage(); insecure.offer(); insecure.win.isSecureContext = false; expect(insecure.controller.status().reason).toContain('secure');
});
test('ignores synthetic offers and does not claim installed from acceptance alone', async () => {
  const p = fakePage(); p.fire('beforeinstallprompt', { isTrusted: false, prompt() {} });
  expect(p.controller.status().ready).toBe(false);
  p.offer(undefined, Promise.resolve({ outcome: 'accepted' })); p.controller.show();
  await p.button().onclick!({ isTrusted: true });
  expect(p.controller.status().reason).not.toBe('App installed.');
});
