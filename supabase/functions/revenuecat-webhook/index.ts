// Keeps public.subscriptions in step with Google Play, via RevenueCat.
// RevenueCat calls this on every purchase, renewal, cancellation, billing problem, refund or expiry.
// Rather than trust the event's own fields, we ask RevenueCat for the customer's current state and store that,
// so out-of-order or repeated events can't leave someone with the wrong access.
//
// Secrets: REVENUECAT_WEBHOOK_AUTH (the Authorization value you set on the webhook in RevenueCat)
//          REVENUECAT_SECRET_KEY  (a secret API key from RevenueCat → Project settings → API keys)
import { createClient } from "npm:@supabase/supabase-js@2";

const ENTITLEMENT = "plus";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function syncUser(admin: ReturnType<typeof createClient>, userId: string) {
  const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${Deno.env.get("REVENUECAT_SECRET_KEY")}` },
  });
  if (!res.ok) throw new Error(`RevenueCat lookup failed (${res.status}) for ${userId}`);
  const { subscriber } = await res.json();
  const ent = subscriber?.entitlements?.[ENTITLEMENT];
  const sub = ent ? subscriber.subscriptions?.[ent.product_identifier] : null;
  const expires = ent?.expires_date ? new Date(ent.expires_date) : null;
  const live = ent && (!expires || expires.getTime() > Date.now());

  let status = "expired";
  if (sub?.refunded_at) status = "refunded";
  else if (live && sub?.billing_issues_detected_at) status = "grace";
  else if (live && sub?.unsubscribe_detected_at) status = "cancelled";
  else if (live) status = "active";

  const { data: profile } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
  if (!profile) return; // account deleted, nothing to store

  await admin.from("subscriptions").upsert({
    user_id: userId,
    entitlement: ENTITLEMENT,
    status,
    product_id: ent?.product_identifier ?? null,
    store: sub?.store ?? null,
    expires_at: expires ? expires.toISOString() : null,
    will_renew: status === "active" || status === "grace",
    updated_at: new Date().toISOString(),
  });
}

Deno.serve(async (req) => {
  if (req.headers.get("Authorization") !== Deno.env.get("REVENUECAT_WEBHOOK_AUTH")) {
    return new Response("Forbidden", { status: 403 });
  }
  const { event } = await req.json();
  if (!event || event.type === "TEST") return new Response("ok");

  // Everyone this event touches: the buyer, plus both sides of a transfer.
  const ids = new Set<string>([event.app_user_id, event.original_app_user_id, ...(event.aliases ?? []),
    ...(event.transferred_from ?? []), ...(event.transferred_to ?? [])].filter((x) => typeof x === "string" && UUID.test(x)));

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    for (const id of ids) await syncUser(admin, id);
    return new Response("ok");
  } catch (e) {
    // A non-2xx makes RevenueCat retry later.
    return new Response(String((e as Error).message), { status: 500 });
  }
});
