# Actua Website

The official website for [Actua](https://github.com/azimul-kabir/actua), a native Android app for Actual Budget.

## Hosting

This is a static website with no build step. It is deployed with Cloudflare Pages, which publishes `main` on every push.

### Cloudflare Pages

- **Production branch:** `main`
- **Framework preset:** None
- **Build command:** empty
- **Build output directory:** `/`
- **Custom domain:** `actua.azimulkabir.com`

Cloudflare Pages caches `style.css` for 4 hours, so `index.html` links it as `style.css?v=N`. Bump `N` whenever the stylesheet changes, otherwise returning visitors get new HTML with the old CSS.

`404.html` is served for unknown paths, and `robots.txt` points search engines at `sitemap.xml`.

### Legal pages

`privacy.html` and `terms.html` are generated from `PRIVACY.md` and `TERMS.md` in the [Actua repository](https://github.com/azimul-kabir/actua) by `scripts/update-legal.mjs`. Don't edit them by hand. The **Update legal pages** workflow runs it every four hours and commits any change, and the Actua repository can send a `privacy-updated` or `app-released` `repository_dispatch` event to update straight away. Run it locally with `node scripts/update-legal.mjs`.

### What's new

The **What's new** section and the release label in the hero are generated from the latest stable [Actua release](https://github.com/azimul-kabir/actua/releases). `scripts/update-whats-new.mjs` takes that release's Play Store notes (`fastlane/metadata/android/en-US/changelogs/<versionCode>.txt`), or the first bullets of its `CHANGELOG.md` section when there are none, and writes them between the `<!-- whats-new -->` and `<!-- release-pill -->` markers in `index.html`.

The **Update What's new** workflow runs it every hour and commits any change, which Cloudflare Pages then deploys. Run it by hand from the Actions tab, or locally with `node scripts/update-whats-new.mjs`. To update straight after a release instead of within the hour, the Actua release workflow can send a `repository_dispatch` event of type `app-released` to this repository.

### Promo video

The "See it in motion" section plays `images/actua-promo.mp4` (1080p landscape H.264, 71 seconds, about 5 MB) with the poster `images/actua-promo-poster.jpg`. It is self-hosted, so the page loads no third-party player or tracking, and `preload="none"` means the video only downloads when a visitor presses play. To replace it, overwrite both files and keep their names; Cloudflare Pages allows files up to 25 MiB.

### Supporter extras

The "Supporter extras" section (`#supporters`) describes the cosmetic perks of the Google Play version. Its four screenshots live in `images/screenshots/{light,dark}/` as `accent-colors.jpg`, `catppuccin.jpg`, `app-icon.jpg` and `widget-styles.jpg`; keep the copy in line with Settings → Supporter extras in the app. It also covers the Catppuccin themes and the greeting; only the Catppuccin themes have a screenshot.

The production website is:

https://actua.azimulkabir.com/

## Links

- Website: https://actua.azimulkabir.com/
- Developer website: https://www.azimulkabir.com
- Actua source and releases: https://github.com/azimul-kabir/actua
- Obtainium: https://apps.obtainium.imranr.dev/redirect?r=obtainium://add/https://github.com/azimul-kabir/actua
- Discord: https://discord.gg/FhedEyP97f
- Google Play: https://play.google.com/store/apps/details?id=com.azimulkabir.actua
- Report an issue: https://github.com/azimul-kabir/actua/issues/new/choose

### Website purchase preparation

`/support`, `/refund` and `/contact` are served from their `.html` files by
Cloudflare Pages' clean URL handling. The Supporter Extras website price is
US$2.99 once, approved by the maintainer. Checkout is deliberately unavailable:
Actua 2.7.0 supports Google Play purchases, not website license activation.
The new pages reuse `style.css` and add `support.css` for page-specific styles.

Before enabling website payments:

- Complete Paddle seller and domain approval and create the one-time product.
- Publish final website purchase/refund terms, trader details required for the
  sale, and accurate payment/licensing privacy disclosures. Update app legal
  Markdown at its source rather than hand-editing generated legal pages.
- Implement a compatible Full APK and backend: verified Paddle webhooks,
  idempotent fulfillment, signed entitlements, restoration and refund revocation.
- Test sandbox checkout, interrupted return, duplicate events, refund,
  reinstall/device recovery and existing Play supporter upgrades.
- Add Paddle Checkout only after those dependencies are ready. Keep API keys and
  webhook secrets on the backend; a checkout redirect must not grant access.

The legal generator preserves Support, Refund and Contact footer links. The app
repository's `.github/FUNDING.yml` can point to
`https://actua.azimulkabir.com/support` after these pages are deployed. This
website change does not alter app flavors, existing purchase rights or funding
configuration in the separate app repository.

### Paddle sandbox backend foundation

See [docs/PADDLE_SANDBOX.md](docs/PADDLE_SANDBOX.md) for the verified sandbox
catalog, Pages Functions/D1 architecture, endpoint behavior and deployment gates.
Run `npm test` with Node 24 for backend regression checks. The backend defaults
to disabled. Separately gated sandbox checkout and Resend recovery test pages are implemented;
public website checkout and Android website activation are not enabled.
