// IndexedDB: everything the app needs offline.
// "kv": feed, progress, quiz log, settings, sync info.  "img": downloaded images { path, sha, blob }.
(function () {
  let dbp;
  function db() {
    return (dbp ||= new Promise((ok, fail) => {
      const r = indexedDB.open('lernfeed', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('kv');
        r.result.createObjectStore('img', { keyPath: 'path' });
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error);
    }));
  }
  async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((ok, fail) => {
      const t = d.transaction(store, mode);
      const res = fn(t.objectStore(store));
      t.oncomplete = () => ok(res && 'result' in res ? res.result : undefined);
      t.onerror = () => fail(t.error);
    });
  }

  window.Store = {
    get: (k) => tx('kv', 'readonly', (s) => s.get(k)),
    set: (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k)),
    del: (k) => tx('kv', 'readwrite', (s) => s.delete(k)),
    img: (path) => tx('img', 'readonly', (s) => s.get(path)),
    putImg: (rec) => tx('img', 'readwrite', (s) => s.put(rec)),
    delImg: (path) => tx('img', 'readwrite', (s) => s.delete(path)),
    imgKeys: () => tx('img', 'readonly', (s) => s.getAllKeys()),
    // sha per stored image, without loading the blobs
    imgShas: async () => {
      const d = await db();
      return new Promise((ok, fail) => {
        const out = {};
        const r = d.transaction('img').objectStore('img').openCursor();
        r.onsuccess = () => {
          const c = r.result;
          if (!c) return ok(out);
          out[c.value.path] = c.value.sha;
          c.continue();
        };
        r.onerror = () => fail(r.error);
      });
    },
  };
})();
