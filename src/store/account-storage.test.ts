import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultSettings,
  emptyProgress,
  flush,
  guestDocument,
  store,
} from "./store";
import type { SyncDocument } from "./sync-merge";

test("guest and independent accounts are isolated; outbox and baseline survive account reload atomically", () => {
  const data = new Map<string, string>();
  const g = globalThis as unknown as { window: unknown; localStorage: unknown };
  const originalWindow = g.window,
    originalStorage = g.localStorage;
  g.window = { clearTimeout, setTimeout };
  g.localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
  };
  try {
    store.useDataset("word-atlas-open");
    store.progress((p) => ({ ...p, bookmarks: ["guest-word"] }));
    flush();
    store.useAccount("alice");
    assert.deepEqual(store.get().progress.bookmarks, []);
    const document: SyncDocument = {
      progress: {
        ...emptyProgress("word-atlas-open"),
        bookmarks: ["alice-word"],
      },
      settings: { ...defaultSettings, dailyNew: 20 },
    };
    const checkpoint = {
      base: document,
      pending: { id: "123", revision: 7, document },
    };
    store.applyCloud(document, checkpoint);
    const record = JSON.parse(
      data.get("word-atlas:account:alice:word-atlas-open")!,
    );
    assert.deepEqual(record.cloud, checkpoint);
    assert.deepEqual(record.progress.bookmarks, ["alice-word"]);
    store.useAccount("bob");
    assert.deepEqual(store.get().progress.bookmarks, []);
    store.progress((p) => ({ ...p, bookmarks: ["bob-word"] }));
    flush();
    store.useAccount("alice");
    assert.deepEqual(store.get().progress.bookmarks, ["alice-word"]);
    assert.deepEqual(store.get().cloud, checkpoint);
    assert.equal(store.get().settings.dailyNew, 20);
    store.useAccount(null);
    assert.deepEqual(store.get().progress.bookmarks, ["guest-word"]);
    assert.deepEqual(guestDocument().progress.bookmarks, ["guest-word"]);
  } finally {
    g.window = originalWindow;
    g.localStorage = originalStorage;
  }
});
