// Bundles the app into www/ and copies the shared engine to the edge functions.
// SUPABASE_URL and SUPABASE_ANON_KEY come from the environment (GitHub secrets in CI, a .env file locally).
import { build } from "esbuild";
import { mkdirSync, copyFileSync, readFileSync, existsSync } from "node:fs";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
// Live project (London). These are public values: every copy of the app carries them, and the
// database's row-level security is what protects data. Override with SUPABASE_URL / SUPABASE_ANON_KEY.
const url = process.env.SUPABASE_URL || "https://bdycrgfnxafpczhpxveh.supabase.co";
const key = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJkeWNyZ2ZueGFmcGN6aHB4dmVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxMTE3MTAsImV4cCI6MjEwODY4NzcxMH0.58hGzP4RCM-5t_qowtWcbXRbN3hbV21XEdOGZ5DztpE";

mkdirSync("www", { recursive: true });
copyFileSync("shared/engine.js", "supabase/functions/finish-duel/engine.js");
copyFileSync("src/index.html", "www/index.html");
mkdirSync("www/brand", { recursive: true });
for (const f of ["logo.webp", "logo-256.webp", "welcome.jpg", "splash.mp4", "splash-poster.webp", "gameplay.mp4", "gameplay-poster.webp"]) copyFileSync(`src/brand/${f}`, `www/brand/${f}`);

await build({
  entryPoints: ["src/main.js"],
  bundle: true,
  minify: true,
  format: "esm",
  target: ["chrome100"],
  outfile: "www/app.js",
  define: {
    __SUPABASE_URL__: JSON.stringify(url),
    __SUPABASE_ANON_KEY__: JSON.stringify(key),
    // Where privacy.html, terms.html and delete-account.html are hosted (GitHub Pages by default).
    __LEGAL_BASE__: JSON.stringify((process.env.LEGAL_BASE_URL || "").replace(/\/$/, "")),
    // RevenueCat's public Google Play key (safe to ship in the app). Empty = subscriptions hidden.
    __REVENUECAT_KEY__: JSON.stringify(process.env.REVENUECAT_ANDROID_KEY || ""),
  },
});
// Fonts + styles into one stylesheet, font files copied next to it.
await build({
  stdin: { contents: '@import "./src/fonts.css";\n@import "./src/styles.css";', resolveDir: ".", loader: "css" },
  bundle: true,
  minify: true,
  outfile: "www/styles.css",
  loader: { ".woff2": "file", ".woff": "file" },
  assetNames: "fonts/[name]-[hash]",
});
console.log(`Built www/ for ${url} and copied the engine into supabase/functions/finish-duel.`);
