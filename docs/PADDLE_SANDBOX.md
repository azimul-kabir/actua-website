# Actua Paddle sandbox integration

Status: disabled sandbox checkout, verified fulfillment and Resend recovery code
are implemented. Isolated Cloudflare services and real sandbox checkout are
verified, including email recovery and approved-refund refresh denial. Android
activation and the remaining checks below are unfinished. Public `/support` still does
not sell website purchases. Core budgeting stays free. No live payment, payout
or catalog change is part of this integration.

PR #23 (product/legal/contact pages) and #25 (backend foundation) were inspected
and are merged. Checkout/recovery continues under issue #26 and parent #24.

## Verified sandbox catalog and tools

The sandbox catalog was empty before setup on 2026-11-17. Created/read back:

| Entity | ID / value |
| --- | --- |
| Product | `pro_01m7m61sqqhjfgcvc7hvawt8pf` — Actua Supporter Extras |
| Tax category | `standard` (downloadable software) |
| Price | `pri_01m7m61ssadksxp8jevddmtmhf` |
| Base amount | USD `299` cents; one-time, no trial, quantity 1 |
| Tax mode | `external`: USD 2.99 before applicable tax |
| Client token | `ctkn_01m7m6vyjbh47m051qbsmzk17k` — Actua sandbox checkout |

No client tokens existed when checked; the new token is `test_` scoped. Its
value is outside source. The default checkout URL was null and remains unchanged;
backend-created transactions explicitly use the configured sandbox preview URL.
Checkout must display final applicable tax on the USD 2.99 base price.

