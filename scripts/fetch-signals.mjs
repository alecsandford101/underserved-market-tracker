// Pull FREE, live signals for each market and turn them into 1-10 scores.
// Three keyless, open sources — no paid APIs, no keys to store:
//
//   DEMAND
//     1. Hacker News (Algolia) search  -> tech / pain-point interest (B2B skew)
//        https://hn.algolia.com/api
//     2. Wikipedia pageviews (Wikimedia REST) -> general public interest
//        https://wikimedia.org/api/rest_v1/  (corrects HN's SMB blind spot)
//   MARKET SIZE & GROWTH
//     3. BLS QCEW open data -> national establishment counts by industry
//        (NAICS) = customer-base / TAM proxy, PLUS the over-the-year change in
//        establishments = growth. Fully keyless.
//        https://data.bls.gov/cew/data/api/
//
// Output: JSON on stdout (the dashboard reads this as data.json). We emit BOTH
// the blended demand score AND the raw hn/wiki sub-scores, so the dashboard can
// let the user re-mix HN vs Wikipedia live. Diagnostics go to stderr.

const MARKETS = [
  { name: "Small contractor job management",        hn: ["construction management software", "contractor software"],        wiki: ["General contractor", "Construction management"],   naics: ["236", "238"] },
  { name: "Independent landlord / property mgmt",   hn: ["property management software", "landlord software"],              wiki: ["Property management", "Landlord"],                  naics: ["5313"] },
  { name: "Subcontractor scheduling & dispatch",    hn: ["field service dispatch software", "job scheduling software"],     wiki: ["Subcontractor", "Field service management"],        naics: ["238"] },
  { name: "Building inspection & surveying",        hn: ["building inspection software", "site survey software"],           wiki: ["Home inspection", "Building inspection"],           naics: ["541350"] },
  { name: "Trades CRM & quoting",                   hn: ["field service CRM", "trades quoting software"],                   wiki: ["Field service management", "Tradesperson"],         naics: ["238"] },
  { name: "Independent gym / studio ops",           hn: ["gym management software", "fitness studio software"],             wiki: ["Health club", "Physical fitness"],                  naics: ["713940"] },
  { name: "Auto repair shop management",            hn: ["auto repair shop software", "automotive shop management software"], wiki: ["Automobile repair shop", "Maintenance (technical)"], naics: ["8111"] },
  { name: "Salon / barber booking & CRM",           hn: ["salon booking software", "barber booking app"],                   wiki: ["Beauty salon", "Barber"],                           naics: ["812111", "812112"] },
  { name: "Independent restaurant back-office",     hn: ["restaurant management software", "restaurant inventory software"], wiki: ["Restaurant", "Restaurant management"],              naics: ["7225"] },
  { name: "Small professional services (acct/law)", hn: ["practice management software", "legal case management software"], wiki: ["Accountant", "Law firm"],                           naics: ["5411", "5412"] },
];

const HN_WINDOW_YEARS = 3;
const WIKI_WINDOW_MONTHS = 12;
const HN_WEIGHT = 0.5;   // default demand blend (dashboard can override live)
const WIKI_WEIGHT = 0.5;

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
  return (j.nbHits || 0) + attention * 0.05;
}

// ---- Wikipedia pageviews ----
function ymd(d) { return d.toISOString().slice(0, 10).replace(/-/g, "") + "00"; }
const wikiEnd = new Date();
const wikiStart = new Date(Date.UTC(wikiEnd.getUTCFullYear(), wikiEnd.getUTCMonth() - WIKI_WINDOW_MONTHS, 1));
async function wikiViews(article) {
  const title = encodeURIComponent(article.replace(/ /g, "_"));
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${title}/monthly/${ymd(wikiStart)}/${ymd(wikiEnd)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (res.status === 404) return 0;
  if (!res.ok) throw new Error(`Wiki ${res.status} for "${article}"`);
  const j = await res.json();
  return (j.items || []).reduce((s, it) => s + (it.views || 0), 0);
}

// ---- BLS QCEW open data (establishments + growth by NAICS, national) ----
// The annual "by industry" CSV lists every area; we want the national private
// row (area_fips US000, own_code 5): annual_avg_estabs = size, and the
// over-the-year % change in establishments = growth.
async function qcew(year, naics) {
  const url = `https://data.bls.gov/cew/data/api/${year}/a/industry/${encodeURIComponent(naics)}.csv`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`QCEW ${res.status} for NAICS ${naics}`);
  const lines = (await res.text()).split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(",").map((s) => s.replace(/^"|"$/g, ""));
  const iArea = head.indexOf("area_fips"), iOwn = head.indexOf("own_code");
  const iEst = head.indexOf("annual_avg_estabs"), iG = head.indexOf("oty_annual_avg_estabs_pct_chg");
  for (let k = 1; k < lines.length; k++) {
    const f = lines[k].split(",").map((s) => s.replace(/^"|"$/g, ""));
    if (f[iArea] === "US000" && f[iOwn] === "5") {
      return { estabs: Number(f[iEst]) || 0, growthPct: Number(f[iG]) || 0 };
    }
  }
  return { estabs: 0, growthPct: 0 };
}
// Resolve the most recent QCEW annual year that has data (lags ~1 year).
async function resolveQcewYear() {
  for (const y of [2024, 2023, 2022]) {
    try { const r = await qcew(y, "7225"); if (r.estabs > 0) return y; } catch (e) { /* try next */ }
  }
  return 2023;
}

