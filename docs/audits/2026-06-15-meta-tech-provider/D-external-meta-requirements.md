# Meta Tech Provider — External App Review Requirements

**Date:** 2026-06-15
**Scope:** EXTERNAL requirements from Meta's official documentation for becoming a Meta **Tech Provider** and passing **App Review**, for a platform that manages other businesses' Meta assets: Meta Ads (Marketing API), WhatsApp Business Accounts via Embedded Signup, Conversions API, and Lead Ads.
**Sourcing note:** Findings below are drawn from fetched live pages on `developers.facebook.com` / `facebook.com/business/help` as of 2026-06-15. Where a page was JS-rendered and only navigation chrome could be fetched, the substance comes from Meta's own search-result snippets (also dated to the current crawl) and is flagged. My training cutoff is Jan 2026; the one materially newer external change I could confirm is **per-message WhatsApp pricing (effective 2025-07-01)**, captured in §6. No 2026-specific App Review process changes were visible on the fetched pages.

---

## 0. The big picture (how the pieces gate each other)

To operate as a Tech Provider managing assets you do **not** own, you need, roughly in order:

1. A **Business** app (type = Business) in the App Dashboard.
2. Complete **Basic Settings** (privacy policy, data deletion, icon, category, contact, OAuth redirect URIs, app domains) — §1.
3. **Business Verification** of your Business Portfolio — §2. This gates everything below.
4. **App Review** for **Advanced Access** to each permission, each backed by a **screencast** — §3, §4.
5. For WhatsApp specifically: **Tech Provider** status + Embedded Signup + a separate review of the WhatsApp permissions, plus per-client **display name review** and **phone registration** — §5.
6. Conversions API: usually **no review** in the standard server-events path — §6.
7. Then ongoing: **annual Data Use Checkup**, data-deletion handling, re-review when adding permissions — §7.

**Key gating fact:** "Business Verification is required for all apps making requests for Advanced Access," and to serve businesses you don't own/manage your app "must be approved for Advanced Access via Meta's App Review." Source: [Marketing API authorization / ads_management reference](https://developers.facebook.com/docs/permissions/reference/ads_management/), [Access Verification](https://developers.facebook.com/docs/development/release/access-verification/).

---

## 1. Meta App setup (Basic Settings before review)

Source: [App Review submission guide](https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review/submission-guide), [Data Deletion Callback](https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback/).

| Setting                                      | Requirement                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **App type**                                 | **Business** app type (required for Marketing API, WhatsApp, business permissions, Tech Provider).                                                                                                                                                                                                                                                                  |
| **Dev vs Live mode**                         | App must be switched to **Live mode** to use approved permissions in production. In Dev mode, permissions only work for users with a **role** on the app (admins/developers/testers). Standard Access ≈ what works for app-roled users / your own assets; Advanced Access ≈ works for the public/other businesses, and requires App Review + Business Verification. |
| **App Icon**                                 | **1024×1024** image, no Meta trademarks/logos. Required before submission.                                                                                                                                                                                                                                                                                          |
| **Privacy Policy URL**                       | **Required.** This is the page shown to users during the login/consent flow so they can evaluate the permission grant. Must be live and reachable.                                                                                                                                                                                                                  |
| **Terms of Service URL**                     | Field exists in Basic Settings; the submission guide does **not** list it as a hard blocker, but it is expected for a commercial Tech Provider and is commonly checked. Treat as required-in-practice.                                                                                                                                                              |
| **Data Deletion**                            | **Required:** you must specify **either** a **Data Deletion Callback URL** **or** a **Data Deletion Instructions URL** in Basic Settings (see §7 for the callback contract). Apps accessing user data cannot pass review without one.                                                                                                                               |
| **App Domains**                              | Must list the domains your login/redirects use, consistent with OAuth redirect URIs.                                                                                                                                                                                                                                                                                |
| **Valid OAuth Redirect URIs**                | Configured under Facebook Login / Login for Business settings; must exactly match the redirect(s) used by your app and Embedded Signup.                                                                                                                                                                                                                             |
| **App Category**                             | Must **accurately** describe the app's function. Inaccurate category is a rejection reason.                                                                                                                                                                                                                                                                         |
| **Business contact / Primary contact email** | A reachable email for review notifications.                                                                                                                                                                                                                                                                                                                         |
| **Business linked to app**                   | The app must be connected to a **verified Business** (Settings > Basic > Verification) before App Review for Advanced Access.                                                                                                                                                                                                                                       |

