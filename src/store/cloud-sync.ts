import { useSyncExternalStore } from "react";
import { go } from "../lib/router";
import { passwordRecoveryRequested, supabase } from "../lib/supabase";
import {
  defaultSettings,
  guestDocument,
  sanitizeProgress,
  sanitizeSettings,
  store,
} from "./store";
import {
  mergeDocuments,
  mergeInitial,
  SYNC_SETTINGS,
  type SyncDocument,
} from "./sync-merge";

export type SyncStatus =
  "unconfigured" | "signed-out" | "syncing" | "synced" | "offline" | "error";
let state: {
  status: SyncStatus;
  email: string | null;
  message: string;
  at: number | null;
  recovering: boolean;
} = {
  status: supabase ? "signed-out" : "unconfigured",
  email: null,
  message: "",
  at: null,
  recovering: passwordRecoveryRequested,
};
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let busy = false,
  applying = false,
  generation = 0;
let activeRun: Promise<void> | null = null;
const set = (patch: Partial<typeof state>) => {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
};
export const getCloudSync = () => state;
export const finishPasswordRecovery = () => set({ recovering: false });
export const useCloudSync = () =>
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => state,
  );

function normalize(document: SyncDocument): SyncDocument {
  const settings = { ...defaultSettings };
  for (const key of SYNC_SETTINGS)
    Object.assign(settings, { [key]: document.settings[key] });
  return { progress: document.progress, settings };
}
function current() {
  return normalize(store.get());
}
function validate(value: unknown): SyncDocument {
  const d = value as SyncDocument;
  if (
    !d ||
    d.progress?.version !== 2 ||
    d.progress.datasetId !== store.get().progress.datasetId ||
    !d.settings
  )
    throw new Error("云端进度格式不兼容，已保留本地记录");
  return normalize({
    progress: sanitizeProgress(d.progress, d.progress.datasetId),
    settings: sanitizeSettings(d.settings),
  });
}
function apply(
  document: SyncDocument,
  base: SyncDocument | null,
  pending: NonNullable<ReturnType<typeof store.get>["cloud"]>["pending"],
) {
  applying = true;
  try {
    store.applyCloud(document, { base, pending });
    if (store.get().saveError)
      throw new Error("设备空间不足，暂未上传，请先导出备份");
  } finally {
    applying = false;
  }
}
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

async function run() {
  if (!supabase || busy || !store.get().account) return;
  if (!navigator.onLine) {
    set({ status: "offline", message: "离线学习已保存在本机，联网后自动同步" });
    return;
  }
  busy = true;
  const g = generation,
    account = store.get().account,
    id = store.get().progress.datasetId;
  const still = () =>
    generation === g &&
    store.get().account === account &&
    store.get().progress.datasetId === id;
  set({ status: "syncing", message: "正在同步" });
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const pending = store.get().cloud?.pending;
      if (pending) {
        const { data, error } = await supabase.rpc("word_atlas_commit", {
          p_dataset: id,
          p_revision: pending.revision,
          p_document: pending.document,
          p_write_id: pending.id,
        });
        if (!still()) return;
        if (error) throw error;
        if (!data || typeof data.applied !== "boolean")
          throw new Error("同步响应异常");
        // Both paths keep current edits; a receipt acknowledges exactly the staged document.
        apply(
          current(),
          data.applied ? pending.document : (store.get().cloud?.base ?? null),
          null,
        );
      }
      const { data, error } = await supabase
        .from("word_atlas_progress")
        .select("revision,document")
        .eq("dataset_id", id)
        .maybeSingle();
      if (!still()) return;
      if (error) throw error;
      const local = current();
      const remote = data?.document
        ? validate(data.document)
        : {
            ...local,
            progress: {
              ...local.progress,
              cards: {},
              days: {},
              bookmarks: [],
              mistakes: [],
              typing: [],
              session: null,
            },
            settings: { ...defaultSettings },
          };
      const base = store.get().cloud?.base;
      const merged = base
        ? mergeDocuments(base, local, remote)
        : data?.document
          ? mergeInitial(local, remote)
          : local;
      if (equal(merged, remote)) {
        apply(merged, remote, null);
        set({ status: "synced", at: Date.now(), message: "已同步" });
        return;
      }
      // Commit local state, baseline and outbox together before starting the network write.
      apply(merged, remote, {
        id: crypto.randomUUID(),
        revision: Number(data?.revision ?? 0),
        document: merged,
      });
    }
    throw new Error("另一台设备正在更新，稍后自动重试");
  } catch (error) {
    if (!still()) return;
    const message =
      error instanceof Error
        ? error.message
        : (error as { message?: string })?.message || "云端暂时不可用";
    set({
      status: navigator.onLine ? "error" : "offline",
      message: store.get().saveError
        ? "设备存储失败，请先导出备份，暂不上传"
        : `${message}；本地进度已保留`,
    });
  } finally {
    busy = false;
    if (generation !== g && store.get().account) schedule();
  }
}
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    activeRun = run();
  }, 700);
}
export function syncNow() {
  clearTimeout(timer);
  if (busy) return activeRun;
  activeRun = run();
  return activeRun;
}

export function importGuestProgress() {
  const guest = normalize(guestDocument());
  const document = mergeInitial(guest, current());
  // Original guest data remains untouched as a local backup.
  apply(
    document,
    store.get().cloud?.base ?? null,
    store.get().cloud?.pending ?? null,
  );
  schedule();
}

export function startCloudSync() {
  if (!supabase) return () => {};
  let disposed = false;
  const accountChanged = (id: string | null, email: string | null) => {
    if (disposed) return;
    generation++;
    applying = true;
    try {
      store.useAccount(id);
    } finally {
      applying = false;
    }
    set({
      email,
      status: id ? "syncing" : "signed-out",
      message: "",
      at: null,
    });
    if (id) schedule();
  };
  // Auth callbacks must not await another auth method while the SDK holds its lock.
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    if (
      event === "PASSWORD_RECOVERY" ||
      (session && passwordRecoveryRequested)
    ) {
      set({ recovering: true });
      setTimeout(() => go({ page: "me" }), 0);
    }
    if (session?.user.id === store.get().account) return;
    accountChanged(session?.user.id ?? null, session?.user.email ?? null);
  });
  const authGeneration = generation;
  void supabase.auth.getSession().then(({ data, error }) => {
    if (disposed || generation !== authGeneration) return;
    if (error)
      set({ status: "error", message: "登录状态读取失败，请重新登录" });
    else if (data.session?.user.id !== store.get().account)
      accountChanged(
        data.session?.user.id ?? null,
        data.session?.user.email ?? null,
      );
  });
  const unsubscribe = store.subscribe(() => {
    if (!applying && store.get().account) {
      set({
        status: navigator.onLine ? "syncing" : "offline",
        message: navigator.onLine ? "更改等待同步" : "离线学习，联网后自动同步",
      });
      schedule();
    }
  });
  const resume = () => {
    if (document.visibilityState === "visible") void syncNow();
  };
  window.addEventListener("online", resume);
  document.addEventListener("visibilitychange", resume);
  const interval = setInterval(resume, 15000);
  return () => {
    disposed = true;
    subscription.unsubscribe();
    unsubscribe();
    clearInterval(interval);
    clearTimeout(timer);
    window.removeEventListener("online", resume);
    document.removeEventListener("visibilitychange", resume);
  };
}
