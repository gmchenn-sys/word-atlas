import assert from "node:assert/strict";
import test from "node:test";
import { defaultSettings, emptyProgress } from "./store";
import { mergeDocuments, type SyncDocument } from "./sync-merge";
const doc = (): SyncDocument => ({
  progress: emptyProgress("word-atlas-open"),
  settings: { ...defaultSettings },
});
const card = (last: number) => ({
  due: last + 1,
  s: 2,
  d: 5,
  el: 0,
  sd: 1,
  ls: 0,
  reps: 1,
  lapses: 0,
  st: 2 as const,
  seen: 1,
  last,
});

test("offline devices retain different learned words and latest review of the same word", () => {
  const b = doc(),
    l = doc(),
    r = doc();
  l.progress.cards = { a: card(20), common: card(30) };
  r.progress.cards = { b: card(25), common: card(40) };
  const merged = mergeDocuments(b, l, r);
  assert.deepEqual(Object.keys(merged.progress.cards).sort(), [
    "a",
    "b",
    "common",
  ]);
  assert.equal(merged.progress.cards.common.last, 40);
});
test("daily totals add only local increments; repeated pulls do not double count", () => {
  const b = doc();
  b.progress.days["2026-11-10"] = { n: 2, r: 3, c: 2, t: 10 };
  const l = structuredClone(b),
    r = structuredClone(b);
  l.progress.days["2026-11-10"].n += 1;
  r.progress.days["2026-11-10"].n += 2;
  const m = mergeDocuments(b, l, r);
  assert.equal(m.progress.days["2026-11-10"].n, 5);
  assert.equal(mergeDocuments(m, m, m).progress.days["2026-11-10"].n, 5);
});
test("bookmark removals stay removed while additions on either device survive", () => {
  const b = doc();
  b.progress.bookmarks = ["old"];
  const l = structuredClone(b),
    r = structuredClone(b);
  l.progress.bookmarks = ["phone"];
  r.progress.bookmarks.push("desktop");
  assert.deepEqual(
    new Set(mergeDocuments(b, l, r).progress.bookmarks),
    new Set(["phone", "desktop"]),
  );
});
test("reset does not destroy a concurrent review; mismatched datasets are rejected", () => {
  const b = doc();
  b.progress.cards = { a: card(10), b: card(10) };
  const l = doc(),
    r = structuredClone(b);
  r.progress.cards.b = card(20);
  assert.deepEqual(Object.keys(mergeDocuments(b, l, r).progress.cards), ["b"]);
  r.progress.datasetId = "other";
  assert.throws(() => mergeDocuments(b, l, r));
});

test("a stale device never rolls back a more advanced shared session", () => {
  const b = doc();
  b.progress.session = {
    id: "round",
    started: 1,
    steps: [],
    index: 2,
    graded: {},
    newIds: [],
    reviewIds: [],
  };
  const l = structuredClone(b),
    r = structuredClone(b);
  l.progress.session!.index = 3;
  r.progress.session!.index = 5;
  assert.equal(mergeDocuments(b, l, r).progress.session!.index, 5);
});
test("normal reset removes typing history while concurrent new rounds survive", () => {
  const b = doc();
  b.progress.typing = [
    { at: 1, mode: "word", items: 1, wpm: 10, accuracy: 100 },
  ];
  const l = doc(),
    r = structuredClone(b);
  r.progress.typing.push({
    at: 2,
    mode: "sentence",
    items: 1,
    wpm: 20,
    accuracy: 100,
  });
  assert.deepEqual(
    mergeDocuments(b, l, r).progress.typing.map((t) => t.at),
    [2],
  );
});
