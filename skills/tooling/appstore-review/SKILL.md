---
name: appstore-review
description: Audit an entire iOS/iPadOS app project (native Swift/Objective-C, React Native/Expo, Flutter, Capacitor) the way an Apple App Store reviewer would, and write a report document listing every rejection risk and optimization found, each with evidence (file and line), the relevant App Store Review Guideline, severity and a concrete fix. Changes no code. Use when asked to check App Store readiness, find rejection reasons, prepare a submission, respond to a rejection, or review an app against Apple's guidelines.
---

# Apple App Store review audit

You act as an App Store reviewer auditing the **whole project**, not a diff. The deliverable is a **report document** that lists **every issue found**, so the team can fix them before submitting and track each one to closure.

## Contract

- **Change no code, config or metadata.** This is an audit. Read files and run read-only commands only. Fixes happen afterwards, and only when the user asks (then use the `plan-feature` flow if it is installed).
- **Cover everything** in [references/audit-checklist.md](references/audit-checklist.md). A section with no issues is still reported as checked.
- **Every finding has evidence.** Cite `path:line` (or the missing file / missing key). No evidence, no finding. If something cannot be verified from the repository (App Store Connect metadata, screenshots, server behaviour, review notes), record it under *Unverifiable – confirm manually*, not as a finding.
- **Guidelines change.** Reference guidelines by section number and topic (for example "5.1.1(v) Account deletion"). If you have web access, check the current wording at https://developer.apple.com/app-store/review/guidelines/ before quoting; otherwise say the reference should be confirmed. Never invent a guideline number.

## When to use

- "Is this app ready for the App Store?", "check for rejection risks", "audit before submission".
- The app was rejected and the user wants every related and unrelated risk found in one pass.
- Before a major release, a new monetization model (subscriptions, IAP), adding login, tracking, user-generated content, or a kids audience.

## Workflow

### 1. Identify the app and its stack

Find out what you are reviewing and record it in the report header:

| Stack | Where the iOS app lives |
|---|---|
| Native Swift / Objective-C | `*.xcodeproj`, `*.xcworkspace`, `Package.swift`, `Podfile` at repo root or under `ios/` |
| React Native (bare) | `ios/` with `Podfile`, `ios/<App>/Info.plist`, JS in `src/` or `app/` |
| Expo (managed / prebuild) | `app.json` / `app.config.(js|ts)` (`ios.infoPlist`, `ios.entitlements`, `ios.privacyManifests`, plugins), `eas.json`; `ios/` may be generated and git-ignored |
| Flutter | `ios/Runner/Info.plist`, `ios/Runner/*.entitlements`, `ios/Podfile`, `pubspec.yaml`, Dart in `lib/` |
| Capacitor / Cordova / Ionic | `ios/App/App/Info.plist`, `capacitor.config.*`, `config.xml` |

Collect: bundle identifier, display name, version and build, deployment target, devices (iPhone, iPad), capabilities and entitlements, background modes, SDKs and third-party packages, monetization (IAP, subscriptions, ads, external payments), login methods, data collected, whether the app has user-generated content, a kids audience, health, finance, gambling, VPN, crypto or other regulated features.

For Expo or other generated `ios/` folders, audit the **source of truth** (`app.json`/config plugins) and mention that the generated project must be rebuilt.

### 2. Inventory the project

List the files you will inspect (and say which were not found):

- `Info.plist` (all targets, including extensions and widgets), `*.entitlements`, `PrivacyInfo.xcprivacy` (app and extensions), `*.storekit`, `GoogleService-Info.plist`, launch screen / storyboard, asset catalogs (`AppIcon`).
- Build settings: `project.pbxproj` (deployment target, `TARGETED_DEVICE_FAMILY`, signing, bitcode leftovers), `Podfile` / `Podfile.lock`, `Package.resolved`, `pubspec.lock`, `package.json` lockfile.
- Source: login, onboarding, paywall/purchase, account/settings screens, permission requests, analytics/ads/tracking setup, web views, deep links, push notifications, networking (ATS exceptions), crash/debug menus, feature flags, hard-coded URLs and credentials.
- Metadata in repo if present: `fastlane/metadata/`, `fastlane/screenshots/`, `Deliverfile`, release notes, privacy policy URL.

### 3. Audit against the checklist

Work through every section of [references/audit-checklist.md](references/audit-checklist.md): app completeness, metadata, privacy and permissions, privacy manifests and required-reason APIs, tracking (ATT), login and account deletion, payments and IAP, subscriptions, user-generated content, kids, design and minimum functionality, performance and stability, legal, technical requirements (APIs, encryption export, background modes, ATS, IPv6, SDK versions), and regulated categories.

Useful read-only searches (adapt to the stack):

