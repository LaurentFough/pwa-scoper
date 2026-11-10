import { createInstallController } from './install';
import { StorageManager } from '../utils/storage';
import { httpUrl } from '../navigation/policy';
import type { SiteSetting } from '../utils/storage';

// Popup injection and document_start registration must share one event listener and prompt.
(() => {
  const state = window as unknown as { __pwaScopeFixerContent?: boolean };
  if (state.__pwaScopeFixerContent) return;
  state.__pwaScopeFixerContent = true;
  const install = createInstallController(window, document);
  let manuallyApplied = false;
  function getPwaDefaults() {
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    const themeColor = themeColorMeta ? themeColorMeta.getAttribute("content") : null;

    const bodyStyles = window.getComputedStyle(document.body || document.documentElement);
    const backgroundColor =
      bodyStyles.backgroundColor !== "rgba(0, 0, 0, 0)" &&
      bodyStyles.backgroundColor !== "transparent"
        ? bodyStyles.backgroundColor
        : "#ffffff";

    return {
      name: document.title || "Fixed PWA",
      short_name: document.title || "Fixed PWA",
      background_color: backgroundColor,
      theme_color: themeColor,
    };
  }

  function injectManifest(settings: {
    startUrl: string;
    name?: string;
    shortName?: string;
    backgroundColor?: string;
    themeColor?: string;
  }) {
    console.log("[PWA Scope(Fixe)r] Injecting manifest");

    // 2. Remove existing manifest to avoid conflict
    const existingLinks = document.querySelectorAll('link[rel="manifest"]');
    existingLinks.forEach((link) => link.remove());

    // Find existing icons
    const iconLinks = Array.from(
      document.querySelectorAll(
        'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]',
      ),
    );

    const manifestIcons = iconLinks
      .map((link: any) => {
        const sizes = link.getAttribute("sizes");
        const type = link.getAttribute("type") || "image/png";
        return {
          src: link.href,
          sizes: sizes || "any", // Never mislabel a small favicon as a 192px icon.
          type: type,
        };
      })
      .filter((icon) => icon.src); // Ensure src exists

    // Supply real 192px and 512px images when the site provides only a small favicon.
    for (const size of [192, 512]) {
      if (manifestIcons.some(icon => icon.sizes.split(/\s+/).includes(`${size}x${size}`))) continue;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not create a fallback icon.');
      ctx.fillStyle = '#3383db';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold ${Math.round(size * 0.42)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('PWA', size / 2, size / 2);
      manifestIcons.push({ src: canvas.toDataURL('image/png'), sizes: `${size}x${size}`, type: 'image/png' });
    }

    // 3. Construct Manifest
    const defaults = getPwaDefaults();

    // Using a generic manifest that encourages standalone mode
    const manifestJson: any = {
      start_url: settings.startUrl,
      display: "standalone",
      name: settings.name || defaults.name,
      short_name: settings.shortName || defaults.short_name,
      background_color: settings.backgroundColor || defaults.background_color,
      icons: manifestIcons,
    };

    const themeColor = settings.themeColor || defaults.theme_color;
    if (themeColor) {
      manifestJson.theme_color = themeColor;
    }

    const manifestString = JSON.stringify(manifestJson);
    // Using Data URI for manifest
    const dataUri = `data:application/manifest+json,${encodeURIComponent(manifestString)}`;

    // DOM construction avoids HTML parsing and Trusted Types createHTML requirements.
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = dataUri;
    (document.head || document.documentElement).prepend(link);
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return;
    if (request.action === 'fix_scope') {
      try {
        const start = httpUrl(request.settings.startUrl);
        if (start.origin !== location.origin) throw new Error('Start URL must belong to the current origin.');
        manuallyApplied = true;
        injectManifest(request.settings);
        sendResponse({ success: true });
      } catch { sendResponse({ success: false, error: 'Could not apply the manifest. Use a start URL on the current origin.' }); }
    } else if (request.action === 'trigger_install') {
      sendResponse(install.show());
    } else if (request.action === 'check_install_status') {
      sendResponse(install.status());
    } else if (request.action === 'get_manifest_defaults') {
      sendResponse(getPwaDefaults());
    }
  });

  // Listen immediately, then reapply the saved manifest after the site's initial DOM exists.
  const domReady = document.readyState === 'loading'
    ? new Promise<void>(resolve => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }))
    : Promise.resolve();
  void Promise.all([StorageManager.get(['autoScopeFix', 'siteSettings']), domReady]).then(([data]) => {
    const setting: SiteSetting | undefined = data.siteSettings[location.hostname];
    if (manuallyApplied || !data.autoScopeFix || !setting) return;
    if (httpUrl(setting.startUrl).origin !== location.origin || (setting.origin && setting.origin !== location.origin)) return;
    injectManifest(setting);
  }).catch(() => console.warn('[PWA Scope(Fixe)r] Saved manifest could not be reapplied.'));
})();
