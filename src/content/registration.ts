import { httpUrl } from '../navigation/policy';
import type { SiteSetting } from '../utils/storage';

export function siteOrigin(hostname: string, setting: SiteSetting): string | null {
  try {
    const url = httpUrl(setting.origin ?? setting.startUrl);
    return url.hostname === hostname ? `${url.protocol}//${url.hostname}/*` : null;
  } catch { return null; }
}

// Register separately from navigation: installation must work without a navigation policy.
let pending = Promise.resolve();
export function syncManifestScripts(): Promise<void> {
  const next = pending.catch(() => {}).then(reconcileManifestScripts);
  pending = next;
  return next;
}
async function reconcileManifestScripts() {
  const id = 'pwa-scope-fixer-manifest';
  const { siteSettings = {} } = await chrome.storage.local.get('siteSettings');
  const matches: string[] = [];
  for (const [host, setting] of Object.entries(siteSettings as Record<string, SiteSetting>)) {
    const origin = siteOrigin(host, setting);
    if (origin && await chrome.permissions.contains({ origins: [origin] })) matches.push(origin);
  }
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (!matches.length) {
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [id] });
    return;
  }
  const script = { id, matches: [...new Set(matches)], js: ['content.js'], runAt: 'document_start' as const, allFrames: false };
  if (existing.length) await chrome.scripting.updateContentScripts([script]);
  else await chrome.scripting.registerContentScripts([script]);
}
