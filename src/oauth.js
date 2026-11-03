// "Continue with Google". On the web the page goes to Google and comes back with ?code=.
// In the Android app Google opens in a browser tab and returns through the app link
// com.playtinted.app://auth-callback (allow-listed in Supabase → Auth → URL Configuration).
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { sb } from "./supa.js";

export const APP_CALLBACK = "com.playtinted.app://auth-callback";
const native = () => Capacitor.isNativePlatform();

export async function signInWithGoogle() {
  const redirectTo = native() ? APP_CALLBACK : location.origin + location.pathname;
  const { data, error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, skipBrowserRedirect: native(), queryParams: { prompt: "select_account" } },
  });
  if (error) throw error;
  if (native() && data?.url) await Browser.open({ url: data.url, presentationStyle: "popover" });
}

async function finish(url) {
  const u = new URL(url);
  const code = u.searchParams.get("code");
  const err = u.searchParams.get("error_description");
  if (err) console.warn("Google sign-in cancelled or failed:", err);
  if (code) await sb.auth.exchangeCodeForSession(code).catch((e) => console.warn("Sign-in exchange failed", e));
}

// Call once at start-up, before reading the session.
export async function handleOAuthReturn() {
  if (native()) {
    App.addListener("appUrlOpen", async ({ url }) => {
      if (!url?.startsWith(APP_CALLBACK)) return;
      await Browser.close().catch(() => {});
      await finish(url);
    });
    return;
  }
  if (/[?&](code|error)=/.test(location.search)) {
    await finish(location.href);
    history.replaceState(null, "", location.pathname);
  }
}
