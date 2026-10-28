class ScriptCompletionClient {
  constructor(url) {
    this.url = url;
    this.nextId = 0;
    this.pending = null;
    this.worker = null;
  }

  suggest(source, position, language) {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.resolve(null);
      this.pending = null;
    }
    if (!this.worker) {
      this.worker = new Worker(this.url);
      this.worker.onmessage = ({ data }) => {
        if (!this.pending || data.id !== this.pending.id) return;
        const pending = this.pending;
        this.pending = null;
        clearTimeout(pending.timer);
        if (data.error) pending.reject(new Error(data.error));
        else pending.resolve(data.result);
      };
      this.worker.onerror = () => {
        if (this.pending) {
          clearTimeout(this.pending.timer);
          this.pending.reject(new Error("Could not start autocomplete"));
          this.pending = null;
        }
        this.worker.terminate();
        this.worker = null;
      };
    }
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        if (this.pending?.id !== id) return;
        this.pending = null;
        reject(new Error("Autocomplete timed out"));
      }, 15000);
      this.pending = { id, resolve, reject, timer };
      this.worker.postMessage({ id, source, position, language });
    });
  }
}
