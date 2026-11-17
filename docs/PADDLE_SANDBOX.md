# Actua Paddle sandbox integration

Status: disabled sandbox checkout, verified fulfillment and Resend recovery code
are implemented. Cloudflare service configuration, real sandbox end-to-end tests
and Android website activation remain unfinished. Public `/support` still does
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
| Tax mode | `location` (returned from account settings) |
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

Cloudflare identity, existing bindings and plan limits could not be inspected
from this environment. No D1 database, encrypted Pages secrets, notification
destination, scheduled Worker or Resend service has been provisioned. The site's
existing Git integration automatically builds branch previews. Earlier direct
preview HTTP checks received Cloudflare 403 error 1010 on static and API routes,
so remote route behavior was not verified.

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
notification-settings response. No destination has been created yet.

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
No actual email has been sent in development; provider calls in tests are mocked.

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

- Provision Cloudflare bindings/secrets/Turnstile, Resend DNS/key and a sandbox
  notification destination; then test real sandbox checkout, declined payments,
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
