import type { Progress, Settings } from "./store";

export interface SyncDocument {
  progress: Progress;
  settings: Settings;
}
export interface CloudCheckpoint {
  base: SyncDocument | null;
  pending: { id: string; revision: number; document: SyncDocument } | null;
}
export const SYNC_SETTINGS = [
  "accent",
  "autoplay",
  "dailyNew",
  "retention",
  "spell",
  "startLevel",
  "onboarded",
] as const;
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

function mergeSet(base: string[], local: string[], remote: string[]) {
  const removed = new Set(base.filter((id) => !local.includes(id)));
  const added = local.filter((id) => !base.includes(id));
  return [...new Set([...added, ...remote.filter((id) => !removed.has(id))])];
}

/** Three-way merge: replay this device's changes over the latest cloud snapshot. */
export function mergeDocuments(
  base: SyncDocument,
  local: SyncDocument,
  remote: SyncDocument,
): SyncDocument {
  if (
    base.progress.datasetId !== local.progress.datasetId ||
    local.progress.datasetId !== remote.progress.datasetId
  )
    throw new Error("词库不一致，未合并进度");
  const b = base.progress,
    l = local.progress,
    r = remote.progress;
  const cards = { ...r.cards };
  for (const id of new Set([
    ...Object.keys(b.cards),
    ...Object.keys(l.cards),
  ])) {
    if (same(l.cards[id], b.cards[id])) continue;
    if (!l.cards[id]) {
      // A reset cannot erase a word reviewed on the other device in the meantime.
      if (same(r.cards[id], b.cards[id])) delete cards[id];
    } else if (
      !r.cards[id] ||
      same(r.cards[id], b.cards[id]) ||
      (l.cards[id].last ?? l.cards[id].seen) >=
        (r.cards[id].last ?? r.cards[id].seen)
    ) {
      cards[id] = l.cards[id];
    }
  }
  const days = { ...r.days };
  for (const key of new Set([...Object.keys(b.days), ...Object.keys(l.days)])) {
    if (same(l.days[key], b.days[key])) continue;
    if (!l.days[key]) {
      if (same(r.days[key], b.days[key])) delete days[key];
      continue;
    }
    const day = { ...l.days[key] };
    for (const field of ["n", "r", "c", "t"] as const)
      day[field] = Math.max(
        0,
        (r.days[key]?.[field] ?? 0) +
          l.days[key][field] -
          (b.days[key]?.[field] ?? 0),
      );
    days[key] = day;
  }
  const typing = new Map(r.typing.map((t) => [`${t.at}:${t.mode}`, t]));
  const localTyping = new Set(l.typing.map((t) => `${t.at}:${t.mode}`));
  for (const t of b.typing)
    if (!localTyping.has(`${t.at}:${t.mode}`))
      typing.delete(`${t.at}:${t.mode}`);
  for (const t of l.typing) typing.set(`${t.at}:${t.mode}`, t);
  let session = r.session;
  if (!same(l.session, b.session)) {
    if (same(r.session, b.session)) session = l.session;
    else if (l.session && r.session?.id === l.session.id)
      session =
        l.session.index > r.session.index ||
        (l.session.index === r.session.index &&
          (l.session.finished || l.session.pending))
          ? l.session
          : r.session;
    else if (
      l.session &&
      (!r.session || l.session.started >= r.session.started)
    )
      session = l.session;
  }
  const settings = { ...remote.settings };
  // Presentation/audio preferences remain appropriate for each device.
  for (const key of SYNC_SETTINGS)
    if (!same(local.settings[key], base.settings[key]))
      Object.assign(settings, { [key]: local.settings[key] });
  return {
    progress: {
      ...r,
      cards,
      days,
      session,
      bookmarks: mergeSet(b.bookmarks, l.bookmarks, r.bookmarks),
      mistakes: mergeSet(b.mistakes, l.mistakes, r.mistakes).slice(0, 300),
      typing: [...typing.values()].sort((a, b) => a.at - b.at).slice(-500),
    },
    settings,
  };
}

/** First connection has no shared baseline: avoid counting an imported backup twice. */
export function mergeInitial(
  local: SyncDocument,
  remote: SyncDocument,
): SyncDocument {
  const base = structuredClone(local);
  base.progress.cards = {};
  base.progress.bookmarks = [];
  base.progress.mistakes = [];
  base.progress.typing = [];
  base.progress.session = null;
  base.progress.days = {};
  const merged = mergeDocuments(base, local, remote);
  for (const [key, value] of Object.entries(local.progress.days)) {
    const other = remote.progress.days[key];
    merged.progress.days[key] = other
      ? {
          n: Math.max(value.n, other.n),
          r: Math.max(value.r, other.r),
          c: Math.max(value.c, other.c),
          t: Math.max(value.t, other.t),
        }
      : value;
  }
  return merged;
}
