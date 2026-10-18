// Fetches PRIVACY.md from azimul-kabir/actua, converts it to semantic HTML,
// and generates privacy.html styled to match the Actua website.
//
// Usage: node scripts/update-privacy.mjs
//   GH_TOKEN  optional, raises the GitHub API rate limit

import { readFile, writeFile, appendFile } from 'node:fs/promises';

const APP_REPO = 'azimul-kabir/actua';
const PRIVACY_PATH = 'PRIVACY.md';
const PAGE = new URL('../privacy.html', import.meta.url);

class NetworkError extends Error {}

async function get(url, { headers = {} } = {}) {
  const reqHeaders = { 'User-Agent': 'actua-website', ...headers };
  if (process.env.GH_TOKEN && !reqHeaders.Authorization) {
    reqHeaders.Authorization = `Bearer ${process.env.GH_TOKEN}`;
  }
  let res;
  try {
    res = await fetch(url, { headers: reqHeaders });
  } catch (err) {
    throw new NetworkError(`${url}: ${err.message}`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new NetworkError(`${url}: HTTP ${res.status}`);
  return res.text();
}

async function fetchPrivacyMarkdown() {
  // 1. Try authenticated GitHub API for raw contents
  try {
    const text = await get(`https://api.github.com/repos/${APP_REPO}/contents/${PRIVACY_PATH}`, {
      headers: { Accept: 'application/vnd.github.raw+json' },
    });
    if (text) return text;
  } catch (err) {
    // Fall back to raw URL if API call fails
  }

  // 2. Fall back to raw.githubusercontent.com
  const rawText = await get(`https://raw.githubusercontent.com/${APP_REPO}/main/${PRIVACY_PATH}`);
  if (!rawText) throw new Error(`Could not find ${PRIVACY_PATH} in ${APP_REPO}`);
  return rawText;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInline(text) {
  const codeSnippets = [];
  let s = text.replace(/`([^`]+)`/g, (_, code) => {
    const idx = codeSnippets.length;
    codeSnippets.push(`<code>${escapeHtml(code)}</code>`);
    return `__CODE_${idx}__`;
  });

  s = escapeHtml(s);

  // Markdown links: [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const safeUrl = escapeHtml(url);
    const isExternal = /^https?:\/\//.test(url);
    const targetAttr = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${safeUrl}"${targetAttr}>${label}</a>`;
  });

  // Bold: **text**
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italic: *text* or _text_
  s = s.replace(/(^|[^\w])\*([^*]+)\*($|[^\w])/g, '$1<em>$2</em>$3');
  s = s.replace(/(^|[^\w])_([^_]+)_($|[^\w])/g, '$1<em>$2</em>$3');

  // Restore inline code
  s = s.replace(/__CODE_(\d+)__/g, (_, idx) => codeSnippets[Number(idx)]);
  return s;
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function formatDate(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${isoDate}T00:00:00Z`));
}

function parseMarkdown(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let title = 'Privacy Policy';
  let lastUpdated = '';
  const blocks = [];
  let currentLines = [];
  let inList = false;
  let listItems = [];

  function flushParagraph() {
    if (currentLines.length > 0) {
      const text = currentLines.join(' ').trim();
      if (text) {
        blocks.push(`<p>${renderInline(text)}</p>`);
      }
      currentLines = [];
    }
  }

  function flushList() {
    if (listItems.length > 0) {
      const lis = listItems.map((item) => `          <li>${renderInline(item.trim())}</li>`).join('\n');
      blocks.push(`<ul>\n${lis}\n        </ul>`);
      listItems = [];
    }
    inList = false;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (trimmed.startsWith('# ')) {
      flushParagraph();
      flushList();
      title = trimmed.slice(2).trim();
      continue;
    }

    const dateMatch = trimmed.match(/^_Last updated:\s*([^_]+)_$/i);
    if (dateMatch) {
      flushParagraph();
      flushList();
      lastUpdated = dateMatch[1].trim();
      continue;
    }

    if (trimmed.startsWith('## ')) {
      flushParagraph();
      flushList();
      const hText = trimmed.slice(3).trim();
      const slug = slugify(hText);
      blocks.push(`<h2 id="${slug}">${renderInline(hText)}</h2>`);
      continue;
    }

    if (trimmed.startsWith('### ')) {
      flushParagraph();
      flushList();
      const hText = trimmed.slice(4).trim();
      const slug = slugify(hText);
      blocks.push(`<h3 id="${slug}">${renderInline(hText)}</h3>`);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      flushParagraph();
      inList = true;
      listItems.push(trimmed.replace(/^[-*]\s+/, ''));
      continue;
    }

    if (inList && (/^\s{2,}/.test(line) || /^\t+/.test(line))) {
      listItems[listItems.length - 1] += ' ' + trimmed;
      continue;
    }

    if (inList) {
      flushList();
    }

    currentLines.push(trimmed);
  }

  flushParagraph();
  flushList();

  return { title, lastUpdated, html: blocks.join('\n\n        ') };
}

function buildHtml({ title, lastUpdated, html }) {
  const metaDate = lastUpdated ? formatDate(lastUpdated) : '';
  const dateSnippet = lastUpdated
    ? `<span>Last updated: <time datetime="${escapeHtml(lastUpdated)}">${metaDate}</time></span><span class="legal-meta-separator" aria-hidden="true">·</span>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#4B18D1">
  <meta name="description" content="Privacy Policy for Actua, an independent native Android client for Actual Budget. Explains how your budget data, credentials, and permissions are handled.">
  <title>${escapeHtml(title)} · Actua</title>
  <link rel="canonical" href="https://actua.azimulkabir.com/privacy.html">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Actua">
  <meta property="og:title" content="${escapeHtml(title)} · Actua">
  <meta property="og:description" content="Privacy Policy for Actua, an independent native Android client for Actual Budget. Free, open source, and privacy-focused.">
  <meta property="og:url" content="https://actua.azimulkabir.com/privacy.html">
  <meta property="og:image" content="https://actua.azimulkabir.com/images/actua-hero.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="675">
  <meta property="og:image:alt" content="Actua, a native Android client for Actual Budget">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/images/favicon-32.png" type="image/png" sizes="32x32">
  <link rel="apple-touch-icon" href="/images/apple-touch-icon.png">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header class="topbar">
    <a class="brand" href="/" aria-label="Actua home">
      <img class="brand-mark" src="/images/actua-icon.svg" alt="" width="38" height="38">
      <span>Actua</span>
    </a>
    <nav>
      <a href="/#features">Features</a>
      <a href="/#screenshots">Screenshots</a>
      <a class="nav-keep" href="/#download">Download</a>
      <a href="/#faq">FAQ</a>
      <a class="nav-button" href="https://github.com/azimul-kabir/actua">
        <svg class="icon-svg" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
        GitHub
      </a>
    </nav>
  </header>

  <main>
    <div class="legal-container">
      <article class="legal-card">
        <header class="legal-header">
          <div class="eyebrow">LEGAL &amp; PRIVACY</div>
          <h1>${escapeHtml(title)}</h1>
          <p class="legal-meta">
            ${dateSnippet}
            <a href="https://github.com/azimul-kabir/actua/blob/main/PRIVACY.md" target="_blank" rel="noopener noreferrer">Source on GitHub ↗</a>
          </p>
        </header>

        <div class="legal-body">
        ${html}
        </div>
      </article>
    </div>
  </main>

  <footer>
    <div class="footer-about">
      <div class="footer-brand"><img class="brand-mark" src="/images/actua-icon.svg" alt="" width="32" height="32"><strong>Actua</strong></div>
      <p>Native Android app for Actual Budget.<br>Built by <a href="https://www.azimulkabir.com">Azimul Kabir</a> and the community.</p>
    </div>
    <div class="footer-links">
      <a href="https://github.com/azimul-kabir/actua">
        <svg class="icon-svg" viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
        GitHub
      </a>
      <a href="https://discord.gg/FhedEyP97f">
        <svg class="icon-svg" viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.078.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.127c-.598.35-1.22.645-1.873.892a.076.076 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.673-3.548-13.662a.06.06 0 0 0-.031-.028zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.334-.955 2.419-2.157 2.419zm7.974 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.334-.946 2.419-2.157 2.419z"/></svg>
        Discord
      </a>
      <a href="https://www.azimulkabir.com">
        <svg class="icon-svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        Developer website
      </a>
      <a href="https://actualbudget.org/">
        <svg class="icon-svg" viewBox="0 0 30 32" width="14" height="15" fill="currentColor" aria-hidden="true"><path d="m1.138 30.423 13.8-29.309a.32.32 0 0 1 .289-.184h.605a.32.32 0 0 1 .287.18l8.903 18.29 2.791-1.074a.32.32 0 0 1 .414.184l.742 1.932a.32.32 0 0 1-.183.413l-2.574.99 3.175 6.524a.32.32 0 0 1-.147.428l-1.861.905a.32.32 0 0 1-.428-.147l-3.277-6.733-21.98 8.453a.32.32 0 0 1-.415-.189l-.152-.418a.32.32 0 0 1 .01-.245M15.56 6.152 5.85 26.774l16.634-6.398z"/><path d="m21.777 14.568.932 2.544-21.203 7.775a.32.32 0 0 1-.41-.19l-.713-1.944a.32.32 0 0 1 .19-.41z"/></svg>
        Actual Budget
      </a>
      <a href="/privacy.html" aria-current="page">Privacy Policy</a>
      <a href="https://github.com/azimul-kabir/actua/blob/main/LICENSE">MIT License</a>
    </div>
    <small>Actua is an independent open-source project and is not affiliated with Actual Budget.</small>
  </footer>
</body>
</html>
`;
}

async function main() {
  let md;
  try {
    md = await fetchPrivacyMarkdown();
  } catch (err) {
    if (!(err instanceof NetworkError)) throw err;
    console.log(`::warning::Could not fetch ${PRIVACY_PATH}: ${err.message}`);
    return;
  }

  const parsed = parseMarkdown(md);
  const newHtml = buildHtml(parsed);

  let existing = '';
  try {
    existing = await readFile(PAGE, 'utf8');
  } catch {
    // File may not exist yet
  }

  const changed = newHtml !== existing;
  if (changed) {
    await writeFile(PAGE, newHtml);
  }

  console.log(`Privacy Policy (Last updated: ${parsed.lastUpdated || 'unknown'}): ${changed ? 'updated privacy.html' : 'already up to date'}`);

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\nlast_updated=${parsed.lastUpdated}\n`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
