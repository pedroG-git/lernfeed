(function () {
  const $ = (id) => document.getElementById(id);
  const feedEl = $('feed');

  let posts = [];          // from feed.json
  let progress = {};       // post id -> { n, ok, box, due, last }
  let quizLog = {};        // "postId#qi" -> { right, wrong, last }
  let settings = { klasse: '' };
  let session = { shown: new Set(), sinceQuiz: 0, again: [] };
  const imgUrls = {};

  // ---------- saving ----------
  let saveTimer;
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      Store.set('progress', progress);
      Store.set('quizLog', quizLog);
    }, 400);
  }
  addEventListener('pagehide', () => { Store.set('progress', progress); Store.set('quizLog', quizLog); });

  // ---------- text ----------
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\W)_(.+?)_(?=\W|$)/g, '$1<i>$2</i>');
  // Paragraphs, "- " lists and "1. " lists.
  function md(text) {
    const out = [];
    let list = null;
    for (const raw of String(text || '').split('\n')) {
      const line = raw.trim();
      const ul = line.match(/^[-•]\s+(.*)/), ol = line.match(/^\d+[.)]\s+(.*)/);
      const kind = ul ? 'ul' : ol ? 'ol' : null;
      if (list && list !== kind) { out.push(`</${list}>`); list = null; }
      if (kind) {
        if (!list) { out.push(`<${kind}>`); list = kind; }
        out.push(`<li>${inline((ul || ol)[1])}</li>`);
      } else if (line) out.push(`<p>${inline(line)}</p>`);
    }
    if (list) out.push(`</${list}>`);
    return out.join('');
  }
  // A text field is either a string or { einfach, normal }.
  const pick = (f, lvl) => (f == null ? '' : typeof f === 'string' ? f : f[lvl] || f.einfach || f.normal || '');
  const hasBoth = (p) => [p.kurz, p.mehr].some((f) => f && typeof f === 'object' && f.einfach && f.normal);

  // ---------- images ----------
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', gif: 'image/gif' };
  async function imgUrl(path) {
    if (imgUrls[path]) return imgUrls[path];
    const rec = await Store.img(path);
    if (!rec) return null;
    const type = MIME[path.split('.').pop().toLowerCase()] || rec.blob.type;
    return (imgUrls[path] = URL.createObjectURL(new Blob([rec.blob], { type })));
  }

  // ---------- cards ----------
  function meta(p) {
    return [p.klasse, p.le, p.thema].filter(Boolean).map(esc).join(' · ');
  }

  function postCard(p) {
    const el = document.createElement('article');
    el.className = 'card';
    el.dataset.id = p.id;
    let lvl = Mix.level(progress[p.id]);
    let open = false;

    const draw = () => {
      const more = pick(p.mehr, lvl);
      el.innerHTML = `
        <div class="body">
          <div class="meta">${meta(p)}</div>
          <h2>${inline(p.titel)}</h2>
        </div>
        ${p.bild ? `<img alt="" hidden>${p.bildText ? `<div class="caption">${inline(p.bildText)}</div>` : ''}` : ''}
        <div class="body">
          ${md(pick(p.kurz, lvl))}
          ${open && more ? `<div class="more-text">${md(more)}</div>` : ''}
          ${p.quelle ? `<div class="source">Quelle: ${esc(p.quelle)}</div>` : ''}
        </div>
        <div class="row">
          ${more ? `<button class="text" data-a="more">${open ? 'Weniger' : 'Mehr lesen'}</button>` : ''}
          ${hasBoth(p) ? `<button class="text" data-a="lvl">${lvl === 'einfach' ? 'Normale Sprache' : 'Einfache Sprache'}</button>` : ''}
          <span class="spacer"></span>
          ${el.dataset.rated
            ? `<span class="done ${el.dataset.rated}">${el.dataset.rated === 'got' ? '✓ Verstanden' : 'Kommt bald wieder'}</span>`
            : `<button class="pill miss" data-a="miss">Nicht verstanden</button><button class="pill got" data-a="got">Verstanden</button>`}
        </div>`;
      if (p.bild) {
        const img = el.querySelector('img');
        imgUrl(p.bild).then((u) => { if (u) { img.src = u; img.hidden = false; } });
      }
    };

    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      if (a === 'more') { open = !open; draw(); }
      if (a === 'lvl') { lvl = lvl === 'einfach' ? 'normal' : 'einfach'; draw(); }
      if (a === 'got' || a === 'miss') {
        const got = a === 'got';
        progress[p.id] = Mix.rate(Mix.seen(progress[p.id], Date.now()), got, Date.now());
        el.dataset.rated = got ? 'got' : 'miss';
        el.dataset.seen = 1;
        saveSoon();
        draw();
        if (!got) showAgain(el, p);
      }
    });
    draw();
    return el;
  }

  function quizCard(item) {
    const { post: p, q, qi } = item;
    const el = document.createElement('article');
    el.className = 'card quiz';
    el.dataset.quiz = 1;
    el.innerHTML = `
      <div class="body">
        <div class="label">Kurze Frage</div>
        <div class="meta">${meta(p)}</div>
        <h2>${inline(q.frage)}</h2>
      </div>
      <div class="options">${q.optionen.map((o, i) => `<button class="option" data-i="${i}">${inline(o)}</button>`).join('')}</div>`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('.option');
      if (!b || el.dataset.answered) return;
      el.dataset.answered = 1;
      const right = +b.dataset.i === q.richtig;
      el.querySelectorAll('.option').forEach((o, i) => {
        if (i === q.richtig) o.classList.add('right');
        else if (o === b) o.classList.add('wrong');
      });
      const why = document.createElement('div');
      why.className = 'why';
      why.innerHTML = `<b>${right ? 'Richtig.' : 'Nicht ganz.'}</b> ${q.warum ? inline(q.warum) : ''}`;
      el.appendChild(why);
      const key = p.id + '#' + qi;
      const log = quizLog[key] || { right: 0, wrong: 0, last: 0 };
      log[right ? 'right' : 'wrong']++;
      log.last = Date.now();
      quizLog[key] = log;
      // Wrong answer: the post behind the question comes back soon.
      if (!right) {
        progress[p.id] = Mix.rate(progress[p.id], false, Date.now());
        showAgain(el, p);
      }
      saveSoon();
    });
    return el;
  }

  // "Nicht verstanden": the post shows up again about 5 cards later.
  function showAgain(fromEl, p) {
    let at = fromEl;
    for (let i = 0; i < 5 && at; i++) at = at.nextElementSibling;
    if (at) at.after(postCard(p));
    else session.again.push(p);
  }

  // ---------- seen tracking ----------
  // A post counts as seen after it was at least 60% on screen for 1.5 seconds.
  const timers = new Map();
  const seenObs = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const el = e.target;
      if (e.isIntersecting && e.intersectionRatio >= 0.6) {
        if (!timers.has(el)) timers.set(el, setTimeout(() => markSeen(el), 1500));
      } else {
        clearTimeout(timers.get(el));
        timers.delete(el);
      }
    }
  }, { threshold: [0, 0.6] });

  function markSeen(el) {
    timers.delete(el);
    seenObs.unobserve(el);
    if (el.dataset.seen) return;
    el.dataset.seen = 1;
    progress[el.dataset.id] = Mix.seen(progress[el.dataset.id], Date.now());
    saveSoon();
  }

  // ---------- feed ----------
  function loadMore() {
    const add = [];
    while (session.again.length) add.push({ type: 'post', post: session.again.shift() });
    let res = Mix.next(posts, progress, { now: Date.now(), count: 15, shown: session.shown, klasse: settings.klasse, quizLog, sinceQuiz: session.sinceQuiz });
    if (!res.items.length && session.shown.size) {
      // Everything was shown in this session: start a new round.
      session.shown = new Set();
      res = Mix.next(posts, progress, { now: Date.now(), count: 15, shown: session.shown, klasse: settings.klasse, quizLog, sinceQuiz: session.sinceQuiz });
    }
    session.sinceQuiz = res.sinceQuiz;
    add.push(...res.items);
    for (const it of add) {
      const el = it.type === 'quiz' ? quizCard(it) : postCard(it.post);
      feedEl.appendChild(el);
      if (it.type === 'post') {
        session.shown.add(it.post.id);
        seenObs.observe(el);
      }
    }
    $('more').hidden = !add.length;
  }

  function restart() {
    feedEl.innerHTML = '';
    session = { shown: new Set(), sinceQuiz: 0, again: [] };
    const has = posts.length > 0;
    $('empty').hidden = has;
    if (has) { loadMore(); scrollTo(0, 0); }
    else $('more').hidden = true;
  }

  new IntersectionObserver((e) => { if (e[0].isIntersecting && posts.length) loadMore(); }, { rootMargin: '800px' }).observe($('more'));

  function useFeed(feed) {
    posts = (feed && feed.posts) || [];
    const sel = $('klasse');
    const classes = [...new Set(posts.map((p) => p.klasse))].sort();
    sel.innerHTML = '<option value="">Alle Klassen</option>' + classes.map((k) => `<option>${esc(k)}</option>`).join('');
    if (!classes.includes(settings.klasse)) settings.klasse = '';
    sel.value = settings.klasse;
  }

  $('klasse').addEventListener('change', (e) => {
    settings.klasse = e.target.value;
    Store.set('settings', settings);
    restart();
  });

  // ---------- sync ----------
  let syncing = false;
  async function doSync(manual) {
    if (syncing) return;
    const token = await Store.get('token');
    if (!token) {
      if (manual) $('syncStep').textContent = 'Bitte zuerst den Token speichern.';
      return;
    }
    syncing = true;
    $('syncBtn').disabled = true;
    const step = (t) => {
      $('syncStep').textContent = t;
      if (manual || !posts.length) { $('status').textContent = t; $('status').hidden = false; }
    };
    try {
      const r = await Sync.run(token, step);
      if (r.changed) {
        // While reading, new posts just join the next cards; only an empty feed is rebuilt.
        const wasEmpty = !posts.length;
        useFeed(await Store.get('feed'));
        if (wasEmpty) restart();
        step(`Fertig: ${r.posts} Beiträge.`);
      } else step('Alles aktuell.');
      setTimeout(() => ($('status').hidden = true), 2500);
    } catch (e) {
      step(navigator.onLine === false ? 'Kein Internet. Später nochmal versuchen.' : `Fehler: ${e.message}`);
      if (!manual) setTimeout(() => ($('status').hidden = true), 4000);
    } finally {
      syncing = false;
      $('syncBtn').disabled = false;
      showSettingsInfo();
    }
  }

  // ---------- settings ----------
  async function showSettingsInfo() {
    const s = await Store.get('sync');
    $('syncInfo').textContent = s
      ? `${posts.length} Beiträge · zuletzt geladen ${new Date(s.at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`
      : 'Noch nie geladen.';
    const vals = Object.values(progress);
    const ok = vals.filter((p) => p.box >= 2).length;
    $('progressInfo').textContent = `${vals.length} von ${posts.length} gesehen · ${ok} sitzen schon gut`;
    $('token').placeholder = (await Store.get('token')) ? 'Token gespeichert ✓' : 'github_pat_…';
  }

  const openSettings = () => { $('settings').hidden = false; showSettingsInfo(); };
  $('openSettings').addEventListener('click', openSettings);
  $('emptySettings').addEventListener('click', openSettings);
  $('closeSettings').addEventListener('click', () => ($('settings').hidden = true));
  $('syncBtn').addEventListener('click', () => doSync(true));
  $('saveToken').addEventListener('click', async () => {
    const t = $('token').value.trim();
    if (!t) return;
    await Store.set('token', t);
    $('token').value = '';
    showSettingsInfo();
    doSync(true);
  });
  $('reset').addEventListener('click', () => ($('resetConfirm').hidden = false));
  $('resetNo').addEventListener('click', () => ($('resetConfirm').hidden = true));
  $('resetYes').addEventListener('click', () => {
    progress = {};
    quizLog = {};
    saveSoon();
    $('resetConfirm').hidden = true;
    showSettingsInfo();
    restart();
  });

  // ---------- app update (same flow as Games for you) ----------
  const current = window.APP_VERSION || '0.0.0';
  $('version').textContent = `Version ${current}`;
  const SITE = 'https://pedrog-git.github.io/lernfeed/';
  const newer = (a, b) => {
    const pa = String(a).replace(/^v/, '').split('.').map(Number), pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    return false;
  };
  async function checkUpdate(manual) {
    if (manual) $('check').textContent = 'Suche…';
    try {
      const r = await fetch(`${SITE}version.json?t=${Date.now()}`, { cache: 'no-store' });
      const { version } = await r.json();
      if (newer(version, current)) {
        $('updateText').textContent = `App-Version ${version} ist da`;
        $('update').hidden = false;
        if (manual) $('check').textContent = 'Nach Updates suchen';
      } else if (manual) $('check').textContent = 'Neueste Version ✓';
    } catch {
      if (manual) $('check').textContent = 'Konnte nicht prüfen';
    }
  }
  $('updateBtn').addEventListener('click', () => (location.href = SITE));
  $('check').addEventListener('click', () => checkUpdate(true));

  // ---------- start ----------
  (async () => {
    progress = (await Store.get('progress')) || {};
    quizLog = (await Store.get('quizLog')) || {};
    settings = { ...settings, ...((await Store.get('settings')) || {}) };
    useFeed(await Store.get('feed'));
    restart();
    checkUpdate(false);
    // New content at most every 3 hours, quietly in the background.
    const s = await Store.get('sync');
    if (!s || Date.now() - s.at > 3 * 3600 * 1000) doSync(false);
  })();
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    const s = await Store.get('sync');
    if (s && Date.now() - s.at > 3 * 3600 * 1000) doSync(false);
  });
})();