```bash
# permission purpose strings present?
grep -rn "UsageDescription" --include=Info.plist --include=app.json --include="app.config.*" .
# APIs that require a privacy-manifest reason
grep -rnE "UserDefaults|NSFileCreationDate|NSFileModificationDate|systemUptime|mach_absolute_time|volumeAvailableCapacity|activeInputModes|creationDate|modificationDate" --include=*.swift --include=*.m .
# tracking / IDFA / third-party SDKs
grep -rnE "AppTrackingTransparency|ATTrackingManager|advertisingIdentifier|IDFA|FBSDK|AppsFlyer|Adjust|GoogleMobileAds|Firebase" .
# purchases and external payment links
grep -rnE "StoreKit|SKProduct|Product\.products|RevenueCat|Purchases|stripe|paypal|checkout|buy now|subscribe" -i .
# login providers and account deletion
grep -rnE "GIDSignIn|GoogleSignIn|FBLogin|ASAuthorizationAppleID|signInWithApple|deleteAccount|delete account" -i .
# ATS exceptions, debug code, placeholder content
grep -rnE "NSAllowsArbitraryLoads|NSExceptionDomains|lorem ipsum|TODO|FIXME|coming soon|beta|test@|localhost|staging" -i .
```

For each potential issue, confirm it by reading the surrounding code. Classify severity:

| Severity | Meaning |
|---|---|
| **Blocker** | Very likely rejection or removal (missing account deletion, digital goods sold outside IAP, crash on launch, missing purpose string for a requested permission, missing privacy manifest reasons, tracking without ATT, private API use). |
| **High** | Likely rejection depending on reviewer and flow (missing restore purchases, unclear subscription terms, broken or placeholder content, login wall without justification, missing demo account info). |
| **Medium** | Possible rejection or a common follow-up request (weak purpose strings, iPad layout issues on a universal app, missing UGC reporting UI). |
| **Low** | Optimization, trust or quality improvement (onboarding clarity, metadata keywords, review-prompt timing). |

### 4. Write the report

Create `docs/reviews/YYYY-MM-DD-appstore-review.md` (or the project's existing reports folder) using [references/report-template.md](references/report-template.md). It must contain:

1. Header: app, stack, version/build, bundle id, scope, date, verdict.
2. Executive summary: verdict (*Ready* / *Ready after fixes* / *Not ready*), counts per severity, the top 3 risks.
3. **Issue register: every issue**, one row each, with ID (`ASR-001`...), severity, area, guideline, evidence (`path:line`), status `Open`. Then one detail section per issue: what is wrong, why a reviewer would reject it, evidence excerpt, the concrete fix (code/config/metadata), effort (S/M/L), and how to verify the fix.
4. Checklist coverage: every checklist section marked *Issues found*, *Passed* or *Not applicable*, with one line of justification.
5. *Unverifiable – confirm manually*: items that depend on App Store Connect, screenshots, servers or review notes.
6. Submission prep: App Review notes to provide (demo account, feature explanations, hardware needed), privacy "nutrition label" answers implied by the code, and suggested release order of fixes.

Do not merge different problems into one issue, and do not drop low-severity findings: the report is the complete list.

### 5. Hand off

Print the executive summary and the issue register table in chat, give the report path, and ask whether to start fixing (and in which order). Do not edit any file until the user says so.

## Pitfalls

- Auditing only the Swift code of a React Native/Flutter/Expo app; most risks live in config (`app.json`, plugins, `Info.plist`) and in the JS/Dart flows.
- Missing extensions: widgets, notification service and share extensions have their own `Info.plist` and privacy manifests.
- Third-party SDKs: a commonly used SDK may require its own privacy manifest and signature; check versions in lockfiles.
- Treating "Sign in with Apple" as always mandatory. The rule on equivalent login options has changed over time; state the current requirement only after checking the guideline text.
- Reporting rules for external purchase links as universal; they differ by storefront/region and have changed recently. Flag them as "verify for target storefronts".
- Quoting Xcode or SDK minimum versions from memory; Apple updates these yearly. Say "check the current upload requirements".

## References

- [references/audit-checklist.md](references/audit-checklist.md): every area to audit, with what to look for.
- [references/report-template.md](references/report-template.md): the report document structure.
- App Store Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Privacy manifest files: https://developer.apple.com/documentation/bundleresources/privacy-manifest-files
- Required reason APIs: https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api
- App privacy details: https://developer.apple.com/app-store/app-privacy-details/
- Offering account deletion: https://developer.apple.com/support/offering-account-deletion-in-your-app/
- Upcoming requirements: https://developer.apple.com/news/upcoming-requirements/
- Inspired by `github/awesome-copilot` skill `apple-appstore-reviewer` (MIT).
