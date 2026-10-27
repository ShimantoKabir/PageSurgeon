const ext = globalThis.browser || globalThis.chrome;

// Chrome imports helpers; Firefox loads them first via background.scripts.
if (typeof importScripts === "function") importScripts("shared.js");

// Rules whose JS is covered by a registered user script (run on page load).
// Rules with libs are excluded: the libs must load first and be visible to
// the code, so they run via injectRule in the page world instead.
let registeredRuleIds = new Set();
const usesLibs = (rule) => !!(rule.libs && rule.libs.length > 0);
const ruleRunAt = (rule) => rule.runAt === "document_start" ? "document_start" : "document_idle";
const earlyStyleId = (rule) => `pagesurgeon-${ext.runtime.id}-${rule.id}`;

async function configureUserScriptWorld() {
  // User-authored loaders may append <script> elements with textContent.
  // Chrome checks those insertions against the initiating world's policy.
  // Configure only USER_SCRIPT; extension pages retain their Manifest V3 CSP.
  await ext.userScripts.configureWorld({
    csp: "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' http://localhost:* http://127.0.0.1:*; object-src 'none'",
  });
}

// Self-contained because this function is serialized into the user-script world.
function installEarlyCss(id, css) {
  function apply() {
    const parent = document.head || document.documentElement;
    if (!parent) return false;
    let style = document.getElementById(id);
    if (!style) {
      style = document.createElement("style");
      style.id = id;
      style.textContent = css;
      parent.appendChild(style);
    } else {
      style.textContent = css;
    }
    return true;
  }
  if (!apply()) {
    const observer = new MutationObserver(() => {
      if (apply()) observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  }
}

function registeredCode(rule) {
  const earlyCss = ruleRunAt(rule) === "document_start" && rule.css
    ? `(${installEarlyCss.toString()})(${JSON.stringify(earlyStyleId(rule))}, ${JSON.stringify(rule.css)});`
    : "";
  // Apply the same wildcard and exclusion rules as the popup and live injector.
  // The browser's native match-pattern grammar differs from our wildcard grammar.
  return `if (!(${isRestrictedUrl.toString()})(location.href) &&
    (${isMatch.toString()})(location.href, ${JSON.stringify(rule.urlPattern || "")})) {
    ${earlyCss}
    ${rule.js || ""}
  }`;
}

async function removeEarlyCss(tabId, rule) {
  await ext.scripting.executeScript({
    target: { tabId },
    func: (id) => document.getElementById(id)?.remove(),
    args: [earlyStyleId(rule)],
  }).catch(() => {});
}

// Keep rapid saves and permission events from unregistering each other's scripts.
let syncQueue = Promise.resolve();
function syncUserScripts() {
  syncQueue = syncQueue.then(reconcileUserScripts, reconcileUserScripts);
  return syncQueue;
}

/* --- Sync Registered User Scripts (Exempt from Host Page CSP) --- */
async function reconcileUserScripts() {
  try {
    if (!ext.userScripts?.register) {
      registeredRuleIds = new Set();
      return;
    }
    // Must precede registration: policy updates apply to newly created worlds.
    await configureUserScriptWorld();
    const existing = await ext.userScripts.getScripts();
    if (existing && existing.length > 0) {
      await ext.userScripts.unregister({ ids: existing.map((s) => s.id) });
    }

    const data = await ext.storage.local.get(["rules"]);
    const rules = data.rules || [];
    const registered = new Set();

    for (const rule of rules) {
      if (rule.enabled === false) continue;
      if (!rule.js?.trim() && !(ruleRunAt(rule) === "document_start" && rule.css)) continue;
      if (usesLibs(rule)) continue;
      if (!rule.urlPattern?.trim()) continue;

      // Register one by one so a single bad pattern doesn't drop every rule
      try {
        await ext.userScripts.register([
          {
            id: "usr_" + rule.id.replace(/[^a-zA-Z0-9_-]/g, ""),
            matches: ["<all_urls>"],
            js: [{ code: registeredCode(rule) }],
            world: "USER_SCRIPT",
            runAt: ruleRunAt(rule),
          },
        ]);
        registered.add(rule.id);
      } catch (err) {
        console.warn(`Could not register rule "${rule.name}":`, err);
      }
    }
    registeredRuleIds = registered;
  } catch (err) {
    registeredRuleIds = new Set();
    console.warn("userScripts sync note:", err);
  }
}

/* --- Inject Rules (CSS & Live Execution) --- */
async function injectRule(tabId, url, rule, { runJs = true } = {}) {
  if (rule.enabled === false) return;
  if (isRestrictedUrl(url)) return;
  if (!isMatch(url, rule.urlPattern)) return;

  // 1. External Modules (Libraries)
  if (rule.libs && rule.libs.length > 0) {
    for (const libUrl of rule.libs) {
      if (libUrl.endsWith(".css")) {
        await ext.scripting
          .executeScript({
            target: { tabId },
            func: (u) =>
              new Promise((resolve) => {
                if (document.querySelector(`link[href="${u}"]`)) return resolve();
                const l = document.createElement("link");
                l.rel = "stylesheet";
                l.href = u;
                l.onload = l.onerror = () => resolve();
                document.head.appendChild(l);
              }),
            args: [libUrl],
          })
          .catch(() => {});
      } else if (libUrl.endsWith(".js")) {
        await ext.scripting
          .executeScript({
            target: { tabId },
            func: (u) =>
              new Promise((resolve) => {
                if (document.querySelector(`script[src="${u}"]`)) return resolve();
                const s = document.createElement("script");
                s.src = u;
                s.onload = s.onerror = () => resolve();
                document.head.appendChild(s);
              }),
            args: [libUrl],
          })
          .catch(() => {});
      }
    }
  }

  // 2. CSS Injection (insertCSS is exempt from the page's CSP)
  if (rule.css) {
    await ext.scripting
      .insertCSS({ target: { tabId }, css: rule.css })
      // Hand off early styles to CSP-exempt CSS that the existing live updater tracks.
      .then(() => removeEarlyCss(tabId, rule))
      .catch((err) => console.error("CSS inject error:", err));
  }

  // 3. JS Dynamic Execution (CSP-Safe Execution)
  if (runJs && rule.js && rule.js.trim() !== "") {
    try {
      // Prioritize native userScripts API (bypasses page CSP entirely)
      if (ext.userScripts && ext.userScripts.execute) {
        if (!usesLibs(rule)) await configureUserScriptWorld();
        await ext.userScripts.execute({
          target: { tabId },
          js: [{ code: rule.js }],
          // Library rules need the page world to see the libs they load
          world: usesLibs(rule) ? "MAIN" : "USER_SCRIPT",
        });
      } else {
        // Fallback: run in the page's own world via an inline script tag.
        // (new Function in the isolated world hits the extension CSP.)
        // Subject to the page's CSP, unlike userScripts.
        await ext.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: (jsCode) => {
            try {
              const script = document.createElement("script");
              script.textContent = jsCode;
              (document.head || document.documentElement).appendChild(script);
              script.remove();
            } catch (e) {
              console.error("User script execution error:", e);
            }
          },
          args: [rule.js],
        });
      }
    } catch (err) {
      console.error("JS Injection error:", err);
    }
  }
}

