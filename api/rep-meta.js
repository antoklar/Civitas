// /api/rep-meta — serves public/representative.html with server-rendered
// <title>/OG/Twitter/JSON-LD tags for a specific member of Congress, so
// social crawlers (which don't execute JS) see the right preview when a
// /representative.html?bioguide=ID link is shared. Wired up in vercel.json
// to intercept that route only when a `bioguide` query param is present;
// the client-side JS in representative.html still renders the full page
// (and updates the same tags) once it loads.

const fs = require('fs');
const path = require('path');

const STATE_NAMES = {
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California', CO:'Colorado',
  CT:'Connecticut', DE:'Delaware', FL:'Florida', GA:'Georgia', HI:'Hawaii', ID:'Idaho',
  IL:'Illinois', IN:'Indiana', IA:'Iowa', KS:'Kansas', KY:'Kentucky', LA:'Louisiana',
  ME:'Maine', MD:'Maryland', MA:'Massachusetts', MI:'Michigan', MN:'Minnesota', MS:'Mississippi',
  MO:'Missouri', MT:'Montana', NE:'Nebraska', NV:'Nevada', NH:'New Hampshire', NJ:'New Jersey',
  NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota', OH:'Ohio',
  OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina',
  SD:'South Dakota', TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont', VA:'Virginia',
  WA:'Washington', WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming', DC:'District of Columbia',
  PR:'Puerto Rico', GU:'Guam', VI:'U.S. Virgin Islands', AS:'American Samoa', MP:'Northern Mariana Islands',
};

function escapeAttr(str = '') {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeText(str = '') {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function setMetaContentById(html, id, value) {
  const re = new RegExp(`(<meta\\b[^>]*\\bid="${id}"[^>]*\\bcontent=")[^"]*(")`, 'i');
  return html.replace(re, (m, p1, p2) => `${p1}${escapeAttr(value)}${p2}`);
}
function setLinkHrefById(html, id, value) {
  const re = new RegExp(`(<link\\b[^>]*\\bid="${id}"[^>]*\\bhref=")[^"]*(")`, 'i');
  return html.replace(re, (m, p1, p2) => `${p1}${escapeAttr(value)}${p2}`);
}
function setTitleById(html, id, value) {
  const re = new RegExp(`(<title\\b[^>]*\\bid="${id}"[^>]*>)[^<]*(</title>)`, 'i');
  return html.replace(re, (m, p1, p2) => `${p1}${escapeText(value)}${p2}`);
}
function setScriptJsonById(html, id, jsonValue) {
  const re = new RegExp(`(<script\\b[^>]*\\bid="${id}"[^>]*>)[\\s\\S]*?(</script>)`, 'i');
  return html.replace(re, (m, p1, p2) => `${p1}${jsonValue}${p2}`);
}

function buildOfficeName(m) {
  const isSen = /senator/i.test(m.chamber || '');
  if (isSen) return 'U.S. Senator';
  const districtPart = m.district === 0 ? ', At-Large' : (m.district != null && m.district !== '' ? `, District ${m.district}` : '');
  return `U.S. Representative${districtPart}`;
}

function buildTitle(m) {
  const office = buildOfficeName(m);
  const stateFull = m.state || '';
  if (/senator/i.test(office)) return `${m.name} - ${office}${stateFull ? ' ' + stateFull : ''} | Civitas`;
  return `${m.name} - ${office}${stateFull ? `, ${stateFull}` : ''} | Civitas`;
}

function buildDescription(m) {
  const office = buildOfficeName(m).replace(/^,\s*/, '');
  const stateFull = m.state || '';
  return `${m.name} is the ${office}${stateFull ? ` for ${stateFull}` : ''}. See voting record, committee assignments, sponsored legislation, and campaign donors on Civitas.`;
}

module.exports = async (req, res) => {
  const bioguideId = (req.query.bioguide || '').toString().trim();
  const templatePath = path.join(__dirname, '..', 'public', 'representative.html');
  let html = fs.readFileSync(templatePath, 'utf8');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!bioguideId) return res.status(200).send(html);

  try {
    const host  = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const apiUrl = `${proto}://${host}/api/congress?action=search&bioguideId=${encodeURIComponent(bioguideId)}`;

    const r = await fetch(apiUrl);
    const m = await r.json();
    if (!r.ok || m.error) return res.status(200).send(html);

    // Normalize full state name in case the upstream ever returns an abbreviation.
    m.state = STATE_NAMES[m.state] || m.state;

    const pageUrl = `https://civitasus.com/representative.html?bioguide=${encodeURIComponent(bioguideId)}`;
    const title = buildTitle(m);
    const description = buildDescription(m);
    const image = m.photoUrl || 'https://civitasus.com/icons/icon-512.png';

    html = setTitleById(html, 'metaTitle', title);
    html = setMetaContentById(html, 'metaDescription', description);
    html = setLinkHrefById(html, 'canonicalLink', pageUrl);
    html = setMetaContentById(html, 'ogTitle', title);
    html = setMetaContentById(html, 'ogDescription', description);
    html = setMetaContentById(html, 'ogUrl', pageUrl);
    html = setMetaContentById(html, 'ogImage', image);
    html = setMetaContentById(html, 'twitterTitle', title);
    html = setMetaContentById(html, 'twitterDescription', description);
    html = setMetaContentById(html, 'twitterImage', image);

    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: m.name,
      jobTitle: buildOfficeName(m),
      image,
      url: pageUrl,
      address: m.state ? { '@type': 'PostalAddress', addressRegion: m.state, addressCountry: 'US' } : undefined,
      memberOf: m.party ? { '@type': 'Organization', name: m.party } : undefined,
    };
    html = setScriptJsonById(html, 'personSchema', JSON.stringify(jsonLd));

    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).send(html);
  } catch {
    return res.status(200).send(html);
  }
};
