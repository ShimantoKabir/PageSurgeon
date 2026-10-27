const ext = globalThis.browser || globalThis.chrome;

// Chrome runs this as a service worker (needs importScripts); Firefox lists
// shared.js ahead of it in manifest "scripts".
if (typeof importScripts === "function") importScripts("shared.js");

const hasUserScripts = !!(ext.userScripts && ext.userScripts.register);

// Rules whose JS is covered by a registered user script (run on page load).
// Rules with libs are excluded: the libs must load first and be visible to
// the code, so they run via injectRule in the page world instead.
let registeredRuleIds = new Set();
const usesLibs = (rule) => !!(rule.libs && rule.libs.length > 0);

/* --- Sync Registered User Scripts (Exempt from Host Page CSP) --- */
async function syncUserScripts() {
  if (!hasUserScripts) return;
  try {
    const existing = await ext.userScripts.getScripts();
    if (existing && existing.length > 0) {
      await ext.userScripts.unregister({ ids: existing.map((s) => s.id) });
    }

    const data = await ext.storage.local.get(["rules"]);
    const rules = data.rules || [];
    const registered = new Set();

    for (const rule of rules) {
      if (rule.enabled === false || !rule.js || rule.js.trim() === "") continue;
      if (usesLibs(rule)) continue;

      const patterns = (rule.urlPattern || "")
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p);
      const isUrlPattern = (p) => /^(https?|\*):\/\//.test(p);
      const matches = patterns.filter((p) => !p.startsWith("!") && isUrlPattern(p));
      const excludeMatches = patterns
        .filter((p) => p.startsWith("!"))
        .map((p) => p.substring(1))
        .filter(isUrlPattern);
      if (matches.length === 0) continue;

      // Register one by one so a single bad pattern doesn't drop every rule
      try {
        await ext.userScripts.register([
          {
            id: "usr_" + rule.id.replace(/[^a-zA-Z0-9_-]/g, ""),
            matches,
            excludeMatches,
            js: [{ code: rule.js }],
            world: "USER_SCRIPT",
            runAt: "document_idle",
          },
        ]);
        registered.add(rule.id);
      } catch (err) {
        console.warn(`Could not register rule "${rule.name}":`, err);
      }
    }
    registeredRuleIds = registered;
  } catch (err) {
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
      .catch((err) => console.error("CSS inject error:", err));
  }

  // 3. JS Dynamic Execution (CSP-Safe Execution)
  if (runJs && rule.js && rule.js.trim() !== "") {
    try {
      // Prioritize native userScripts API (bypasses page CSP entirely)
      if (ext.userScripts && ext.userScripts.execute) {
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
    await Promise.all(
      rules.map((rule) =>
        injectRule(tabId, tab.url, rule, { runJs: !registeredRuleIds.has(rule.id) }),
      ),
    );
    await recordAppliedCss(rules);
  }
});

// Live update listener from Options/Popup
ext.runtime.onMessage.addListener((message) => {
  if (message.action !== "ruleUpdated" || !message.rule) return;
  const rule = message.rule;
  syncReady = syncUserScripts();

  (async () => {
    const applied = await getAppliedCss();
    const tabs = await ext.tabs.query({});
    for (const tab of tabs) {
      if (isRestrictedUrl(tab.url)) continue;
      if (applied[rule.id]) {
        await ext.scripting
          .removeCSS({ target: { tabId: tab.id }, css: applied[rule.id] })
          .catch(() => {});
      }
      await injectRule(tab.id, tab.url, rule).catch((err) =>
        console.error("Live update error:", err),
      );
    }
    const { rules = [] } = await ext.storage.local.get(["rules"]);
    await recordAppliedCss(rules);
  })();
});
