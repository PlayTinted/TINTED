// App shell: session, routing, tab bar, push notifications, Android back button.
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { PushNotifications } from "@capacitor/push-notifications";
import { sb, me } from "./supa.js";
import { $, toast, icon } from "./ui.js";
import { authScreen } from "./screens/auth.js";
import { profileForm } from "./screens/profile.js";
import { playScreen } from "./screens/play.js";
import { matchesScreen } from "./screens/matches.js";
import { matchScreen } from "./screens/match.js";
import { duelScreen } from "./screens/duel.js";
import { meScreen } from "./screens/me.js";
import { plusScreen } from "./screens/plus.js";
import { practiceScreen } from "./screens/practice.js";
import { initBilling, signOutBilling } from "./billing.js";
import { splash } from "./splash.js";
import { handleOAuthReturn } from "./oauth.js";

const screens = { auth: authScreen, profile: profileForm, play: playScreen, matches: matchesScreen, match: matchScreen, duel: duelScreen, me: meScreen, plus: plusScreen, practice: practiceScreen };
const TABS = [["play", "Play"], ["matches", "Matches"], ["me", "Me"]];
let cleanup = null;
let current = { name: null, params: {} };
let liveChannel = null;
const badges = { matches: false };
const pairedListeners = new Set();

async function go(name, params = {}) {
  if (typeof cleanup === "function") { try { cleanup(); } catch { /* ignore */ } }
  cleanup = null;
  current = { name, params };
  const app = $("#app");
  app.innerHTML = "";
  document.querySelector(".tabs")?.remove();
  document.querySelector(".composer")?.remove();
  if (name === "matches") badges.matches = false;
  if (TABS.some(([t]) => t === name)) renderTabs(name);
  cleanup = await screens[name](app, params, nav);
  window.scrollTo(0, 0);
}

function renderTabs(active = current.name) {
  document.querySelector(".tabs")?.remove();
  const bar = document.createElement("nav");
  bar.className = "tabs";
  bar.innerHTML = `<div>${TABS.map(([k, label]) =>
    `<button data-tab="${k}" class="${k === active ? "on" : ""}" aria-current="${k === active ? "page" : "false"}">${icon(k)}${label}${k === "matches" && badges.matches ? '<span class="dot" aria-label="new"></span>' : ""}</button>`).join("")}</div>`;
  bar.addEventListener("click", (e) => { const t = e.target.closest("[data-tab]"); if (t) go(t.dataset.tab); });
  document.body.appendChild(bar);
}

async function loadProfile() {
  const { data } = await sb.from("profiles").select("*").eq("id", me.id).maybeSingle();
  me.profile = data;
  return data;
}

async function enterApp() {
  const profile = await loadProfile();
  if (!profile) return go("profile", { onboarding: true });
  const { count } = await sb.from("photos").select("id", { count: "exact", head: true }).eq("user_id", me.id);
  if (!count) return go("profile", { onboarding: true, step: "photos" });
  listen();
  registerPush();
  initBilling().catch((e) => console.warn("Billing setup failed", e));
  go("play");
}

// New pairings arrive here wherever you are in the app.
function listen() {
  if (liveChannel) sb.removeChannel(liveChannel);
  const onPaired = (p) => {
    pairedListeners.forEach((f) => f(p.new));
    if (current.name === "play") return;
    badges.matches = true;
    toast("You've been paired. Open Matches to play.");
    if (document.querySelector(".tabs")) renderTabs();
  };
  liveChannel = sb.channel(`me-${me.id}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "matches", filter: `user_a=eq.${me.id}` }, onPaired)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "matches", filter: `user_b=eq.${me.id}` }, onPaired)
    .subscribe();
}

async function registerPush() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === "prompt") perm = await PushNotifications.requestPermissions();
    if (perm.receive !== "granted") return;
    await PushNotifications.removeAllListeners();
    PushNotifications.addListener("registration", async ({ value }) => {
      await sb.from("profiles").update({ push_token: value }).eq("id", me.id);
    });
    PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
      const m = notification?.data?.match_id;
      if (m) go("match", { match_id: m });
    });
    await PushNotifications.register();
  } catch (e) {
    console.warn("Push setup failed", e);
  }
}

function signedOut() {
  signOutBilling();
  if (liveChannel) { sb.removeChannel(liveChannel); liveChannel = null; }
  me.id = null; me.profile = null;
  go("auth");
}

// Passed to every screen so screens never import this file (avoids circular imports).
const nav = { go, enterApp, loadProfile, signedOut, renderTabs, badges, onPaired: (f) => { pairedListeners.add(f); return () => pairedListeners.delete(f); } };

App.addListener("backButton", () => {
  const n = current.name;
  if (n === "duel") return; // leaving mid-round is done with the on-screen button
  if (n === "match") return go("matches");
  if (n === "profile" && !current.params.onboarding) return go("me");
  if (n === "plus") return go(current.params.from || "me");
  if (n === "practice") return go(me.id ? "play" : "auth");
  if (n === "matches" || n === "me") return go("play");
  App.minimizeApp();
});

(async () => {
  splash();
  await handleOAuthReturn();
  const { data: { session } } = await sb.auth.getSession();
  if (session) { me.id = session.user.id; await enterApp(); } else go("auth");
  sb.auth.onAuthStateChange((event, s) => {
    if (event === "SIGNED_OUT") signedOut();
    if (event === "SIGNED_IN" && s && me.id !== s.user.id) { me.id = s.user.id; enterApp(); }
  });
})();
