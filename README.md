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

`404.html` is served for unknown paths, and `robots.txt` points search engines at `sitemap.xml`.

### What's new

The **What's new** section and the release label in the hero are generated from the latest stable [Actua release](https://github.com/azimul-kabir/actua/releases). `scripts/update-whats-new.mjs` takes that release's Play Store notes (`fastlane/metadata/android/en-US/changelogs/<versionCode>.txt`), or the first bullets of its `CHANGELOG.md` section when there are none, and writes them between the `<!-- whats-new -->` and `<!-- release-pill -->` markers in `index.html`.

The **Update What's new** workflow runs it every hour and commits any change, which Cloudflare Pages then deploys. Run it by hand from the Actions tab, or locally with `node scripts/update-whats-new.mjs`. To update straight after a release instead of within the hour, the Actua release workflow can send a `repository_dispatch` event of type `app-released` to this repository.

The production website is:

https://actua.azimulkabir.com/

## Links

- Website: https://actua.azimulkabir.com/
- Developer website: https://www.azimulkabir.com
- Actua source and releases: https://github.com/azimul-kabir/actua
- Obtainium: https://apps.obtainium.imranr.dev/redirect?r=obtainium://add/https://github.com/azimul-kabir/actua
- Discord: https://discord.gg/FhedEyP97f
- Google Play testing: https://groups.google.com/g/actua-testers (public release under review)
- Report an issue: https://github.com/azimul-kabir/actua/issues/new/choose
