import { createInstallController } from '../src/content/install';

class Element {
  children: Element[] = [];
  textContent = '';
  style = { cssText: '' };
  disabled = false;
  removed = false;
  onclick: ((event: any) => any) | null = null;
  setAttribute() {}
  append(...nodes: Element[]) { this.children.push(...nodes); }
  appendChild(node: Element) { this.children.push(node); }
  remove() { this.removed = true; }
  focus() {}
}
export function fakePage() {
  const listeners: Record<string, ((e: any) => void)[]> = {};
  const body = new Element();
  const doc = { body, documentElement: body, createElement: () => new Element() };
  let standalone = false;
  const win = { isSecureContext: true, matchMedia: () => ({ matches: standalone }), addEventListener: (name: string, fn: (e: any) => void) => (listeners[name] ??= []).push(fn) };
  const fire = (name: string, event: any = {}) => listeners[name]?.forEach(fn => fn(event));
  const controller = createInstallController(win as unknown as Window, doc as unknown as Document);
  const offer = (prompt = () => Promise.resolve(), choice: Promise<{ outcome: 'accepted' | 'dismissed' }> = Promise.resolve({ outcome: 'dismissed' })) => {
    const event = { isTrusted: true, preventDefault() {}, prompt, userChoice: choice };
    fire('beforeinstallprompt', event);
    return event;
  };
  const panel = () => body.children.at(-1)!;
  const button = () => panel().children[1]!;
  return { win, doc, fire, offer, controller, panel, button, standalone: () => { standalone = true; } };
}
