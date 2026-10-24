// Checks the feed mix: order of new posts, reviews coming back, questions every 5 posts, class filter.
const assert = require('assert');
const Mix = require('../www/mix.js');
const { DAY, MIN } = Mix;

const posts = [];
for (const [klasse, le, datum, n] of [['CE 01 A', 'LE 1', '2026-10-07', 6], ['CE 02 B', 'LE 3', '2026-10-21', 8], ['CE 02 B', 'LE 1', '2026-10-13', 6]])
  for (let i = 0; i < n; i++)
    posts.push({ id: `${klasse}-${le}-${i}`, klasse, le, datum, titel: 't', kurz: 'k', fragen: [{ frage: 'f', optionen: ['a', 'b'], richtig: 0 }] });

let now = Date.UTC(2026, 9, 24, 7);

// Seeded random so the checks are repeatable.
const seeded = (a) => () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// 1. Fresh start: newest lesson first, early posts of the lesson near the top; another refresh = another order.
let r = Mix.next(posts, {}, { now, count: 10, rand: seeded(1) });
const le3 = posts.filter((p) => p.le === 'LE 3').map((p) => p.id);
assert(r.items.every((i) => i.type === 'post'));
const orders = new Set([1, 2, 3, 4, 5].map((n) => Mix.next(posts, {}, { now, count: 6, rand: seeded(n) }).items.map((i) => i.post.id).join()));
assert(orders.size > 1, 'refresh remixes');
let avg = 0, share = 0;
for (let n = 1; n <= 200; n++) {
  const ids = Mix.next(posts, {}, { now, count: 20, rand: seeded(n) }).items.map((i) => i.post.id);
  avg += ids.indexOf(le3[0]) / 200;
  share += ids.slice(0, 5).filter((id) => le3.includes(id)).length / 1000;
}
assert(share > 0.75, 'newest lesson mostly on top: ' + share);
assert(avg < 3, 'first post of the lesson usually near the top: ' + avg);

// 2. Rating: got -> 1 day, then 3 days; miss -> 10 minutes, box 0.
let p = Mix.rate({}, true, now);
assert.strictEqual(p.due, now + DAY);
p = Mix.rate(p, true, now);
assert.strictEqual(p.due, now + 3 * DAY);
p = Mix.rate(p, false, now);
assert.strictEqual(p.box, 0);
assert.strictEqual(p.due, now + 10 * MIN);
assert.strictEqual(Mix.level(p), 'normal');
assert.strictEqual(Mix.level(undefined), 'normal');
assert.strictEqual(Mix.level({ lvl: 'einfach' }), 'einfach');

// 3. With seen posts: a question after every 5 posts, and due reviews come in.
const progress = {};
for (const x of posts.slice(0, 6)) progress[x.id] = Mix.seen({}, now - 2 * DAY); // due yesterday
r = Mix.next(posts, progress, { now, count: 18, rand: seeded(7) });
const types = r.items.map((i) => i.type);
assert.strictEqual(types[5], 'quiz');
assert.strictEqual(types[11], 'quiz');
const reviewIds = new Set(posts.slice(0, 6).map((x) => x.id));
assert(r.items.slice(0, 5).some((i) => reviewIds.has(i.post.id)), 'a due review in the first posts');

// 3b. "Noch lernen" weighs more than an overdue review, which weighs more than a post not due yet.
const g0 = Mix.rate({}, false, now - DAY); g0.learn = true;
const g1 = Mix.seen({}, now - 2 * DAY), g2 = Mix.rate({}, true, now);
assert(Mix.weight({}, g0, now, 0, 0) > Mix.weight({}, g1, now, 0, 0));
assert(Mix.weight({}, g1, now, 0, 0) > 5 * Mix.weight({}, g2, now, 0, 0));

// 4. Class filter.
r = Mix.next(posts, {}, { now, count: 30, klasse: 'CE 01 A' });
assert(r.items.length === 6 && r.items.every((i) => i.post.klasse === 'CE 01 A'));

// 5. Shown posts are not repeated; questions asked <30 min ago are skipped.
r = Mix.next(posts, progress, { now, count: 50, shown: new Set(posts.map((x) => x.id)) });
assert.strictEqual(r.items.filter((i) => i.type === 'post').length, 0);
const log = Object.fromEntries(posts.map((x) => [x.id + '#0', { right: 1, wrong: 0, last: now - MIN }]));
r = Mix.next(posts, progress, { now, count: 30, quizLog: log });
assert(r.items.every((i) => i.type === 'post'));

// 6. Exam mode: lesson post, flashcard, post, card …; flashcards never in the normal feed.
const exam = { name: 'LEK', klasse: 'CE 02 B', le: 'LE 3' };
const all = posts.concat(Array.from({ length: 6 }, (_, i) => ({ id: 'lek-' + i, typ: 'karte', pruefung: 'LEK', klasse: 'CE 02 B', le: 'LE 3', titel: 'f', antwort: 'a' })));
r = Mix.next(all, {}, { now, count: 9, exam, rand: seeded(3) });
assert.deepStrictEqual(r.items.map((i) => (i.post.typ ? 'k' : 'p')).join(''), 'pkpkpkpkp');
assert(r.items.every((i) => i.post.le === 'LE 3' && i.post.klasse === 'CE 02 B'));
r = Mix.next(all, {}, { now, count: 50 });
assert(r.items.every((i) => !i.post.typ));

console.log('mix ok');
