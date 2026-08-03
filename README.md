# Underserved Market Tracker

An interactive, self-contained dashboard for finding markets where new technology has the most room to win.

Score any vertical on three signals and let the tool rank the opportunities:

- **Demand / supply gap** — strong customer need but few good solutions
- **Incumbent weakness** — legacy players, poor reviews, dated tech, high prices
- **Market size & growth** — TAM, growth rate, fragmentation, willingness to pay

The **Opportunity** score is a weighted average of the three (weights are adjustable in the app). Higher = more underserved.

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
