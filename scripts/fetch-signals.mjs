// Pull FREE, live demand signals for each market and blend them into a 1-10
// score. Two sources, both keyless and open:
//
//   1. Hacker News (Algolia) search  -> tech / pain-point interest (B2B skew)
//      https://hn.algolia.com/api
//   2. Wikipedia pageviews (Wikimedia REST) -> general public interest
//      https://wikimedia.org/api/rest_v1/  (corrects HN's SMB blind spot)
//
// HN alone under-rates local/SMB verticals (auto shops, salons) because that
// crowd doesn't discuss them. Wikipedia pageviews give those a fair baseline.
// Blended demand = 50% HN + 50% Wikipedia, each log-normalised across markets.
//
// Output: JSON on stdout (the dashboard reads this as data.json). Diagnostics
// go to stderr so `node fetch-signals.mjs > data.json` stays clean.

const MARKETS = [
  { name: "Small contractor job management",        hn: ["construction management software", "contractor software"],        wiki: ["General contractor", "Construction management"] },
  { name: "Independent landlord / property mgmt",   hn: ["property management software", "landlord software"],              wiki: ["Property management", "Landlord"] },
  { name: "Subcontractor scheduling & dispatch",    hn: ["field service dispatch software", "job scheduling software"],     wiki: ["Subcontractor", "Field service management"] },
  { name: "Building inspection & surveying",        hn: ["building inspection software", "site survey software"],           wiki: ["Home inspection", "Building inspection"] },
  { name: "Trades CRM & quoting",                   hn: ["field service CRM", "trades quoting software"],                   wiki: ["Field service management", "Tradesperson"] },
  { name: "Independent gym / studio ops",           hn: ["gym management software", "fitness studio software"],             wiki: ["Health club", "Physical fitness"] },
  { name: "Auto repair shop management",            hn: ["auto repair shop software", "automotive shop management software"], wiki: ["Automobile repair shop", "Maintenance (technical)"] },
  { name: "Salon / barber booking & CRM",           hn: ["salon booking software", "barber booking app"],                   wiki: ["Beauty salon", "Barber"] },
  { name: "Independent restaurant back-office",     hn: ["restaurant management software", "restaurant inventory software"], wiki: ["Restaurant", "Restaurant management"] },
  { name: "Small professional services (acct/law)", hn: ["practice management software", "legal case management software"], wiki: ["Accountant", "Law firm"] },
];

const HN_WINDOW_YEARS = 3;
const WIKI_WINDOW_MONTHS = 12;
const HN_WEIGHT = 0.5;   // tech / pain-point signal
const WIKI_WEIGHT = 0.5; // general-interest baseline

const UA = "underserved-market-tracker/1.0 (https://github.com/alecsandford101/underserved-market-tracker)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log1p = (x) => Math.log(1 + x);

// ---- Hacker News ----
const hnCutoff = Math.floor(Date.now() / 1000) - HN_WINDOW_YEARS * 365 * 24 * 3600;
async function hnSearch(term) {
  const url = "https://hn.algolia.com/api/v1/search?" + new URLSearchParams({
    query: term, tags: "story", numericFilters: `created_at_i>${hnCutoff}`, hitsPerPage: "50",
  });
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HN ${res.status} for "${term}"`);
  const j = await res.json();
  const attention = (j.hits || []).reduce((s, h) => s + (h.points || 0) + (h.num_comments || 0), 0);
  return (j.nbHits || 0) + attention * 0.05; // stories + discounted attention
}

// ---- Wikipedia pageviews ----
function ymd(d) { return d.toISOString().slice(0, 10).replace(/-/g, "") + "00"; }
const wikiEnd = new Date();
const wikiStart = new Date(Date.UTC(wikiEnd.getUTCFullYear(), wikiEnd.getUTCMonth() - WIKI_WINDOW_MONTHS, 1));
async function wikiViews(article) {
  const title = encodeURIComponent(article.replace(/ /g, "_"));
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${title}/monthly/${ymd(wikiStart)}/${ymd(wikiEnd)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (res.status === 404) return 0; // article missing / no data -> ignore
  if (!res.ok) throw new Error(`Wiki ${res.status} for "${article}"`);
  const j = await res.json();
  return (j.items || []).reduce((s, it) => s + (it.views || 0), 0);
}

async function main() {
  const rows = [];
  for (const m of MARKETS) {
    let hnRaw = 0, wikiRaw = 0;
    for (const t of m.hn)   { try { hnRaw   += await hnSearch(t); }   catch (e) { console.error("  ! " + e.message); } await sleep(200); }
    for (const a of m.wiki) { try { wikiRaw += await wikiViews(a); }  catch (e) { console.error("  ! " + e.message); } await sleep(200); }
    rows.push({ name: m.name, hnRaw, wikiRaw });
    console.error(`  ${m.name.padEnd(46)} hn=${String(Math.round(hnRaw)).padStart(5)}  wiki=${String(wikiRaw).padStart(8)}`);
  }

  // log-normalise each source independently to 0..1, then blend to 1..10
  const maxHnLog   = Math.max(...rows.map((r) => log1p(r.hnRaw)))   || 1;
  const maxWikiLog = Math.max(...rows.map((r) => log1p(r.wikiRaw))) || 1;
  for (const r of rows) {
    const hnN   = log1p(r.hnRaw)   / maxHnLog;
    const wikiN = log1p(r.wikiRaw) / maxWikiLog;
    r.hnScore    = Math.round((1 + 9 * hnN) * 10) / 10;
    r.wikiScore  = Math.round((1 + 9 * wikiN) * 10) / 10;
    r.demandScore = Math.round((1 + 9 * (HN_WEIGHT * hnN + WIKI_WEIGHT * wikiN)) * 10) / 10;
  }

  const ranked = [...rows].sort((a, b) => b.demandScore - a.demandScore);
  console.error(`\n=== Blended demand (HN ${HN_WINDOW_YEARS}y + Wikipedia ${WIKI_WINDOW_MONTHS}mo) ===`);
  for (const r of ranked) {
    console.error(`  ${String(r.demandScore).padStart(4)}  (hn ${String(r.hnScore).padStart(4)} / wiki ${String(r.wikiScore).padStart(4)})  ${r.name}`);
  }

  process.stdout.write(JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: "Hacker News (Algolia) + Wikipedia pageviews",
    method: `Blended demand = ${HN_WEIGHT * 100}% HN discussion (${HN_WINDOW_YEARS}y) + ${WIKI_WEIGHT * 100}% Wikipedia pageviews (${WIKI_WINDOW_MONTHS}mo), log-normalised to 1-10.`,
    markets: rows.map(({ name, demandScore, hnScore, wikiScore }) => ({ name, demandScore, hnScore, wikiScore })),
  }, null, 2) + "\n");
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
