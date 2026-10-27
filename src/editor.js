/* Shared textarea editing behavior. No page code is evaluated here. */
class CodeEditor {
  constructor(textarea, onChange, status, language = "js") {
    this.textarea = textarea;
    this.onChange = onChange;
    this.status = status;
    this.language = language;
    this.reset();
    textarea.addEventListener("beforeinput", (event) => {
      if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
        event.preventDefault();
        this.restore(event.inputType === "historyUndo" ? -1 : 1);
      } else {
        this.history[this.index] = this.snapshot();
      }
    });
    textarea.addEventListener("input", () => {
      this.record();
      this.changed();
    });
    textarea.addEventListener("keydown", (event) => this.keydown(event));
    for (const event of ["click", "keyup", "select", "focus"]) {
      textarea.addEventListener(event, () => this.updateStatus());
    }
  }

  snapshot() {
    const { value, selectionStart: start, selectionEnd: end } = this.textarea;
    return { value, start, end };
  }

  reset() {
    this.history = [this.snapshot()];
    this.index = 0;
    this.updateStatus();
  }

  record() {
    const next = this.snapshot();
    if (next.value === this.history[this.index].value) return;
    this.history.splice(this.index + 1);
    this.history.push(next);
    if (this.history.length > 200) this.history.shift();
    this.index = this.history.length - 1;
  }

  changed() {
    this.onChange();
    this.updateStatus();
  }

  replace(text, start = this.textarea.selectionStart, end = this.textarea.selectionEnd,
    selectionStart = start + text.length, selectionEnd = selectionStart) {
    this.history[this.index] = this.snapshot();
    const { scrollTop, scrollLeft } = this.textarea;
    this.textarea.setRangeText(text, start, end, "end");
    this.textarea.setSelectionRange(selectionStart, selectionEnd);
    this.textarea.scrollTop = scrollTop;
    this.textarea.scrollLeft = scrollLeft;
    this.record();
    this.changed();
  }

  restore(delta) {
    const next = this.index + delta;
    if (next < 0 || next >= this.history.length) return;
    this.index = next;
    const state = this.history[next];
    this.textarea.value = state.value;
    this.textarea.setSelectionRange(state.start, state.end);
    this.changed();
  }

  updateStatus() {
    const { value, selectionStart: start, selectionEnd: end } = this.textarea;
    const lines = value.slice(0, start).split("\n");
    if (this.status) this.status.textContent =
      `Ln ${lines.length}, Col ${lines.at(-1).length + 1}` +
      (end > start ? ` · ${end - start} selected` : "") + " · 4 spaces";
  }

  indent(outdent) {
    const { value, selectionStart: start, selectionEnd: end } = this.textarea;
    if (start === end && !outdent) {
      const column = start - value.slice(0, start).lastIndexOf("\n") - 1;
      this.replace(" ".repeat(4 - column % 4));
      return;
    }
    const lineStart = value.slice(0, start).lastIndexOf("\n") + 1;
    const last = end > start && value[end - 1] === "\n" ? end - 1 : end;
    const lineEnd = value.indexOf("\n", last);
    const stop = lineEnd === -1 ? value.length : lineEnd;
    const lines = value.slice(lineStart, stop).split("\n");
    let delta = 0;
    let firstDelta = 0;
    const text = lines.map((line, index) => {
      const removed = outdent ? (line.match(/^(?: {1,4}|\t)/)?.[0].length || 0) : 0;
      const change = outdent ? -removed : 4;
      if (index === 0) firstDelta = change;
      delta += change;
      return outdent ? line.slice(removed) : "    " + line;
    }).join("\n");
    this.replace(text, lineStart, stop,
      Math.max(lineStart, start + firstDelta), Math.max(lineStart, end + delta));
  }

  toggleComment() {
    const { value, selectionStart: start, selectionEnd: end } = this.textarea;
    if (start !== end) {
      const selected = value.slice(start, end);
      let replacement;
      if (selected.startsWith("/*") && selected.endsWith("*/") &&
        selected.indexOf("*/", 2) === selected.length - 2) {
        const openLength = selected.startsWith("/* ") ? 3 : 2;
        const closeLength = selected.endsWith(" */") && selected.length >= openLength + 3 ? 3 : 2;
        replacement = selected.slice(openLength, -closeLength);
      } else {
        if (selected.includes("/*") || selected.includes("*/")) {
          if (this.status) this.status.textContent = "Select code without existing block comments to wrap it.";
          return;
        }
        replacement = `/* ${selected} */`;
      }
      // Keep the entire result selected so a second shortcut reverses the operation.
      this.replace(replacement, start, end, start, start + replacement.length);
      return;
    }
    const first = value.slice(0, start).lastIndexOf("\n") + 1;
    const last = end > start && value[end - 1] === "\n" ? end - 1 : end;
    const nextLine = value.indexOf("\n", last);
    const stop = nextLine < 0 ? value.length : nextLine;
    const text = value.slice(first, stop);
    const edits = [];
    if (this.language === "css") {
      const leading = text.match(/^\s*/)[0].length;
      const trailing = text.trimEnd().length;
      if (text.trim().startsWith("/*") && text.trim().endsWith("*/") &&
        text.indexOf("*/", leading + 2) === trailing - 2) {
        const openLength = text[leading + 2] === " " ? 3 : 2;
        const closeLength = text[trailing - 3] === " " && trailing - 3 >= leading + openLength ? 3 : 2;
        edits.push({ at: first + leading, remove: openLength, insert: "" });
        edits.push({ at: first + trailing - closeLength, remove: closeLength, insert: "" });
      } else {
        // CSS comments cannot nest. Avoid turning existing comments into broken code.
        if (text.includes("/*") || text.includes("*/")) {
          if (this.status) this.status.textContent = "Select code without existing block comments to wrap it.";
          return;
        }
        edits.push({ at: first + leading, remove: 0, insert: "/* " });
        edits.push({ at: first + Math.max(leading, trailing), remove: 0, insert: " */" });
      }
    } else {
      const lines = text.split("\n");
      const uncomment = lines.some((line) => line.trim()) &&
        lines.filter((line) => line.trim()).every((line) => /^\s*\/\//.test(line));
      let offset = first;
      for (const line of lines) {
        const indent = line.match(/^[\t ]*/)[0].length;
        if (line.trim() || lines.length === 1) {
          edits.push({ at: offset + indent,
            remove: uncomment ? (line[indent + 2] === " " ? 3 : 2) : 0,
            insert: uncomment ? "" : "// " });
        }
        offset += line.length + 1;
      }
    }
    const mapPosition = (position) => {
      let delta = 0;
      for (const edit of edits) {
        if (position < edit.at) break;
        delta += edit.insert.length - Math.min(edit.remove, position - edit.at);
      }
      return position + delta;
    };
    let replacement = text;
    for (const edit of [...edits].reverse()) {
      const at = edit.at - first;
      replacement = replacement.slice(0, at) + edit.insert + replacement.slice(at + edit.remove);
    }
    this.replace(replacement, first, stop, mapPosition(start), mapPosition(end));
  }

  keydown(event) {
    if (event.defaultPrevented || event.isComposing) return;
    const key = event.key;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && !event.altKey && (key === "/" || event.code === "Slash")) {
      event.preventDefault();
      this.toggleComment();
      return;
    }
    if (modifier && key.toLowerCase() === "s") {
      event.preventDefault();
      document.getElementById("save-btn").click();
      return;
    }
    if (modifier && (key.toLowerCase() === "z" || key.toLowerCase() === "y")) {
      event.preventDefault();
      this.restore(key.toLowerCase() === "y" || event.shiftKey ? 1 : -1);
      return;
    }
    // Escape then Tab lets keyboard users leave the editor.
    if (key === "Escape") {
      this.releaseTab = true;
      return;
    }
    if (key === "Tab" && this.releaseTab) {
      this.releaseTab = false;
      return;
    }
    this.releaseTab = false;
    if (modifier || event.altKey) return;
    const { value, selectionStart: start, selectionEnd: end } = this.textarea;
    const pairs = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`" };
    if (key === "Tab") {
      event.preventDefault();
      this.indent(event.shiftKey);
    } else if (key === "Enter") {
      event.preventDefault();
      const line = value.slice(value.slice(0, start).lastIndexOf("\n") + 1, start);
      const indent = line.match(/^\s*/)[0];
      const opens = /[{[(]\s*$/.test(line);
      const inner = indent + (opens ? "    " : "");
      const paired = opens && pairs[line.trimEnd().at(-1)] === value[end];
      this.replace("\n" + inner + (paired ? "\n" + indent : ""), start, end,
        start + 1 + inner.length);
    } else if (key === "Backspace" && start === end && start > 0 &&
      pairs[value[start - 1]] === value[start]) {
      event.preventDefault();
      this.replace("", start - 1, start + 1);
    } else if (start === end && key === value[start] && ")]}'\"`".includes(key)) {
      event.preventDefault();
      this.textarea.setSelectionRange(start + 1, start + 1);
      this.updateStatus();
    } else if (pairs[key]) {
      const quote = "'\"`".includes(key);
      // Leave apostrophes and escaped quotes to ordinary text input.
      if (quote && (value[start - 1] === "\\" || /[\w$]/.test(value[start - 1] || "")) && start === end) return;
      if (start === end && value[end] && !/[\s)\]}>,;:]/.test(value[end])) return;
      event.preventDefault();
      this.replace(key + value.slice(start, end) + pairs[key], start, end,
        start + 1, end + 1);
    }
  }
}
