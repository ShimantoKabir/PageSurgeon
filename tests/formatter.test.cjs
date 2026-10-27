const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

module.exports = (async () => {
  const context = vm.createContext({ TextEncoder, TextDecoder });
  for (const file of ['vendor/prettier/standalone.js', 'vendor/prettier/babel.js',
    'vendor/prettier/estree.js', 'vendor/prettier/postcss.js', 'formatter.js', 'editor.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), context);
  }
  const format = vm.runInContext('beautifySource', context);
  const source = 'function greet(name){return {message:`Hi ${name}`,ok:true}}';
  const js = await format(source, 'js', source.indexOf('message') + 3);
  assert.match(js.formatted, /\n {2}return/);
  assert.match(js.formatted, /`Hi \$\{name\}`/);
  assert.equal(js.formatted.slice(js.cursorOffset - 3, js.cursorOffset + 4), 'message');
  new vm.Script(js.formatted);
  assert.equal((await format(js.formatted, 'js')).formatted, js.formatted);

  const typed = 'interface Person{name:string};function greet(person:Person):string{return person.name}';
  const formattedTS = await format(typed, 'ts', typed.indexOf('person.name') + 3);
  assert.match(formattedTS.formatted, /\n {2}name: string;/);
  assert.match(formattedTS.formatted, /person: Person/);
  assert.match(formattedTS.formatted, /\n {2}return person.name;/);
  assert.equal((await format(formattedTS.formatted, 'ts')).formatted, formattedTS.formatted);
  await assert.rejects(() => format('const value: = ;', 'ts'));

  const css = await format('.card{color:red;padding:0 4px}', 'css');
  assert.match(css.formatted, /\n {2}color: red;/);
  const scss = await format('$primary:red;@mixin card($gap){padding:$gap;.title{color:$primary}}', 'css');
  assert.match(scss.formatted, /\$primary: red;/);
  assert.match(scss.formatted, /@mixin card\(\$gap\)/);
  assert.match(scss.formatted, /\n {4}color: \$primary;/);
  assert.equal((await format(scss.formatted, 'css')).formatted, scss.formatted);
  await assert.rejects(() => format('const = ;', 'js'));
  await assert.rejects(() => format('.card { color: red;', 'css'));
  assert.equal((await format('', 'js')).formatted, '');

  // Beautification uses the editor's normal undo transaction.
  const textarea = { value: source, selectionStart: 0, selectionEnd: 0,
    addEventListener() {},
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
    setRangeText(text, start, end) { this.value = this.value.slice(0, start) + text + this.value.slice(end); },
  };
  const Editor = vm.runInContext('CodeEditor', context);
  const editor = new Editor(textarea, () => {});
  editor.replace(js.formatted, 0, source.length, js.cursorOffset);
  editor.restore(-1);
  assert.equal(textarea.value, source);
  editor.restore(1);
  assert.equal(textarea.value, js.formatted);
  console.log('Formatter checks passed: JavaScript, CSS, SCSS, syntax errors, cursor mapping, idempotence, undo/redo.');
})();
