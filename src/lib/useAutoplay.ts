import { useEffect, useRef } from "react";
import type { Accent } from "../atlas/types";
import { playAutomatic } from "./audio";

/** One automatic pronunciation per learning step, only in the focused page. */
export function useAutoplay(
  enabled: boolean,
  word: string | undefined,
  url: string | null,
  accent: Accent,
) {
  const played = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !word) return;
    const key = `${word}:${accent}`;
    let cancel: (() => void) | undefined;
    const attempt = () => {
      if (
        played.current === key ||
        document.visibilityState !== "visible" ||
        !document.hasFocus()
      )
        return;
      played.current = key;
      cancel = playAutomatic(url, word, accent);
    };
    const visibility = () => {
      if (document.visibilityState === "hidden" || !document.hasFocus())
        cancel?.();
      else attempt();
    };
    // Let React finish mounting before starting audio. StrictMode's discarded
    // effect is cleaned up before it can start a second pronunciation.
    const timer = window.setTimeout(attempt, 0);
    window.addEventListener("focus", attempt);
    window.addEventListener("blur", visibility);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", attempt);
      window.removeEventListener("blur", visibility);
      document.removeEventListener("visibilitychange", visibility);
      cancel?.();
    };
  }, [enabled, word, url, accent]);
}
