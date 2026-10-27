const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let saves = 0;
const context = vm.createContext({
  document: { getElementById: () => ({ click: () => saves++ }) },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/editor.js'), 'utf8'), context);
const CodeEditor = vm.runInContext('CodeEditor', context);

function setup(value = '', start = value.length, end = start, language = 'js') {
  const listeners = {};
  const textarea = {
    value, selectionStart: start, selectionEnd: end, scrollTop: 50, scrollLeft: 10,
    addEventListener(name, callback) { listeners[name] = callback; },
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
    setRangeText(text, a, b) { this.value = this.value.slice(0, a) + text + this.value.slice(b); },
  };
  const status = {};
  let changes = 0;
  const editor = new CodeEditor(textarea, () => changes++, status, language);
  const key = (key, extra = {}) => {
    const event = { key, preventDefault() { this.defaultPrevented = true; }, ...extra };
    editor.keydown(event);
    return event;
  };
  return { textarea, editor, status, key, listeners, changes: () => changes };
}

let t = setup('abc');
t.key('Tab');
assert.equal(t.textarea.value, 'abc ');
assert.equal(t.textarea.scrollTop, 50);
t.key('z', { ctrlKey: true });
assert.equal(t.textarea.value, 'abc');
t.key('z', { ctrlKey: true, shiftKey: true });
assert.equal(t.textarea.value, 'abc ');

t = setup('one\ntwo\nthree', 0, 8);
t.key('Tab');
assert.equal(t.textarea.value, '    one\n    two\nthree');
t.key('Tab', { shiftKey: true });
assert.equal(t.textarea.value, 'one\ntwo\nthree');
assert.equal(t.textarea.selectionStart, 0);
assert.equal(t.textarea.selectionEnd, 8);

t = setup('  one', 2);
t.key('Tab', { shiftKey: true });
assert.equal(t.textarea.value, 'one');
assert.equal(t.textarea.selectionStart, 0);

t = setup('if (ready) {}', 12);
t.key('Enter');
assert.equal(t.textarea.value, 'if (ready) {\n    \n}');
assert.equal(t.textarea.selectionStart, 17);
t = setup('    color: red;');
t.key('Enter');
assert.equal(t.textarea.value, '    color: red;\n    ');

t = setup('selected', 0, 8);
t.key('(');
assert.equal(t.textarea.value, '(selected)');
assert.equal(t.textarea.selectionStart, 1);
assert.equal(t.textarea.selectionEnd, 9);
t = setup();
t.key('{');
assert.equal(t.textarea.value, '{}');
t.key('Backspace');
assert.equal(t.textarea.value, '');
t = setup('()', 1);
t.key(')');
assert.equal(t.textarea.value, '()');
assert.equal(t.textarea.selectionStart, 2);

t = setup('can');
assert.equal(t.key("'").defaultPrevented, undefined);
assert.equal(t.key('(', { isComposing: true }).defaultPrevented, undefined);
assert.equal(t.key('(', { ctrlKey: true }).defaultPrevented, undefined);
t.key('Escape');
assert.equal(t.key('Tab').defaultPrevented, undefined);
t.key('s', { ctrlKey: true });
assert.equal(saves, 1);

t = setup('first');
t.editor.replace('second', 0, 5);
t.editor.restore(-1);
t.listeners.beforeinput({ inputType: 'insertText' });
t.textarea.value = 'first!';
t.textarea.setSelectionRange(6, 6);
t.listeners.input();
t.editor.restore(1);
assert.equal(t.textarea.value, 'first!'); // A new edit discards the redo branch.
t.editor.reset();
t.editor.restore(-1);
assert.equal(t.textarea.value, 'first!'); // Rule switches isolate undo history.
assert.match(t.status.textContent, /Ln 1, Col 7/);

t = setup('\n', 0);
t.key('Enter');
assert.equal(t.textarea.value, '\n\n');
assert.equal(t.textarea.selectionStart, 1);

t = setup('    const answer = 42;', 12);
assert.equal(t.key('/', { ctrlKey: true }).defaultPrevented, true);
assert.equal(t.textarea.value, '    // const answer = 42;');
assert.equal(t.textarea.selectionStart, 15);
t.key('/', { ctrlKey: true });
assert.equal(t.textarea.value, '    const answer = 42;');
assert.equal(t.textarea.selectionStart, 12);
t.key('z', { ctrlKey: true });
assert.equal(t.textarea.value, '    // const answer = 42;');
t.key('z', { ctrlKey: true, shiftKey: true });
assert.equal(t.textarea.value, '    const answer = 42;');

const selectedLines = 'one\n  two\n\nthree';
t = setup(selectedLines, 0, 10);
t.key('/', { ctrlKey: true });
assert.equal(t.textarea.value, '/* one\n  two\n */\nthree');
t.key('/', { ctrlKey: true });
assert.equal(t.textarea.value, selectedLines);
assert.equal(t.textarea.selectionStart, 0);
assert.equal(t.textarea.selectionEnd, 10);
t = setup('// existing\nnew', 0, 15);
t.key('/', { ctrlKey: true });
assert.equal(t.textarea.value, '/* // existing\nnew */');
t.key('/', { ctrlKey: true });
assert.equal(t.textarea.value, '// existing\nnew');

t = setup('const total = left + right;', 14, 21);
t.key('/', { ctrlKey: true });
assert.equal(t.textarea.value, 'const total = /* left +  */right;');
assert.equal(t.textarea.selectionStart, 14);
assert.equal(t.textarea.selectionEnd, 27);
t.key('/', { ctrlKey: true });
assert.equal(t.textarea.value, 'const total = left + right;');
assert.equal(t.textarea.selectionStart, 14);
assert.equal(t.textarea.selectionEnd, 21);
t.key('z', { ctrlKey: true });
assert.equal(t.textarea.value, 'const total = /* left +  */right;');
t.key('z', { ctrlKey: true, shiftKey: true });
assert.equal(t.textarea.value, 'const total = left + right;');

t = setup('.card { color: red; padding: 4px; }', 8, 19, 'css');
t.key('/', { ctrlKey: true });
assert.equal(t.textarea.value, '.card { /* color: red; */ padding: 4px; }');
t.key('/', { ctrlKey: true });
assert.equal(t.textarea.value, '.card { color: red; padding: 4px; }');
t = setup('');
t.key('/', { ctrlKey: true });
assert.equal(t.textarea.value, '// ');
t.key('/', { ctrlKey: true });
assert.equal(t.textarea.value, '');
t = setup('value');
t.key('/', { metaKey: true });
assert.equal(t.textarea.value, '// value');
t = setup('value');
assert.equal(t.key('/', { ctrlKey: true, altKey: true }).defaultPrevented, undefined);
assert.equal(t.key('/', { ctrlKey: true, isComposing: true }).defaultPrevented, undefined);
assert.equal(t.textarea.value, 'value');

t = setup('    color: red;', 8, 8, 'css');
t.key('/', { ctrlKey: true });
assert.equal(t.textarea.value, '    /* color: red; */');
t.key('/', { ctrlKey: true });
assert.equal(t.textarea.value, '    color: red;');
assert.equal(t.textarea.selectionStart, 8);
const cssBlock = '.card {\n    color: red;\n}\n.next {}';
t = setup(cssBlock, 0, 25, 'css');
t.key('/', { ctrlKey: true });
assert.equal(t.textarea.value, '/* .card {\n    color: red;\n} */\n.next {}');
t.key('/', { ctrlKey: true });
assert.equal(t.textarea.value, cssBlock);
t = setup('color: red; /* note */', 0, 21, 'css');
t.key('/', { ctrlKey: true });
assert.equal(t.textarea.value, 'color: red; /* note */');
assert.match(t.status.textContent, /existing block comments/);
console.log('Editor checks passed, including JS/CSS comment toggling, multiline selections, cursor preservation, undo/redo, and shortcut modifiers.');
