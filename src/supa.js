import { createClient } from "@supabase/supabase-js";

/* global __SUPABASE_URL__, __SUPABASE_ANON_KEY__, __LEGAL_BASE__ */
export const sb = createClient(__SUPABASE_URL__, __SUPABASE_ANON_KEY__, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: "pkce" },
});
export const LEGAL_BASE = __LEGAL_BASE__;

export const me = { id: null, profile: null };

const urlCache = new Map();
export async function photoUrl(path) {
  if (!path) return "";
  const hit = urlCache.get(path);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data } = await sb.storage.from("photos").createSignedUrl(path, 3600);
  const url = data?.signedUrl ?? "";
  urlCache.set(path, { url, exp: Date.now() + 50 * 60 * 1000 });
  return url;
}

// Calls an edge function and turns its error body into a readable message.
export async function callFn(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return data;
}

export async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  return data;
}
