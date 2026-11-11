import React, { useEffect, useState } from 'react';
import { emptyPolicies, permissionOrigins, validatePolicies } from '../navigation/policy';
import type { AppPolicy, NavigationPolicies } from '../navigation/policy';

export function NavigationSettings() {
  const [policies, setPolicies] = useState<NavigationPolicies>(emptyPolicies);
  const [app, setApp] = useState<AppPolicy>({ id: crypto.randomUUID(), name: 'My app', scope: '', enabled: false, approvedDomains: [], authenticationDomains: [], interceptWindowOpen: false });
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    Promise.all([chrome.storage.local.get('navigationPolicies'), chrome.tabs.query({ active: true, currentWindow: true })]).then(([data, tabs]) => {
      const saved = validatePolicies(data.navigationPolicies ?? emptyPolicies);
      setPolicies(saved);
      const url = tabs[0]?.url;
      if (url && /^https?:/.test(url)) {
        const scope = new URL(url).origin + '/';
        setApp(saved.apps.find(a => a.scope === scope) ?? { ...app, scope });
      }
    }).catch(() => setStatus('Could not read navigation policies. Open extension options to inspect storage.'));
  }, []);
  const save = async () => {
    setBusy(true);
    try {
      const next = validatePolicies({ version: 1, apps: [...policies.apps.filter(a => a.id !== app.id), app] });
      const normalized = next.apps.find(a => a.id === app.id)!;
      // Call request directly in the user gesture, before any await.
      if (app.enabled && !await chrome.permissions.request({ origins: permissionOrigins(normalized) }))
        throw new Error('Site access was declined; policy was not saved.');
      await chrome.storage.local.set({ navigationPolicies: next });
      setPolicies(next); setApp(normalized);
      setStatus('Saved. Reload the app, then enable in this window. Standalone PWAs activate automatically.');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not save policy.'); }
    finally { setBusy(false); }
  };
  const activate = async (action: string) => {
    try {
      const response = await chrome.runtime.sendMessage({ action, appId: app.id });
      if (!response?.success) throw new Error(response?.error ?? 'Could not change activation.');
      setStatus(action === 'navigation_bind' ? 'Enabled for this app tab until the window closes or browser restarts.' : 'Navigation disabled in this app tab.');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Activation failed.'); }
  };
  const input = 'border rounded p-2 w-full bg-white text-slate-800';
  return <section className="border-t pt-3 flex flex-col gap-2 text-sm">
    <h2 className="font-bold">Internal navigation</h2>
    <p>Keep approved links in this app. Authentication and external destinations use Chromium’s normal behavior.</p>
    <label>Saved app<select className={input} value={policies.apps.some(a => a.id === app.id) ? app.id : ''} onChange={e => {
      const chosen = policies.apps.find(a => a.id === e.target.value);
      if (chosen) setApp(chosen);
      else setApp({ ...app, id: crypto.randomUUID(), name: 'My app', enabled: false });
    }}><option value="">New app</option>{policies.apps.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    <label>App name<input className={input} value={app.name} onChange={e => setApp({ ...app, name: e.target.value })} /></label>
    <label>Scope URL (ends in /)<input className={input} value={app.scope} onChange={e => setApp({ ...app, scope: e.target.value })} /></label>
    <label>Approved domains (one per line, exact hostnames)<textarea className={input} value={app.approvedDomains.join('\n')} onChange={e => setApp({ ...app, approvedDomains: e.target.value.split('\n') })} onBlur={() => setApp({ ...app, approvedDomains: app.approvedDomains.filter(Boolean) })} /></label>
    <label>Authentication domains (always native)<textarea className={input} value={app.authenticationDomains.join('\n')} onChange={e => setApp({ ...app, authenticationDomains: e.target.value.split('\n') })} onBlur={() => setApp({ ...app, authenticationDomains: app.authenticationDomains.filter(Boolean) })} /></label>
    <label><input type="checkbox" checked={app.enabled} onChange={e => setApp({ ...app, enabled: e.target.checked })} /> Enable this policy</label>
    <label><input type="checkbox" checked={app.interceptWindowOpen} onChange={e => setApp({ ...app, interceptWindowOpen: e.target.checked })} /> Handle simple window.open calls (best effort)</label>
    <p className="text-xs">window.open handling returns null when redirected. Named windows and popup features stay native. Add login providers above before enabling.</p>
    <button className="bg-blue-600 text-white rounded p-2" disabled={busy} onClick={save}>Save navigation policy &amp; grant site access</button>
    <div className="flex gap-2"><button className="border rounded p-2" disabled={busy} onClick={() => activate('navigation_bind')}>Enable in this window</button><button className="border rounded p-2" onClick={() => activate('navigation_unbind')}>Disable in this window</button></div>
    <p role="status">{status}</p>
  </section>;
}