// Initial script synchronization on startup (also runs on every worker wake)
let syncReady = syncUserScripts();
ext.runtime.onInstalled.addListener(() => (syncReady = syncUserScripts()));
ext.runtime.onStartup.addListener(() => (syncReady = syncUserScripts()));
ext.permissions.onAdded.addListener((permissions) => {
  if (permissions.permissions.includes("userScripts")) {
    syncReady = syncUserScripts();
  }
});
ext.permissions.onRemoved.addListener((permissions) => {
  if (permissions.permissions.includes("userScripts")) {
    registeredRuleIds = new Set();
  }
});

// insertCSS can only be undone with the exact same CSS, so remember what each
// rule last injected (session storage survives service worker restarts)
async function getAppliedCss() {
  if (!ext.storage.session) return {};
  const { appliedCss = {} } = await ext.storage.session.get("appliedCss");
  return appliedCss;
}

async function recordAppliedCss(rules) {
  if (!ext.storage.session) return;
  const appliedCss = {};
  for (const rule of rules) {
    if (rule.enabled !== false && rule.css) appliedCss[rule.id] = rule.css;
  }
  await ext.storage.session.set({ appliedCss });
}

// Tab update listener
ext.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && !isRestrictedUrl(tab.url)) {
    await syncReady;
    const { rules = [] } = await ext.storage.local.get(["rules"]);
    // Registered userScripts already run the JS on page load; run it here
    // only for rules they don't cover.
    await Promise.all(rules.map((rule) => {
      const early = ruleRunAt(rule) === "document_start";
      if (early && rule.enabled !== false && rule.js?.trim() &&
        isMatch(tab.url, rule.urlPattern) && !registeredRuleIds.has(rule.id)) {
        console.warn(`Document-start rule "${rule.name}" could not run. Enable user scripts, remove external libraries, save, and reload the website.`);
      }
      return injectRule(tabId, tab.url, rule, {
        runJs: !early && !registeredRuleIds.has(rule.id),
      });
    }));
    await recordAppliedCss(rules);
  }
});

// Live update listener from Options/Popup
ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== "ruleUpdated" || !message.rule) return;
  const rule = message.rule;
  syncReady = syncUserScripts();

  (async () => {
    await syncReady;
    const applied = await getAppliedCss();
    const tabs = await ext.tabs.query({});
    for (const tab of tabs) {
      if (isRestrictedUrl(tab.url)) continue;
      await removeEarlyCss(tab.id, rule);
      if (applied[rule.id]) {
        await ext.scripting
          .removeCSS({ target: { tabId: tab.id }, css: applied[rule.id] })
          .catch(() => {});
      }
      // Document-start JavaScript takes effect on navigation, never halfway through a page.
      await injectRule(tab.id, tab.url, rule, { runJs: ruleRunAt(rule) !== "document_start" }).catch((err) =>
        console.error("Live update error:", err),
      );
    }
    const { rules = [] } = await ext.storage.local.get(["rules"]);
    await recordAppliedCss(rules);
  })().then(() => sendResponse({ ok: true }), (error) => {
    console.error("Rule update error:", error);
    sendResponse({ ok: false, error: error.message });
  });
  return true;
});
