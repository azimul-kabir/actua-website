# Sandbox-only search exclusion

`actua-sandbox.azimulkabir.com` serves a copy of the public site. These two files
keep it out of search results:

- `robots.txt` replaces the repository's `robots.txt` and disallows everything.
- `_headers` adds `X-Robots-Tag: noindex, nofollow` to every static response.

When assembling the sandbox's static publish directory (see `docs/PADDLE_SANDBOX.md`),
copy both files into it after copying the site, so they overwrite `robots.txt` and add
`_headers`. Do not copy them into the repository root or into the production deploy:
the production site must stay indexable. The checkout and recovery pages already send
`X-Robots-Tag: noindex, nofollow` from their Functions.
