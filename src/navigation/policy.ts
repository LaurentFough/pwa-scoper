export interface AppPolicy {
  id: string;
  name: string;
  enabled: boolean;
  scope: string;
  approvedDomains: string[];
  authenticationDomains: string[];
  interceptWindowOpen: boolean;
}
export interface NavigationPolicies { version: 1; apps: AppPolicy[] }
export const emptyPolicies: NavigationPolicies = { version: 1, apps: [] };

export function httpUrl(value: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Use an HTTP(S) URL without credentials.');
  return url;
}
function domain(value: unknown): string {
  if (typeof value !== 'string' || value !== value.trim() || /[/:?#@*\\\s]/.test(value))
    throw new Error('Domains must be exact hostnames without wildcards, ports or paths.');
  const host = httpUrl(`https://${value}`).hostname;
  if (!host || host.endsWith('.') || !/^[a-z0-9.-]+$/.test(host) || host.split('.').some(p => !p || p.startsWith('-') || p.endsWith('-')))
    throw new Error('Invalid hostname.');
  return host;
}
export function validatePolicies(input: unknown): NavigationPolicies {
  const data = input as NavigationPolicies;
  if (!data || data.version !== 1 || !Array.isArray(data.apps) || data.apps.length > 100)
    throw new Error('Unsupported navigation policy version or app list.');
  const ids = new Set<string>();
  const apps = data.apps.map(app => {
    if (!app || typeof app.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(app.id) || ids.has(app.id))
      throw new Error('App IDs must be unique.');
    ids.add(app.id);
    if (typeof app.name !== 'string' || !app.name.trim() || app.name.length > 100 || typeof app.enabled !== 'boolean' || typeof app.interceptWindowOpen !== 'boolean')
      throw new Error('Invalid app name or switches.');
    if (typeof app.scope !== 'string') throw new Error('Missing scope URL.');
    const scope = httpUrl(app.scope);
    if (scope.search || scope.hash || !scope.pathname.endsWith('/'))
      throw new Error('Scope must end in / and have no query or fragment.');
    const list = (values: unknown) => {
      if (!Array.isArray(values) || values.length > 100) throw new Error('Invalid domain list.');
      return [...new Set(values.map(domain))];
    };
    return { ...app, name: app.name.trim(), scope: scope.href,
      approvedDomains: list(app.approvedDomains), authenticationDomains: list(app.authenticationDomains) };
  });
  return { version: 1, apps };
}
export function inScope(url: string, app: AppPolicy): boolean {
  try { const u = httpUrl(url), s = httpUrl(app.scope); return u.origin === s.origin && u.pathname.startsWith(s.pathname); }
  catch { return false; }
}
export function permissionOrigins(app: AppPolicy): string[] {
  const s = httpUrl(app.scope);
  return [...new Set([`${s.protocol}//${s.hostname}/*`, ...app.approvedDomains.map(d => `${s.protocol}//${d}/*`)])];
}
