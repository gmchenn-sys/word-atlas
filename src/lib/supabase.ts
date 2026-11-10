import { createClient } from "@supabase/supabase-js";
export const passwordRecoveryRequested =
  typeof location !== "undefined" &&
  new URLSearchParams(location.hash.slice(1)).get("type") === "recovery";
const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
export const supabase =
  url && key
    ? createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;