---

## 2. Business Verification

Sources: [Business Verification (developers)](https://developers.facebook.com/docs/development/release/business-verification/), [About Business Verification (Help Center)](https://www.facebook.com/business/help/1095661473946872), [Verify your business](https://www.facebook.com/business/help/2058515294227817), [Documents for registered entities](https://www.facebook.com/business/help/193400874040813), [Access Verification](https://developers.facebook.com/docs/development/release/access-verification/).

- **What it is:** Meta "gathers information about you and your Business so [Meta] can verify your identity as a business entity." It confirms you are a real, legally registered company.
- **Who must complete it:** An **administrator of the Business Portfolio** (Business Manager admin) — not merely an app admin. App admins can _initiate_ the connection (App Dashboard > Settings > Basic > Verification), but a Business admin finalizes it in Business Manager.
- **Information Meta collects:** Business **legal name, address, phone number, email, and website**. If Meta can't auto-confirm from public records, it requests **official documents**.
- **Documents required (when not auto-confirmed):**
  - Proof the business is **legally registered** — e.g. business **formation/registration document** and a **tax identification number** (EIN in the US). You may upload up to two documents, but **both must show the legal business name**, and documents lacking the legal name + tax ID are rejected.
  - **Proof of identity:** a government-issued **photo ID for each beneficial owner** (owner with **≥10%** of shares), when prompted.
- **What it gates:**
  - **Advanced Access** to permissions (required for all Advanced Access requests).
  - The ability for **other businesses to access their own data through your app** (i.e., the core Tech Provider model).
  - **Live WhatsApp** messaging / Tech Provider status.
- **Tech Provider note:** To become a Tech Provider you "verify your business with Meta" (name, address, phone, email, website). There is also a **Tech Provider Access Verification**: existing businesses get **60 days** after notification to complete it before access is restricted.
- **Timeline:** Auto-verification can be instant; manual document review typically takes a few business days and can run **1–2 weeks** if documents need resubmission. (Meta does not publish a firm SLA on the fetched pages; plan for delay — this is a common launch bottleneck.)

---

## 3. App Review / Access Levels (per-permission matrix)

Sources: [Permissions Reference](https://developers.facebook.com/docs/permissions/), [Access Verification](https://developers.facebook.com/docs/development/release/access-verification/), [ads_management reference](https://developers.facebook.com/docs/permissions/reference/ads_management/), [Ads Management Standard Access feature](https://developers.facebook.com/docs/features-reference/ads-management-standard-access/), [Lead Ads sample submission](https://developers.facebook.com/docs/app-review/resources/sample-submissions/marketing-api/).

**Standard vs Advanced Access (definitions):**

- **Standard Access** — access to assets/data that **your own Business, or anyone with a role on your app**, owns/manages. No App Review needed; lower rate limits.
- **Advanced Access** — required to access data of **businesses/users you do not own or manage** (the Tech Provider case), and grants **higher rate limits**. Requires **App Review** + **Business Verification**, and is subject to **Ongoing Review**.

**Per-permission requirements:**

| Permission / Feature           | App Review for Advanced Access?                                | What Meta wants demonstrated                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public_profile`               | **No** — granted to all apps by default (Standard).            | Nothing; default.                                                                                                                                                                                                                                                                                                            |
| `email`                        | **No review** for basic use; default-grant tier.               | Nothing special; shown incidentally in login consent.                                                                                                                                                                                                                                                                        |
| `ads_read`                     | **Yes** (Advanced).                                            | App user logging in + consenting; app **reading/displaying ad metrics** (Impressions, Conversions, Spend, Clicks, Reach).                                                                                                                                                                                                    |
| `ads_management`               | **Yes** (Advanced). Restricted.                                | Specific examples of **why you manage ads on behalf of other businesses**; screencast showing login + consent, then the app **creating campaigns / editing ads / fetching metrics**. Dependencies: `pages_read_engagement`, `pages_show_list`.                                                                               |
| `business_management`          | **Yes** (Advanced).                                            | App user consenting; app **reading/managing Business Manager assets** (e.g., listing ad accounts, assigning assets) in-product.                                                                                                                                                                                              |
| `leads_retrieval`              | **Yes** (Advanced).                                            | Login + consent, then app **retrieving lead form submissions** and showing what it does with the lead data. **Dependencies:** `ads_management`, `ads_read`, `business_management`, `pages_manage_ads`, `pages_read_engagement`, `pages_show_list`. Also commonly paired with the **Ads Management Standard Access** feature. |
| `pages_show_list`              | **Yes** (Advanced).                                            | App user **selecting from their list of Pages**.                                                                                                                                                                                                                                                                             |
| `pages_read_engagement`        | **Yes** (Advanced).                                            | App **reading Page content/engagement** the permission covers.                                                                                                                                                                                                                                                               |
| `pages_manage_ads`             | **Yes** (Advanced).                                            | App **managing ads associated with a Page** (e.g., lead ads on the Page).                                                                                                                                                                                                                                                    |
| `pages_manage_metadata`        | **Yes** (Advanced).                                            | App **subscribing to Page webhooks / managing Page settings/metadata** (e.g., installing the leadgen webhook on the Page).                                                                                                                                                                                                   |
| `whatsapp_business_management` | **Yes** (Advanced).                                            | Business-facing UI **managing client WABAs**: phone numbers, message templates. (See §5.)                                                                                                                                                                                                                                    |
| `whatsapp_business_messaging`  | **Yes** (Advanced). Depends on `whatsapp_business_management`. | Business-facing UI **sending and receiving** WhatsApp messages (NOT the consumer app). (See §5.)                                                                                                                                                                                                                             |
| `instagram_basic`              | **Yes** (Advanced) if used.                                    | App user consenting + app **reading the connected IG business account** (only request if actually used).                                                                                                                                                                                                                     |

**Ads Management Standard Access feature / rate-limit tiers:**

- The **Ads Management Standard Access** feature governs Marketing API **rate-limit tiers**. New apps start in the **development tier** with low call volume; passing review for this feature raises you to **Standard** tier, and higher volume (managing many ad accounts/datasets) pushes toward higher allocation. Managing a **high number of datasets on behalf of other businesses** specifically requires **Advanced Access**. Source: [ads-management-standard-access](https://developers.facebook.com/docs/features-reference/ads-management-standard-access/), [Marketing API tier simplification blog](https://developers.facebook.com/ads/blog/post/v2/2018/07/02/marketing-api-tier-simplification/).

**Hard prerequisite for submission — at least one real API call per permission:**

- You "must make at least **1 successful API call** using **each permission** for which you are requesting advanced access," and calls "must be made within **30 days** of submitting for App Review" (Graph API Explorer counts; logged within ~2 days). Source: [Lead Ads sample submission](https://developers.facebook.com/docs/app-review/resources/sample-submissions/marketing-api/).
- **Only request permissions you actually use** — "Selecting unneeded permissions is a common reason for rejection." Source: [Permissions](https://developers.facebook.com/docs/permissions/).

---

## 4. THE DEMONSTRATION VIDEO / SCREENCAST (the core concern)

Primary source: [Screen Recordings — App Review](https://developers.facebook.com/docs/app-review/submission-guide/screen-recordings/). Secondary: [WhatsApp solution-provider sample submission](https://developers.facebook.com/docs/whatsapp/solution-providers/app-review/sample-submission), [Marketing API sample submission](https://developers.facebook.com/docs/app-review/resources/sample-submissions/marketing-api/).

### 4.1 What the video MUST show

1. **The full login flow, logged-out → logged-in.**
   - **Log out of any test account before recording** and capture the entire flow from logged-out to logged-in.
   - If your app **also** supports its own (non-Meta) login, capture **that** flow too.
2. **The Facebook Login / Login-for-Business consent dialog showing the requested permissions.**
   - Show the user clicking the **(business) login button**, and the **app user consenting within the authorization flow** — i.e., the permissions dialog itself must be on screen as the user grants the permission you're demonstrating.
3. **Each permission actually being USED in-product.**
   - For **every** permission/feature in the submission, show "an app user **accessing data that requires the permission**… and **what your app does with that data**." Example Meta gives: to demo publishing, show the user selecting a page → creating a post → publishing → then viewing the published post.
   - **Per-permission coverage is mandatory:** "Ensure that your screen recording shows your app using **every** permission and feature in your submission. **If you omit one… your submission will be rejected.**" And: "If our reviewers are unable to verify that your app needs a specific permission or feature based on what you've shown… **you will not be approved** for that permission or feature."

### 4.2 Test credentials

- Provide **working test-user credentials** so reviewers can reproduce the flow. If your app supports non-Meta account creation, "include credentials for one of these test users as well." Reviewers must be able to **log in and reproduce every step** — "could not reproduce" is a top rejection cause.

### 4.3 Format / production guidance (from Meta's page)

- **Resolution:** record in **high resolution, 1080p or better**; _lower your monitor resolution to ≤1440px width_ before recording so the UI is legible.
- **Cursor:** **increase mouse cursor size** for visibility.
- **Audio:** **omit audio** — reviewers won't listen.
- **Language:** use **English** as the app UI language if possible; if not, add **captions/tooltips** explaining non-obvious UI.
- **Tools:** Meta suggests **Camtasia / Snagit** (paid) or **QuickTime / OBS** (free), editing with iMovie.
- **Recording hygiene:** record only relevant content (no off-screen activity), use **annotations/zoom** to highlight where each permission is exercised, **don't** film one device's screen with another device's camera.
- **Relationship to the form:** the recording only needs to show **how to test/use** each permission — you explain _why_ you need it in the **written form** (don't copy-paste the same description across permissions).

### 4.4 Common reasons reviewers REJECT the video

- **"Could not reproduce"** — bad/missing test credentials, broken login, environment not reachable, app in Dev mode without reviewer access.
- **Permission usage not shown** — a requested permission never appears being used in-product (the single most common omission, especially for multi-permission Tech Provider submissions where one of `pages_*` or `business_management` is skipped).
- **Login/consent screen not captured** — recording starts already logged-in, so the consent dialog with the permissions is never seen.
- **Wrong interface for WhatsApp** — showing the consumer chat instead of your **business-facing** management/messaging UI (see §5.4).
- **Requesting unused permissions** — anything in the submission with no demonstrated use.
- **Non-English UI with no captions / illegible low-res capture.**

### 4.5 Practical recipe for THIS Tech Provider app

Record (at minimum) one continuous flow per permission cluster, all starting logged-out:

- **Ads cluster:** Embedded/Login-for-Business consent showing `ads_read`, `ads_management`, `business_management`, `pages_show_list`, `pages_read_engagement`, `pages_manage_ads` → then in-app: list the client's ad accounts → show campaign metrics (Impressions/Spend/Clicks) → create or edit a campaign.
- **Lead Ads:** consent showing `leads_retrieval` + `pages_manage_metadata` → connect a Page → subscribe to the leadgen webhook → submit a test lead → show it arriving in your product.
- **WhatsApp:** the **Embedded Signup** dialog (Login-for-Business) showing `whatsapp_business_management` + `whatsapp_business_messaging` → in your **business-facing** console: manage the client WABA (templates, phone number) and **send + receive** a message.

---

## 5. WhatsApp Business Platform / Tech Provider specifics

Sources: [Become a Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers), [Embedded Signup overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/), [Onboarding customers as a Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider/), [Access Tokens Guide](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens/), [Solution-provider sample submission](https://developers.facebook.com/docs/whatsapp/solution-providers/app-review/sample-submission), [Messaging Limits](https://developers.facebook.com/docs/whatsapp/messaging-limits/), [Registering phone numbers](https://developers.facebook.com/docs/whatsapp/solution-providers/phone-numbers/registering-phone-numbers/), [Two-step verification](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/two-step-verification/).

### 5.1 Tech Provider vs Solution Partner vs direct BSP

- **Tech Provider** — you build software on the **Cloud API** and onboard **other businesses** via Embedded Signup; each client is billed by Meta directly (or you resell). Requires Business Verification + App Review of WhatsApp permissions. **This is the role Switchboard wants.**
- **Solution Partner** — a Tech Provider that has additionally been **accepted into the Partner program** (line of credit, can be billed on behalf of clients, listed in the partner directory). Strict additional vetting; an _upgrade_ path from Tech Provider.
- **Direct BSP (legacy "Business Solution Provider")** — older On-Premises/hosted model; largely subsumed by Cloud API + Tech Provider. Not needed if you use Cloud API.

### 5.2 Embedded Signup (the onboarding mechanism)

- Embedded Signup is "a scalable authentication and authorization interface launched directly from your website or client portal." It is built on **Facebook Login for Business** with a **configuration ID (`config_id`)** that pins the exact assets/permissions requested.
- During the flow the **client** logs in, **creates or selects a WABA**, **adds a phone number**, and verifies it.
- Your app receives an **authorization code** (plus WABA ID and phone number ID via the SDK callback / Graph). You **exchange the code** for a **Business Integration System User access token** — a token "scoped to individual onboarded customers" used for "programmatic, automated actions on customer WABAs without requiring app user input or re-authentication." This token **must** be generated via Embedded Signup configured with Facebook Login for Business.

### 5.3 Post-onboarding steps (per client)

1. **Subscribe your app to the client's WABA** (`POST /<WABA_ID>/subscribed_apps`) to receive **webhooks** (messages, statuses, template/quality updates).
2. **Register the phone number** for Cloud API — 4 steps: create the number on the WABA → request a verification code → verify the code → **register** the number with a **6-digit two-step-verification PIN** (`POST /<PHONE_NUMBER_ID>/register`). You'll need that PIN later to move/delete the number.
3. **Display name review:** the client's **display name** is submitted and goes through Meta review. Statuses include `PENDING_REVIEW`, approved, `EXPIRED`, `NONE` (no/expired certificate ⇒ number cannot be registered). The name must follow Meta's display-name guidelines.
4. **Webhooks (required):** subscribe at the **app** level to fields like `messages` (and template/account update fields). A reachable HTTPS webhook with verify-token handshake is mandatory for messaging.

### 5.4 WhatsApp App Review (separate demonstration, same review system)

WhatsApp permissions go through the **same** App Review system but have their **own** demonstration expectations:

- Request **`whatsapp_business_management`** and **`whatsapp_business_messaging`**.
- For **`whatsapp_business_management`:** a short video showing "clear evidence of how your application uses the `whatsapp_business_management` permission" — i.e., **managing client phone numbers and templates**.
- For **`whatsapp_business_messaging`:** record the **business-facing interface, not the consumer-facing experience**, showing **sending and receiving** messages.
- In the written description, state your **role (Tech Provider/Solution Partner)**, the **value** to users, and concrete **use cases**.
- **Beyond Login-permission review**, WhatsApp also imposes **per-client gates that are not part of App Review**: **display name approval** and **phone number registration** happen for _every_ onboarded client, plus **business verification of the client** for higher limits / Official Business Account status.

### 5.5 Messaging limits / tiers

From Meta's [Messaging Limits](https://developers.facebook.com/docs/whatsapp/messaging-limits/) (substance via current crawl snippet; page is JS-rendered):

- Limits are now **business-portfolio-based**, not per-phone-number (a 2025 change), and apply to **business-initiated** conversations to **unique** users in a rolling **24h** window.
- Tiers (internal labels like `TIER_250`): start at **250** unique customers/24h (unverified/new), scaling to **1K**, then **10K**, **100K**, and **unlimited**. Scaling is **automatic** based on **delivered message volume to unique numbers over a 30-day moving window** combined with a **high template quality rating**. Per the current docs, the first scaling step now jumps toward **2,000** rather than 1,000.
- **Quality rating** drops (too many blocks/reports) can **lower** your tier or flag the number.

### 5.6 Tech Provider onboarding obligations (summary)

Verified business → app connected & approved for the two WhatsApp permissions → Embedded Signup with `config_id` → per-client: WABA subscription, phone registration + PIN, display name review, webhook handling, quality monitoring, and (if reselling/credit) the Solution Partner upgrade.

---

## 6. Conversions API (CAPI)

Sources: [CAPI Get Started](https://developers.facebook.com/docs/marketing-api/conversions-api/get-started/), [Dataset Quality API](https://developers.facebook.com/docs/marketing-api/conversions-api/dataset-quality-api/), [FBE Pixel+CAPI onboarding](https://developers.facebook.com/docs/marketing-api/fbe/fbe2/get-started/pixel-capi-onboarding).

- **Auth model:** CAPI uses a **dataset (formerly "pixel") ID + access token**. The token is generated against a **System User** that has the **Manage Pixel/Manage Dataset** permission on that dataset (Events Manager > dataset settings > Generate access token; or a Business-Manager System User token).
- **App Review / permissions:** For the **standard server-events** implementation, **"your app does not need to go through App Review, and you do not need to request any permissions."** You POST events to `/<DATASET_ID>/events` with the dataset token. This is the simplest path and avoids the screencast entirely for CAPI.
- **When review/permissions DO come in:** if you generate the dataset token **programmatically on a client's behalf** via Business-Manager APIs / Facebook Login for Business / **Meta Business Extension** (rather than the client pasting a manually generated token), that path leans on **`ads_management` / `business_management`** (already in your Advanced-Access set) and on the **Dataset Quality API** for at-scale partners. So: CAPI itself = no extra review; **automating client token provisioning** rides on permissions you're already getting reviewed for in §3.
- **Practical recommendation:** for the pilot, have each client generate/paste a dataset token (no review). Automate token minting later under your already-approved `business_management`/`ads_management` access.

---

## 7. Ongoing obligations

Sources: [Data Use Checkup](https://developers.facebook.com/docs/development/maintaining-data-access/data-use-checkup/), [DUCO FAQ](https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/data-use-checkup/faq/), [Access Verification](https://developers.facebook.com/docs/development/release/access-verification/), [Data Deletion Callback](https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback/).

- **Annual Data Use Checkup (DUCO):** every ~year you must **review the permissions your app holds and attest** that your access/usage complies with Platform Terms + Developer Policies, **within 60 days** of notification, or **lose API access**. Apps with many can complete DUCO in bulk from "My Apps." Remove unused permissions in App Review > My Permissions and Features.
- **Ongoing Review (Advanced Access):** Advanced-Access apps undergo periodic **Ongoing Review** to retain access. Apps using **Facebook Login for Business** (limited to business permissions) have **reduced** ongoing-compliance requirements vs. consumer Facebook Login.
- **Tech Provider Access Verification re-check:** existing apps get **60 days** to complete/maintain Tech Provider verification after notification.
- **Data Deletion handling (must work, not just be configured):** the **Data Deletion Callback URL** must accept a **POST** with a `signed_request` (verify with app secret → app-scoped user ID), **initiate deletion**, and **return JSON** `{ "url": "<status_url>", "confirmation_code": "<code>" }`. Alternatively provide a **Data Deletion Instructions URL** (a help page). "Failure to comply… may result in your callback being removed or your app being disabled." (Also see the **deauthorize callback** for app-uninstall events.)
- **Re-validation when adding permissions:** any **new** permission/feature requires a **new App Review submission** with its own screencast + a successful API call within the prior 30 days. Changing what an already-approved permission does can also require re-review.
- **Rate limits:** Standard vs Advanced Access set Graph/Marketing API rate tiers; Marketing API additionally uses the **Ads Management Standard Access** tier system (§3). WhatsApp adds its own **messaging-limit tiers** + **quality rating** (§5.5).
- **Business Verification maintenance:** keep the Business Portfolio verified; lapses restrict Advanced Access and WhatsApp.

---

## 8. Top things that commonly BLOCK approval (consolidated)

1. **Screencast omits a permission's in-product use** → that permission denied. (#1 cause for multi-permission Tech Provider apps.)
2. **"Could not reproduce"** → missing/broken test credentials, app left in Dev mode without reviewer access, unreachable environment.
3. **Login/consent dialog not captured** (recording starts logged-in).
4. **Business Verification incomplete or documents lacking legal name + tax ID** → Advanced Access and WhatsApp blocked entirely.
5. **No successful API call per requested permission in the last 30 days** before submission.
6. **Requesting permissions the app doesn't actually use.**
7. **WhatsApp video shows the consumer chat, not the business-facing console.**
8. **Missing Data Deletion callback/instructions URL or non-functional callback.**
9. **Privacy Policy URL missing/unreachable; inaccurate app category; non-English UI without captions.**
10. **WhatsApp per-client gates forgotten:** display name still `PENDING_REVIEW`/`NONE`, or phone number not registered with a PIN.

---

## Source list

- App Review screen recordings — https://developers.facebook.com/docs/app-review/submission-guide/screen-recordings/
- App Review submission guide — https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review/submission-guide
- Permissions Reference — https://developers.facebook.com/docs/permissions/
- ads_management reference — https://developers.facebook.com/docs/permissions/reference/ads_management/
- Ads Management Standard Access — https://developers.facebook.com/docs/features-reference/ads-management-standard-access/
- Marketing API sample submission (Lead Ads) — https://developers.facebook.com/docs/app-review/resources/sample-submissions/marketing-api/
- Access Verification — https://developers.facebook.com/docs/development/release/access-verification/
- Business Verification (developers) — https://developers.facebook.com/docs/development/release/business-verification/
- About Business Verification (Help Center) — https://www.facebook.com/business/help/1095661473946872
- Verify your business — https://www.facebook.com/business/help/2058515294227817
- Documents for registered entities — https://www.facebook.com/business/help/193400874040813
- Become a Tech Provider (WhatsApp) — https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers
- Embedded Signup overview — https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/
- Onboarding customers as a Tech Provider — https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider/
- WhatsApp Access Tokens guide — https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens/
- WhatsApp solution-provider sample submission — https://developers.facebook.com/docs/whatsapp/solution-providers/app-review/sample-submission
- WhatsApp Messaging Limits — https://developers.facebook.com/docs/whatsapp/messaging-limits/
- Registering phone numbers — https://developers.facebook.com/docs/whatsapp/solution-providers/phone-numbers/registering-phone-numbers/
- Two-step verification — https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/two-step-verification/
- WhatsApp pricing (per-message, 2025-07-01) — https://developers.facebook.com/docs/whatsapp/pricing/updates-to-pricing/
- Conversations 2025 / per-message pricing — https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- Conversions API Get Started — https://developers.facebook.com/docs/marketing-api/conversions-api/get-started/
- Data Use Checkup — https://developers.facebook.com/docs/development/maintaining-data-access/data-use-checkup/
- Data Deletion Callback — https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback/
