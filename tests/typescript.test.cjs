const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

module.exports = (async () => {
  const src = (file) => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  const context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(src('vendor/typescript/typescript.js'), context);
  vm.runInContext(src('compiler.js'), context);
  const compile = vm.runInContext('transpileRuleJavaScript', context);
  const source = `
    interface Person { name: string }
    type Names = Array<string>;
    enum Status { Ready = 'ready' }
    class Greeter {
      constructor(private person: Person) {}
      greet<T extends string>(suffix: T): string { return this.person.name + suffix; }
    }
    const names: Names = ['Ada'];
    globalThis.result = new Greeter({ name: names[0] }).greet('!') + Status.Ready;
  `;
  const rule = { js: source, jsLanguage: 'ts' };
  const emitted = compile(rule);
  assert.equal(rule.js, source);
  assert.doesNotMatch(emitted, /interface Person|type Names|private person|: string/);
  const page = vm.createContext({});
  vm.runInContext(emitted, page);
  assert.equal(page.result, 'Ada!ready');
  assert.equal(compile({ js: 'const x = 1; // original' }), 'const x = 1; // original');
  assert.equal(compile({ js: '', jsLanguage: 'ts' }), '');
  assert.throws(() => compile({ js: 'const x: = ;', jsLanguage: 'ts' }), /Line 1, column/);
  for (const source of ['import x from "package";', 'import type { X } from "package";',
    'export const x: number = 1;', 'export {};']) {
    assert.throws(() => compile({ js: source, jsLanguage: 'ts' }), /Imports and exports are not supported/);
  }
  // Transpilation intentionally does not provide semantic type checking.
  assert.match(compile({ js: 'const value: number = "text";', jsLanguage: 'ts' }), /const value = "text"/);
  const roundTrip = JSON.parse(JSON.stringify(rule));
  assert.equal(compile(roundTrip), emitted);

  const unloaded = vm.createContext({});
  vm.runInContext(src('compiler.js'), unloaded);
  assert.throws(() => vm.runInContext(`transpileRuleJavaScript({jsLanguage:'ts',js:'const x: number = 1;'})`, unloaded),
    /compiler is unavailable/);

  // Registered, live, and fallback injection must all use emitted JS.
  const handlers = {};
  const event = (name) => ({ addListener(fn) { handlers[name] = fn; } });
  let registrations = [];
  let executions = [];
  const api = {
    runtime: { id: 'test', onInstalled: event('installed'), onStartup: event('startup'), onMessage: event('message') },
    permissions: { onAdded: event('added'), onRemoved: event('removed') },
    storage: { local: { get: async () => ({ rules: [
      { ...rule, id: 'ts-early', urlPattern: 'https://example.com/*', runAt: 'document_start' },
      { id: 'broken', name: 'Broken', jsLanguage: 'ts', js: 'const x: = ;', urlPattern: 'https://example.com/*' },
    ] }) } },
    tabs: { onUpdated: event('updated') },
    userScripts: {
      configureWorld: async () => {}, getScripts: async () => [],
      register: async (scripts) => registrations.push(...scripts),
      execute: async (options) => executions.push(options),
    },
    scripting: { executeScript: async (options) => executions.push(options) },
  };
  context.chrome = api;
  const errors = [];
  context.console = { warn: (...args) => errors.push(args), error: (...args) => errors.push(args) };
  vm.runInContext(src('shared.js') + '\n' + src('background.js'), context);
  await vm.runInContext('syncReady', context);
  assert.equal(registrations.length, 1); // Invalid TS never reaches the browser.
  assert.equal(registrations[0].runAt, 'document_start');
  const registeredPage = vm.createContext({ location: { href: 'https://example.com/' } });
  vm.runInContext(registrations[0].js[0].code, registeredPage);
  assert.equal(registeredPage.result, 'Ada!ready');
  context.liveRule = { ...rule, id: 'live', urlPattern: 'https://example.com/*' };
  await vm.runInContext('injectRule(1, "https://example.com/", liveRule)', context);
  assert.equal(executions[0].js[0].code, emitted);
  api.userScripts = undefined;
  executions = [];
  await vm.runInContext('injectRule(1, "https://example.com/", liveRule)', context);
  assert.equal(executions[0].args[0], emitted);
  executions = [];
  context.liveRule = { ...context.liveRule, js: 'const x: = ;' };
  await vm.runInContext('injectRule(1, "https://example.com/", liveRule)', context);
  assert.equal(executions.length, 0);
  console.log('TypeScript checks passed: executable output, enums/classes/generics, source preservation, diagnostics, module rejection, round-trip storage, and every injection path.');
})();
