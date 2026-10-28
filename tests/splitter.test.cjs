const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

module.exports = (async () => {
  function setup(saved, delayed = false) {
    const media = { matches: false, addEventListener(name, fn) { this.change = fn; } };
    const context = vm.createContext({ matchMedia: () => media });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/splitter.js'), 'utf8'), context);
    const Splitter = vm.runInContext('EditorSplitter', context);
    const styles = new Map();
    const attrs = new Map();
    const classes = new Set();
    const events = {};
    const writes = [];
    const captures = new Set();
    let resolveRead;
    const storage = {
      get: () => delayed ? new Promise((resolve) => { resolveRead = resolve; }) : Promise.resolve({ editorSplit: saved }),
      set: async (value) => writes.push(value),
    };
    const container = {
      style: { setProperty: (name, value) => styles.set(name, value) },
      classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
      getBoundingClientRect: () => ({ left: 20, top: 10, width: 1008, height: 608 }),
    };
    const handle = {
      addEventListener: (name, fn) => { events[name] = fn; },
      setAttribute: (name, value) => attrs.set(name, value),
      focus() {},
      setPointerCapture: (id) => captures.add(id),
      hasPointerCapture: (id) => captures.has(id),
      releasePointerCapture: (id) => captures.delete(id),
      getBoundingClientRect: () => media.matches
        ? { left: 20, top: 10 + styles.get('--js-grow') * 6, width: 1008, height: 8 }
        : { left: 20 + styles.get('--js-grow') * 10, top: 10, width: 8, height: 608 },
    };
    const splitter = new Splitter(container, handle, storage);
    const pointer = (extra = {}) => ({ button: 0, pointerId: 1, clientX: 524, clientY: 314, preventDefault() {}, ...extra });
    const key = (key, extra = {}) => {
      const event = { key, preventDefault() { this.prevented = true; }, ...extra };
      events.keydown(event);
      return event;
    };
    return { splitter, media, styles, attrs, classes, writes, captures, events, pointer, key,
      resolve: (value) => resolveRead(value) };
  }

  let t = setup();
  await Promise.resolve();
  assert.equal(t.styles.get('--js-grow'), 50);
  assert.equal(t.attrs.get('aria-orientation'), 'vertical');
  t.events.pointerdown(t.pointer());
  t.events.pointermove(t.pointer({ clientX: 724 }));
  assert.equal(t.styles.get('--js-grow'), 70);
  assert.equal(t.styles.get('--css-grow'), 30);
  assert.ok(t.classes.has('is-resizing'));
  t.events.pointerup(t.pointer());
  assert.equal(t.writes.at(-1).editorSplit.horizontal, 70);
  assert.equal(t.captures.size, 0);
  assert.equal(t.classes.has('is-resizing'), false);
  t.key('End');
  assert.equal(t.styles.get('--js-grow'), 80);
  t.key('ArrowRight');
  assert.equal(t.styles.get('--js-grow'), 80);
  t.key('ArrowLeft', { shiftKey: true });
  assert.equal(t.styles.get('--js-grow'), 70);
  t.key('Enter');
  assert.equal(t.styles.get('--js-grow'), 50);
  t.events.dblclick();
  assert.equal(t.styles.get('--js-grow'), 50);
  assert.equal(t.key('Tab').prevented, undefined);
  t.key('Home');
  assert.equal(t.styles.get('--js-grow'), 20);

  t.media.matches = true;
  t.media.change();
  assert.equal(t.attrs.get('aria-orientation'), 'horizontal');
  assert.equal(t.styles.get('--js-grow'), 50);
  t.key('ArrowDown');
  assert.equal(t.styles.get('--js-grow'), 52);
  t.events.pointerdown(t.pointer({ clientY: 326 }));
  t.events.pointermove(t.pointer({ clientY: 434 }));
  assert.equal(t.styles.get('--js-grow'), 70);
  t.events.pointerup(t.pointer());
  assert.equal(t.writes.at(-1).editorSplit.vertical, 70);
  assert.equal(t.writes.at(-1).editorSplit.horizontal, 20);
  const writesBeforeCancel = t.writes.length;
  t.events.pointerdown(t.pointer({ clientY: 434 }));
  t.events.pointermove(t.pointer({ clientY: -1000 }));
  assert.equal(t.styles.get('--js-grow'), 20);
  t.events.pointercancel(t.pointer());
  assert.equal(t.styles.get('--js-grow'), 70);
  assert.equal(t.writes.length, writesBeforeCancel);
  t.media.matches = false;
  t.media.change();
  assert.equal(t.styles.get('--js-grow'), 20);

  t = setup({ horizontal: 65, vertical: 200 });
  await Promise.resolve();
  assert.equal(t.styles.get('--js-grow'), 65);
  t.media.matches = true;
  t.media.change();
  assert.equal(t.styles.get('--js-grow'), 80);
  t = setup(null, true);
  t.key('ArrowLeft');
  t.resolve({ editorSplit: { horizontal: 75 } });
  await Promise.resolve();
  assert.equal(t.styles.get('--js-grow'), 48); // Late preference reads cannot undo user input.
  console.log('Splitter checks passed: dragging, bounds, pointer cancellation, keyboard control, responsive orientation, reset, and preference persistence.');
})();
