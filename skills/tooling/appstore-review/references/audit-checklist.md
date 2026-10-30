# App Store audit checklist

Check every section. Guideline numbers are given for orientation; confirm current wording at https://developer.apple.com/app-store/review/guidelines/ before quoting.

## 1. App completeness (2.1)
- Placeholder text, "coming soon", lorem ipsum, empty states that look broken, test/staging endpoints, debug menus reachable in release builds.
- Features that require login: is a demo account or review mode possible? Note what the review notes must contain.
- Crashes or hard failures at launch without network; flows that dead-end.
- Hardware or region dependent features (Bluetooth device, location-bound content) that a reviewer cannot exercise: needs review notes or a demo mode.

## 2. Metadata accuracy (2.3)
- App name, subtitle, description, screenshots and keywords in repo (`fastlane/metadata`) match actual functionality; no other platforms' names or "Android" references in UI or metadata.
- Pricing claims and "free" wording consistent with paywalls.
- Age rating answers consistent with content (UGC, web access, mature themes).

## 3. Privacy and permissions (5.1.1, 5.1.2)
- Every permission the code requests has a matching `NS*UsageDescription` in each relevant `Info.plist` (camera, microphone, photo library and add-only, location when-in-use/always, contacts, calendars, reminders, Bluetooth, motion, health, speech, local network, Face ID, tracking).
- Purpose strings are specific (what and why), not generic ("This app needs access").
- Permissions requested in context, not all at launch; app still usable after denial where reasonable.
- Privacy policy URL reachable in-app (settings/about) and declared in App Store Connect.
- Data collection in code (analytics, crash reporting, ads, contact upload) matches what the privacy nutrition label will say; list collected data types for the report.
- No collecting data unrelated to the core function; no forced sharing of personal data to unlock features.

## 4. Privacy manifests and required-reason APIs
- `PrivacyInfo.xcprivacy` present for the app target (and extensions that use the APIs).
- Required-reason API categories used by the app or its code (UserDefaults, file timestamps, system boot time, disk space, active keyboards) are declared with valid reason codes.
- `NSPrivacyTracking` and `NSPrivacyTrackingDomains` set correctly if the app tracks; `NSPrivacyCollectedDataTypes` consistent with section 3.
- Third-party SDKs on Apple's list of commonly used SDKs ship their own manifests (check versions in lockfiles; old versions often lack them).
- Expo: `ios.privacyManifests` in app config; Flutter/RN: manifest under `ios/Runner` or `ios/<App>` and included in the target.

## 5. Tracking and App Tracking Transparency (5.1.2)
- Any IDFA access, cross-app tracking, fingerprinting, or ad attribution SDK implies an ATT prompt via `ATTrackingManager.requestTrackingAuthorization` before tracking, plus `NSUserTrackingUsageDescription`.
- Tracking SDKs do not initialize (or run in limited mode) before consent; no fingerprinting fallbacks after denial.
- No incentives or gating to obtain ATT consent.

## 6. Login and accounts (4.8, 5.1.1(v))
- If third-party or social login is offered, check the current requirement about offering an equivalent privacy-focused login option (Sign in with Apple satisfies it).
- Account creation in-app implies **account deletion in-app** (not only by email/web), covering deletion of associated data; clear path in settings.
- No login wall for features that do not need an account; guest or browse mode where reasonable.
- Password reset and error states work.

## 7. Payments and in-app purchase (3.1)
- Digital goods, content, features or subscriptions consumed in the app use In-App Purchase (StoreKit / RevenueCat etc.), not Stripe/PayPal/web checkout, unless an exemption applies (physical goods and services, person-to-person services, reader apps, enterprise, region-specific entitlements).
- No buttons, links or calls to action directing users to external purchasing unless the app holds the relevant entitlement for the target storefront; verify current regional rules.
- **Restore purchases** available for non-consumables and subscriptions.
- Prices shown come from StoreKit (localized), not hard-coded.
- Loot boxes disclose odds; no real-money gambling without the required licensing and geo-restrictions.

## 8. Subscriptions (3.1.2)
- Paywall shows: title, duration, price per period, what is included, free-trial length and what happens after it, auto-renewal statement, links to Terms of Use (EULA) and Privacy Policy.
- Easy path to manage/cancel (`showManageSubscriptions` or link to settings).
- Ongoing value justifies a subscription; no subscriptions for one-off content.
- Trial and introductory offers configured consistently with what the UI claims.

## 9. User-generated content (1.2)
- Apps with UGC or chat need: content filtering, reporting of offensive content, blocking abusive users, a way to contact the developer, and moderation with timely response. Check UI and backend calls exist.
- Anonymous chat / random matching flagged as high risk.

## 10. Kids and families (1.3, 5.1.4)
- If in the Kids category or clearly targeting children: no third-party analytics or advertising (or only allowed ones), parental gates for links out and purchases, no behavioural advertising.

## 11. Design and minimum functionality (4.0, 4.2, 4.3)
- App is more than a repackaged website (web view wrapper with no native value) or a template; offers lasting value.
- Not a duplicate of the developer's other apps or a spam variant.
- Universal app: iPad layouts usable (no stretched or cut-off iPhone layouts), supports multitasking settings declared, rotation behaviour sane.
- Launch screen, app icon (no transparency, all sizes), dark mode and Dynamic Type do not break UI.
- Uses system features as intended (no custom alerts mimicking system permission prompts, no misuse of push for marketing without opt-in).

## 12. Performance, stability and network (2.1, 2.4)
- Obvious crash risks on launch paths (force unwraps on config, missing resources, unhandled promise rejections).
- Works on IPv6-only networks (no hard-coded IPv4 literals).
- Reasonable behaviour offline and on slow networks.
- Battery/heat: background tasks, location updates and timers stopped when not needed.

## 13. Technical requirements (2.5)
- No private or undocumented APIs; no dynamic download of executable code that changes app behaviour (JS bundles via OTA updates must stay within allowed scope: no new features or changing the app's primary purpose).
- Background modes in `UIBackgroundModes` are each justified by an actual feature (audio, location, VoIP, fetch, processing, remote notifications).
- App Transport Security: `NSAllowsArbitraryLoads` or broad exceptions need justification.
- Export compliance: `ITSAppUsesNonExemptEncryption` set appropriately.
- Deployment target, SDK and Xcode used meet current upload requirements (check Apple's upcoming requirements page).
- Push notifications: entitlement present when used; notifications not required for core function; marketing pushes opt-in.
- Deep links / universal links: associated domains entitlement matches configuration.

## 14. Legal and intellectual property (5.2, 5.3, 5.6)
- No unlicensed third-party trademarks, logos, celebrity likeness or copyrighted content.
- Required disclaimers for medical, health, financial or legal features; regulated features (banking, crypto exchange, VPN, gambling, telehealth) submitted by the appropriate legal entity with licenses.
- Contests and sweepstakes have official rules and state Apple is not a sponsor.

## 15. Health, safety and sensitive features (1.4, 5.1.3)
- HealthKit data not used for advertising or stored in iCloud improperly; health claims are substantiated.
- Medical or dosage calculators carry disclaimers and sources.
- Location-based safety features behave correctly when permission is denied.

## 16. Optimizations (not rejection risks)
- Ask for ratings with `SKStoreReviewController` / `requestReview` at positive moments, not on launch.
- Onboarding explains value before asking for permissions or payment.
- Metadata keywords and screenshots reflect the most used features.
- Accessibility labels on primary controls.
