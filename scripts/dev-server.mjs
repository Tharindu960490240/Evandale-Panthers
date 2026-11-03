/* ============================================================
   Local test server – run the whole site on your computer.

     npm run dev    real mode: uses your .env.local settings
                    (PlayHQ key, Google Sheet ID, join webhook).
                    Anything not set falls back to data/content.json.
     npm run demo   demo mode: fake PlayHQ fixtures, ladder, sheet
                    and join form, so every section can be tested
                    before the real keys arrive.

   Then open http://localhost:3000
   Needs Node.js 18 or newer. Not deployed (see .vercelignore).
   ============================================================ */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEMO = process.argv.includes("--demo");
const PORT = Number(process.env.PORT || 3000);

/* ---------- load .env.local (real mode only) ---------- */
if (!DEMO) {
  for (const file of [".env.local", ".env"]) {
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
    console.log(`Loaded settings from ${file}`);
    break;
  }
}

/* ---------- demo mode: fake PlayHQ, Google Sheet and join webhook ---------- */
if (DEMO) {
  const ORG = "demo-org";
  Object.assign(process.env, {
    PLAYHQ_API_KEY: "demo", PLAYHQ_ORG_ID: ORG, GOOGLE_SHEET_ID: "demo-sheet",
    JOIN_WEBHOOK_URL: "https://script.google.com/macros/s/demo/exec", JOIN_WEBHOOK_SECRET: "demo",
  });

  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
  const csv = (rows) => new Response(rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n"));
  const readCsv = (name) => fs.readFileSync(path.join(ROOT, "docs/sheet-template", `${name}.csv`), "utf8");

  // Demo sheet = the real template files, plus a little demo news/gallery/sponsors
  const SHEET = {
    Club: readCsv("Club"), Teams: readCsv("Teams"), Squad: readCsv("Squad"),
    News: [["date", "title", "summary", "link", "image"],
      [today(0), "Demo: Round preview", "This is demo news. Real news comes from the club's Google Sheet.", "", ""],
      [today(-10), "Demo: Season launch", "Thanks to everyone who came along.", "", ""]],
    Gallery: [["image", "caption"], ["/assets/crest.png", "Demo photo"]],
    Sponsors: [["name", "url", "logo", "tier"], ["Demo Sponsor", "https://example.com", "", "Gold"]],
  };

  // Fixtures spread around today so there are always results and upcoming games
  const TEAMS = [
    ["t-pl", "Evandale Panthers Premier League", "g-pl", "TCL Premier League"],
    ["t-a", "Evandale Panthers A-Grade", "g-a", "TCL A-Grade"],
    ["t-b", "Evandale Panthers B-Grade", "g-b", "TCL B-Grade"],
    ["t-c", "Evandale Panthers C-Grade", "g-c", "TCL C-Grade"],
    ["t-fb", "Evandale Panthers Female Boom", "g-fb", "TCL Female Boom Division 2"],
    ["t-u12", "Evandale Panthers U12s Division 2", "g-u12", "CN Under 12s Division 2"],
  ];
  const OPP = ["Hadspen", "Westbury", "Longford", "Perth", "Bracknell", "Launceston"];
  const game = (team, i) => {
    const offset = (i - 3) * 7 + 4 + (team[0] === "t-u12" ? -1 : 0);
    const done = offset < 0;
    const home = i % 2 === 0;
    const outcomes = ["WON", "LOSS", "WON", "DRAW"];
    return {
      id: `${team[0]}-${i}`, status: done ? "COMPLETED" : "UPCOMING",
      url: "https://www.playhq.com/",
      round: { name: `Round ${i + 1}`, abbreviatedName: `R${i + 1}` },
      schedule: { date: today(offset), time: team[0] === "t-u12" ? "17:30:00" : "13:00:00", timezone: "Australia/Hobart" },
      venue: { name: home ? "Morven Park" : `${OPP[i]} Oval` },
      competitors: [
        { id: team[0], name: team[1], isHomeTeam: home, outcome: done ? outcomes[i % 4] : "", scoreTotal: done ? 150 + i * 7 : null },
        { id: "x", name: OPP[i], isHomeTeam: !home, scoreTotal: done ? 140 + i * 5 : null },
      ],
    };
  };
  const ladder = (team) => {
    const names = [team[1], ...OPP.slice(0, 5)];
    return { ladders: [{ pool: { id: null, name: "" }, standings: names.map((n, i) => ({
      team: { id: i === 0 ? team[0] : `o${i}`, name: n }, played: 3, won: 3 - (i % 4), lost: i % 4, drawn: 0, byes: 0,
      competitionPoints: (3 - (i % 4)) * 6, ranking: 0,
    })).sort((a, b) => b.competitionPoints - a.competitionPoints).map((s, i) => ({ ...s, ranking: i + 1 })) }] };
  };

  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.hostname === "docs.google.com") {
      const tab = u.searchParams.get("sheet");
      const data = SHEET[tab] || SHEET.Club;
      return typeof data === "string" ? new Response(data) : csv(data);
    }
    if (u.hostname === "script.google.com") {
      console.log("Demo join form submission:", JSON.parse(opts.body).name);
      return json({ ok: true });
    }
    if (u.pathname === `/v1/organisations/${ORG}/seasons`) return json({ data: [{ id: "s1", name: "Summer 2026/27", status: "ACTIVE" }], metadata: {} });
    if (u.pathname === "/v1/seasons/s1/teams") return json({ data: TEAMS.map((t) => ({ id: t[0], name: t[1], club: { id: ORG }, grade: { id: t[2], name: t[3] } })), metadata: {} });
    const fx = u.pathname.match(/^\/v1\/teams\/([\w-]+)\/fixture$/);
    if (fx) { const t = TEAMS.find((x) => x[0] === fx[1]); return json({ data: [0, 1, 2, 3, 4, 5].map((i) => game(t, i)), metadata: {} }); }
    const ld = u.pathname.match(/^\/v1\/grades\/([\w-]+)\/ladder$/);
    if (ld) { const t = TEAMS.find((x) => x[2] === ld[1]); return json(ladder(t)); }
    return new Response("Not found in demo", { status: 404 });
  };
}

