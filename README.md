# Underserved Market Tracker

An interactive, self-contained dashboard for finding markets where new technology has the most room to win.

Score any vertical on three signals and let the tool rank the opportunities:

- **Demand / supply gap** — strong customer need but few good solutions
- **Incumbent weakness** — legacy players, poor reviews, dated tech, high prices
- **Market size & growth** — TAM, growth rate, fragmentation, willingness to pay

The **Opportunity** score is a weighted average of the three (weights are adjustable in the app). Higher = more underserved.

## Live data (free, auto-refreshing)

Two of the three signals are pulled from live, free, **keyless** sources and refreshed automatically — no paid APIs, no keys to store:

**Demand / supply gap** — blended from:
- **Hacker News** (Algolia search API) — tech / pain-point discussion volume (B2B skew)
- **Wikipedia pageviews** (Wikimedia REST API) — general public interest, which corrects HN's blind spot for local/SMB verticals

The blend defaults to 50/50, and the dashboard has a **demand-mix slider** to rebalance HN vs Wikipedia live (the raw sub-scores are shipped in `data.json`, so re-mixing happens client-side).

**Market size & growth** — region-aware, switchable with the **US / UK toggle** in the header:
- **US** — **BLS QCEW** open data: national establishment counts by NAICS industry plus the over-the-year change in establishments (growth).
- **UK** — **ONS "UK Business Counts"** via the **Nomis** open API: local-unit counts by SIC-2007 industry plus year-over-year growth. Also keyless.

Either way it's 80% size + 20% growth, log-normalised to 1–10. The demand signal is region-independent (interest, not geography), so switching region only re-overlays the market-size numbers.

`scripts/fetch-signals.mjs` takes a region argument and produces `data.json` (US) and `data-uk.json` (UK); a daily GitHub Actions workflow (`.github/workflows/refresh-data.yml`) re-runs both and commits the results, so the hosted dashboard stays current. **Incumbent weakness** remains a manual score (no reliable free source for review sentiment). Markets showing a green dot next to a score are using live data.

To run the fetch locally:

```bash
node scripts/fetch-signals.mjs us > data.json
node scripts/fetch-signals.mjs uk > data-uk.json
```

## Features

- Add / edit / remove markets, each rated 1–10 on the three signals
- Adjustable signal weights that re-rank everything live
- Ranked table + an "opportunity map" bubble chart (x = market size, y = demand gap, bubble size = incumbent weakness, colour = opportunity)
- Filter by vertical and search by name/notes
- Export / import your data as JSON
- Pre-seeded with sample markets across **Construction & Real Estate** and **Local Services & SMB**

## Usage

Just open `index.html` in any modern browser — no build step, no server, no dependencies. Your data is saved automatically in the browser's `localStorage`. Use **Export** to back up or share a dataset.

## Hosting (optional)

Because it's a single static file, you can host it anywhere: GitHub Pages, Netlify, Vercel, or an S3 bucket. For GitHub Pages, enable Pages on the repo (Settings → Pages → deploy from `main` / root) and the dashboard will be live at your Pages URL.
