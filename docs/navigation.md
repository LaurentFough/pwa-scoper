# Internal navigation policy v1 (extension 1.1.1)

This initial implementation adds opt-in internal navigation to PWA Scope(Fixe)r, a fork of the upstream extension. Manifest injection, saved site appearance, reset, installation prompts and upstream credits remain. Existing `siteSettings` and `autoScopeFix` values are untouched. Navigation is disabled until an app policy is enabled and its site access is granted.

## Configure an app

1. Build with Bun and load `dist` unpacked in Chromium 106 or newer. The upstream Web Store listing does **not** contain this fork's changes.
2. Open the extension popup in the app's starting page. Under **Internal navigation**, give the app a name and scope, for example `https://example.com/work/`. Scope URLs must end in `/`, without credentials, query or fragment. This scope controls navigation only; it does not change Chromium's installed manifest scope.
3. List approved domains, one exact hostname per line, such as `docs.example.net`. Wildcards and implicit subdomains are deliberately unsupported. Approved domains cover all paths on that host using the scope's scheme and effective port. A scope of `https://example.com/work/` covers that directory and descendants, not `/work-other/` or the rest of the site.
4. Add authentication providers to **Authentication domains**. Exclusions override both the scope and approved domains. Keep login providers out of the approved list unless the same host also serves app content and you have tested that site's flow.
5. Enable the policy, click **Save navigation policy & grant site access**, and approve the requested hosts. Reload the app. Open the popup again and click **Enable in this window** for an Omarchy `--app` window. Standalone PWAs automatically select a unique matching scope. Overlapping policies require explicit selection; they are never guessed.
6. Optionally enable simple `window.open` handling after testing sign-in. It is off by default because rerouted calls return `null` instead of a popup handle.

The activation is bound to the current app **tab**, not every tab in the browser window. It follows that tab across approved hosts and survives service-worker suspension through `storage.session`. It is not inherited by popups, new tabs, or unrelated browser tabs. Closing the tab or restarting the browser clears it. **Disable in this window** suppresses automatic activation in that tab for the session; **Enable** reverses it. Disabling the saved policy stops future activation. Policy edits clear live handlers; reload to apply the saved version. Host grants remain until revoked using Chromium's extension site-access controls.

For multiple apps, choose **New app**, edit its scope and lists, and save. Choose an existing app to edit or disable it. The independent navigation policy never overwrites the upstream per-site manifest settings.

## Behavior

| Request from an active app document | Handling |
| --- | --- |
| Unhandled, ordinary left click to scope or approved host | Same browsing context, including `target=_blank` and a base target of `_blank` |
| External host, out-of-scope path, other scheme/port | Chromium's native behavior |
| Authentication exclusion, recognized auth path or query | Native behavior; no popup reparenting or closing |
| Ctrl/Cmd/Shift/Alt click, middle click, download, ping, `rel=external` | Native behavior |
| Site handler already canceled the click, named target, `_parent`, `_top` | Native behavior |
| Simple `window.open(url)` or `_blank` to an approved URL | Same context only when explicitly enabled; returns `null` |
| Named/featureful popup, blank URL, `about:blank`, external or auth `window.open` | Original `window.open`, preserving its return value |
| Forms, iframe navigation, server redirects, browser UI actions | Native behavior |

The auth escape hatch recognizes path segments `oauth`, `oauth2`, `authorize`, `saml`, `sso`, `login`, `signin`, `logout`, and `callback`, plus common query keys such as `client_id`, `redirect_uri`, `response_type`, `SAMLRequest`, `SAMLResponse`, `code`, and `state`. These checks are conservative heuristics, not complete OAuth detection. Arbitrary authentication endpoints must be excluded explicitly. The extension does not intercept redirects or POST forms, and it never adopts a child popup into the app. External links retain native behavior; this does not force every external link into a separate browser window.

## Chromium constraints verified before implementation

