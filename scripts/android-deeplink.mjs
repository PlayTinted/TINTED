// Adds the sign-in return link (com.playtinted.app://auth-callback) to the Android manifest. Safe to re-run.
import { readFileSync, writeFileSync } from "node:fs";
const p = "android/app/src/main/AndroidManifest.xml";
let x = readFileSync(p, "utf8");
if (!x.includes('android:scheme="com.playtinted.app"')) {
  const filter = `
            <intent-filter android:autoVerify="false">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="com.playtinted.app" android:host="auth-callback" />
            </intent-filter>`;
  x = x.replace(/(<activity[\s\S]*?android:name="\.MainActivity"[\s\S]*?>)/, `$1${filter}`);
  writeFileSync(p, x);
  console.log("Added sign-in deep link to AndroidManifest.xml");
}
