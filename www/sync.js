// Downloads the content (feed.json + images) from the private GitHub repo with a read-only token.
// Only files whose git sha changed are downloaded again, so a sync after a small update is quick.
(function () {
  const REPO = 'pedroG-git/lernfeed-inhalt';
  const API = `https://api.github.com/repos/${REPO}`;

  async function gh(url, token, raw) {
    const r = await fetch(url, {
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      },
    });
    if (r.status === 401) throw new Error('Token ungültig oder abgelaufen');
    if (r.status === 404) throw new Error('Kein Zugriff auf das Inhalte-Repo (Token-Rechte prüfen)');
    if (!r.ok) throw new Error(`GitHub-Fehler ${r.status}`);
    return r;
  }

  // onStep(text) shows progress. Returns { changed, posts }.
  async function run(token, onStep = () => {}) {
    onStep('Suche nach neuen Inhalten…');
    const tree = await (await gh(`${API}/git/trees/main?recursive=1`, token)).json();
    const files = {};
    for (const f of tree.tree) if (f.type === 'blob') files[f.path] = f.sha;
    if (!files['feed.json']) throw new Error('feed.json fehlt im Inhalte-Repo');

    const info = (await Store.get('sync')) || {};
    let feed = await Store.get('feed');
    let changed = false;
    if (info.feedSha !== files['feed.json'] || !feed) {
      onStep('Lade Beiträge…');
      feed = await (await gh(`${API}/git/blobs/${files['feed.json']}`, token, true)).json();
      changed = true;
    }

    // Images used by the feed: download new or changed ones, delete unused ones.
    const want = new Set(feed.posts.filter((p) => p.bild).map((p) => p.bild));
    const have = await Store.imgShas();
    const todo = [...want].filter((p) => files[p] && have[p] !== files[p]);
    const total = todo.length;
    let done = 0;
    const worker = async () => {
      while (todo.length) {
        const path = todo.shift();
        const blob = await (await gh(`${API}/git/blobs/${files[path]}`, token, true)).blob();
        await Store.putImg({ path, sha: files[path], blob });
        onStep(`Lade Bilder… ${++done}/${total}`);
      }
    };
    if (todo.length) {
      changed = true;
      onStep(`Lade Bilder… 0/${total}`);
      await Promise.all([worker(), worker(), worker(), worker()]);
    }
    for (const p of Object.keys(have)) if (!want.has(p)) await Store.delImg(p);

    // Save the feed only after all images are there, so the app never shows half an update.
    if (changed) await Store.set('feed', feed);
    await Store.set('sync', { feedSha: files['feed.json'], at: Date.now() });
    return { changed, posts: feed.posts.length };
  }

  window.Sync = { run, REPO };
})();
