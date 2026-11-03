# Tinted

You're paired blind. You see a first name, age, town, one line and a frosted photo. Everything else is earned by playing 90-second bubble duels together:

1. **Glimpse.** Duel 1. Each heart you pop unlocks one of their six reveals and clears their photo a step. No free chat yet, only quick questions during duels.
2. **Chatting.** If you both choose Keep going, chat opens and you play duel 2.
3. **Revealed.** Keep going again and you see every photo, their bio and all six reveals. Rematch any time.

Either person choosing Pass ends the match quietly. Duels can be played at different times; if you're both playing at once, scores show live.

Android app (Capacitor) on a Supabase backend.

## What's in here

| Path | What it is |
| --- | --- |
| `shared/engine.js` | The bubble game. Deterministic: the same seed and shots always give the same score. |
| `src/` | The app: sign-in, profile, find a match, matches, match page (stages, reveals, chat), duel, settings. |
| `supabase/migrations/` | Database, security rules, pairing queue, stages, photo levels, duel logic. |
| `supabase/functions/` | `finish-duel` (re-checks scores), `delete-account`, `notify` (push), `moderate-photo`, `revenuecat-webhook` (subscriptions). |
| `site/` | Privacy policy, terms, account deletion page. Published to GitHub Pages. |
| `.github/workflows/` | `android.yml` builds the signed .aab, `backend.yml` deploys Supabase, `pages.yml` publishes `site/`. |
| `tests/` | Engine replay test (runs in every build). |

## Setup, in order

You do these once. Each needs your own account, so they can't be automated.

### 1. GitHub
1. Create a **private** repo called `pop-the-question` and push this folder to it.
2. Settings → Pages → Source: **GitHub Actions**.
3. Settings → Secrets and variables → Actions → **Variables**: add `COMPANY_NAME` (e.g. `Eden OS and Refinery Ltd`) and `SUPPORT_EMAIL`.
4. Run **Publish legal pages** from the Actions tab. Your pages will be at `https://<your-github-name>.github.io/pop-the-question/`. That address is your `LEGAL_BASE_URL`.

### 2. Supabase
**Already done for the live project** (`bdycrgfnxafpczhpxveh`, London): schema, security rules, photo store, triggers, hourly clean-up, all five server functions, and the function lock-down. The database-to-function secret lives in Supabase Vault and needs no setup. The steps below are for setting up a fresh project from scratch.

1. Create a project at supabase.com. Pick the London region.
2. Project Settings → API: copy the **Project URL** and **anon public** key.
3. Authentication → Sign In / Providers → Email: keep email on, and turn **Confirm email** on.
4. Authentication → Email Templates → **Magic Link**: replace the body so it sends a code, e.g. `Your Tinted code is {{ .Token }}`.
5. Authentication → SMTP: connect a real email sender (Resend, Postmark or similar). Supabase's built-in sender is rate-limited and only meant for testing.
6. Add the GitHub secrets `SUPABASE_ACCESS_TOKEN` (from your Supabase account tokens page), `SUPABASE_PROJECT_REF` (the ID in your project URL) and `SUPABASE_DB_PASSWORD`, then run **Deploy backend** from the Actions tab.
7. Edge Functions → Secrets: add `WEBHOOK_SECRET` (any long random string). Add `FIREBASE_SERVICE_ACCOUNT` after step 3, and `SIGHTENGINE_USER` / `SIGHTENGINE_SECRET` if you use Sightengine.
8. Database → Webhooks, create these, each type **Supabase Edge Functions**, method POST, with an HTTP header `x-webhook-secret` set to your `WEBHOOK_SECRET`:
   - `photos` INSERT → `moderate-photo`
   - `messages` INSERT → `notify`
   - `matches` INSERT and UPDATE → `notify` (paired, chat open, revealed)
   - `duels` UPDATE → `notify` (results are in)
   - `duel_results` UPDATE → `notify` (your turn)
9. Database → Extensions: enable **pg_cron**, then in the SQL editor run `select cron.schedule('expire-stale', '0 * * * *', 'select public.expire_stale()');` so unplayed duels close after 48 hours.

Without Sightengine keys, new photos stay **pending**. Approve them in Table Editor → `photos` by setting `status` to `approved`. Review `reports` there too.

### 3. Firebase (push notifications)
1. Create a Firebase project, add an **Android app** with package name `com.edenos.tinted`.
2. Download `google-services.json`, base64 it (`base64 -w0 google-services.json`), and save it as the GitHub secret `GOOGLE_SERVICES_JSON_B64`.
3. Project settings → Service accounts → **Generate new private key**. Paste the whole JSON as the Supabase function secret `FIREBASE_SERVICE_ACCOUNT`.

The package name `com.edenos.tinted` is permanent once the app is on Google Play. Change it in `capacitor.config.json` and Firebase now if you want a different one.

