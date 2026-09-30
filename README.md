# Actua Website

The official website for [Actua](https://github.com/azimul-kabir/actua), a native Android app for Actual Budget.

## Hosting

This is a static website with no build step. It can be deployed for free with GitHub Pages or Cloudflare Workers.

### GitHub Pages

1. Open **Settings → Pages** in this repository.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select **main** and **/(root)**.
4. Save.

The site will be available at:

https://azimul-kabir.github.io/actua-website/

### Cloudflare Workers

`wrangler.jsonc` serves the repository root as static assets (files listed in `.assetsignore` are excluded).

When connecting the repository in the Cloudflare dashboard:

- **Build command:** leave empty
- **Deploy command:** `npx wrangler deploy`
- **Preview command:** `npx wrangler versions upload`

To deploy from your machine, run `npx wrangler deploy`.

## Links

- Actua: https://github.com/azimul-kabir/actua
- Discord: https://discord.gg/FyGxRjmhw
- Google Play access: https://groups.google.com/g/actua-testers
