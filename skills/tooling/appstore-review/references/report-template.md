# App Store review audit: <App name>

| | |
|---|---|
| **Date** | YYYY-MM-DD |
| **App / bundle id** | <name> / `com.example.app` |
| **Version / build** | 1.2.0 (45) |
| **Stack** | Native Swift / React Native / Expo / Flutter / Capacitor |
| **Targets audited** | App, widget extension, notification service extension, ... |
| **Scope** | Whole repository at commit `<sha>` |
| **Auditor** | <agent> for <user> |
| **Verdict** | ❌ Not ready / ⚠️ Ready after fixes / ✅ Ready |

## 1. Executive summary

<Three to five sentences: overall readiness and the most important risks.>

| Severity | Count |
|---|---|
| Blocker | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |

**Top risks**
1. ASR-00X – ...
2. ...
3. ...

## 2. Issue register

Every issue found, one row each.

| ID | Severity | Area | Guideline | Evidence | Summary | Status |
|---|---|---|---|---|---|---|
| ASR-001 | Blocker | Accounts | 5.1.1(v) Account deletion | `src/screens/Settings.tsx` (no delete option); `api/users.ts:12` | Users can create accounts but cannot delete them in-app | Open |
| ASR-002 | High | Payments | 3.1.1 In-App Purchase | `lib/paywall/checkout.dart:88` | Premium unlocked via Stripe web checkout | Open |

## 3. Issue details

### ASR-001 – <short title>

- **Severity:** Blocker
- **Area / guideline:** Accounts / 5.1.1(v) (confirm current wording)
- **Evidence:** `path/to/file:line`

  ```
  relevant excerpt
  ```

- **Why a reviewer rejects this:** ...
- **Fix:** concrete steps (code, config, metadata, review notes).
- **Effort:** S / M / L
- **How to verify:** ...
- **Status:** Open

(repeat for every issue)

## 4. Checklist coverage

| # | Area | Result | Notes |
|---|---|---|---|
| 1 | App completeness | Issues found | ASR-004, ASR-007 |
| 2 | Metadata accuracy | Passed | fastlane metadata matches features |
| 3 | Privacy and permissions | Issues found | ASR-003 |
| 4 | Privacy manifests | ... | |
| 5 | Tracking / ATT | Not applicable | no tracking SDKs found |
| 6 | Login and accounts | | |
| 7 | Payments / IAP | | |
| 8 | Subscriptions | | |
| 9 | User-generated content | | |
| 10 | Kids | | |
| 11 | Design / minimum functionality | | |
| 12 | Performance / stability / network | | |
| 13 | Technical requirements | | |
| 14 | Legal / IP | | |
| 15 | Health / safety | | |
| 16 | Optimizations | | |

## 5. Unverifiable – confirm manually

| Item | Why it cannot be checked from the repo | Who / where to confirm |
|---|---|---|
| Screenshots match current UI | not in repository | App Store Connect |

## 6. Submission preparation

**App Review notes to provide**
- Demo account: ...
- Features needing explanation or hardware: ...

**Privacy nutrition label implied by the code**

| Data type | Collected by | Linked to user | Used for tracking |
|---|---|---|---|

**Suggested fix order**
1. Blockers: ...
2. High: ...
3. Medium / Low: ...

## 7. Fix log (filled as issues are resolved)

| ID | Fixed in | Verified how | Date |
|---|---|---|---|
