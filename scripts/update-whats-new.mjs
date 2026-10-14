// Fills the "What's new" section and the hero release label in index.html
// from the latest stable Actua release.
//
// The bullets come from the release's Play Store notes
// (fastlane/metadata/android/en-US/changelogs/<versionCode>.txt at the
// release tag). Releases without them fall back to the first bullets of that
// version's CHANGELOG.md section.
//
// Usage: node scripts/update-whats-new.mjs
//   GH_TOKEN     optional, raises the GitHub API rate limit
//   RELEASE_TAG  optional, use this tag instead of asking the API (needs RELEASE_DATE)
//   RELEASE_DATE optional, YYYY-MM-DD, used with RELEASE_TAG

import { readFile, writeFile, appendFile } from 'node:fs/promises';

const APP_REPO = 'azimul-kabir/actua';
const PAGE = new URL('../index.html', import.meta.url);
const MAX_ITEMS = 5;

class NetworkError extends Error {}

async function get(url, { json = false } = {}) {
  const headers = { 'User-Agent': 'actua-website' };
  if (json) {
    headers.Accept = 'application/vnd.github+json';
    if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
  }
  let res;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    throw new NetworkError(`${url}: ${err.message}`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new NetworkError(`${url}: HTTP ${res.status}`);
  return json ? res.json() : res.text();
}

const raw = (tag, path) => get(`https://raw.githubusercontent.com/${APP_REPO}/${tag}/${path}`);

// Newest published, non-draft, non-prerelease release; same rule as azimulkabir.com.
async function latestRelease() {
  if (process.env.RELEASE_TAG) {
    if (!process.env.RELEASE_DATE) throw new Error('RELEASE_TAG needs RELEASE_DATE');
    return { tag: process.env.RELEASE_TAG, date: process.env.RELEASE_DATE };
  }
  const releases = await get(`https://api.github.com/repos/${APP_REPO}/releases?per_page=100`, { json: true });
  const stable = (releases ?? [])
    .filter((r) => !r.draft && !r.prerelease && r.published_at)
    .sort((a, b) => a.published_at.localeCompare(b.published_at));
  const last = stable.at(-1);
  if (!last) throw new Error(`No stable release found in ${APP_REPO}`);
  return { tag: last.tag_name, date: last.published_at.slice(0, 10) };
}

async function storeNotes(tag) {
  const gradle = await raw(tag, 'app/build.gradle.kts');
  const code = gradle?.match(/versionCode\s*=\s*(\d+)/)?.[1];
  if (!code) return [];
  const notes = await raw(tag, `fastlane/metadata/android/en-US/changelogs/${code}.txt`);
  return (notes ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[•*-]\s+/.test(line))
    .map((line) => line.replace(/^[•*-]\s+/, ''));
}

async function changelogNotes(tag, version) {
  const changelog = await raw(tag, 'CHANGELOG.md');
  if (!changelog) return [];
  const start = changelog.indexOf(`## [${version}]`);
  if (start === -1) return [];
  const rest = changelog.slice(start + 3);
  const section = rest.slice(0, rest.search(/^## /m) === -1 ? undefined : rest.search(/^## /m));
  return section
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) =>
      line
        .slice(2)
        .replace(/\s*\(\[#\d+\]\([^)]*\)\)\s*$/, '') // trailing "([#123](…))"
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // other links keep their text
        .trim(),
    );
}

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const inline = (s) => escapeHtml(s).replace(/`([^`]+)`/g, '<code>$1</code>');

function formatDate(isoDate) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${isoDate}T00:00:00Z`));
}

function renderPill(version) {
  return `<a class="release-pill" href="#whats-new"><span>New</span>Actua ${escapeHtml(version)} is out →</a>`;
}

function renderSection({ tag, version, date, items }) {
  const releaseUrl = `https://github.com/${APP_REPO}/releases/tag/${encodeURIComponent(tag)}`;
  const changelogUrl = `https://github.com/${APP_REPO}/blob/main/CHANGELOG.md`;
  const lis = items.map((item) => `          <li>${inline(item)}</li>`).join('\n');
  return `<section id="whats-new" class="section whats-new">
      <div class="whats-new-card">
        <div class="section-heading">
          <div class="eyebrow">WHAT'S NEW</div>
          <h2>Actua ${escapeHtml(version)}</h2>
          <p>Released <time datetime="${date}">${formatDate(date)}</time>.</p>
          <p class="whats-new-links">
            <a href="${releaseUrl}">Release notes →</a>
            <a href="${changelogUrl}">Full changelog →</a>
          </p>
        </div>
        <ul>
${lis}
        </ul>
      </div>
    </section>`;
}

function replaceBetween(html, name, content) {
  const re = new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(<!-- ${name}:end -->)`);
  if (!re.test(html)) throw new Error(`index.html is missing the <!-- ${name}:start/end --> markers`);
  return html.replace(re, (_, start, end) => `${start}\n${content}${end}`);
}

async function main() {
  let release;
  let items;
  try {
    release = await latestRelease();
    release.version = release.tag.replace(/^v/, '');
    items = await storeNotes(release.tag);
    if (items.length === 0) items = await changelogNotes(release.tag, release.version);
  } catch (err) {
    if (!(err instanceof NetworkError)) throw err;
    // A GitHub hiccup shouldn't fail the hourly run; the next one will try again.
    console.log(`::warning::Could not read the latest release: ${err.message}`);
    return;
  }
  items = items.slice(0, MAX_ITEMS);
  if (items.length === 0) {
    throw new Error(`No store notes or CHANGELOG.md entries found for ${release.tag}`);
  }

  const before = await readFile(PAGE, 'utf8');
  let html = replaceBetween(before, 'release-pill', `        ${renderPill(release.version)}\n        `);
  html = replaceBetween(html, 'whats-new', `    ${renderSection({ ...release, items })}\n    `);

  const changed = html !== before;
  if (changed) await writeFile(PAGE, html);
  console.log(`${release.tag} (${release.date}): ${changed ? 'updated index.html' : 'already up to date'}`);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `version=${release.version}\nchanged=${changed}\n`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