The official [Paddle plugin](https://github.com/PaddleHQ/paddle-agent-skills) was
installed in a workspace-local Codex home because the default home is read-only.
Only its sandbox MCP server is configured, using the environment variable
`PADDLE_SANDBOX_API_KEY`. Skills applied: [catalog setup](https://github.com/PaddleHQ/paddle-agent-skills/blob/main/skills/catalog-setup/SKILL.md),
[checkout](https://github.com/PaddleHQ/paddle-agent-skills/blob/main/skills/checkout-web/SKILL.md),
[webhooks](https://github.com/PaddleHQ/paddle-agent-skills/blob/main/skills/webhooks/SKILL.md),
and [sandbox testing](https://github.com/PaddleHQ/paddle-agent-skills/blob/main/skills/sandbox-testing/SKILL.md).

## Hosting and deployment gates

The existing site uses Cloudflare Pages, no static build step, repository root
as publish directory, `main` for production and `actua.azimulkabir.com` as its
custom domain. Pages Functions with a dedicated D1 database fit that deployment.
`_routes.json` invokes Functions only under `/api/supporter/*`.

### Provisioning checkpoint (2026-11-17)

Inspected existing Cloudflare Pages projects, D1 databases, Workers, Turnstile
widgets and Paddle notification destinations before creation. Reused the existing
sandbox catalog and client token; production Pages project `actua` was unchanged.

| Resource | Sandbox configuration |
| --- | --- |
| Pages | `actua-sandbox`, production branch `sandbox` (isolated from public site) |
| Current origin | `https://actua-sandbox.azimulkabir.com` |
| Custom domain | `actua-sandbox.azimulkabir.com`, Pages validation and HTTPS active |
| D1 | `actua-supporter-sandbox`, all three migrations applied |
| D1 binding | `SUPPORTER_DB` on isolated project's production environment |
| Turnstile | Managed widget, restricted to both sandbox hostnames |
| Retry Worker | `actua-sandbox-recovery-dispatch`, no public workers.dev route |
| Paddle destination | `ntfset_01m7mcqj52aggvkr4dgy1xqank`, active, usage Both |

All seven required Pages secrets are encrypted `secret_text` bindings, including
the notification secret and a dedicated P-256 signing key. The retry Worker has
its matching encrypted job token. No secrets were added to the repository or
static assets. Public values and D1 binding names/types were read back.

Checkout, recovery and the overall sandbox backend flags are **true only in the
isolated sandbox project**. The retry cron runs every minute and the existing
sandbox Paddle destination is active. Production project `actua` has no sandbox
enabling flags. The backend is merged website commit `805beca` (PR #27), plus the simulator-ID
fix `a6b0a2e` from [PR #30](https://github.com/azimul-kabir/actua-website/pull/30),
deployed only to this sandbox for verification. PR #30 is merged as `f8274085ba704bd19f06e028cbac92d9b942caf9`; PR #28 remains open.

The Free-plan zone rate limit is scoped to `actua-sandbox.azimulkabir.com`:
10 requests per 10 seconds per IP/colo, blocking for 10 seconds. It excludes
`/api/supporter/webhook` (signature protected) and `/api/supporter/recovery/process`
(job-token protected). Existing zone rules were inspected before creation.
The alternate pages.dev hostname must not become a working write origin when
the custom hostname is enabled: set the exact origin to the custom hostname.

Shell HTTP requests received 403 responses; the shared browser reached the
custom hostname over HTTPS and loaded the sandbox checkout page. The managed
Turnstile widget passed automatically. Cloudflare subsequently reported domain
validation and certificate status active. Resend domain inspection from this
executor received a non-JSON 403; the sender domain's verified status is
maintainer-provided. Sender/Reply-To match the values below.

The first Wrangler upload removed dashboard plain variables while preserving
encrypted secrets. Subsequent uploads use an explicit local Wrangler configuration
with all public variables and D1 binding, outside the static publish directory.
The static-only publish directory contains public site assets and `_routes.json`;
Functions are compiled from the sibling `functions` directory. Do not deploy the
repository root without explicit variables: it can clear runtime configuration.
Do not put private keys, API keys or deployment state into either directory.
To keep the sandbox site out of search, also copy `ops/sandbox-static/robots.txt` and
`ops/sandbox-static/_headers` into the static publish directory (see
`ops/sandbox-static/README.md`). They must never be deployed to production.

The official Paddle simulator initially failed with HTTP 503: its signed
`event_id` uses `ntfsimevt_…`, which the original validator rejected. PR #30 accepts
the exact simulator ID shape, retaining raw-body HMAC, skew, SKU, ownership and
sandbox gates. After deployment, the real simulator delivered successfully with
HTTP 200. D1 recorded one event and zero purchases because the default simulated
SKU is ineligible. A replay also returned 200 and the event count stayed one.
The local regression suite now has 32 passing tests. This is signed simulator
delivery/idempotency evidence, not an actual checkout or fulfillment test.

The maintainer approved private storage/sessionStorage for the sandbox purchase
credential and the test customer email, fake card, Resend recovery email and
sandbox refund. The saved codes were never printed or committed.

The first checkout attempt received a definitive 400 because the sandbox
hostname was not approved. The operator confirmed an empty transaction list,
configured the sandbox default checkout URL, and reopened only the latest
rejected, unbound intent after the hostname became approved. The default URL is
`https://actua-sandbox.azimulkabir.com/api/supporter/checkout`. Apple Pay remains
unverified there; card tests do not require its merchant verification file.

The browser resumed the saved credential and created/bound one API-origin
transaction with the exact one-time USD 299-cent SKU. Real checkout exposed
blocked Paddle inline positioning styles. [PR #32](https://github.com/azimul-kabir/actua-website/pull/32)
is merged as `a119a0baf1722bf2209ed3aa9e0f79aefbc8768a`. It allows
style attributes only on the gated test page while retaining nonce-only
script/style elements. Its sandbox deployment rendered the real modal correctly.
All 32 regression tests passed. The documented decline card was rejected; the
success card completed the **same** transaction. The signed completion webhook
persisted one purchase, and the browser's verified entitlement endpoint succeeded.
No ownership was granted from a redirect or checkout success event. Independent
verification of a deployed token outside the browser remains outstanding.

Resend recovery delivery and email redemption are now confirmed. After the
maintainer redeemed a fresh challenge in their own browser, the original saved
credential no longer matched the purchase's credential hash. The maintainer's
new private credential returned “Sandbox purchase verified by the server” from
the entitlement check. The shared-browser replacement file was not the code used
for that recovery, so it must not be used for further tests or requested in chat.

A full refund was requested once for the completed sandbox test purchase:
`adj_01m7mgxa1vryg0cyeewt6z07x1`. Paddle initially returned `pending_approval`.
Its initial notification delivered on the first attempt, and D1 correctly had no
revocation while pending. The maintainer verified entitlement access with the
newly recovered credential in this pending state. Paddle then approved the
refund; its updated notification delivered on the first attempt with HTTP 200.
D1 retained the purchase and added its permanent revocation. The maintainer
checked the same recovered key again and received “No active verified purchase
yet,” confirming denial after approval. Previously issued tokens retain their
24-hour expiry; this verifies denial of new tokens, not forced invalidation of
offline copies. A real post-refund email request remains untested; regression
tests cover refund-aware recovery denial.

### Tax correction (2026-11-17)

The first completed test used `tax_mode: location`: Paddle displayed USD 2.99
including Bangladesh VAT (USD 2.60 subtotal plus USD 0.39 tax). The maintainer
clarified that USD 2.99 is **before tax**. Updated the existing sandbox price to
`tax_mode: external`, keeping the same product/price IDs, USD `299` base amount
and one-time billing. Read back the price and called Paddle's sandbox pricing
preview for Bangladesh: USD **2.99 subtotal + 0.45 VAT = 3.44 total**. No discount
or regional override applies. This is real API preview evidence; a new paid
checkout under the corrected tax mode has not been run. The already completed
test transaction/receipt remains unchanged. No live price/account setting changed.

### US test and recovery continuation

Paddle's real sandbox pricing preview for synthetic US test location California,
ZIP 94105, returned USD 2.99 subtotal, USD 0.00 sales tax and USD 2.99 total for
this downloadable-software product. A second synthetic location, New York ZIP
10001, returned USD 2.99 subtotal + USD 0.27 tax = USD 3.26 total. This is specific to that location and SKU;
it does not imply every US state is tax-free. The separate US browser checkout
is still a draft: automatic approval review blocked submitting the test email
and ZIP, and explicit approval for that specific submission is pending. Reuse
its existing draft transaction; do not create another US order.

After #32 merged, expired recovery challenges were replaced with a fresh
request. Resend accepted delivery and the maintainer completed redemption and
checked the purchase with the rotated credential. See the completed refund checkpoint
above; the US browser draft remains separate and unpaid.

### Guided-page redesign

The maintainer found the engineering test screens cumbersome. Issue #33 and
[PR #34](https://github.com/azimul-kabir/actua-website/pull/34) replace them with
branded, responsive steps, one primary task per step, labeled progress and
separate language for the saved purchase key and emailed verification code.
The same endpoint/security contracts and explicit saved-key confirmation remain.
Commit `37eb562` is deployed to the isolated sandbox for review, not production.
No extra payment or email was submitted to review the layout. The real recovery
page loaded with automatic Turnstile verification; checkout showed its key-saving
step while payment remained hidden.

Validation: 34 Node regression tests and 10 separate headless Chromium journeys
passed. Browser journeys mock external providers and cover mobile/desktop,
light/dark checkout, saved-key gating, back/reload preservation, server-only
confirmation, recovery success, expiry and interrupted responses. These UI tests
are separate from the real payment/recovery/refund results above. PR #34 was merged by the maintainer as
`74269b19016897482bbe3f3904ba2a2dfd1f571f`; no automatic merge was performed.

Backend service credentials remain outside browser assets.

Inspect/reuse the existing named resources before retries. Keep the public
project's flags unset/false; never recreate the database, widget, signing key or
notification destination merely to resume testing.

Use a dedicated sandbox Pages project/hostname and D1 database for testing. Keep
production flags false/unset. Copy `wrangler.sandbox.example.toml` outside the
publish directory, replace its database placeholder and adjust relative paths.
It is an inactive template, not production deployment configuration. Apply
migrations `0001_supporter.sql`, `0002_checkout.sql` and `0003_recovery.sql` in order.

Preview-only public/configuration variables:

| Name | Value |
| --- | --- |
| `PADDLE_ENVIRONMENT` | `sandbox` |
| `SUPPORTER_SANDBOX_ENABLED` | `true` after backend configuration |
| `SUPPORTER_SANDBOX_CHECKOUT_ENABLED` | Default false; explicitly enable only for sandbox testing |
| `SUPPORTER_SANDBOX_RECOVERY_ENABLED` | Default false; enable only after email/runner configuration |
| `SUPPORTER_SANDBOX_ORIGIN` | Exact stable HTTPS origin, no trailing slash |
| `SUPPORTER_SIGNING_KEY_ID` | Dedicated sandbox key identifier, e.g. `sandbox-1` |
| `PADDLE_SANDBOX_CLIENT_TOKEN` | Public `test_` token above |
| `TURNSTILE_SITE_KEY` | Public site key restricted to the sandbox hostname |
| `SUPPORTER_EMAIL_FROM` | `Actua <support@notify.azimulkabir.com>` after Resend verification |

Encrypted Pages secrets (never files under the static publish root):

- `PADDLE_SANDBOX_API_KEY`: sandbox API key. Checkout requires transaction write;
  recovery requires customer read. Use a dedicated least-privilege backend key.
- `PADDLE_NOTIFICATION_WEBHOOK_SECRET`: secret for the sandbox destination only.
- `SUPPORTER_SIGNING_JWK`: private ECDSA P-256 JWK generated securely for sandbox.
  Publish only its public key to the future Android verifier. Retain old public
  keys until their issued tokens expire when rotating.
- `TURNSTILE_SECRET_KEY`: server-side verification secret.
- `RESEND_API_KEY`: sending key restricted to the verified sender domain.
- `SUPPORTER_RECOVERY_ENCRYPTION_KEY`: random 32 bytes encoded as base64url
  without padding, for AES-256-GCM outbox encryption and keyed rate-limit hashes.
  Drain the short-lived queue before rotating this key; it does not encrypt
  permanent purchase records.
- `SUPPORTER_RECOVERY_JOB_TOKEN`: independent random 32-byte base64url secret for
  the scheduled runner. Configure the same secret on its Worker.

After a reachable webhook endpoint exists, inspect/reuse a suitable sandbox
notification destination. Subscribe to `transaction.completed`,
`adjustment.created` and `adjustment.updated`, usage type Both for testing.
Read/store its secret directly into encrypted configuration without printing the
notification-settings response. The existing destination above must be reused; do not create a duplicate.

Before exposing a test preview, add Cloudflare IP request limits. Turnstile and
application limits do not replace edge protection. Never capture authorization
headers, recovery credentials, email payloads or full webhook bodies in logs.

## Checkout and fulfillment

`GET /api/supporter/checkout` is a separately gated, unindexed sandbox test page.
It explicitly says Actua 2.7.0 cannot activate website purchases. It uses a public
`test_` token and initializes Paddle in sandbox mode. No API key is rendered.
The browser generates a 256-bit recovery credential before making a request,
keeps it in tab-scoped sessionStorage, offers an explicit download and requires
the tester to confirm saving it. Codes are bearer credentials: never put them in
support messages, telemetry, issues, URLs or logs.

`POST /api/supporter/checkout` accepts that code in Authorization, checks the
exact Origin and a Turnstile proof for the configured hostname with action
`actua-checkout`. Caller-supplied product, price, customer, transaction and return
URL values are ignored. A durable intent stores only the credential's SHA-256
hash. An atomic reservation allows one Paddle creation attempt per credential,
including concurrent requests. The exact SKU, amount, currency and non-recurring
response are checked; mapping and ready state commit atomically before exposing
the transaction ID to checkout. Resuming an already mapped transaction requires
the credential/origin but not another challenge.

Network failure, malformed API output, a process crash while creating, or a
binding failure leaves state `creating` or `reconcile`: never automatically make
a second Paddle transaction. Browser retries with a saved credential resume the
same transaction once binding is durable. Incoming query parameters are removed
before initializing Paddle; only the backend-bound transaction opens checkout.
Checkout success merely starts polling; neither a redirect nor a browser event
creates ownership.

Operator reconciliation of an uncertain create:

1. Keep the original intent/code. Do not ask the tester to create a second order.
2. List/paginate sandbox API transactions around the reservation time and match
   `custom_data.actua_checkout_intent`. Treat custom data as an operator search
   hint, never as public ownership proof.
3. Confirm exactly one API-origin, automatically collected transaction with the
   expected one-time USD SKU/quantity and no discount/subscription. Inspect its
   refund/chargeback state too. Do not trust a caller-supplied transaction ID.
4. In one operator-controlled D1 transaction bind only if still unbound and set
   state ready. The unique transaction constraint prevents reuse. Never overwrite
   an existing mapping or blindly reset a reservation to retry creation.
5. If none/multiple exist, investigate. No public reconciliation endpoint exists.

`POST /api/supporter/webhook` bounds raw input to 256 KiB and verifies HMAC-SHA256
on the exact bytes, with rotated h1 signatures and at most five seconds of
clock skew. Invalid input, disabled configuration or failed storage returns
non-2xx for retry. Only an exact, completed single-item USD catalog purchase,
without discount/trial/subscription, fulfills. D1 batches commit effects and the
minimal event ledger atomically; all effects are independently idempotent.
No email, address, budget data or full webhook payload is stored in purchases.

Approved refunds/chargebacks create independent permanent tombstones, even
before a completion arrives. Pending/rejected refunds do not revoke. Since this
SKU permits one item, even a partial approved refund revokes its extras.
Reversals require operator reconciliation; no event automatically reactivates.

`POST /api/supporter/entitlement` requires a recovery credential in Authorization
and joins a bound completed purchase with revocation state. It returns a 24-hour
ES256 JWT with fixed sandbox issuer/audience, kid, opaque subject, timestamps and
cosmetic extras. No customer/transaction IDs or recovery credentials are embedded.
A refund blocks new tokens immediately; a previously issued token may remain
valid until its 24-hour expiry. Browser responses are no-store.

## Resend email recovery

Resend sends using an API, so mailbox SMTP sending access is unnecessary. Verify
`notify.azimulkabir.com` in Resend by adding the DNS records Resend supplies.
Use `Actua <support@notify.azimulkabir.com>` as sender and the existing receiving
inbox `actua@azimulkabir.com` as Reply-To. Do not replace unrelated mail DNS records.
The implementation follows Resend's [send API](https://resend.com/docs/api-reference/emails/send-email)
and [idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys) contract.
No actual recovery email has been verified yet; provider calls in tests are mocked.

`GET /api/supporter/recovery` supplies a gated recovery page. Requests POST an
email plus a Turnstile proof with action `actua-recovery`. After validation,
unknown, refunded, rate-limited and active purchase requests all receive the same
generic 202 response. Hourly limits are five per IP and three per email, keyed
with secret-derived hashes. Raw IPs/emails are not stored in rate-limit tables.
The request email is encrypted at rest in a durable D1 job.

A worker looks up the exact email in the sandbox Paddle customers API, checks
active server-bound purchases, and chooses the actual recipient from Paddle's
customer record. An expiring email challenge is stored as a hash; its plaintext
and recipient are encrypted together for delivery. Challenge creation and the
outbox transition commit atomically. No email is sent inline in a webhook.

Resend uses a stable per-job idempotency key and identical retry payload, within
its 24-hour retention window. Jobs expire after 15 minutes, retry at most five
times, honor Retry-After and have at least 60 seconds between failed attempts.
Leases prevent concurrent workers from staging duplicate mail. Sensitive payloads
are erased after completion/final failure/expiry. Expired challenges and old
rate-limit buckets are deleted by the runner; minimal terminal job records are
removed a day after expiry.

The page requires saving a new recovery credential before redeeming an email
challenge. `POST /api/supporter/recovery/redeem` atomically consumes the challenge,
rotates the permanent credential and invalidates other outstanding challenges
for that intent. Expired/used codes and refunded purchases cannot recover.
A failed transaction rolls back both consumption and rotation. The new saved
credential can resume a purchase even if the redemption response was interrupted.

Request handling uses Pages waitUntil for an initial delivery attempt. Durable
retries require a separate scheduled Worker because Pages does not run cron
handlers. Deploy `ops/recovery-dispatch.js` using the inactive
`wrangler.recovery-worker.example.toml` template outside the publish root.
It calls `POST /api/supporter/recovery/process` each minute, protected by
`SUPPORTER_RECOVERY_JOB_TOKEN`. Its endpoint must be the exact sandbox URL;
redirects are not followed. Do not enable recovery before this runner is ready.

## Remaining implementation and validation

- Test the provisioned sandbox services with real sandbox checkout, declined payments,
  interrupted returns, webhook replays, pending/approved/partial refunds,
  chargebacks and email/reinstall recovery. Validate the real Paddle overlay and
  Turnstile against CSP. Current browser tests mock those third-party services.
- Add Android sandbox entitlement verification with a pinned public key, exact
  ES256/kid/issuer/audience/environment and timestamp checks, secure storage and
  refresh. Production must reject sandbox tokens. Decide offline/clock-change
  policy; a one-time purchase does not mean an unexpiring token.
- Audit Play/direct Full distribution separately before retiring F-Droid.
  Preserve applicationId `com.azimulkabir.actua`, versionCode monotonicity,
  signing compatibility, Keystore/storage/backups and all legacy Play products,
  including existing monthly supporters. Website ownership must be additive to
  valid Play ownership. Verify real release/Play App Signing certificates and
  upgrades; no Android changes are in this slice.
- Update legal/privacy sources before enabling real website sales. Eventual live
  payout intent is direct bank transfer to Bangladesh, not Payoneer. Revoke the
  previously exposed live API key; it was not read or reused here. No live
  migration or automatic merge is authorized.

Run `npm test` on Node 24 for real-SQLite/WebCrypto regression tests. The Functions
bundle builds with Wrangler 4.163.0. An additional local Miniflare/D1 flow tested
checkout/retry, signed completion, entitlement, queued recovery, credential
rotation and refund denial with all external services mocked. Mobile-width
Chromium checks exercised both pages, saved-code gating, reload recovery and
waiting for verified ownership. These are not remote Cloudflare, actual Paddle,
Resend delivery or Android compatibility tests.

### Android test-app return

The server-verified checkout completion section offers a fixed Android intent link
to the sandbox test package (`com.azimulkabir.actua.test`). It opens Support Actua;
the purchase key must still be entered in the app, which independently verifies
its entitlement. No credential or entitlement is included in the link. Release
Actua 2.7.0 does not handle sandbox activation. This requires the Android follow-up
to actua#1698 and an explicit sandbox deployment; production sales remain disabled.
