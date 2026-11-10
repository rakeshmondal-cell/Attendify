# Attendify — first working journey

One shared API, an HR web portal, and an Android employee app.

Locked product rules from the design review:

- Manager approvals stay on the HR website. The Android app is employee-only.
- First-time activation: work email OTP → enable fingerprint with BiometricPrompt CryptoObject → register device key.
- Later logins: fingerprint unlocks the registered phone key (CryptoObject) → confirm registered email → OTP.
- The app never stores fingerprint images. Android Keystore keeps the private key; fingerprint only unlocks signing.
- Lost phone / new device recovery asks HR to reset the registered device, then activate again.
- Biometric lockout and fingerprint-enrollment changes force recovery through HR.

## First milestone

HR creates an employee and assigns a shift → employee activates and checks in → HR sees the record → employee checks out → both sides show the same hours.

## Employee roster

The MSR employee list lives in:

- `documentation/data/employee-list.xlsx`
- `documentation/data/employees.json` (importable copy)

Load or refresh employees into the running API:

```bash
cd backend
npm run import:employees
```

Skipped Excel rows today:

- `MSR240` Sumita Mukherjee — no company email
- `MSR941` Kajal Tiwari — shares `accounts@msrlimited.com` with `MSR939`

## Folders

- `backend/` — Node.js + Express + MySQL attendance API
- `hr-web/` — React HR portal
- `android-app/` — Kotlin Jetpack Compose employee app

## Run the API

Requires MySQL 8. Copy `backend/.env.example` to `backend/.env` and set credentials. Defaults:

- database: `attendify`
- user: `attendify`
- password: `Attendify_Dev_2026!`

```bash
cd backend
npm install
npm start
```

API: `http://localhost:4000`

Seeded HR account: `hr@attendify.local`

OTP emails are sent through Gmail SMTP (`MAIL_*` in `backend/.env`, from `maintenance@msrlimited.com`).

For local testing, `ATTENDIFY_SHOW_OTP=true` also returns `devCode` in the API response. Set it to `false` for email-only delivery.

## Run the HR portal

```bash
cd hr-web
npm install
npm run dev
```

Open `http://127.0.0.1:5173`

## Run the Android app

Open `android-app/` in Android Studio, sync Gradle, then run on an emulator.

The app talks to `http://10.0.2.2:4000` (the host machine from the Android emulator).

On a physical phone, change `API_BASE` in `android-app/app/build.gradle.kts` to your PC’s LAN IP and keep the API reachable.

Allow location when asked. Check-in/out works from **anywhere** (office or work-from-home). The phone must provide GPS with accuracy ≤ 100 m plus a **full street address** (reverse geocode) and Google **Maps / Street View** links, which HR can open from the attendance report.

## Verify the shared hours

With the API running:

```bash
cd backend
npm run journey
```

That script creates an employee, assigns today’s General shift, activates a device key, checks in and out, and asserts the employee and HR hours match.

## Notes for the next slices

Breaks, leave, correction forms, roster, notifications, and reports are intentionally out of this first cut.