async function main() {
  const qcewYear = await resolveQcewYear();
  console.error(`QCEW year: ${qcewYear}\n`);

  const rows = [];
  for (const m of MARKETS) {
    let hnRaw = 0, wikiRaw = 0, estab = 0, growthWeighted = 0;
    for (const t of m.hn)   { try { hnRaw   += await hnSearch(t); }  catch (e) { console.error("  ! " + e.message); } await sleep(150); }
    for (const a of m.wiki) { try { wikiRaw += await wikiViews(a); } catch (e) { console.error("  ! " + e.message); } await sleep(150); }
    for (const c of m.naics) {
      try { const q = await qcew(qcewYear, c); estab += q.estabs; growthWeighted += q.estabs * q.growthPct; }
      catch (e) { console.error("  ! " + e.message); }
      await sleep(150);
    }
    const growthPct = estab > 0 ? Math.round((growthWeighted / estab) * 10) / 10 : null;
    rows.push({ name: m.name, hnRaw, wikiRaw, estab, growthPct });
    console.error(`  ${m.name.padEnd(46)} hn=${String(Math.round(hnRaw)).padStart(5)}  wiki=${String(wikiRaw).padStart(8)}  estab=${String(estab).padStart(8)}  growth=${growthPct ?? "—"}%`);
  }

  // log-normalise each source independently to 0..1
  const maxHnLog    = Math.max(...rows.map((r) => log1p(r.hnRaw)))   || 1;
  const maxWikiLog  = Math.max(...rows.map((r) => log1p(r.wikiRaw))) || 1;
  const maxEstabLog = Math.max(...rows.map((r) => log1p(r.estab)))   || 1;
  const to10 = (n) => Math.round((1 + 9 * n) * 10) / 10;
  const clamp01 = (n) => Math.max(0, Math.min(1, n));
  for (const r of rows) {
    const hnN   = log1p(r.hnRaw)   / maxHnLog;
    const wikiN = log1p(r.wikiRaw) / maxWikiLog;
    r.hnScore    = to10(hnN);
    r.wikiScore  = to10(wikiN);
    r.demandScore = to10(HN_WEIGHT * hnN + WIKI_WEIGHT * wikiN);
    if (r.estab > 0) {
      // size & growth: 80% establishment base + 20% growth (growth mapped -5%..+10% -> 0..1)
      const sizeN   = log1p(r.estab) / maxEstabLog;
      const growthN = clamp01(((r.growthPct ?? 0) + 5) / 15);
      r.sizeScore = to10(0.8 * sizeN + 0.2 * growthN);
    } else {
      r.sizeScore = null;
    }
  }

  const ranked = [...rows].sort((a, b) => b.demandScore - a.demandScore);
  console.error(`\n=== Scores (demand: HN ${HN_WINDOW_YEARS}y + Wiki ${WIKI_WINDOW_MONTHS}mo | size+growth: QCEW ${qcewYear}) ===`);
  for (const r of ranked) {
    console.error(`  demand ${String(r.demandScore).padStart(4)} (hn ${String(r.hnScore).padStart(4)}/wiki ${String(r.wikiScore).padStart(4)})  size ${String(r.sizeScore ?? "—").padStart(4)} (${(r.estab || 0).toLocaleString()} estabs, ${r.growthPct ?? "—"}%)  ${r.name}`);
  }

  process.stdout.write(JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: "Hacker News + Wikipedia (demand) · BLS QCEW (market size & growth)",
    method: `Demand = ${HN_WEIGHT * 100}% HN discussion (${HN_WINDOW_YEARS}y) + ${WIKI_WEIGHT * 100}% Wikipedia pageviews (${WIKI_WINDOW_MONTHS}mo). Size & growth = 80% establishment counts + 20% YoY establishment growth, BLS QCEW ${qcewYear}. All log-normalised to 1-10. hnScore/wikiScore exposed so the dashboard can re-mix demand.`,
    markets: rows.map(({ name, demandScore, hnScore, wikiScore, sizeScore, estab, growthPct }) => ({ name, demandScore, hnScore, wikiScore, sizeScore, establishments: estab || null, growthPct })),
  }, null, 2) + "\n");
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
