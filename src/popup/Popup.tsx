import React, { useEffect, useState } from "react";

import { NavigationSettings } from "./NavigationSettings";

import { httpUrl } from "../navigation/policy";
import { StorageManager } from "../utils/storage";

export const Popup = () => {
  const [startUrl, setStartUrl] = useState("");
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [bgColor, setBgColor] = useState("");
  const [themeColor, setThemeColor] = useState("");

  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [isInstallReady, setIsInstallReady] = useState(false);
  const [installReason, setInstallReason] = useState('Checking installation availability…');
  const [activeTab, setActiveTab] = useState<{ id: number; url: string } | null>(null);
  const [pageDefaults, setPageDefaults] = useState<any>({});

  const getCurrentTabUrl = (useFullUrl = false) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (activeTab?.url) {
        try {
          const urlObj = new URL(activeTab.url);
          setStartUrl(useFullUrl ? urlObj.href : urlObj.origin);
        } catch {
          setStartUrl(activeTab.url);
        }
      }
    });
  };

  useEffect(() => {
    // Initialize popup: Inject script -> Get Defaults -> Load Settings
    const init = async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id === undefined || !tab.url) throw new Error('No web page selected.');
        // Safe to inject repeatedly; saved sites also register this at document_start.
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"],
        });

        setActiveTab({ id: tab.id, url: tab.url });

        // 2. Get Page Defaults from content script
        const defaults: any = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tab.id!, { action: "get_manifest_defaults" }, (response) => {
            if (chrome.runtime.lastError) {
              console.warn("Error getting defaults:", chrome.runtime.lastError);
              resolve({});
            } else {
              resolve(response || {});
            }
          });
        });

        setPageDefaults(defaults);

        // 3. Load saved settings from storage
        const hostname = new URL(tab.url).hostname;
        const { siteSettings } = await StorageManager.get("siteSettings");
        const saved = siteSettings?.[hostname];

        // 4. Update UI state
        // Priority: Saved Settings > Page Defaults > Tab Info
        const tabTitle = tab.title || "Fixed PWA";

        // Name & Short Name
        setName(saved?.name || defaults.name || tabTitle);
        setShortName(saved?.shortName || defaults.short_name || tabTitle);

        // Colors
        setBgColor(saved?.backgroundColor || defaults.background_color || "#ffffff");
        setThemeColor(saved?.themeColor || defaults.theme_color || "");

        // Start URL
        if (saved?.startUrl) {
          setStartUrl(saved.startUrl);
        } else {
          try {
            const urlObj = new URL(tab.url);
            setStartUrl(urlObj.origin);
          } catch {
            setStartUrl(tab.url);
          }
        }

      } catch (err) {
        console.error("Initialization failed:", err);
        setStatus("error");
        setStatusMsg("Failed to initialize. Try refreshing the page.");
      }
    };

    init();
  }, []);

  // Read actual readiness, including events delivered after the popup opens.
  useEffect(() => {
    if (!activeTab) return;
    let cancelled = false;
    const update = async () => {
      try {
        const result = await chrome.tabs.sendMessage(activeTab.id, { action: 'check_install_status' });
        if (!cancelled) { setIsInstallReady(result?.ready === true); setInstallReason(result?.reason ?? 'Installation unavailable.'); }
      } catch {
        if (!cancelled) { setIsInstallReady(false); setInstallReason('Reload this page, then reopen the extension.'); }
      }
    };
    void update();
    const timer = setInterval(update, 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [activeTab]);

  const handleApply = async () => {
    setStatus('idle');
    setStatusMsg('');
    try {
      if (!activeTab) throw new Error('No web page selected.');
      const current = httpUrl(activeTab.url);
      const start = httpUrl(startUrl);
      if (start.origin !== current.origin) throw new Error('Start URL must belong to the current origin.');
      // Request from this direct user gesture, before any asynchronous work.
      const granted = await chrome.permissions.request({ origins: [`${current.protocol}//${current.hostname}/*`] });
      if (!granted) throw new Error('Site access is needed to reapply the manifest after reload. Nothing was saved.');
      const settings = { startUrl: start.href, origin: current.origin, name, shortName, backgroundColor: bgColor, themeColor };
      const { siteSettings, autoScopeFix } = await StorageManager.get(['siteSettings', 'autoScopeFix']);
      await StorageManager.set({ siteSettings: { ...siteSettings, [current.hostname]: settings } });
      const registration = await chrome.runtime.sendMessage({ action: 'manifest_sync' });
      if (!registration?.success) throw new Error('Settings saved, but automatic reapplication is unavailable. Reload the extension and try again.');
      const response = await chrome.tabs.sendMessage(activeTab.id, { action: 'fix_scope', settings });
      if (!response?.success) throw new Error(response?.error ?? 'Could not apply the manifest.');
      setStatus('success');
      setStatusMsg(autoScopeFix ? 'Manifest saved and applied. Reload this page once, then reopen the extension to check installation.' : 'Manifest applied. Enable Auto Scope Fix in Options to reapply it after reload.');
    } catch (error) {
      setStatus('error');
      setStatusMsg(error instanceof Error ? error.message : 'Could not save the manifest.');
    }
  };

  const handleReset = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !tab?.id) return;

    try {
      const hostname = new URL(tab.url).hostname;
      const { siteSettings } = await StorageManager.get("siteSettings");

      if (siteSettings[hostname]) {
        delete siteSettings[hostname];
        await StorageManager.set({ siteSettings });
      }

      // Reset state to defaults
      setName(pageDefaults.name || "");
      setShortName(pageDefaults.short_name || "");
      setBgColor(pageDefaults.background_color || "#ffffff");
      setThemeColor(pageDefaults.theme_color || "");
      getCurrentTabUrl(false); // Reset start URL logic

      // Apply defaults
      const defaults = {
        startUrl: new URL(tab.url).origin, // Default start url usually origin
        name: pageDefaults.name,
        shortName: pageDefaults.short_name,
        backgroundColor: pageDefaults.background_color,
        themeColor: pageDefaults.theme_color,
      };

      await chrome.tabs.sendMessage(tab.id, {
        action: "fix_scope",
        settings: defaults,
      });

      setStatus("success");
      setStatusMsg("Reset to defaults!");
    } catch (e) {
      console.error("Reset failed", e);
      setStatus("error");
      setStatusMsg("Reset failed");
    }
  };

  const handleInstall = async () => {
    try {
      if (!activeTab) return;
      const result = await chrome.tabs.sendMessage(activeTab.id, { action: 'trigger_install' });
      if (result?.success) window.close(); // The final, trusted install click happens on the page.
      else { setIsInstallReady(false); setInstallReason(result?.reason ?? 'Installation is no longer available.'); }
    } catch { setIsInstallReady(false); setInstallReason('Reload this page, then reopen the extension.'); }
  };

  return (
    <div className="p-4 flex flex-col gap-4 w-[450px]">
      <div className="flex items-center gap-2 border-b pb-2 mb-1">
        <h1 className="text-lg font-bold text-slate-800 flex-1">PWA Scope(Fixe)r</h1>
        <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">v{chrome.runtime.getManifest().version}</span>
        <button
          onClick={() => chrome.runtime.openOptionsPage()}
          className="p-1.5 hover:bg-slate-200 rounded-full text-slate-500 hover:text-slate-700 transition-colors"
          title="Open Options"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {/* Start URL */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500 uppercase">Start URL</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={startUrl}
              onChange={(e) => setStartUrl(e.target.value)}
              placeholder="https://..."
              className="flex-1 px-2 py-1.5 text-sm border rounded text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
            <button
              onClick={() => getCurrentTabUrl(true)}
              title="Use current tab URL"
              className="px-2 py-1.5 bg-slate-100 border rounded hover:bg-slate-200 text-slate-600 transition-colors"
            >
              🔗
            </button>
          </div>
        </div>

        {/* Name & Short Name */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 uppercase">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="px-2 py-1.5 text-sm border rounded text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 uppercase">Short Name</label>
            <input
              type="text"
              value={shortName}
              onChange={(e) => setShortName(e.target.value)}
              className="px-2 py-1.5 text-sm border rounded text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
          </div>
        </div>

        {/* Colors */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 uppercase">Background</label>
            <div className="flex gap-1">
              <input
                type="color"
                value={bgColor}
                onChange={(e) => setBgColor(e.target.value)}
                className="h-[34px] w-[34px] p-0 border rounded cursor-pointer"
              />
              <input
                type="text"
                value={bgColor}
                onChange={(e) => setBgColor(e.target.value)}
                className="flex-1 min-w-0 px-2 py-1.5 text-sm border rounded text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
            </div>
            <div className="flex gap-1 mt-1">
              {["#ffffff", "#000000", "#3383db", "#4F46E5", "#64748b"].map((c) => (
                <button
                  key={c}
                  onClick={() => setBgColor(c)}
                  className="w-6 h-6 rounded border shadow-sm hover:scale-110 transition-transform"
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 uppercase">Theme Color</label>
            <div className="flex gap-1">
              <input
                type="color"
                value={themeColor || "#ffffff"}
                onChange={(e) => setThemeColor(e.target.value)}
                className="h-[34px] w-[34px] p-0 border rounded cursor-pointer"
              />
              <input
                type="text"
                value={themeColor}
                placeholder="None"
                onChange={(e) => setThemeColor(e.target.value)}
                className="flex-1 min-w-0 px-2 py-1.5 text-sm border rounded text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
            </div>
            <div className="flex gap-1 mt-1">
              {["#ffffff", "#000000", "#3383db", "#4F46E5", "#64748b"].map((c) => (
                <button
                  key={c}
                  onClick={() => setThemeColor(c)}
                  className="w-6 h-6 rounded border shadow-sm hover:scale-110 transition-transform"
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-2 mt-2">
        <button
          onClick={handleApply}
          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded transition-colors flex items-center justify-center gap-2"
        >
          <span>Apply & Save</span>
        </button>

        <button
          onClick={handleReset}
          className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded transition-colors"
          title="Reset to defaults"
        >
          🔄
        </button>
      </div>

      {isInstallReady && (
        <button
          onClick={handleInstall}
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded transition-colors flex items-center justify-center gap-2"
          title="Show the install confirmation button on the page"
        >
          <span>📲 Continue installation on page</span>
        </button>
      )}

      <p className="text-sm text-slate-600" role="status">{installReason}</p>

      {status === "success" && (
        <div className="bg-green-50 text-green-700 p-2 rounded text-sm border border-green-200 text-center">
          ✅ {statusMsg}
        </div>
      )}

      {status === "error" && (
        <div className="bg-red-50 text-red-700 p-2 rounded text-sm border border-red-200 text-center">
          ❌ {statusMsg}
        </div>
      )}

      <NavigationSettings />

      <div className="mt-2 pt-3 border-t text-[10px] text-slate-400 text-center flex flex-col gap-1">
        <div>
          Developed by{" "}
          <a
            href="https://github.com/kittizz"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-500 hover:text-blue-600 underline"
          >
            kittizz
          </a>
        </div>
        <div>
          Idea by{" "}
          <a
            href="https://www.reddit.com/r/MicrosoftEdge/comments/1f74e7j/comment/n1ntpql/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-500 hover:text-blue-600 underline"
          >
            Expensive-Draw-2949
          </a>
        </div>
        <div>
          <a
            href="https://github.com/kittizz/pwa-scope-fixer"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-500 hover:text-blue-600 underline"
          >
            GitHub Repository
          </a>
        </div>
      </div>
    </div>
  );
};
