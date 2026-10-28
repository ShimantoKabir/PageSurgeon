class EditorSplitter {
  constructor(container, handle, storage, onResize = () => {}) {
    this.container = container;
    this.handle = handle;
    this.storage = storage;
    this.onResize = onResize;
    this.ratios = { horizontal: 50, vertical: 50 };
    this.media = matchMedia("(max-width: 1000px)");
    this.drag = null;
    this.changed = false;
    handle.addEventListener("pointerdown", (event) => this.start(event));
    handle.addEventListener("pointermove", (event) => this.move(event));
    handle.addEventListener("pointerup", (event) => this.finish(event));
    handle.addEventListener("pointercancel", (event) => this.finish(event, true));
    handle.addEventListener("lostpointercapture", (event) => this.finish(event));
    handle.addEventListener("keydown", (event) => this.keydown(event));
    handle.addEventListener("dblclick", () => this.setRatio(50, true));
    this.media.addEventListener("change", () => {
      if (this.drag) this.finish({ pointerId: this.drag.id }, true);
      this.render();
    });
    this.render();
    storage.get("editorSplit").then(({ editorSplit }) => {
      // Do not let a delayed storage read undo a drag that has already started.
      if (this.changed) return;
      for (const axis of ["horizontal", "vertical"]) {
        if (Number.isFinite(editorSplit?.[axis])) {
          this.ratios[axis] = this.clamp(editorSplit[axis]);
        }
      }
      this.render();
    }).catch(() => {});
  }

  get axis() { return this.media.matches ? "vertical" : "horizontal"; }
  clamp(ratio) { return Math.max(20, Math.min(80, ratio)); }

  render() {
    const ratio = this.ratios[this.axis];
    this.container.style.setProperty("--js-grow", ratio);
    this.container.style.setProperty("--css-grow", 100 - ratio);
    this.handle.setAttribute("aria-orientation", this.media.matches ? "horizontal" : "vertical");
    this.handle.setAttribute("aria-valuenow", Math.round(ratio));
    this.handle.setAttribute("aria-valuetext", `JavaScript ${Math.round(ratio)}%, CSS ${Math.round(100 - ratio)}%`);
    this.onResize();
  }

  setRatio(ratio, save = false) {
    this.changed = true;
    this.ratios[this.axis] = this.clamp(ratio);
    this.render();
    if (save) this.persist();
  }

  persist() {
    this.storage.set({ editorSplit: { ...this.ratios } }).catch(() => {});
  }

  start(event) {
    if (event.button !== 0 || event.isPrimary === false || this.drag) return;
    event.preventDefault();
    const rect = this.handle.getBoundingClientRect();
    this.changed = true;
    this.drag = {
      id: event.pointerId,
      axis: this.axis,
      initial: this.ratios[this.axis],
      offset: this.media.matches ? event.clientY - rect.top : event.clientX - rect.left,
    };
    this.handle.focus({ preventScroll: true });
    this.handle.setPointerCapture(event.pointerId);
    this.container.classList.add("is-resizing");
  }

  move(event) {
    if (!this.drag || event.pointerId !== this.drag.id) return;
    const rect = this.container.getBoundingClientRect();
    const handle = this.handle.getBoundingClientRect();
    const stacked = this.drag.axis === "vertical";
    const available = stacked ? rect.height - handle.height : rect.width - handle.width;
    if (available <= 0) return;
    const offset = (stacked ? event.clientY - rect.top : event.clientX - rect.left) - this.drag.offset;
    this.setRatio(offset / available * 100);
  }

  finish(event, cancel = false) {
    if (!this.drag || event.pointerId !== this.drag.id) return;
    const drag = this.drag;
    this.drag = null;
    this.container.classList.remove("is-resizing");
    if (this.handle.hasPointerCapture(drag.id)) this.handle.releasePointerCapture(drag.id);
    if (cancel) {
      this.ratios[drag.axis] = drag.initial;
      this.render();
    } else {
      this.persist();
    }
  }

  keydown(event) {
    let ratio = this.ratios[this.axis];
    const step = event.shiftKey ? 10 : 2;
    const previous = this.media.matches ? "ArrowUp" : "ArrowLeft";
    const next = this.media.matches ? "ArrowDown" : "ArrowRight";
    if (event.key === previous) ratio -= step;
    else if (event.key === next) ratio += step;
    else if (event.key === "Home") ratio = 20;
    else if (event.key === "End") ratio = 80;
    else if (event.key === "Enter") ratio = 50;
    else return;
    event.preventDefault();
    this.setRatio(ratio, true);
  }
}
