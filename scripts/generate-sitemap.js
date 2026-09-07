#!/usr/bin/env node
// Regenerates public/sitemap.xml — the site's own page, the about page, and
// one entry per current member of Congress (the only representatives with a
// stable, crawlable URL: /representative.html?bioguide=ID — see api/rep-meta.js
// and the sessionStorage/query-param fallback in public/representative.html).
// State and local officials don't have stable ids in this codebase, so they
// aren't individually indexable yet.
//
// Run manually after a new Congress is sworn in, or periodically via cron:
//   node scripts/generate-sitemap.js

const fs = require('fs');
const path = require('path');

const LEG_URL = 'https://unitedstates.github.io/congress-legislators/legislators-current.json';
const SITE = 'https://civitasus.com';

async function main() {
  const res = await fetch(LEG_URL);
  if (!res.ok) throw new Error(`Failed to fetch legislators: ${res.status}`);
  const legislators = await res.json();

  const today = new Date().toISOString().slice(0, 10);

  const urls = [
    { loc: `${SITE}/`, changefreq: 'weekly', priority: '1.0' },
    { loc: `${SITE}/about.html`, changefreq: 'monthly', priority: '0.5' },
  ];

  const seen = new Set();
  legislators.forEach((leg) => {
    const bioguide = leg.id?.bioguide;
    if (!bioguide || seen.has(bioguide)) return;
    seen.add(bioguide);
    urls.push({
      loc: `${SITE}/representative.html?bioguide=${encodeURIComponent(bioguide)}`,
      changefreq: 'monthly',
      priority: '0.7',
    });
  });

  const body = urls.map((u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;

  const outPath = path.join(__dirname, '..', 'public', 'sitemap.xml');
  fs.writeFileSync(outPath, xml);
  console.log(`Wrote ${urls.length} URLs to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
