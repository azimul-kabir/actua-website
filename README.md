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
