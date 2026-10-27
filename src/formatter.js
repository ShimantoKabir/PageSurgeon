// Prettier and its parsers are bundled locally; editor contents stay on-device.
async function beautifySource(source, language, cursorOffset = 0) {
  return prettier.formatWithCursor(source, {
    parser: language === "ts" ? "babel-ts" : language === "js" ? "babel" : "scss",
    plugins: Object.values(prettierPlugins),
    cursorOffset,
    tabWidth: 2,
    printWidth: 100,
    useTabs: false,
    embeddedLanguageFormatting: "off",
  });
}
