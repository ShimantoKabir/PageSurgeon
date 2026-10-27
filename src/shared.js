/* --- Helpers shared by background.js and popup.js --- */
function isMatch(url, patternStr) {
  if (!patternStr) return false;
  const patterns = patternStr
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p);
  let matched = false;
  let excluded = false;
  for (const p of patterns) {
    const isExclude = p.startsWith("!");
    const cleanP = isExclude ? p.substring(1) : p;
    const regexStr =
      "^" +
      cleanP.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") +
      "$";
    const regex = new RegExp(regexStr);
    if (regex.test(url)) {
      if (isExclude) excluded = true;
      else matched = true;
    }
  }
  return matched && !excluded;
}

function isRestrictedUrl(url) {
  return (
    !url ||
    /^(chrome|edge|about|view-source|chrome-extension|moz-extension):/.test(url) ||
    url.includes("chromewebstore.google.com") ||
    url.includes("chrome.google.com/webstore") ||
    url.includes("addons.mozilla.org")
  );
}
