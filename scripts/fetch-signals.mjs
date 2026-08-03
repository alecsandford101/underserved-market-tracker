// Pull FREE, live signals for each market and turn them into 1-10 scores.
// Keyless, open sources only — no paid APIs, no keys to store.
//
// Usage:  node scripts/fetch-signals.mjs [us|uk]   (default: us)
//
//   DEMAND (both regions — interest, not geography)
//     1. Hacker News (Algolia) search  -> tech / pain-point interest (B2B skew)
//        https://hn.algolia.com/api
//     2. Wikipedia pageviews (Wikimedia REST) -> general public interest
//        https://wikimedia.org/api/rest_v1/  (corrects HN's SMB blind spot)
//   MARKET SIZE & GROWTH
//     US: BLS QCEW open data -> national establishment counts by NAICS + the
//         over-the-year change in establishments = growth.
//         https://data.bls.gov/cew/data/api/
//     UK: ONS "UK Business Counts" via the Nomis open API -> local-unit counts
//         by SIC-2007 industry + year-over-year change = growth. Keyless.
//         https://www.nomisweb.co.uk/api/
//
// Output: JSON on stdout (the dashboard reads this as data.json for US and
// data-uk.json for UK). We emit BOTH the blended demand score AND the raw
// hn/wiki sub-scores, so the dashboard can re-mix HN vs Wikipedia live.
// Diagnostics go to stderr.

const REGION = (process.argv[2] || "us").toLowerCase();
if (!["us", "uk"].includes(REGION)) { console.error(`Unknown region "${REGION}" (use us|uk)`); process.exit(1); }

// Each market carries demand terms plus the size codes for BOTH regions:
//   naics  -> BLS QCEW (US)      nomis -> ONS/Nomis industry ids (UK, NM_141_1)
//   news   -> Google News UK (gl=GB) query for the UK-specific demand signal.
// News queries are deliberately narrowed so item counts land in a discriminating
// band rather than saturating at Google News' ~100-item cap.
const MARKETS = [
  { name: "Small contractor job management",        hn: ["construction management software", "contractor software"],        wiki: ["General contractor", "Construction management"],   naics: ["236", "238"],        nomis: ["134258828", "134258929", "134258930"], news: "construction job management software" }, // 41100/41201/41202 building construction
  { name: "Independent landlord / property mgmt",   hn: ["property management software", "landlord software"],              wiki: ["Property management", "Landlord"],                  naics: ["5313"],              nomis: ["134286048", "134285937"], news: "landlord property management software" },              // 68320 mgmt + 68209 letting
  { name: "Subcontractor scheduling & dispatch",    hn: ["field service dispatch software", "job scheduling software"],     wiki: ["Subcontractor", "Field service management"],        naics: ["238"],               nomis: ["146800683"], news: "subcontractor scheduling software" },                            // 43 specialised construction
  { name: "Building inspection & surveying",        hn: ["building inspection software", "site survey software"],           wiki: ["Home inspection", "Building inspection"],           naics: ["541350"],            nomis: ["134288850", "134292629"], news: "building surveying inspection software" },              // 71122 eng consulting + 74901 environmental
  { name: "Trades CRM & quoting",                   hn: ["field service CRM", "trades quoting software"],                   wiki: ["Field service management", "Tradesperson"],         naics: ["238"],               nomis: ["146800683"], news: "trades job management software" },                            // 43 specialised construction
  { name: "Independent gym / studio ops",           hn: ["gym management software", "fitness studio software"],             wiki: ["Health club", "Physical fitness"],                  naics: ["713940"],            nomis: ["134310858", "134310838"], news: "gym management software" },              // 93130 fitness + 93110 sports facilities
  { name: "Auto repair shop management",            hn: ["auto repair shop software", "automotive shop management software"], wiki: ["Automobile repair shop", "Maintenance (technical)"], naics: ["8111"],             nomis: ["134262928"], news: "garage management software MOT" },                            // 45200 motor vehicle repair
  { name: "Salon / barber booking & CRM",           hn: ["salon booking software", "barber booking app"],                   wiki: ["Beauty salon", "Barber"],                           naics: ["812111", "812112"],  nomis: ["134313748"], news: "salon booking software" },                            // 96020 hairdressing & beauty
  { name: "Independent restaurant back-office",     hn: ["restaurant management software", "restaurant inventory software"], wiki: ["Restaurant", "Restaurant management"],              naics: ["7225"],             nomis: ["134273829", "134273830"], news: "restaurant EPOS management software" },              // 56101 licensed + 56102 unlicensed restaurants
  { name: "Small professional services (acct/law)", hn: ["practice management software", "legal case management software"], wiki: ["Accountant", "Law firm"],                           naics: ["5411", "5412"],      nomis: ["134286829", "134286830", "134286929", "134286930"], news: "accounting practice management software" }, // 69101/69102 legal + 69201/69202 accounting
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

// ---- UK demand: Google News RSS, GB-scoped (media-coverage interest proxy) ----
// Keyless RSS feed on Google's CDN (tolerates datacenter IPs where Trends/GDELT
// 429). We count <item> entries for a UK-scoped query as a coarse interest
// signal. gl=GB is a soft scope, so this is UK-WEIGHTED news coverage, not pure
// search demand. Needs a browser UA (an empty/bot UA gets 403). Returns null on
// failure so the caller can fall back to the global HN/Wikipedia blend.
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
async function newsGB(query) {
  const url = "https://news.google.com/rss/search?" + new URLSearchParams({
    q: query, gl: "GB", hl: "en-GB", ceid: "GB:en",
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA } });
      if (res.ok) {
        const xml = await res.text();
        const n = (xml.match(/<item>/g) || []).length;
        return Math.min(100, n);
      }
    } catch (e) { /* transient — retry once */ }
    await sleep(1500);
  }
  return null;
}

