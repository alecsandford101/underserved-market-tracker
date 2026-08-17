const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
} = require("docx");
const fs = require("fs");

const ACCENT = "B4531A";
const INK = "2A2320";
const SOFT = "5B534D";

const H = (t) => new Paragraph({
  spacing: { before: 180, after: 70 },
  children: [new TextRun({ text: t, bold: true, size: 22, color: ACCENT, font: "Calibri" })],
});

const P = (runs, opts = {}) => new Paragraph({
  spacing: { after: opts.after ?? 60 }, ...opts,
  children: Array.isArray(runs) ? runs : [new TextRun({ text: runs, size: 19, color: INK, font: "Calibri" })],
});

const bullet = (bold, rest) => new Paragraph({
  bullet: { level: 0 }, spacing: { after: 40 },
  children: [
    ...(bold ? [new TextRun({ text: bold, bold: true, size: 19, color: INK, font: "Calibri" })] : []),
    new TextRun({ text: rest, size: 19, color: INK, font: "Calibri" }),
  ],
});

// ---- datasets table ----
const cellTxt = (t, bold, color) => new Paragraph({
  spacing: { before: 20, after: 20 },
  children: [new TextRun({ text: t, size: 17, bold: !!bold, color: color || INK, font: "Calibri" })],
});
const COLS = [2400, 2200, 4400];
const headRow = new TableRow({
  tableHeader: true,
  children: ["Signal", "Region", "Source(s)"].map((t, i) => new TableCell({
    width: { size: COLS[i], type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: ACCENT, color: "auto" },
    margins: { top: 30, bottom: 30, left: 90, right: 90 },
    children: [cellTxt(t, true, "FFFFFF")],
  })),
});
const dataRows = [
  ["Demand / supply gap", "US", "Hacker News (Algolia search) + Wikipedia pageviews (Wikimedia REST)"],
  ["Demand / supply gap", "UK", "Google News RSS, GB-scoped (media-coverage interest proxy)"],
  ["Market size & growth", "US", "BLS QCEW — establishment counts + YoY growth by NAICS industry"],
  ["Market size & growth", "UK", "ONS \u201CUK Business Counts\u201D via the Nomis open API \u2014 local-unit counts + YoY growth by SIC-2007"],
  ["Incumbent weakness", "Both", "Manual score (no reliable free source for review sentiment)"],
].map((cells, ri) => new TableRow({
  children: cells.map((t, i) => new TableCell({
    width: { size: COLS[i], type: WidthType.DXA },
    shading: ri % 2 ? { type: ShadingType.CLEAR, fill: "F5F1EC", color: "auto" } : undefined,
    margins: { top: 30, bottom: 30, left: 90, right: 90 },
    children: [cellTxt(t)],
  })),
}));
const noBorder = { style: BorderStyle.SINGLE, size: 2, color: "D8D0C7" };
const table = new Table({
  columnWidths: COLS,
  width: { size: COLS.reduce((a, b) => a + b, 0), type: WidthType.DXA },
  borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder },
  rows: [headRow, ...dataRows],
});

const doc = new Document({
  sections: [{
    properties: { page: { margin: { top: 720, bottom: 640, left: 900, right: 900 } } },
    children: [
      new Paragraph({
        spacing: { after: 20 },
        children: [new TextRun({ text: "UNDERSERVED MARKET TRACKER", bold: true, size: 15, color: ACCENT, font: "Consolas", characterSpacing: 40 })],
      }),
      new Paragraph({
        spacing: { after: 30 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: INK, space: 6 } },
        children: [new TextRun({ text: "Technical & Analytical Brief", bold: true, size: 30, color: INK, font: "Calibri" })],
      }),
      P([new TextRun({ text: "A self-contained dashboard that scores and ranks SMB software markets on three signals to surface where new technology has the most room to win. Free, keyless public data only \u2014 no paid APIs, no running cost.", italics: true, size: 19, color: SOFT, font: "Calibri" })], { after: 40 }),

      H("Language & tools"),
      bullet("Front end: ", "single self-contained HTML file \u2014 vanilla JavaScript, no frameworks or build step, hand-drawn SVG chart, state saved in browser localStorage."),
      bullet("Data pipeline: ", "a Node.js script (ES modules, native fetch) pulls the live signals and emits JSON."),
      bullet("Automation & hosting: ", "a GitHub Actions cron job refreshes the data daily; served free as a static site on GitHub Pages."),

      H("Datasets"),
      table,

      H("Industries / sectors covered"),
      P("10 SMB verticals across two themes \u2014 Construction & Real Estate and Local Services & SMB: small-contractor job management, independent landlord / property management, subcontractor scheduling, building inspection & surveying, trades CRM & quoting, gym / studio ops, auto-repair shop management, salon / barber booking, independent restaurant back-office, and small professional services (accounting / legal). The model is extensible \u2014 adding a vertical is one row of search terms plus industry codes."),

      H("What determines whether a sector is \u201Cunderserved\u201D"),
      P([new TextRun({ text: "An Opportunity score \u2014 an adjustable weighted average of three sub-signals, each on a 1\u201310 scale:", size: 19, color: INK, font: "Calibri" })]),
      bullet("Demand / supply gap \u2014 ", "strong interest but few good tools; measured live as discussion / coverage volume, log-normalised."),
      bullet("Incumbent weakness \u2014 ", "legacy players, poor reviews, dated tech; currently a manual expert score."),
      bullet("Market size & growth \u2014 ", "establishment counts + growth rate from official statistics agencies (80% size / 20% growth)."),

      H("Results & honest limitations"),
      bullet("", "The live data discriminates meaningfully: high-demand, large, fragmented verticals (e.g. trades job management and subcontractor scheduling \u2014 ~244k UK local units \u2014 and independent landlord / property management) rise to the top, while smaller niches rank lower."),
      bullet("", "It produces a ranked shortlist of hypotheses, not proven opportunities. Demand is a coverage / interest proxy, not measured unmet demand, and incumbent weakness is human judgement."),
      bullet("", "Nothing has yet been validated against real-world outcomes. The tool's value is a consistent, defensible way to decide where to look first; validation is the next step."),

      new Paragraph({
        spacing: { before: 200 },
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: "D8D0C7", space: 6 } },
        children: [new TextRun({ text: "Live: alecsandford101.github.io/underserved-market-tracker  \u00B7  US / UK region toggle  \u00B7  data auto-refreshed daily", size: 15, color: SOFT, font: "Consolas" })],
      }),
    ],
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync("C:/Users/AlecSandford/underserved-market-tracker/brief/Underserved-Market-Tracker-Brief.docx", buf);
  console.log("written");
});