- [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) normally run in an isolated world. Patching `window.open` there does not patch the page's own function. This extension injects a self-contained runtime using `scripting.executeScript` in `MAIN`, with the validated app policy as an argument. Page code can replace or bypass that runtime; it is not a security boundary.
- [Scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting) requires site access. Optional permissions are requested for configured hosts only, not every website. A registered isolated bootstrap starts at `document_start`, then asks the worker to inject the page runtime. That asynchronous round trip leaves a startup race. Calls made earlier, cached references to `open`, and calls in other frames may bypass handling. Injection targets the sender's `documentId` to avoid applying late replies to another document.
- [Window types](https://developer.chrome.com/docs/extensions/reference/api/windows#type-WindowType) do not supply a reliable installed-PWA identity. The deprecated `app` type refers to Chrome Apps. A generic extension popup window is not an installed app window. No app identity or `--app` command-line value is inferred from these APIs.
- [webNavigation](https://developer.chrome.com/docs/extensions/reference/api/webNavigation) observes navigation; it is not a synchronous cancel-and-route hook. This extension does not attempt to close already-created windows or use observational events as popup interception.
- The inspected [Omarchy launcher](https://github.com/omacom/omarchy/blob/master/bin/omarchy-launch-webapp) forwards `--app=URL` to a Chromium-based browser. Install the extension in that browser's actual profile. No native host, shell hook, XDG handler or Linux-specific runtime is required. Explicit activation is provided because app display-mode reporting can vary.

There is **no universal popup interception**. Native out-of-scope UI and the browser's security decisions can still appear. Cross-platform support here means standard Chromium extension APIs and a portable Bun build; native behavior on Linux/Omarchy, Windows and macOS requires the manual checks below.

## Storage, diagnostics and recovery

`chrome.storage.local.navigationPolicies` is `{ version: 1, apps: [...] }`. Each app has `id`, `name`, `enabled`, `scope`, `approvedDomains`, `authenticationDomains`, and `interceptWindowOpen`. Missing data means an empty list. Unknown versions and invalid entries fail closed, with a generic warning. No settings migration or reset is required for upstream users. Scope and exact-host validation runs before saving and again when the worker reads settings.

Warnings use `[PWA Scope(Fixe)r]` in the page console and extension service-worker console. Navigation logs do not include full URLs, query strings, authentication codes or browsing history. There is no telemetry. Revoke host access or disable the policy and reload the app to recover native behavior. If an injected page runtime cannot be reached after access is revoked, reloading is required to remove it. Optional host access is broader than directory scopes because Chromium match patterns grant access by origin; the runtime enforces the directory policy.

## Validation

Automated checks: `bun test`, `bun run typecheck`, `bun run build`. Tests execute the serialized runtime without its module closure, exercise navigation and auth decisions, mock Chromium permissions and registration, verify sender/frame checks, document targeting, ambiguous activation, session persistence and disable behavior. These are deterministic API/DOM simulations, not native browser verification. CI runs the same checks on Linux, macOS and Windows.

Before release, repeat these checks in a disposable profile on each target browser/OS:

1. Verify the old popup still injects a manifest, changes appearance, resets settings, and handles an unavailable install prompt. Confirm stored upstream settings survive upgrade.
2. Configure two apps. Verify a normal browser tab remains unchanged, standalone auto-matching selects one app, overlapping scopes require manual selection, and Omarchy explicit activation works.
3. Follow ordinary and `_blank` links within scope and to an approved second host. Reload on that second host and test again. Test base targets and dynamically added links.
4. Verify lookalike/subdomain hosts, other ports/schemes, out-of-scope paths, external links, Ctrl/Cmd clicks and downloads retain native behavior.
5. Complete actual sign-in, named/featureful popup sign-in, POST redirects, cancellation, sign-out and callback flows. Test a same-host custom auth endpoint after adding its host to exclusions. Leave `window.open` handling disabled if the app depends on popup handles.
6. With `window.open` enabled, test a direct approved URL; confirm named windows, `about:blank` followed by script navigation, featureful popups and external URLs remain native. Confirm early calls and iframe requests are allowed to escape.
7. Suspend/restart the extension worker, reload, disable the tab, reload again, edit/disable a policy, revoke site access, close/reopen the app and restart the browser. Verify session activation and cleanup match the description above.

Native browser/PWA/Omarchy acceptance is pending; passing unit tests and builds alone does not establish those results.

## Installation troubleshooting

Version 1.1.1 fixes the extension showing an install action merely because a manifest was saved. It also preserves captured prompts when the popup is reopened, registers an early listener for saved/granted sites, and reapplies saved manifests after the initial DOM loads when **Auto Scope Fix** is enabled. Registration is independent of navigation policies. **Apply & Save** now requests site access and waits for listener registration before recommending a reload. Unknown-size favicons are no longer labeled as 192px icons, and missing 192px/512px images receive correctly sized generated fallbacks.

Update/reload the extension, open the website in a normal browser tab, click **Apply & Save**, grant access, and reload that page once. Reopen the extension. If Chromium emits an installation offer, **Continue installation on page** exposes an on-page **Install app** button. Its real click invokes the single-use prompt with page user activation. A popup message never directly calls `prompt()`. Dismissed or failed prompts are consumed; the extension waits for a new browser offer. The popup updates readiness while open. It does not claim the app is installed from the user's acceptance alone; the `appinstalled` event confirms that state.

When no offer exists, the popup explains that native installation is unavailable and suggests Chromium's **Install page as app** menu, where offered. The extension cannot manufacture an installation event or guarantee installation by changing a manifest. Chromium's [install criteria](https://web.dev/articles/install-criteria) include a secure page, manifest fields and icon sizes, engagement checks and the app not already being installed. Its [custom installation guidance](https://web.dev/articles/customize-install) describes saving the offered event, calling it from a user gesture and using it once. Page CSP can also block a data-URL manifest or icons; inspect the page's Application/Manifest and console panels if the native menu is unavailable. No uninstall is required merely to configure internal navigation in an existing PWA or an Omarchy `--app` window.

Regression checks include repeated production-script injection without losing a captured offer, fresh-document listener registration, automatic reapplication with the setting on/off, same-origin validation, correct fallback dimensions, prompt single-use/double-click behavior, cancellation, failure and browser-menu fallback. These are simulated browser events; real Chromium installation and policy-specific eligibility still require native testing.
