// Permanently deletes the signed-in user: their photos in storage, then the auth user.
// Every table row cascades from auth.users. Used by the in-app button and the web deletion page.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: { user } } = await admin.auth.getUser(jwt);
  if (!user) return json({ error: "Sign in again" }, 401);

  // Photos live at <user>/<photo>/{g1,g2,g3,full}.jpg
  const bucket = admin.storage.from("photos");
  const { data: dirs } = await bucket.list(user.id, { limit: 100 });
  const paths: string[] = [];
  for (const d of dirs ?? []) {
    const { data: inner } = await bucket.list(`${user.id}/${d.name}`, { limit: 10 });
    for (const f of inner ?? []) paths.push(`${user.id}/${d.name}/${f.name}`);
  }
  if (paths.length) await bucket.remove(paths);

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return json({ error: error.message }, 500);
  return json({ deleted: true });
});
