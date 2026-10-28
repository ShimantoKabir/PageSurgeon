importScripts("vendor/typescript/typescript.js", "intelligence.js");

let latestRequest = 0;
const intelligenceReady = (async () => {
  const manifest = await fetch(new URL("vendor/typescript/libs.json", self.location.href));
  if (!manifest.ok) throw new Error("Could not load type library manifest");
  const names = await manifest.json();
  const libraries = await Promise.all(names.map(async (name) => {
    const response = await fetch(new URL("vendor/typescript/" + name, self.location.href));
    if (!response.ok) throw new Error(`Could not load type library ${name}`);
    return [name, await response.text()];
  }));
  return new ScriptIntelligence(Object.fromEntries(libraries));
})();
// Avoid an unhandled rejection before the first autocomplete request arrives.
intelligenceReady.catch(() => {});
self.onmessage = async ({ data }) => {
  latestRequest = data.id;
  try {
    const engine = await intelligenceReady;
    if (data.id !== latestRequest) return;
    self.postMessage({ id: data.id, result: engine.complete(data.source, data.position, data.language) });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
};