// ---- US: BLS QCEW open data (establishments + growth by NAICS, national) ----
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
async function resolveQcewYear() {
  for (const y of [2024, 2023, 2022]) {
    try { const r = await qcew(y, "7225"); if (r.estabs > 0) return y; } catch (e) { /* try next */ }
  }
  return 2023;
}

// ---- UK: ONS UK Business Counts via Nomis (NM_141_1, local units, keyless) ----
// geography 2092957697 = United Kingdom; measures 20100 = count of local units;
// employment_sizeband / legal_status 0 = totals. `industry` accepts a
// comma-separated list of Nomis ids; we sum the observations.
const NM_GEO = "2092957697";
async function nomisCount(ids, date) {
  const url = `https://www.nomisweb.co.uk/api/v01/dataset/NM_141_1.data.json?` + new URLSearchParams({
    geography: NM_GEO, date, industry: ids.join(","), employment_sizeband: "0", legal_status: "0", measures: "20100",
  });
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Nomis ${res.status} for ${ids.join(",")}`);
  const j = await res.json();
  const obs = j.obs || [];
  const total = obs.reduce((s, o) => s + (o.obs_value?.value || 0), 0);
  const year = obs[0]?.time?.value ? Number(obs[0].time.value) : null;
  return { total, year };
}
// Latest establishment count for a market plus YoY growth (latest vs prior year).
async function nomisSize(ids) {
  const latest = await nomisCount(ids, "latest");
  if (!latest.year || latest.total <= 0) return { estabs: 0, growthPct: 0 };
  await sleep(150);
  const prev = await nomisCount(ids, String(latest.year - 1));
  const growthPct = prev.total > 0 ? Math.round(((latest.total / prev.total) - 1) * 1000) / 10 : 0;
  return { estabs: latest.total, growthPct };
}

async function main() {
  // Resolve the size source up front so we can label the output.
  let qcewYear = null;
  if (REGION === "us") { qcewYear = await resolveQcewYear(); console.error(`QCEW year: ${qcewYear}\n`); }
  else { console.error(`UK size: ONS UK Business Counts via Nomis (NM_141_1, local units)\n`); }

  const rows = [];
  for (const m of MARKETS) {
    let hnRaw = 0, wikiRaw = 0, estab = 0, growthPct = null, newsRaw = null;
    for (const t of m.hn)   { try { hnRaw   += await hnSearch(t); }  catch (e) { console.error("  ! " + e.message); } await sleep(150); }
    for (const a of m.wiki) { try { wikiRaw += await wikiViews(a); } catch (e) { console.error("  ! " + e.message); } await sleep(150); }

    if (REGION === "uk") { try { newsRaw = await newsGB(m.news); } catch (e) { console.error("  ! " + e.message); } await sleep(400); }

    if (REGION === "us") {
      let growthWeighted = 0;
      for (const c of m.naics) {
        try { const q = await qcew(qcewYear, c); estab += q.estabs; growthWeighted += q.estabs * q.growthPct; }
        catch (e) { console.error("  ! " + e.message); }
        await sleep(150);
      }
      growthPct = estab > 0 ? Math.round((growthWeighted / estab) * 10) / 10 : null;
    } else {
      try { const s = await nomisSize(m.nomis); estab = s.estabs; growthPct = estab > 0 ? s.growthPct : null; }
      catch (e) { console.error("  ! " + e.message); }
      await sleep(150);
    }

    rows.push({ name: m.name, hnRaw, wikiRaw, estab, growthPct, newsRaw });
    const newsCol = REGION === "uk" ? `  news=${String(newsRaw ?? "—").padStart(4)}` : "";
    console.error(`  ${m.name.padEnd(46)} hn=${String(Math.round(hnRaw)).padStart(5)}  wiki=${String(wikiRaw).padStart(8)}${newsCol}  estab=${String(estab).padStart(8)}  growth=${growthPct ?? "—"}%`);
  }

  // log-normalise each source independently to 0..1
  const maxHnLog    = Math.max(...rows.map((r) => log1p(r.hnRaw)))   || 1;
  const maxWikiLog  = Math.max(...rows.map((r) => log1p(r.wikiRaw))) || 1;
  const maxEstabLog = Math.max(...rows.map((r) => log1p(r.estab)))   || 1;
  const newsVals    = rows.filter((r) => r.newsRaw != null).map((r) => log1p(r.newsRaw));
  const maxNewsLog  = (newsVals.length ? Math.max(...newsVals) : 0) || 1;
  const to10 = (n) => Math.round((1 + 9 * n) * 10) / 10;
  const clamp01 = (n) => Math.max(0, Math.min(1, n));
  for (const r of rows) {
    const hnN   = log1p(r.hnRaw)   / maxHnLog;
    const wikiN = log1p(r.wikiRaw) / maxWikiLog;
    const blend = to10(HN_WEIGHT * hnN + WIKI_WEIGHT * wikiN);
    r.hnScore    = to10(hnN);
    r.wikiScore  = to10(wikiN);
    if (REGION === "uk") {
      // UK demand = UK news-coverage interest (Google News GB), log-normalised.
      // Fall back to the global HN/Wikipedia blend for any vertical whose news
      // fetch failed, so a transient block never craters a market's demand.
      r.newsScore = r.newsRaw != null ? to10(log1p(r.newsRaw) / maxNewsLog) : null;
      r.demandScore = r.newsScore != null ? r.newsScore : blend;
    } else {
      r.demandScore = blend;
    }
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
  const sizeLabel = REGION === "us" ? `QCEW ${qcewYear}` : "ONS/Nomis UK Business Counts";
  console.error(`\n=== ${REGION.toUpperCase()} scores (demand: HN ${HN_WINDOW_YEARS}y + Wiki ${WIKI_WINDOW_MONTHS}mo | size+growth: ${sizeLabel}) ===`);
  for (const r of ranked) {
    console.error(`  demand ${String(r.demandScore).padStart(4)} (hn ${String(r.hnScore).padStart(4)}/wiki ${String(r.wikiScore).padStart(4)})  size ${String(r.sizeScore ?? "—").padStart(4)} (${(r.estab || 0).toLocaleString()} ${REGION === "us" ? "estabs" : "local units"}, ${r.growthPct ?? "—"}%)  ${r.name}`);
  }

  const source = REGION === "us"
    ? "Hacker News + Wikipedia (demand) · BLS QCEW (market size & growth)"
    : "Google News UK (demand) · ONS UK Business Counts / Nomis (market size & growth)";
  const method = REGION === "us"
    ? `Demand = ${HN_WEIGHT * 100}% HN discussion (${HN_WINDOW_YEARS}y) + ${WIKI_WEIGHT * 100}% Wikipedia pageviews (${WIKI_WINDOW_MONTHS}mo). Size & growth = 80% establishment counts + 20% YoY establishment growth, BLS QCEW ${qcewYear}. All log-normalised to 1-10. hnScore/wikiScore exposed so the dashboard can re-mix demand.`
    : `Demand = UK online news interest (Google News, gl=GB) item counts, log-normalised to 1-10 — a UK-weighted media-coverage proxy, not search volume (verticals with no news fall back to the global HN+Wikipedia blend). Size & growth = 80% local-unit counts + 20% YoY growth, ONS UK Business Counts via Nomis (SIC 2007), log-normalised to 1-10.`;

  process.stdout.write(JSON.stringify({
    generatedAt: new Date().toISOString(),
    region: REGION,
    source,
    method,
    markets: rows.map(({ name, demandScore, hnScore, wikiScore, newsScore, sizeScore, estab, growthPct }) => {
      const m = { name, demandScore, hnScore, wikiScore, sizeScore, establishments: estab || null, growthPct };
      if (REGION === "uk") m.newsScore = newsScore ?? null;
      return m;
    }),
  }, null, 2) + "\n");
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
