# Paddle sandbox foundation

Status: backend foundation only; no deployed endpoint, checkout, or Android activation yet.
Website PR #23 merged on 2026-11-17. Public `/support` remains unavailable for
website purchases. Core budgeting remains free. This code cannot contact live
Paddle and does not require an API key to verify webhooks.

## Catalog verified on 2026-11-17

The sandbox catalog was empty before setup. Created and read back:

| Entity | ID / value |
| --- | --- |
| Product | `pro_01m7m61sqqhjfgcvc7hvawt8pf` — Actua Supporter Extras |
| Tax category | `standard` (downloadable software) |
| Price | `pri_01m7m61ssadksxp8jevddmtmhf` |
| Amount | USD `299` cents; non-recurring, no trial, quantity 1 |
| Tax mode | `location` (returned by Paddle from account settings) |

The price is a USD 2.99 base price; checkout must show the final applicable tax.
No live catalog, payout setting, checkout URL, or webhook destination was changed.
The eventual payout preference is direct bank transfer to Bangladesh, not Payoneer.
Revoke the previously exposed live API key in Paddle authentication settings;
that key was neither read nor reused by this setup.

Official skills used: [catalog setup](https://github.com/PaddleHQ/paddle-agent-skills/blob/main/skills/catalog-setup/SKILL.md),
[webhooks](https://github.com/PaddleHQ/paddle-agent-skills/blob/main/skills/webhooks/SKILL.md),
[checkout](https://github.com/PaddleHQ/paddle-agent-skills/blob/main/skills/checkout-web/SKILL.md),
and [sandbox testing](https://github.com/PaddleHQ/paddle-agent-skills/blob/main/skills/sandbox-testing/SKILL.md).

## Hosting decision

The repository README identifies Cloudflare Pages with repository root as its
static publish directory, no build step, and `main` as the production branch.
Pages Functions plus a dedicated sandbox D1 database fit that deployment without
introducing another hosting provider. D1 `batch` atomically persists fulfillment
and its event ledger. Neither a process-local map nor eventually consistent KV is
used for purchase ownership. `_routes.json` invokes Functions only under
`/api/supporter/*`; all existing static routes retain normal Pages handling.

Cloudflare account access, existing Pages configuration, plan limits and bindings
could not be verified: no Cloudflare identity is available in this environment.
No deployment, D1 provisioning, or webhook destination has been performed.
Use a separate sandbox Pages project/domain and D1 database for first deployment.
Keep the production site's backend disabled.

## Implemented behavior

- `POST /api/supporter/webhook` verifies HMAC-SHA256 over the exact raw bytes,
  accepts rotated `h1` signatures and rejects timestamp skew beyond 5 seconds.
  The request body is bounded to 256 KiB. Invalid signatures, malformed input,
  disabled configuration and storage failures receive non-2xx for Paddle retry.
- Only `transaction.completed` for the exact single-item USD catalog SKU,
  without a subscription, trial or discount, fulfills a purchase. Other events
  are acknowledged without granting access. No success URL can grant access.
- D1 stores transaction/customer IDs and minimal event metadata, no email,
  address, budget data or raw webhook payload. Each effect is independently
  idempotent; the ledger and effect commit in a single D1 batch transaction.
- Approved `refund` or `chargeback` adjustments create permanent revocation
  tombstones. Pending/rejected adjustments do not revoke. Since qualifying
  purchases have exactly one item, even a partial approved refund revokes the
  extras. Refunds arriving before completion remain effective. Chargeback
  reversals require manual reconciliation; no event automatically reactivates.
- `POST /api/supporter/entitlement` accepts a saved 256-bit recovery code only
  through `Authorization: Bearer ...`. It joins a server-bound purchase intent
  with a completed purchase and checks revocations. Transaction IDs, email
  addresses and redirect parameters alone never prove ownership.
- Recovery codes are stored only as SHA-256 hashes. Internal `createIntent` and
  `bindTransaction` helpers are ready for the next server checkout slice. There
  is deliberately no public endpoint to bind a client-supplied transaction.
- The response is a short-lived ES256 JWT with fixed sandbox issuer/audience,
  `kid`, opaque intent subject, `iat`, `nbf`, `exp`, and cosmetic `extras` claim.
  It contains neither recovery credentials nor customer/transaction IDs.
  Responses are `no-store`. There are no credential/payload logs or CORS grants.

## Preview deployment prerequisites

1. Verify the Cloudflare Pages project, Functions/D1 availability and a sandbox
   preview hostname. Create a dedicated sandbox D1 database and apply
   `migrations/0001_supporter.sql`. Never share its binding with live purchases.
2. Use `wrangler.sandbox.example.toml` as a reference for Pages settings. Its
   placeholder config is intentionally inactive. If copying it to
   `/workspace/work/wrangler.toml`, adjust both relative paths to
   `../actua-website` (as shown); other locations need their own relative paths.
   Do not add a real config with secrets to the static site root.
3. Set preview-only variables `PADDLE_ENVIRONMENT=sandbox`,
   `SUPPORTER_SANDBOX_ENABLED=true` and `SUPPORTER_SIGNING_KEY_ID=sandbox-1`.
   Missing bindings or variables fail closed. Production must leave enabled
   unset/false. The flag gates entitlement and webhook routes, not static pages.
4. Generate a dedicated ECDSA P-256 keypair in a secure operator environment.
   Store the **private JWK** as the Pages encrypted secret
   `SUPPORTER_SIGNING_JWK`; publish only the public key to the future sandbox app
   verifier. Never place private keys in a `.json` file under the publish root.
   Rotation must retain older public verification keys until tokens expire.
5. After the endpoint is deployed, inspect existing sandbox notification
   destinations and reuse one if suitable. Subscribe to `transaction.completed`,
   `adjustment.created`, and `adjustment.updated`, usage type Both for testing.
   Store its secret as `PADDLE_NOTIFICATION_WEBHOOK_SECRET` in encrypted Pages
   secrets. Never print the notification-settings response: it contains a secret.
6. Add Cloudflare request rate limits to public purchase/entitlement/recovery
   endpoints before opening a preview to testers. Exclude authorization headers
   and bodies from request logs. Agree retention/deletion rules for purchase,
   event and abandoned intent records before production design review.

## Next slices before enabling checkout

1. Implement a **server-side sandbox checkout creator**. Inspect/reuse a sandbox
   client-side token and default checkout URL first. Create an intent and its
   recovery code; create an automatic-collection Paddle transaction using ONLY
   the configured SKU; bind the returned transaction ID internally before giving
   the browser a checkout transaction. Use only `test_` client-side tokens and
   `Paddle.Environment.set('sandbox')` in browser code. Never expose the API key.
   Durable mapping/retry behavior must handle a transaction created just before
   a database or network failure. Client custom data must not decide ownership.
2. Implement secure delivery and recovery. A saved code already supports bearer
   recovery on another installation, but **no code is currently issued to users**.
   Add verified purchase-email recovery with a selected email provider, generic
   responses that do not reveal purchases, hashed short-lived single-use recovery
   challenges, atomic redemption/credential rotation, and rate limits by IP and
   normalized email. Obtain the recipient from trusted Paddle customer data,
   never from an unverified caller email. Do not email credentials inline in the
   webhook; use a durable outbox. Never put a code into a query string or logs.
3. Add Android sandbox verification/secure storage and refresh with a pinned
   public key, exact ES256 algorithm/kid/issuer/audience/environment validation,
   timestamp validation and no production acceptance of sandbox tokens. Existing
   tokens remain usable for at most 24 hours after a refund, so clients must
   enforce expiry and refresh; a one-time purchase does not mean an unexpiring
   token. Decide and document offline grace and clock-change behavior.
4. Audit Play/direct Full distribution separately before retiring F-Droid. Both
   current flavors use `com.azimulkabir.actua` and the same configured release
   signing key. Preserve these, versionCode monotonicity, storage/Keystore,
   backups and all legacy Play products (including existing monthly supporters).
   Keep the existing Play restoration path; website state must be additive to
   valid Play ownership. Test real signing certificates and Play App Signing
   compatibility rather than assuming configured key equality proves it.
5. Run sandbox checkout using Paddle's test card, interrupted/no return,
   webhook duplicates/replays, wrong product, pending/approved/partial refunds,
   chargebacks, refund-before-completion, reinstall/device recovery, expired
   recovery links and tokens, and existing Play supporter upgrade paths. Then
   update source legal/privacy disclosures before enabling the website button.

No live migration or merge is authorized by this foundation. Live onboarding and
payout review remain separate work.

## Validation

`npm test` uses Node 24's real SQLite engine against the migration and exercises
cryptographic verification, durable rollback, delivery order, duplicate events,
product filtering, authorization and signed JWT verification with a public key.
It uses only synthetic keys and events. It is not a deployed D1 integration test,
Paddle simulator test, browser checkout test or Android compatibility test.

The Functions bundle was also built with Wrangler 4.163.0 (`wrangler pages
functions build functions --outdir <outside-publish-root>`). A local Miniflare
Worker/D1 smoke check against that compiled bundle verified signed refund
receipt, duplicate deduplication, missing-signature rejection and method handling.
This checks local runtime compatibility, not Cloudflare account deployment.
