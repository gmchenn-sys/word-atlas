import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

test("sync controller survives lost responses and concurrent edits without duplicating daily totals", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "word-atlas-sync-"));
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = new Map(
    ["window", "document", "localStorage", "navigator", "__wordAtlasMock"].map(
      (k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)],
    ),
  );
  const records = new Map<string, string>();
  let remote: { revision: number; document: unknown } | null = null;
  const receipts = new Set<string>();
  let loseResponse = false;
  let concurrentWrite = false;
  const client = {
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
      getSession: async () => ({
        data: {
          session: { user: { id: "alice", email: "alice@example.com" } },
        },
        error: null,
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: structuredClone(remote),
            error: null,
          }),
        }),
      }),
    }),
    rpc: async (_name: string, p: Record<string, unknown>) => {
      if (concurrentWrite && remote) {
        concurrentWrite = false;
        const doc = remote.document as {
          progress: { days: Record<string, { n: number }> };
        };
        doc.progress.days["2026-11-10"].n += 2;
        remote.revision++;
      }
      if (receipts.has(p.p_write_id as string))
        return {
          data: { applied: true, ...structuredClone(remote) },
          error: null,
        };
      if (remote && remote.revision !== p.p_revision)
        return {
          data: { applied: false, ...structuredClone(remote) },
          error: null,
        };
      remote = {
        revision: (remote?.revision ?? 0) + 1,
        document: structuredClone(p.p_document),
      };
      receipts.add(p.p_write_id as string);
      if (loseResponse) {
        loseResponse = false;
        return {
          data: null,
          error: { message: "connection lost after commit" },
        };
      }
      return {
        data: { applied: true, ...structuredClone(remote) },
        error: null,
      };
    },
  };
  try {
    const win = new EventTarget();
    Object.assign(win, { clearTimeout, setTimeout });
    const doc = new EventTarget();
    Object.assign(doc, { visibilityState: "visible" });
    Object.defineProperty(globalThis, "window", {
      value: win,
      configurable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: doc,
      configurable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: { onLine: true },
      configurable: true,
    });
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (k: string) => records.get(k) ?? null,
        setItem: (k: string, v: string) => records.set(k, v),
      },
      configurable: true,
    });
    g.__wordAtlasMock = client;
    const file = path.join(dir, "controller.mjs");
    const result = await build({
      stdin: {
        contents:
          'export * from "./src/store/cloud-sync"; export { store, flush } from "./src/store/store";',
        resolveDir: process.cwd(),
        loader: "ts",
      },
      bundle: true,
      platform: "node",
      format: "esm",
      write: false,
      plugins: [
        {
          name: "mock-transport",
          setup(b) {
            b.onResolve({ filter: /lib\/supabase$/ }, () => ({
              path: "supabase",
              namespace: "test",
            }));
            b.onResolve({ filter: /lib\/router$/ }, () => ({
              path: "router",
              namespace: "test",
            }));
            b.onLoad({ filter: /.*/, namespace: "test" }, (a) => ({
              contents:
                a.path === "supabase"
                  ? "export const supabase=globalThis.__wordAtlasMock; export const passwordRecoveryRequested=false;"
                  : "export function go() {}",
              loader: "js",
            }));
          },
        },
      ],
    });
    await writeFile(file, result.outputFiles[0].contents);
    const api = await import(pathToFileURL(file).href);
    const stop = api.startCloudSync();
    try {
      await Promise.resolve();
      await Promise.resolve();
      await api.syncNow();
      api.store.progress((p: object) => ({
        ...p,
        days: { "2026-11-10": { n: 1, r: 1, c: 1, t: 10 } },
      }));
      loseResponse = true;
      await api.syncNow();
      assert.equal(api.getCloudSync().status, "error");
      assert.ok(api.store.get().cloud.pending);
      const pendingId = api.store.get().cloud.pending.id;
      assert.ok([...records.values()].some((v) => v.includes(pendingId)));
      await api.syncNow();
      assert.equal(api.getCloudSync().status, "synced");
      assert.equal(api.store.get().cloud.pending, null);
      assert.equal(api.store.get().progress.days["2026-11-10"].n, 1);
      api.store.progress((p: { days: Record<string, { n: number }> }) => ({
        ...p,
        days: { ...p.days, "2026-11-10": { ...p.days["2026-11-10"], n: 2 } },
      }));
      concurrentWrite = true;
      await api.syncNow();
      assert.equal(api.getCloudSync().status, "synced");
      assert.equal(api.store.get().progress.days["2026-11-10"].n, 4);
      await api.syncNow();
      assert.equal(api.store.get().progress.days["2026-11-10"].n, 4);
      api.flush();
    } finally {
      stop();
    }
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete g[key];
    }
    await rm(dir, { recursive: true, force: true });
  }
});
