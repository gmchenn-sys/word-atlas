import { useEffect, useState } from "react";
import { Cloud, CloudOff, RefreshCw } from "lucide-react";
import { supabase } from "../lib/supabase";
import { guestDocument, useStore } from "../store/store";
import {
  finishPasswordRecovery,
  importGuestProgress,
  syncNow,
  useCloudSync,
} from "../store/cloud-sync";

const LABEL = {
  unconfigured: "仅保存在本机",
  "signed-out": "登录后同步",
  syncing: "正在同步",
  synced: "已同步",
  offline: "离线 · 已保存到本机",
  error: "同步待重试",
};
export function SyncIndicator() {
  const sync = useCloudSync();
  return (
    <a
      className={`sync-indicator sync-${sync.status}`}
      href="#/me"
      title={sync.message || LABEL[sync.status]}
      aria-label={`学习进度：${LABEL[sync.status]}`}
    >
      {sync.status === "offline" || sync.status === "error" ? (
        <CloudOff size={16} />
      ) : (
        <Cloud size={16} />
      )}
      <span>{LABEL[sync.status]}</span>
    </a>
  );
}

function readable(message: string) {
  if (/Invalid login credentials/i.test(message)) return "邮箱或密码不正确。";
  if (/Email not confirmed/i.test(message))
    return "请先打开确认邮件验证邮箱，再登录。";
  if (/rate limit|too many requests/i.test(message))
    return "请求较频繁，请稍后再试。";
  if (/fetch|network/i.test(message))
    return "网络暂时不可用，请检查连接后重试。";
  return message;
}

export function CloudAccount() {
  const sync = useCloudSync();
  const account = useStore((s) => s.account);
  const [mode, setMode] = useState<"login" | "signup" | "reset" | "recovery">(
    "login",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [migration, setMigration] = useState(false);
  useEffect(() => {
    if (sync.recovering) setMode("recovery");
  }, [sync.recovering]);
  useEffect(() => {
    if (!supabase) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("recovery");
    });
    return () => subscription.unsubscribe();
  }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || busy) return;
    setBusy(true);
    setMessage("");
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: `${location.origin}${import.meta.env.BASE_URL}`,
          },
        });
        if (error) throw error;
        if (!data.session)
          setMessage("请到邮箱打开确认链接，验证后即可在手机和电脑登录。");
      } else if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(
          email.trim(),
          { redirectTo: `${location.origin}${import.meta.env.BASE_URL}` },
        );
        if (error) throw error;
        setMessage("若该邮箱已注册，将收到重设密码的邮件。");
      } else {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        finishPasswordRecovery();
        setMode("login");
        setMessage("密码已更新。");
      }
      setPassword("");
    } catch (error) {
      setMessage(
        readable(
          (error as { message?: string }).message || "操作失败，请重试。",
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  const localCount = Object.keys(guestDocument().progress.cards).length;
  if (!supabase)
    return (
      <section className="panel cloud-account">
        <h3 className="eyebrow">跨设备同步</h3>
        <p className="muted">
          当前是本地版。接入云端后，在手机和电脑登录同一邮箱，即可接续学习。
        </p>
      </section>
    );
  return (
    <section className="panel cloud-account">
      <h3 className="eyebrow">账号与同步</h3>
      {account && mode !== "recovery" ? (
        <>
          <p className="account-email">{sync.email || "已登录"}</p>
          <p className={`sync-message sync-${sync.status}`} role="status">
            {LABEL[sync.status]}
            {sync.at && sync.status === "synced"
              ? ` · ${new Date(sync.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
              : ""}
          </p>
          {sync.message && sync.status !== "synced" && (
            <p className="muted">{sync.message}</p>
          )}
          <p className="muted">
            在另一台设备登录同一邮箱，学习进度、收藏和学习设置会自动同步。离线时先保存在本机，联网后补传。
          </p>
          <div className="cloud-actions">
            <button
              className="btn btn-primary"
              onClick={() => void syncNow()}
              disabled={sync.status === "syncing"}
            >
              <RefreshCw size={16} />
              立即同步
            </button>
            <button
              className="btn btn-ghost"
              disabled={busy}
              onClick={async () => {
                if (!supabase) return;
                setBusy(true);
                try {
                  await syncNow();
                  const { error } = await supabase.auth.signOut();
                  if (error) throw error;
                } catch (e) {
                  setMessage(readable((e as Error).message));
                } finally {
                  setBusy(false);
                }
              }}
            >
              退出账号
            </button>
          </div>
          {localCount > 0 && (
            <div className="cloud-migration">
              <p>
                这台设备原来的本地记录包含 <b>{localCount}</b> 个学过的词。
              </p>
              <button
                className="btn btn-ghost"
                disabled={migration || sync.status !== "synced"}
                onClick={() => {
                  importGuestProgress();
                  setMigration(true);
                }}
              >
                合并原有本地进度
              </button>
              {migration && (
                <p className="muted">已加入待同步记录，原本地记录仍保留。</p>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="muted">
            手机和电脑使用同一邮箱登录，就能接着学。每个人的进度独立保存，也可以先在本机学习。
          </p>
          <form className="cloud-form" onSubmit={submit}>
            {mode !== "recovery" && (
              <label>
                邮箱
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                />
              </label>
            )}
            {(mode === "login" || mode === "signup" || mode === "recovery") && (
              <label>
                {mode === "recovery" ? "新密码" : "密码"}
                <input
                  type="password"
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={mode === "login" ? 1 : 8}
                  placeholder={mode === "login" ? "输入密码" : "至少 8 位"}
                />
              </label>
            )}
            <button className="btn btn-primary" disabled={busy}>
              {busy
                ? "请稍候…"
                : mode === "signup"
                  ? "注册账号"
                  : mode === "reset"
                    ? "发送重设邮件"
                    : mode === "recovery"
                      ? "保存新密码"
                      : "登录并同步"}
            </button>
          </form>
          <div className="cloud-actions">
            <button
              className="link"
              onClick={() => {
                setMode(mode === "signup" ? "login" : "signup");
                setMessage("");
              }}
            >
              {mode === "signup" ? "已有账号，去登录" : "没有账号？注册"}
            </button>
            <button
              className="link"
              onClick={() => {
                setMode(mode === "reset" ? "login" : "reset");
                setMessage("");
              }}
            >
              {mode === "reset" ? "返回登录" : "忘记密码"}
            </button>
          </div>
        </>
      )}
      {message && (
        <p className="cloud-feedback" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
