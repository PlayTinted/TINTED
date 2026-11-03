// Screens a new profile photo (the full-resolution version). Triggered by a database webhook on INSERT into public.photos.
// With SIGHTENGINE_USER / SIGHTENGINE_SECRET set, photos are checked automatically.
// Without them, photos stay "pending" and you approve them in the Supabase table editor.
// Check Sightengine's current API docs before launch: model names and response fields can change.
import { createClient } from "npm:@supabase/supabase-js@2";

const LIMITS = { nudity: 0.5, offensive: 0.5, gore: 0.5, minor: 0.3 };


// Calls from the database carry a secret it generated and keeps in Supabase Vault.
async function fromDatabase(req: Request, admin: any) {
  const s = req.headers.get("x-webhook-secret");
  if (!s) return false;
  const { data } = await admin.rpc("check_webhook_secret", { s });
  return data === true;
}

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (!(await fromDatabase(req, admin))) return new Response("Forbidden", { status: 403 });
  const { record } = await req.json();
  const user = Deno.env.get("SIGHTENGINE_USER");
  const secret = Deno.env.get("SIGHTENGINE_SECRET");
  if (!record?.dir || !user || !secret) return new Response("left pending");

  const { data: signed } = await admin.storage.from("photos").createSignedUrl(`${record.dir}/full.jpg`, 300);
  if (!signed?.signedUrl) return new Response("no file", { status: 404 });

  const q = new URLSearchParams({
    url: signed.signedUrl,
    models: "nudity-2.1,offensive-2.0,gore-2.0,face-attributes",
    api_user: user,
    api_secret: secret,
  });
  const res = await fetch(`https://api.sightengine.com/1.0/check.json?${q}`);
  const out = await res.json();
  if (out.status !== "success") return new Response("moderation failed, left pending", { status: 502 });

  const n = out.nudity ?? {};
  const nudity = Math.max(n.sexual_activity ?? 0, n.sexual_display ?? 0, n.erotica ?? 0);
  const offensive = Math.max(...Object.values(out.offensive ?? { x: 0 }).filter((v) => typeof v === "number") as number[]);
  const gore = out.gore?.prob ?? 0;
  const minor = Math.max(0, ...((out.faces ?? []).map((f: any) => f.attributes?.minor ?? 0)));
  const ok = nudity < LIMITS.nudity && offensive < LIMITS.offensive && gore < LIMITS.gore && minor < LIMITS.minor;

  await admin.from("photos").update({ status: ok ? "approved" : "rejected" }).eq("id", record.id);
  return new Response(ok ? "approved" : "rejected");
});
