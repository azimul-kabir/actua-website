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

### What's new

The **What's new** section and the release label in the hero are generated from the latest stable [Actua release](https://github.com/azimul-kabir/actua/releases). `scripts/update-whats-new.mjs` takes that release's Play Store notes (`fastlane/metadata/android/en-US/changelogs/<versionCode>.txt`), or the first bullets of its `CHANGELOG.md` section when there are none, and writes them between the `<!-- whats-new -->` and `<!-- release-pill -->` markers in `index.html`.

The **Update What's new** workflow runs it every hour and commits any change, which Cloudflare Pages then deploys. Run it by hand from the Actions tab, or locally with `node scripts/update-whats-new.mjs`. To update straight after a release instead of within the hour, the Actua release workflow can send a `repository_dispatch` event of type `app-released` to this repository.

### Promo video

The "See it in motion" section plays `images/actua-promo.mp4` (1080p H.264, about 5 MB) with the poster `images/actua-promo-poster.jpg`. It is self-hosted, so the page loads no third-party player or tracking, and `preload="none"` means the video only downloads when a visitor presses play. To replace it, overwrite both files and keep their names; Cloudflare Pages allows files up to 25 MiB.

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
