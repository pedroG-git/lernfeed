// The "smart mix": decides which post comes next.
// Pure functions (no DOM, no storage) so tools/test-mix.js can run them in node.
//
// Per post progress: { n: times seen, ok: times "Kann ich", box: 0-5, due: ms, last: ms }
// - unseen posts come in class order (newest LE first, inside an LE in the order they were written)
// - "Kann ich" pushes the post further away (1, 3, 7, 16, 35 days), "Noch lernen" brings it back soon
// - scrolled past without a tap = seen, comes back tomorrow
// - every few posts a short question about something already seen
(function (root) {
  const MIN = 60 * 1000, DAY = 24 * 60 * MIN;
  const INTERVALS = [1, 3, 7, 16, 35]; // days, by box
  const SOON = 10 * MIN;               // "Noch lernen"
  const QUIZ_EVERY = 5;                 // one question after every 5 posts
  const REVIEW_EVERY = 3;               // every 3rd post is a due review when there is one

  function rate(p, got, now) {
    p = { n: 0, ok: 0, box: 0, due: 0, last: 0, ...p };
    if (got) {
      p.ok++;
      p.due = now + INTERVALS[Math.min(p.box, INTERVALS.length - 1)] * DAY;
      p.box = Math.min(p.box + 1, INTERVALS.length);
    } else {
      p.box = 0;
      p.due = now + SOON;
    }
    p.last = now;
    return p;
  }

  // Seen on screen without a tap.
  function seen(p, now) {
    p = { n: 0, ok: 0, box: 0, due: 0, last: 0, ...p };
    p.n++;
    p.last = now;
    if (!p.due || p.due < now) p.due = now + DAY;
    return p;
  }

  // Normal German by default; the post page can switch a single post to simple German (remembered).
  function level(p) {
    return (p && p.lvl) || 'normal';
  }

  // Unseen posts: newest lesson first, inside a lesson in authored order.
  function freshOrder(posts) {
    const lessonDate = {};
    for (const x of posts) {
      const k = x.klasse + '|' + x.le;
      if (!lessonDate[k] || x.datum > lessonDate[k]) lessonDate[k] = x.datum || '';
    }
    return posts
      .map((x, i) => ({ x, i, d: lessonDate[x.klasse + '|' + x.le] }))
      .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : a.i - b.i))
      .map((o) => o.x);
  }

  // Builds the next `count` feed items. `shown` = post ids already in this session (not repeated unless due).
  // Items: { type: 'post', post } or { type: 'quiz', post, q, qi }
  function next(posts, progress, opts) {
    const { now, count = 15, shown = new Set(), klasse = '', quizLog = {}, sinceQuiz = 0 } = opts;
    const pool = klasse ? posts.filter((x) => x.klasse === klasse) : posts;
    const prog = (x) => progress[x.id];

    const fresh = freshOrder(pool.filter((x) => !prog(x) && !shown.has(x.id)));
    const due = pool
      .filter((x) => prog(x) && prog(x).due <= now && !shown.has(x.id))
      .sort((a, b) => prog(a).due - prog(b).due);
    const fill = pool
      .filter((x) => prog(x) && prog(x).due > now && !shown.has(x.id))
      .sort((a, b) => prog(a).last - prog(b).last);
    // Questions: from posts already seen, the ones answered wrong or not asked for longest first.
    const quizzes = [];
    for (const x of pool) {
      if (!prog(x) || !x.fragen) continue;
      x.fragen.forEach((q, qi) => {
        const log = quizLog[x.id + '#' + qi] || { right: 0, wrong: 0, last: 0 };
        if (now - log.last < 30 * MIN) return;
        quizzes.push({ x, q, qi, score: log.right - 2 * log.wrong, last: log.last });
      });
    }
    quizzes.sort((a, b) => a.score - b.score || a.last - b.last);

    const out = [];
    let posted = sinceQuiz, slot = 0;
    while (out.length < count) {
      if (posted >= QUIZ_EVERY && quizzes.length) {
        const z = quizzes.shift();
        out.push({ type: 'quiz', post: z.x, q: z.q, qi: z.qi });
        posted = 0;
        continue;
      }
      let x = null;
      if (slot % REVIEW_EVERY === REVIEW_EVERY - 1 && due.length) x = due.shift();
      else x = fresh.shift() || due.shift() || fill.shift();
      if (!x) break;
      out.push({ type: 'post', post: x });
      posted++;
      slot++;
    }
    return { items: out, sinceQuiz: posted };
  }

  const api = { rate, seen, level, next, freshOrder, INTERVALS, DAY, MIN };
  root.Mix = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
