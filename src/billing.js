// Subscriptions through Google Play Billing, via RevenueCat.
// Google Play takes the payment. RevenueCat tells our server (revenuecat-webhook), and the server decides
// what Plus unlocks, so the app can't be tricked into granting it.
import { Capacitor } from "@capacitor/core";
import { Purchases } from "@revenuecat/purchases-capacitor";
import { me, rpc } from "./supa.js";

/* global __REVENUECAT_KEY__ */
const KEY = __REVENUECAT_KEY__;
const ENTITLEMENT = "plus";
const PLAY_SUBSCRIPTIONS = "https://play.google.com/store/account/subscriptions?package=com.playtinted.app";

// The investor demo swaps in a pretend store (window.__demoBilling).
const store = () => globalThis.__demoBilling || Purchases;
export const billingAvailable = () => !!globalThis.__demoBilling || (Capacitor.isNativePlatform() && !!KEY);

let configuredFor = null;
export async function initBilling() {
  if (!billingAvailable() || !me.id || configuredFor === me.id) return;
  if (configuredFor) await store().logIn({ appUserID: me.id });
  else await store().configure({ apiKey: KEY, appUserID: me.id });
  configuredFor = me.id;
}

export async function signOutBilling() {
  if (!configuredFor) return;
  try { await store().logOut(); } catch { /* already anonymous */ }
  configuredFor = null;
}

const money = (amount, currency) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amount);

// The plans on sale, as set up in Google Play Console and RevenueCat's "current" offering.
export async function getPlans() {
  await initBilling();
  const offerings = await store().getOfferings();
  const pkgs = offerings?.current?.availablePackages ?? [];
  return pkgs
    .filter((p) => ["ANNUAL", "MONTHLY"].includes(p.packageType))
    .map((p) => ({
      id: p.identifier,
      period: p.packageType === "ANNUAL" ? "year" : "month",
      price: p.product.priceString,
      perMonth: p.packageType === "ANNUAL" ? money(p.product.price / 12, p.product.currencyCode) : null,
      raw: p,
    }))
    .sort((a, b) => (a.period === "year" ? 0 : 1) - (b.period === "year" ? 0 : 1)); // annual first
}

// Our server's view of your plan (the one that counts).
export const myPlan = async () => (await rpc("my_plan"))?.[0] ?? { plus: false, match_limit: 1 };

// Wait for the payment to reach our server (usually a few seconds).
async function confirmed(timeoutMs = 20000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const plan = await myPlan().catch(() => null);
    if (plan?.plus) return plan;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

const cancelled = (e) => e?.userCancelled || e?.code === "1" || e?.code === "PURCHASE_CANCELLED" || /cancel/i.test(e?.message || "");

// Returns "subscribed", "pending" (paid, server not caught up yet), or "cancelled". Throws on real errors.
export async function subscribe(plan) {
  await initBilling();
  try {
    const { customerInfo } = await store().purchasePackage({ aPackage: plan.raw });
    if (!customerInfo?.entitlements?.active?.[ENTITLEMENT]) throw new Error("Google Play didn't confirm the purchase. You haven't been charged twice; try again or restore.");
  } catch (e) {
    if (cancelled(e)) return "cancelled";
    throw e;
  }
  return (await confirmed()) ? "subscribed" : "pending";
}

export async function restore() {
  await initBilling();
  const { customerInfo } = await store().restorePurchases();
  if (!customerInfo?.entitlements?.active?.[ENTITLEMENT]) return false;
  return !!(await confirmed(12000));
}

export async function manageUrl() {
  try {
    await initBilling();
    const { customerInfo } = await store().getCustomerInfo();
    return customerInfo?.managementURL || PLAY_SUBSCRIPTIONS;
  } catch { return PLAY_SUBSCRIPTIONS; }
}
