#!/usr/bin/env python3
"""Builds the website version of Tinted into web-dist/ with no npm or bundler.
The browser loads Supabase from jsDelivr; Capacitor features are stubbed (they only matter in the Android app).
Upload web-dist/ to Netlify (drag the folder onto the project's Deploys page)."""
import base64, hashlib, json, re, shutil, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "web-dist"
SITE = "https://playtinted.com"
build = (ROOT / "build.mjs").read_text()
URL = re.search(r'"(https://[a-z0-9]+\.supabase\.co)"', build).group(1)
KEY = re.search(r'"(eyJ[A-Za-z0-9._-]+)"', build).group(1)
SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm"

shutil.rmtree(OUT, ignore_errors=True)
APP = OUT / "app"   # the web app lives at /app/; the front page is at /
shutil.copytree(ROOT / "src", APP / "src", ignore=shutil.ignore_patterns("index.html", "fonts.css"))
shutil.copytree(ROOT / "shared", APP / "shared")
shutil.copy(ROOT / "site" / "try.html", APP / "try.html")  # no-sign-up demo duel, served at /play
shutil.copytree(ROOT / "src" / "brand" / "icons", OUT / "src" / "brand" / "icons")  # also at the root, for emails and icons
for f in ["privacy.html", "terms.html", "delete-account.html", "site.css"]:
    shutil.copy(ROOT / "site" / f, OUT / f)
if (ROOT / "site" / "img").exists(): shutil.copytree(ROOT / "site" / "img", OUT / "img")
shutil.copy(ROOT / "site" / "landing.html", OUT / "index.html")
shutil.copytree(ROOT / "site" / "assets", OUT / "assets")

(APP / "env.js").write_text(
    f'var __SUPABASE_URL__ = {json.dumps(URL)}, __SUPABASE_ANON_KEY__ = {json.dumps(KEY)},\n'
    f'    __LEGAL_BASE__ = {json.dumps(SITE)}, __REVENUECAT_KEY__ = "";\n')
(APP / "cap-web.js").write_text("""// Web stand-ins for the Android-only Capacitor plugins.
export const Capacitor = { isNativePlatform: () => false, getPlatform: () => "web" };
export const App = { addListener() { return { remove() {} }; }, minimizeApp() {} };
export const PushNotifications = {};
export const Haptics = { impact() { navigator.vibrate?.(10); }, notification() { navigator.vibrate?.(20); } };
export const ImpactStyle = { Light: "LIGHT", Medium: "MEDIUM", Heavy: "HEAVY" };
export const NotificationType = { Success: "SUCCESS", Warning: "WARNING", Error: "ERROR" };
export const Browser = { open({ url }) { location.href = url; }, close() {} };
export const Purchases = {};
""")
imports = {"@supabase/supabase-js": SUPABASE_JS}
for m in ["core", "app", "push-notifications", "haptics", "browser"]: imports[f"@capacitor/{m}"] = "./cap-web.js"
imports["@revenuecat/purchases-capacitor"] = "./cap-web.js"
importmap = json.dumps({"imports": imports}, indent=1)
h = base64.b64encode(hashlib.sha256(importmap.encode()).digest()).decode()
sb_host = URL.replace("https://", "")
csp = ("default-src 'self'; "
       f"script-src 'self' https://cdn.jsdelivr.net https://analytics.tiktok.com 'sha256-{h}'; "
       "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; "
       f"img-src 'self' data: blob: https://{sb_host} https://play.google.com https://*.tiktok.com; media-src 'self'; "
       f"connect-src 'self' https://{sb_host} wss://{sb_host} https://cdn.jsdelivr.net https://*.tiktok.com")
(APP / "index.html").write_text(f"""<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#160b26">
  <meta http-equiv="Content-Security-Policy" content="{csp}">
  <title>Tinted · Play first. See later.</title>
  <meta name="description" content="Get paired blind. Play one 90-second bubble duel together, and every heart you free clears a little more of their photo.">
  <meta property="og:title" content="Tinted"><meta property="og:description" content="Play first. See later.">
  <meta property="og:image" content="{SITE}/app/src/brand/logo.webp">
  <link rel="icon" href="src/brand/logo-256.webp">
  <link rel="canonical" href="{SITE}/app/">
  <meta property="og:url" content="{SITE}/app/">
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="apple-touch-icon" href="src/brand/icons/apple-touch-icon.png">
  <meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="Tinted">
  <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fredoka:wght@300..700&family=Leckerli+One&display=swap">
  <link rel="stylesheet" href="src/styles.css">
  <script src="env.js"></script>
  <script type="importmap">{importmap}</script>
</head>
<body>
  <main id="app" aria-live="polite"></main>
  <div id="toast" role="status" hidden></div>
  <script type="module" src="src/main.js"></script>
</body>
</html>
""")
(APP / "manifest.webmanifest").write_text(json.dumps({
    "name": "Tinted", "short_name": "Tinted", "description": "Play first. See later. Meet someone over a 90-second bubble duel before you see their face.",
    "start_url": "/app/", "scope": "/app/", "display": "standalone", "orientation": "portrait",
    "background_color": "#160b26", "theme_color": "#160b26", "categories": ["social", "games", "lifestyle"],
    "icons": [
        {"src": "src/brand/icons/icon-192.png", "sizes": "192x192", "type": "image/png"},
        {"src": "src/brand/icons/icon-512.png", "sizes": "512x512", "type": "image/png"},
        {"src": "src/brand/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}]}, indent=1))
# One official address: send the old netlify.app address (and www) to playtinted.com, permanently.
(OUT / "_redirects").write_text(
    "https://playtinted.netlify.app/* https://playtinted.com/:splat 301!\n"
    "https://www.playtinted.com/* https://playtinted.com/:splat 301!\n"
    "/play /app/try.html 200\n"
    "/about.html / 301\n")
(OUT / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {SITE}/sitemap.xml\n")
(OUT / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + "".join(f"  <url><loc>{SITE}/{p}</loc></url>\n" for p in ["", "play", "app/", "privacy.html", "terms.html"]) + "</urlset>\n")
(OUT / "_headers").write_text("/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n/app/src/brand/*\n  Cache-Control: public, max-age=604800\n/assets/*\n  Cache-Control: public, max-age=604800\n")
# Fill in who runs Tinted and how to reach them (the legal pages ship with placeholders).
COMPANY, SUPPORT = "Tinted", "hello@playtinted.com"
for page in ["privacy.html", "terms.html", "delete-account.html"]:
    f = OUT / page; f.write_text(f.read_text().replace("__COMPANY__", COMPANY).replace("__SUPPORT_EMAIL__", SUPPORT))
# Every static page states its official address too.
for page in ["privacy.html", "terms.html", "delete-account.html"]:
    f = OUT / page; h = f.read_text()
    if 'rel="canonical"' not in h:
        h = h.replace("<head>", f'<head>\n<link rel="canonical" href="{SITE}/{page}">', 1)
    f.write_text(h)
print("Built", OUT)

# TikTok Pixel (consent-gated) in the <head> of every page.
shutil.copy(ROOT / "site" / "tt.js", OUT / "tt.js")
for f in OUT.rglob("*.html"):
    h = f.read_text()
    if "/tt.js" not in h:
        h = re.sub(r"(<head[^>]*>)", r'\1\n<script src="/tt.js"></script>', h, count=1)
        f.write_text(h)
