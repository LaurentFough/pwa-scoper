import { describe, expect, test } from 'bun:test';
import { emptyPolicies, inScope, permissionOrigins, validatePolicies } from '../src/navigation/policy';
import { app } from './fixtures';
const config = (patch = {}) => ({ version: 1 as const, apps: [{ ...app, ...patch }] });
test('old installations have no navigation policy and valid v1 round trips', () => {
  expect(validatePolicies(emptyPolicies)).toEqual(emptyPolicies);
  expect(validatePolicies(config())).toEqual(config());
});
for (const scope of ['javascript:alert(1)', 'file:///tmp/', 'https://user:pass@app.test/', 'https://app.test/work', 'https://app.test/?x=1', 'https://app.test/#a'])
  test(`rejects unsafe scope ${scope}`, () => expect(() => validatePolicies(config({ scope }))).toThrow());
for (const domain of ['*.test', 'https://docs.test', 'docs.test/path', 'docs.test:443', 'docs.test@evil.test', '', 'docs.test.', '-bad.test', 'docs..test'])
  test(`rejects invalid hostname ${domain}`, () => expect(() => validatePolicies(config({ approvedDomains: [domain] }))).toThrow());
test('canonicalizes domains, deduplicates and rejects unsupported schema / duplicate IDs', () => {
  expect(validatePolicies(config({ approvedDomains: ['DOCS.test', 'docs.test'] })).apps[0]?.approvedDomains).toEqual(['docs.test']);
  expect(() => validatePolicies({ version: 2, apps: [] })).toThrow();
  expect(() => validatePolicies({ version: 1, apps: [app, app] })).toThrow();
  expect(() => validatePolicies(config({ enabled: 'yes' }))).toThrow();
});
test('scope uses origin and directory boundaries, not string prefix hosts', () => {
  for (const url of ['https://app.test/work/', 'https://app.test/work/a?b=c#d']) expect(inScope(url, app)).toBe(true);
  for (const url of ['https://app.test/work-other/', 'https://app.test.evil/work/', 'http://app.test/work/', 'https://app.test:8443/work/']) expect(inScope(url, app)).toBe(false);
  expect(permissionOrigins(app)).toEqual(['https://app.test/*', 'https://docs.test/*']);
});
