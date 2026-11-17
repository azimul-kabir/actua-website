# Purchase wizard browser checks

Run `python tests/browser/purchase-flow.py` with Node 24, Python's `playwright`
package and Chromium installed. The runner starts a localhost-only fixture server
on port 4173 (override with `PURCHASE_TEST_PORT`) and launches a separate headless
browser. It does not attach to a user's browser or need service credentials.

Paddle, Turnstile and all purchase/recovery POST responses are mocked. Ten journeys
cover mobile/desktop, light/dark checkout, saved-key gating, same-key requests,
query/checkout-success non-activation, reload preservation, recovery success,
expired challenges and interrupted redemption. They supplement `npm test`; they
are not evidence of real Paddle payments or email delivery.

Set `PURCHASE_TEST_SCREENSHOTS` to a scratch directory outside the publish root
to capture previews. Fixture email and codes are synthetic; never substitute real
credentials or customer data.
