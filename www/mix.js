// The "smart mix": decides which post comes next.
// Pure functions (no DOM, no storage) so tools/test-mix.js can run them in node.
//
// Per post progress: { n: times seen, ok: times "Kann ich", box: 0-5, due: ms, last: ms }
// - every refresh is a new weighted shuffle: "Noch lernen", overdue reviews and new posts weigh most
// - "Kann ich" pushes the post further away (1, 3, 7, 16, 35 days), "Noch lernen" brings it back soon
// - scrolled past without a tap = seen, comes back tomorrow
// - every few posts a short question about something already seen
(function (root) {
  const MIN = 60 * 1000, DAY = 24 * 60 * MIN;
  const INTERVALS = [1, 3, 7, 16, 35]; // days, by box
  const SOON = 10 * MIN;               // "Noch lernen"
  const QUIZ_EVERY = 5;                 // one question after every 5 posts

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

  // Lesson rank: 0 = newest lesson, 1 = the one before, …
  function lessonRanks(posts) {
    const date = {};
    for (const x of posts) {
      const k = x.klasse + '|' + x.le;
      if (!date[k] || x.datum > date[k]) date[k] = x.datum || '';
    }
    const order = Object.keys(date).sort((a, b) => (date[a] < date[b] ? 1 : date[a] > date[b] ? -1 : 0));
    return Object.fromEntries(order.map((k, i) => [k, i]));
  }

  // How much a post deserves a place in the feed right now.
  // - "Noch lernen" and overdue reviews first, the longer overdue the more
  // - new posts: newer lesson first, inside a lesson the earlier posts first (they build on each other;
  //   flashcards only loosely)
  // - posts not due yet only as filler, the ones not seen for longest first
  function weight(x, g, now, rank, pos) {
    if (!g) return 4 * Math.pow(0.4, rank) * Math.pow(x.typ ? 0.98 : 0.9, pos);
    if (g.due <= now) {
      const late = Math.min((now - g.due) / DAY, 7);
      return (g.learn ? 6 : 2.5) * (1 + late / 7) * (1 - Math.min(g.box || 0, 5) / 8);
    }
    return 0.05 + 0.25 * Math.min((now - (g.last || 0)) / (7 * DAY), 1);
  }

  // Weighted shuffle (Efraimidis-Spirakis with weight², so relevance wins clearly over chance):
  // heavy posts tend to come first, but every refresh is a new mix.
  function remix(list, w, rand) {
    return list
      .map((x) => ({ x, k: Math.pow(rand(), 1 / Math.max(w(x) ** 2, 1e-9)) }))
      .sort((a, b) => b.k - a.k)
      .map((o) => o.x);
  }

  // a a b a a b … (n of a, then one of b), the rest appended.
  function interleave(a, b, n) {
    const out = [];
    while (a.length || b.length) {
      out.push(...a.splice(0, n));
      if (b.length) out.push(b.shift());
    }
    return out;
  }

  // Builds the next `count` feed items. `shown` = post ids already in this session (not repeated).
  // Items: { type: 'post', post } or { type: 'quiz', post, q, qi }
  function next(posts, progress, opts) {
    const { now, count = 15, shown = new Set(), klasse = '', exam = null, quizLog = {}, sinceQuiz = 0, rand = Math.random } = opts;
    // Exam mode: a feed of the test material (posts of its lesson) with a flashcard after each post. Otherwise flashcards stay out of the feed.
    const pool = exam ? posts.filter((x) => x.pruefung === exam.name || (!x.typ && x.klasse === exam.klasse && x.le === exam.le))
      : posts.filter((x) => !x.typ && (!klasse || x.klasse === klasse));
    const prog = (x) => progress[x.id];

    // Position of each new post inside its lesson (among the new ones), for the "earlier first" weight.
    const ranks = lessonRanks(pool), pos = {}, seenIn = {};
    for (const x of pool) {
      if (prog(x)) continue;
      const k = x.klasse + '|' + x.le + '|' + (x.typ || '');
      pos[x.id] = seenIn[k] = (seenIn[k] ?? -1) + 1;
    }
    const w = (x) => weight(x, prog(x), now, ranks[x.klasse + '|' + x.le] || 0, pos[x.id] || 0);
    const open = pool.filter((x) => !shown.has(x.id));
    let order = exam
      ? interleave(remix(open.filter((x) => !x.typ), w, rand), remix(open.filter((x) => x.typ), w, rand), 1)
      : remix(open, w, rand);

    // Questions: from posts already seen, the ones answered wrong or not asked for longest first.
    const quizzes = [];
    for (const x of pool) {
      if (!prog(x) || !x.fragen) continue;
      x.fragen.forEach((q, qi) => {
        const log = quizLog[x.id + '#' + qi] || { right: 0, wrong: 0, last: 0 };
        if (now - log.last < 30 * MIN) return;
        quizzes.push({ x, q, qi, score: log.right - 2 * log.wrong + rand(), last: log.last });
      });
    }
    quizzes.sort((a, b) => a.score - b.score || a.last - b.last);

    const out = [];
    let posted = sinceQuiz;
    while (out.length < count) {
      if (posted >= QUIZ_EVERY && quizzes.length) {
        const z = quizzes.shift();
        out.push({ type: 'quiz', post: z.x, q: z.q, qi: z.qi });
        posted = 0;
        continue;
      }
      const x = order.shift();
      if (!x) break;
      out.push({ type: 'post', post: x });
      posted++;
    }
    return { items: out, sinceQuiz: posted };
  }

  const api = { rate, seen, level, next, weight, INTERVALS, DAY, MIN };
  root.Mix = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