### 4. Signing key
Run this once on your own computer (it needs Java) and keep the file and passwords somewhere safe. If you lose it you need Google support to reset it.
```
keytool -genkeypair -v -keystore upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```
Add GitHub secrets: `ANDROID_KEYSTORE_B64` (`base64 -w0 upload.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`upload`), `ANDROID_KEY_PASSWORD`.

### 5. Build
Add the GitHub secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `LEGAL_BASE_URL`, then run **Android build**. Download the `.aab` from the run's Artifacts. To try it on your phone first, use Play Console's internal testing track.

The app icon and launch screen come from `resources/` (icon.png, splash.png). After `npx cap add android`, run `npm run assets` once to generate every Android size from them. The animated intro is `src/brand/splash.mp4`; swap the file to change it.

### 6. Google Play
1. Create the developer account and pass identity verification.
2. Create the app, then upload the .aab to **Closed testing**. Enrol Play App Signing when asked (your `upload.jks` is the upload key).
3. Fill in: privacy policy URL (`LEGAL_BASE_URL/privacy.html`), account deletion URL (`LEGAL_BASE_URL/delete-account.html`), Data safety form, content rating questionnaire, target audience **18+**, and app category **Dating**.
4. Personal developer accounts need **12+ testers opted in for 14 days in a row** before you can apply for production.
5. Apply for production access from the Play Console dashboard.

### 7. Subscriptions (Tinted Plus)
Plus = 3 matches at once (free accounts get 1) and first in line when pairing. Google requires subscriptions sold inside the app to go through Google Play's billing, so payment is taken by Google Play; RevenueCat keeps track of who's subscribed and tells the server.

1. **Play Console → Settings → Payments profile.** Set up a payments profile so you can sell. Google pays out monthly.
2. **Upload a build first.** Play Console only allows subscription products once a build containing the billing library has been uploaded (any testing track is fine).
3. **Monetise → Products → Subscriptions.** Create a subscription with product ID `plus`, then two base plans: `monthly` (renews every month) and `yearly` (renews every year). Set prices; the demo shows £9.99 and £59.99 as examples. Activate both.
4. **RevenueCat** (free until you pass their revenue threshold): create a project, add an Android app with package `com.edenos.tinted`, and connect your Google Play service account by following RevenueCat's Google Play setup guide.
   - Products: import `plus:monthly` and `plus:yearly`.
   - Entitlements: create one called `plus` and attach both products.
   - Offerings: make the `default` offering current, with a Monthly package and an Annual package.
5. **Keys.** RevenueCat → API keys: put the public Google Play key (starts `goog_`) in the GitHub secret `REVENUECAT_ANDROID_KEY`, and a secret API key in the Supabase function secret `REVENUECAT_SECRET_KEY`.
6. **Webhook.** RevenueCat → Integrations → Webhooks: URL `https://<project-ref>.supabase.co/functions/v1/revenuecat-webhook`, and set the Authorization header to a long random string. Save the same string as the Supabase function secret `REVENUECAT_WEBHOOK_AUTH`.
7. **Test.** Add your Google account under Play Console → Settings → License testing. Test purchases on that account are free and renew every few minutes, so you can watch renewals and expiry happen.
8. **Data safety form.** Declare "Purchase history" as collected, for app functionality.

The server decides what Plus unlocks (`is_plus` and `match_limit` in the database), so a tampered app can't grant itself Plus. If someone's Plus lapses, their existing matches carry on; they just can't start new ones beyond the free limit.

## Running locally
```
cp .env.example .env    # fill in SUPABASE_URL and SUPABASE_ANON_KEY
npm install
npm test
npm run build           # outputs www/
npx cap add android && npx cap open android   # needs Android Studio
```

## How it works underneath
1. **Pairing.** `find_match` pairs you with the longest-waiting compatible person (gender, age range both ways, never matched before, not blocked) or puts you in the queue. Up to 3 matches at once. A new match opens duel 1.
2. **Playing.** Tapping Play calls `start_duel`, which records your start time and returns the board seed. Your phone plays 90 seconds; if the other person is on the realtime channel `duel-<id>` at the same time, scores show live.
3. **Reveals.** Each heart calls `reveal_fact`, which unlocks their next fact. 2 hearts → photo version g2, 4 → g3, full reveal → the original.
4. **Scoring.** At the end, your shot angles go to `finish-duel`, which replays them with the seed. Only the replayed score counts. When both have played, the duel closes.
5. **Deciding.** Each calls `decide`. Both keep → next stage; either passes → the match ends.

## How photos stay private
Each photo is uploaded four times by the owner's phone: three blurred copies (`g1` heaviest, `g2`, `g3`) and the original (`full`). Storage rules let a match download only the copy their progress allows, so the blur can't be bypassed by inspecting the app.

## Before you launch
- Get a solicitor to review `site/privacy.html` and `site/terms.html`, and to check your Online Safety Act duties for user-to-user chat.
- Decide who reviews reports and how fast. Underage reports should be actioned the same day.
