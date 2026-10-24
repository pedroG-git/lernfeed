(function () {
  const $ = (id) => document.getElementById(id);
  const feedEl = $('feed');

  let posts = [];          // from feed.json
  let byId = {};
  let progress = {};       // post id -> { n, ok, box, due, last, learn, lvl }
  let quizLog = {};        // "postId#qi" -> { right, wrong, last }
  let settings = { klasse: '' };
  let stats = { day: '', n: 0 };
  let session = { shown: new Set(), sinceQuiz: 0, again: [] };
  const imgUrls = {};

  // ---------- saving ----------
  let saveTimer;
  const saveNow = () => { Store.set('progress', progress); Store.set('quizLog', quizLog); Store.set('stats', stats); };
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }
  addEventListener('pagehide', saveNow);

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
  const pick = (f, lvl) => (f == null ? '' : typeof f === 'string' ? f : f[lvl] || f.normal || f.einfach || '');
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
  function figure(p) {
    if (!p.bild) return '';
    return `<figure><img alt="" hidden data-src="${esc(p.bild)}">${p.bildtext ? `<figcaption>${inline(p.bildtext)}</figcaption>` : ''}</figure>`;
  }
  function loadImgs(root) {
    root.querySelectorAll('img[data-src]').forEach((img) =>
      imgUrl(img.dataset.src).then((u) => { if (u) { img.src = u; img.hidden = false; } }));
  }

  // ---------- rating ----------
  const meta = (p) => [p.klasse, p.le, p.thema].filter(Boolean).map(esc).join(' · ');
  const state = (id) => {
    const g = progress[id];
    return !g ? 'new' : g.learn ? 'learn' : g.ok > 0 ? 'got' : 'seen';
  };

  // "Kann ich" pushes the post away, "Noch lernen" brings it back soon and puts it on the Lernliste.
  function rate(id, got) {
    const g = Mix.rate(Mix.seen(progress[id], Date.now()), got, Date.now());
    g.learn = !got;
    if (!got) g.marked = Date.now();
    progress[id] = g;
    countToday();
    saveSoon();
    refreshCards(id, got);
    updateBadge();
  }

  function rateButtons(id, justRated) {
    if (justRated) {
      return `<span class="done ${justRated}">${justRated === 'got' ? '✓ Kann ich' : '★ Auf der Lernliste'}</span>`;
    }
    return `<button class="pill miss" data-a="miss">Noch lernen</button><button class="pill got" data-a="got">Kann ich</button>`;
  }

  // Feed cards and the open post page redraw after a rating anywhere.
  function refreshCards(id, got) {
    document.querySelectorAll(`[data-id="${CSS.escape(id)}"]`).forEach((el) => el.refresh && el.refresh(got));
  }

  // ---------- feed cards ----------
  function postCard(p) {
    const el = document.createElement('article');
    el.className = 'card post';
    el.dataset.id = p.id;
    let rated = '';

    const draw = () => {
      const lvl = Mix.level(progress[p.id]);
      const nq = (p.fragen || []).length;
      el.innerHTML = `
        <div class="body">
          <div class="meta">${meta(p)}</div>
          <h2>${inline(p.titel)}</h2>
        </div>
        ${figure(p)}
        <div class="body clamp">${md(pick(p.kurz, lvl))}</div>
        <div class="row">
          <span class="hint">Lesen${nq ? ` · ${nq} ${nq === 1 ? 'Frage' : 'Fragen'}` : ''} ›</span>
          <span class="spacer"></span>
          ${rateButtons(p.id, rated)}
        </div>`;
      loadImgs(el);
    };
    el.refresh = (got) => {
      if (got !== undefined) rated = got ? 'got' : 'miss';
      draw();
    };

    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'got' || a === 'miss') {
        rated = a;
        el.dataset.seen = 1;
        rate(p.id, a === 'got');
        if (a === 'miss') showAgain(el, p);
        return;
      }
      openView({ v: 'post', id: p.id });
    });
    draw();
    return el;
  }

  // One question; used in the feed and on the post page.
  function question(p, q, qi) {
    const el = document.createElement('div');
    el.className = 'question';
    el.innerHTML = `
      <h3>${inline(q.frage)}</h3>
      <div class="options">${q.optionen.map((o, i) => `<button class="option" data-i="${i}">${inline(o)}</button>`).join('')}</div>`;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
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
      saveSoon();
      // Wrong answer: the post goes on the Lernliste and comes back soon.
      if (!right) {
        rate(p.id, false);
        if (el.closest('#feed')) showAgain(el.closest('.card'), p);
      }
    });
    return el;
  }

  function quizCard(item) {
    const { post: p, q, qi } = item;
    const el = document.createElement('article');
    el.className = 'card quiz';
    el.innerHTML = `
      <div class="body">
        <div class="label">Kurze Frage</div>
        <div class="meta">${meta(p)}</div>
      </div>`;
    el.querySelector('.body').appendChild(question(p, q, qi));
    const open = document.createElement('button');
    open.className = 'text';
    open.textContent = `Zum Beitrag: ${p.titel} ›`;
    open.addEventListener('click', () => openView({ v: 'post', id: p.id }));
    const row = document.createElement('div');
    row.className = 'row';
    row.appendChild(open);
    el.appendChild(row);
    return el;
  }

  // "Noch lernen": the post shows up again about 5 cards later.
  function showAgain(fromEl, p) {
    let at = fromEl;
    for (let i = 0; i < 5 && at; i++) at = at.nextElementSibling;
    if (at) at.after(postCard(p));
    else session.again.push(p);
  }

  // ---------- post page (opens like a Reddit thread) ----------
  // Order inside a lesson, used for "Weiter" and the related list.
  function lessonPosts(p) {
    return posts.filter((x) => x.klasse === p.klasse && x.le === p.le);
  }

  function postPage(p) {
    const page = $('page');
    page.dataset.id = p.id;
    let rated = '';
    const draw = () => {
      const lvl = Mix.level(progress[p.id]);
      const more = pick(p.mehr, lvl);
      const lesson = lessonPosts(p);
      const i = lesson.indexOf(p);
      const next = lesson[(i + 1) % lesson.length];
      const related = [];
      for (let k = 2; k < lesson.length && related.length < 6; k++) related.push(lesson[(i + k) % lesson.length]);
      if (next && next !== p) related.unshift(next);
      const s = state(p.id);
      page.innerHTML = `
        <div class="page-head">
          <button class="text back" data-a="back">‹ Zurück</button>
          <span class="meta">${meta(p)}</span>
        </div>
        <article class="thread">
          <h1>${inline(p.titel)}</h1>
          ${s === 'learn' ? '<div class="tag learn">★ Auf deiner Lernliste</div>' : s === 'got' ? '<div class="tag got">✓ Kann ich</div>' : ''}
          ${figure(p)}
          <div class="text-body">${md(pick(p.kurz, lvl))}${more ? md(more) : ''}</div>
          ${p.quelle ? `<div class="source">Quelle: ${esc(p.quelle)}</div>` : ''}
          <div class="row">
            ${hasBoth(p) ? `<button class="text" data-a="lvl">${lvl === 'einfach' ? 'Normale Sprache' : 'Einfache Sprache'}</button>` : ''}
            <span class="spacer"></span>
            ${rateButtons(p.id, rated)}
          </div>
        </article>
        ${(p.fragen || []).length ? '<section class="thread-quiz"><h2>Teste dich</h2><div class="qs"></div></section>' : ''}
        ${related.length ? `<section class="related"><h2>Mehr aus ${esc(p.le || p.klasse)}</h2>
          ${related.map((x) => `<button class="rel" data-open="${esc(x.id)}">
            <span class="dot ${state(x.id)}"></span><span>${inline(x.titel)}<small>${esc(x.thema || '')}</small></span></button>`).join('')}
        </section>` : ''}
        ${next && next !== p ? `<button class="primary next" data-open="${esc(next.id)}">Nächster Beitrag: ${inline(next.titel)} ›</button>` : ''}`;
      const qs = page.querySelector('.qs');
      if (qs) p.fragen.forEach((q, qi) => qs.appendChild(question(p, q, qi)));
      loadImgs(page);
    };
    page.refresh = (got) => {
      if (got !== undefined) rated = got ? 'got' : 'miss';
      draw();
    };
    page.onclick = (e) => {
      const t = e.target;
      const a = t.closest('[data-a]')?.dataset.a;
      const to = t.closest('[data-open]')?.dataset.open;
      if (to) return openView({ v: 'post', id: to });
      if (t.tagName === 'IMG') return openView({ v: 'img', src: t.dataset.src, cap: p.bildtext || '' });
      if (a === 'back') return history.back();
      if (a === 'lvl') {
        const g = { ...Mix.seen(progress[p.id], Date.now()) };
        g.lvl = Mix.level(progress[p.id]) === 'einfach' ? 'normal' : 'einfach';
        progress[p.id] = g;
        saveSoon();
        draw();
      }
      if (a === 'got' || a === 'miss') {
        rated = a;
        rate(p.id, a === 'got');
      }
    };
    // Opening a post counts as seen.
    if (!progress[p.id]) { progress[p.id] = Mix.seen(progress[p.id], Date.now()); countToday(); saveSoon(); refreshCards(p.id); }
    draw();
    page.scrollTop = 0;
  }

  // ---------- Lernliste ----------
  const learnList = () => posts.filter((p) => progress[p.id]?.learn).sort((a, b) => (progress[b.id].marked || 0) - (progress[a.id].marked || 0));
  function updateBadge() {
    const n = learnList().length;
    $('badge').textContent = n;
    $('badge').hidden = !n;
  }
  function listPage() {
    const page = $('list');
    const items = learnList();
    page.innerHTML = `
      <div class="page-head">
        <button class="text back" data-a="back">‹ Zurück</button>
        <span class="meta">Lernliste</span>
      </div>
      <h1>Lernliste</h1>
      <p class="muted small">Alles, was du mit „Noch lernen“ markiert oder in einer Frage falsch hattest. Tippe später „Kann ich“, dann verschwindet es hier.</p>
      ${items.length ? items.map((x) => `<button class="rel" data-open="${esc(x.id)}">
          <span class="dot learn"></span><span>${inline(x.titel)}<small>${meta(x)}</small></span></button>`).join('')
        : '<p class="empty-list">Noch nichts auf der Liste.</p>'}`;
    page.onclick = (e) => {
      const to = e.target.closest('[data-open]')?.dataset.open;
      if (to) return openView({ v: 'post', id: to });
      if (e.target.closest('[data-a="back"]')) history.back();
    };
    page.scrollTop = 0;
  }

  // ---------- views + Android back button ----------
  // Every page (post, Lernliste, image, settings) is a history entry, so the phone's back button closes it.
  const overlays = ['page', 'list', 'viewer', 'settings'];
  function render(st) {
    const v = st && st.v;
    for (const id of overlays) $(id).hidden = true;
    document.body.classList.toggle('locked', !!v);
    if (v === 'post' && byId[st.id]) { postPage(byId[st.id]); $('page').hidden = false; }
    else if (v === 'list') { listPage(); $('list').hidden = false; }
    else if (v === 'img') {
      $('viewer').innerHTML = `<img alt=""><div class="cap">${inline(st.cap || '')}</div><div class="hint-zoom">Tippen zum Vergrößern</div>`;
      imgUrl(st.src).then((u) => { if (u) $('viewer').querySelector('img').src = u; });
      $('viewer').hidden = false;
    } else if (v === 'settings') { $('settings').hidden = false; showSettingsInfo(); }
  }
  function openView(st) {
    history.pushState(st, '');
    render(st);
  }
  addEventListener('popstate', (e) => render(e.state));
  $('viewer').addEventListener('click', (e) => {
    if (e.target.tagName === 'IMG') e.target.classList.toggle('zoom');
    else history.back();
  });

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
    countToday();
    saveSoon();
  }

  // Posts read today, shown small in the header.
  function countToday() {
    const d = new Date().toLocaleDateString('de-DE');
    if (stats.day !== d) stats = { day: d, n: 0 };
    stats.n++;
    showToday();
  }
  function showToday() {
    const d = new Date().toLocaleDateString('de-DE');
    $('today').textContent = stats.day === d && stats.n ? `${stats.n} heute` : '';
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
    byId = Object.fromEntries(posts.map((p) => [p.id, p]));
    const sel = $('klasse');
    const classes = [...new Set(posts.map((p) => p.klasse))].sort();
    sel.innerHTML = '<option value="">Alle Klassen</option>' + classes.map((k) => `<option>${esc(k)}</option>`).join('');
    if (!classes.includes(settings.klasse)) settings.klasse = '';
    sel.value = settings.klasse;
    updateBadge();
  }

  $('klasse').addEventListener('change', (e) => {
    settings.klasse = e.target.value;
    Store.set('settings', settings);
    restart();
  });
  $('title').addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));
  $('openList').addEventListener('click', () => openView({ v: 'list' }));

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

  const openSettings = () => openView({ v: 'settings' });
  $('openSettings').addEventListener('click', openSettings);
  $('emptySettings').addEventListener('click', openSettings);
  $('closeSettings').addEventListener('click', () => history.back());
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
    updateBadge();
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
    stats = (await Store.get('stats')) || stats;
    settings = { ...settings, ...((await Store.get('settings')) || {}) };
    useFeed(await Store.get('feed'));
    showToday();
    history.replaceState(null, '');
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
