/* ============================================================
   /api/content  –  Vercel serverless function
   ------------------------------------------------------------
   Reads the club's Google Sheet so the committee can update the
   website without touching code.

   Environment variable:
     GOOGLE_SHEET_ID   the long ID in the sheet's URL:
                       docs.google.com/spreadsheets/d/<THIS PART>/edit
   The sheet must be shared as "Anyone with the link – Viewer".

   Tabs it reads (names must match; see docs/sheet-template/):
     Club      key | value
     Teams     name | blurb | plays | training
     Squad     name | role | team | captain | photo | note
     News      date | title | summary | link | image
     Gallery   image | caption
     Sponsors  name | url | logo | tier

   If GOOGLE_SHEET_ID isn't set, the site uses data/content.json.
   ============================================================ */

const TABS = {
  Club: ["key", "value"],
  Teams: ["name"],
  Squad: ["name", "role"],
  News: ["date", "title"],
  Gallery: ["image"],
  Sponsors: ["name"],
};

let cache = { at: 0, body: null };
const CACHE_MS = 5 * 60 * 1000;

export default async function handler(req, res) {
  const sheetId = (process.env.GOOGLE_SHEET_ID || "").trim();
  if (!sheetId) {
    return send(res, 200, { source: "none", configured: false, message: "No Google Sheet connected. Using data/content.json." }, 60);
  }
  const fresh = req.query && req.query.refresh === "1";
  if (!fresh && cache.body && Date.now() - cache.at < CACHE_MS) return send(res, 200, cache.body, 300);

  try {
    const entries = await Promise.all(
      Object.entries(TABS).map(async ([tab, required]) => [tab, await readTab(sheetId, tab, required)])
    );
    const t = Object.fromEntries(entries);
    const body = {
      source: "sheet",
      configured: true,
      updatedAt: new Date().toISOString(),
      club: toClub(t.Club.rows),
      teams: t.Teams.rows.map((r) => ({ name: r.name, blurb: r.blurb || "", plays: r.plays || "", training: r.training || "" })),
      squad: t.Squad.rows.map((r) => ({
        name: r.name, role: normaliseRole(r.role), team: r.team || "",
        captain: /^(y|yes|true|c|captain|vc|vice)/i.test(r.captain || "") ? (/^v/i.test(r.captain) ? "VC" : "C") : "",
        photo: imageUrl(r.photo), note: r.note || "",
      })),
      news: t.News.rows.map((r) => ({ date: toIsoDate(r.date), title: r.title, summary: r.summary || "", link: r.link || "", image: imageUrl(r.image) }))
        .sort((a, b) => String(b.date).localeCompare(String(a.date))),
      gallery: t.Gallery.rows.map((r) => ({ image: imageUrl(r.image), caption: r.caption || "" })).filter((g) => g.image),
      sponsors: t.Sponsors.rows.map((r) => ({ name: r.name, url: r.url || "", logo: imageUrl(r.logo), tier: r.tier || "" })),
      warnings: entries.filter(([, v]) => v.warning).map(([k, v]) => `${k}: ${v.warning}`),
    };
    cache = { at: Date.now(), body };
    return send(res, 200, body, 300);
  } catch (err) {
    console.error("[content] sheet error:", err);
    if (cache.body) return send(res, 200, { ...cache.body, stale: true }, 60);
    return send(res, 502, { source: "error", configured: true, message: String(err.publicMessage || err.message) }, 30);
  }
}

/* ---------------- Google Sheets ---------------- */

async function readTab(sheetId, tab, required) {
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
  const r = await fetch(url, { redirect: "follow" });
  const text = await r.text();
  if (!r.ok || /^\s*<!DOCTYPE html/i.test(text) || /<html/i.test(text.slice(0, 200))) {
    const err = new Error(`Couldn't read the "${tab}" tab (HTTP ${r.status}).`);
    err.publicMessage = "Couldn't open the Google Sheet. Check it's shared as 'Anyone with the link – Viewer' and GOOGLE_SHEET_ID is right.";
    throw err;
  }
  const table = parseCsv(text).filter((row) => row.some((c) => c.trim() !== ""));
  if (!table.length) return { rows: [] };

  const headers = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  // Google returns the FIRST tab if the name doesn't exist – check the headers really match.
  if (!required.every((h) => headers.includes(h))) {
    return { rows: [], warning: `tab missing or columns don't match (need: ${required.join(", ")})` };
  }
  const rows = table.slice(1).map((row) => {
    const o = {};
    headers.forEach((h, i) => { o[h] = (row[i] || "").trim(); });
    return o;
  }).filter((o) => o[required[0]]);
  return { rows };
}

// RFC 4180 CSV parser (handles quotes, commas and new lines inside cells)
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/* ---------------- Shaping ---------------- */

function toClub(rows) {
  const out = {};
  for (const r of rows) {
    const key = r.key.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    if (key) out[key] = r.value || "";
  }
  return out;
}

function normaliseRole(role) {
  const r = String(role || "").toLowerCase();
  if (r.includes("keep")) return "Keeper";
  if (r.includes("all")) return "All-rounder";
  if (r.includes("bowl") || r.includes("spin") || r.includes("pace")) return "Bowler";
  if (r.includes("bat")) return "Batter";
  return role || "";
}

// Turns Google Drive share links into direct image links; leaves other URLs alone.
function imageUrl(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  const m = s.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]+)/);
  if (m) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w1200`;
  return s;
}

// Accepts 2026-11-03, 3/11/2026 (Australian), or "3 Nov 2026"
function toIsoDate(v) {
  const s = String(v || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const au = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (au) {
    const y = au[3].length === 2 ? `20${au[3]}` : au[3];
    return `${y}-${au[2].padStart(2, "0")}-${au[1].padStart(2, "0")}`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
}

function send(res, status, body, maxAge) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", maxAge > 0 ? `public, s-maxage=${maxAge}, stale-while-revalidate=600` : "no-store");
  res.status(status).send(JSON.stringify(body));
}
