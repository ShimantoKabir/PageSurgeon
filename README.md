# PageSurgeon

Apply custom JavaScript and CSS rules to matching websites.

## TypeScript

Choose **TypeScript** from the language selector above the JavaScript editor.
Write a single-file TypeScript script, then save. PageSurgeon stores the
original source and compiles it locally to JavaScript before registration,
live execution, or fallback injection. Existing rules default to JavaScript.
The language selection is preserved in JSON exports and imports.

TypeScript supports type annotations, interfaces, type aliases, enums,
generics, and classes. Beautify understands TypeScript and uses two-space
indentation. Compilation errors appear below the editor header and prevent
that script from executing; the source can still be saved for later editing.
Compilation also happens before document-start registration, preserving the
rule's injection timing.

This is single-file transpilation, without semantic type checking or package
bundling. Static imports/exports and JSX/TSX are not supported. Use ordinary
browser globals or the external libraries panel for runtime dependencies.
The TypeScript compiler is bundled with the extension; source stays on-device.

Run TypeScript checks with `node tests/typescript.test.cjs`.
Run the Chrome worker lifecycle and exact badge-example checks with
`node tests/service-worker.test.cjs`. The lifecycle harness rejects new script
imports after worker installation, matching Chrome's restriction. The badge
checks use a DOM fixture; browser verification is a separate manual check.

## Editors

JavaScript and TypeScript autocomplete uses the bundled TypeScript language
service and DOM type libraries in a dedicated worker. It suggests members
after a dot or optional chain, including variables inferred from DOM queries,
arrays, strings, object literals, and declared TypeScript types. For example,
`const x = document.querySelector('a#dib'); x.` offers anchor members such as
`href`, plus inherited DOM members. Chained expressions such as `x.classList.`
and `x.style.` also work. Use the arrows to browse the full scrollable list
and Enter or Tab to insert a member without replacing its receiver.

Autocomplete analyzes source locally without executing it or contacting a
service. Compound literal selectors with a known HTML tag receive additional
type hints. Untyped third-party APIs or selectors that don't identify a tag
may provide less specific suggestions. Run checks with
`node tests/completions.test.cjs`.

Drag the divider between the editors to resize them. On narrow windows it
becomes an up/down divider. Double-click it or focus it and press Enter to
restore an equal split. Arrow keys adjust the focused divider; Shift+Arrow
makes a larger adjustment. Each layout remembers its own split position.
Run the interaction checks with `node tests/splitter.test.cjs`.

Both editors support four-space indentation with Tab, selection indentation
with Tab / Shift+Tab, automatic indentation on Enter, bracket and quote pairs,
selection wrapping, and undo / redo. Autocomplete places the cursor at the
first snippet placeholder. The footer shows the cursor position and selection
length.

- Ctrl+Space: open suggestions; use arrows and Enter / Tab to accept.
- Ctrl+S (Cmd+S on macOS): save the current rule.
- Ctrl+/ (Cmd+/ on macOS): wrap/unwrap the exact selected code with `/* ... */` in either editor. Without a selection, toggle the current JavaScript line with `//`, or the current CSS/SCSS line with `/* ... */`. Block wrapping skips selections containing existing block comments to avoid nesting them.
- Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y): undo / redo, including editor actions.
- Escape, then Tab: move keyboard focus out of the editor.

Undo history is kept separately for each editor and resets when switching
rules. Run editor regression checks with `node tests/editor.test.cjs`.

### Beautify

Click **Beautify** in either editor to format JavaScript or CSS/SCSS using the
bundled Prettier formatter. Formatting uses two-space indentation, preserves
the cursor position, and can be undone. Invalid code displays an error and
leaves the editor unchanged. Save to apply formatted changes. Formatting runs
locally without sending source code to a service.

SCSS can be formatted but is not compiled. Inject CSS output, rather than
uncompiled Sass variables or mixins.

### Injection timing

Enable **Run at document start** on a rule and save. Reload the target website
to run its JavaScript at `document_start`, before the DOM has been built.
Elements such as `document.body` may not exist yet. With the switch off,
registered JavaScript continues to run at `document_idle`.

Early execution requires access to the user scripts API and a rule with no
external libraries. Libraries load asynchronously and cannot be guaranteed to
finish before the page starts parsing. If user scripts access is missing,
document-start JavaScript is skipped with a background-console warning rather
than silently executed late. Grant access, save the rule, and reload the page.

Early CSS is attached as soon as the document root exists; strict page CSP or
the page removing that style element can prevent its early application. After
loading, the extension hands the CSS off to its normal CSP-exempt injection.
Changes to early JavaScript take effect on the next navigation; saving does
not rerun it on an already loaded page.

Formatter checks: `node tests/formatter.test.cjs`.
Injection checks: `node tests/injection.test.cjs`.

## Chrome

The root `manifest.json` is for Chrome Manifest V3. Load this project folder
with **Load unpacked** at `chrome://extensions`. Enable **Allow User Scripts**
in the extension's details (Developer mode on Chrome versions before 138).

## Local development loaders

In Chrome, PageSurgeon configures the `USER_SCRIPT` world to permit inline
script elements created by user-authored rules, including loaders that fetch
localhost JavaScript and append it using `script.textContent`. Localhost script
URLs remain allowed. No changes to the pasted loader are needed for that CSP
case. Extension settings and popup pages retain the standard Manifest V3 CSP.

After updating the extension, enable **Allow User Scripts**, reload the
extension, and reload the target website so it receives the new world policy.
The localhost server still needs to permit the loader's fetch requests, and
the original loader only fetches files after a WebSocket message of type `ok`.

Firefox currently does not consistently exempt inserted inline script elements
from the website's CSP, even with this user-script world policy. See Mozilla
bug 1446231 and the discussion in bug 1875475. This loader's unchanged behavior
on restrictive websites is therefore currently supported in Chrome.

## Firefox

`manifest.firefox.json` is the Firefox Manifest V3 source manifest. It uses
background scripts and requires Firefox 136 or newer.

Prepare a Firefox folder from PowerShell:

```powershell
./scripts/build.ps1 -Browser firefox
```

At `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**
and select `dist/firefox/manifest.json`. Open PageSurgeon's settings and click
**Enable user scripts**, then approve the Firefox permission request. Allow
website access when Firefox requests it, and reload the website tabs.

Re-run the build after editing source files, then reload the temporary add-on.
Temporary add-ons are removed when Firefox closes.

Firefox versions without `userScripts.execute` use the existing page-script
fallback for live JavaScript updates and rules with libraries. That fallback
can be blocked by a website's Content Security Policy. Registered JavaScript
rules without libraries run through `userScripts` after a page reload.

To prepare a separate Chrome folder, run `./scripts/build.ps1 -Browser chrome`
and load `dist/chrome` as an unpacked extension.
