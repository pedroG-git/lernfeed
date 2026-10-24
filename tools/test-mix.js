// Checks the feed mix: order of new posts, reviews coming back, questions every 5 posts, class filter.
const assert = require('assert');
const Mix = require('../www/mix.js');
const { DAY, MIN } = Mix;

const posts = [];
for (const [klasse, le, datum, n] of [['CE 01 A', 'LE 1', '2026-10-07', 6], ['CE 02 B', 'LE 3', '2026-10-21', 8], ['CE 02 B', 'LE 1', '2026-10-13', 6]])
  for (let i = 0; i < n; i++)
    posts.push({ id: `${klasse}-${le}-${i}`, klasse, le, datum, titel: 't', kurz: 'k', fragen: [{ frage: 'f', optionen: ['a', 'b'], richtig: 0 }] });

let now = Date.UTC(2026, 9, 24, 7);

// 1. Fresh start: newest lesson first, authored order, no questions yet (nothing seen).
let r = Mix.next(posts, {}, { now, count: 10 });
assert.deepStrictEqual(r.items.slice(0, 8).map((i) => i.post.id), posts.filter((p) => p.le === 'LE 3').map((p) => p.id));
assert(r.items.every((i) => i.type === 'post'));

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
r = Mix.next(posts, progress, { now, count: 18 });
const types = r.items.map((i) => i.type);
assert.strictEqual(types[5], 'quiz');
assert.strictEqual(types[11], 'quiz');
const reviewIds = new Set(posts.slice(0, 6).map((x) => x.id));
assert(r.items.slice(0, 5).some((i) => reviewIds.has(i.post.id)), 'a due review in the first posts');

// 4. Class filter.
r = Mix.next(posts, {}, { now, count: 30, klasse: 'CE 01 A' });
assert(r.items.length === 6 && r.items.every((i) => i.post.klasse === 'CE 01 A'));

// 5. Shown posts are not repeated; questions asked <30 min ago are skipped.
r = Mix.next(posts, progress, { now, count: 50, shown: new Set(posts.map((x) => x.id)) });
assert.strictEqual(r.items.filter((i) => i.type === 'post').length, 0);
const log = Object.fromEntries(posts.map((x) => [x.id + '#0', { right: 1, wrong: 0, last: now - MIN }]));
r = Mix.next(posts, progress, { now, count: 30, quizLog: log });
assert(r.items.every((i) => i.type === 'post'));

// 6. Exam mode: its flashcards (2) then one lesson post; flashcards never in the normal feed.
const exam = { name: 'LEK', klasse: 'CE 02 B', le: 'LE 3' };
const all = posts.concat(Array.from({ length: 6 }, (_, i) => ({ id: 'lek-' + i, typ: 'karte', pruefung: 'LEK', klasse: 'CE 02 B', le: 'LE 3', titel: 'f', antwort: 'a' })));
r = Mix.next(all, {}, { now, count: 9, exam });
assert.deepStrictEqual(r.items.map((i) => (i.post.typ ? 'k' : 'p')).join(''), 'kkpkkpkkp');
assert(r.items.every((i) => i.post.le === 'LE 3' && i.post.klasse === 'CE 02 B'));
r = Mix.next(all, {}, { now, count: 50 });
assert(r.items.every((i) => !i.post.typ));

console.log('mix ok');