function today(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 864e5);
  return d.toISOString().slice(0, 10);
}

/* ---------- load the API functions ---------- */
const handlers = {};
for (const name of ["fixtures", "content", "join"]) {
  handlers[`/api/${name}`] = (await import(pathToFileURL(path.join(ROOT, "api", `${name}.js`)).href)).default;
}

/* ---------- server ---------- */
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp", ".woff2": "font/woff2" };

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);

  if (handlers[u.pathname]) {
    req.query = Object.fromEntries(u.searchParams);
    let raw = "";
    for await (const chunk of req) raw += chunk;
    try { req.body = raw ? JSON.parse(raw) : undefined; } catch { req.body = raw; }
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => res.end(body);
    try { await handlers[u.pathname](req, res); }
    catch (err) { console.error(err); res.statusCode = 500; res.end(JSON.stringify({ error: String(err) })); }
    log(req, res);
    return;
  }

  let file = path.join(ROOT, decodeURIComponent(u.pathname));
  if (u.pathname === "/") file = path.join(ROOT, "index.html");
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.statusCode = 404; res.end("Not found"); return;
  }
  res.setHeader("Content-Type", TYPES[path.extname(file).toLowerCase()] || "application/octet-stream");
  res.setHeader("Cache-Control", "no-store");
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`\n  Evandale Panthers website – ${DEMO ? "DEMO mode (fake data)" : "real mode"}`);
  console.log(`  Open http://localhost:${PORT}\n`);
  if (!DEMO) {
    const s = (k) => (process.env[k] ? "connected" : "not set – using backup");
    console.log(`  PlayHQ:        ${s("PLAYHQ_API_KEY")}`);
    console.log(`  Google Sheet:  ${s("GOOGLE_SHEET_ID")}`);
    console.log(`  Join form:     ${process.env.JOIN_WEBHOOK_URL ? "connected" : "not set – form offers email instead"}\n`);
  }
  console.log("  Press Ctrl + C to stop.\n");
});

function log(req, res) {
  console.log(`  ${req.method} ${req.url} → ${res.statusCode}`);
}
