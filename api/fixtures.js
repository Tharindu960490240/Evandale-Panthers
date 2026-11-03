/* ============================================================
   /api/fixtures  –  Vercel serverless function
   ------------------------------------------------------------
   Pulls the club's fixtures and results from the PlayHQ public
   API and returns them in a simple shape the website understands.

   Environment variables (set in Vercel → Project → Settings →
   Environment Variables):

     PLAYHQ_API_KEY     required  Client ID / API key from PlayHQ
     PLAYHQ_ORG_ID      required  The club's PlayHQ organisation ID
     PLAYHQ_TENANT      optional  Sport tenant, default "ca" (Cricket Australia)
     PLAYHQ_TEAM_MATCH  optional  Text that appears in our team names,
                                  default "Evandale". Used if PlayHQ
                                  doesn't tag teams with the club ID.
     PLAYHQ_SEASON_IDS  optional  Comma-separated season IDs to force.
                                  Leave empty to use active/upcoming seasons.
     HOME_VENUE_MATCH   optional  Text in our home ground's name,
                                  default "Evandale".

   Useful while setting up:
     /api/fixtures?debug=1   shows which seasons and teams were found.

   The API key never reaches the browser – it's only used here.
   ============================================================ */

const BASE = "https://api.playhq.com/v1";

// Small in-memory cache so a busy Saturday doesn't hammer PlayHQ.
let cache = { at: 0, body: null };
const CACHE_MS = 10 * 60 * 1000; // 10 minutes

export default async function handler(req, res) {
  const env = readEnv();
  const debug = req.query && (req.query.debug === "1" || req.query.debug === "true");

  if (!env.apiKey || !env.orgId) {
    return send(res, 200, {
      source: "none",
      configured: false,
      message: "PlayHQ isn't connected yet. Add PLAYHQ_API_KEY and PLAYHQ_ORG_ID in Vercel.",
      fixtures: [],
    }, 60);
  }

  if (!debug && cache.body && Date.now() - cache.at < CACHE_MS) {
    return send(res, 200, cache.body, 600);
  }

  try {
    const result = await loadFromPlayHQ(env, debug);
    const body = {
      source: "playhq",
      configured: true,
      updatedAt: new Date().toISOString(),
      fixtures: result.fixtures,
      ladders: result.ladders,
      ...(debug ? { debug: result.debug } : {}),
    };
    if (!debug) cache = { at: Date.now(), body };
    return send(res, 200, body, debug ? 0 : 600);
  } catch (err) {
    console.error("[fixtures] PlayHQ error:", err);
    // Serve the last good copy if we have one.
    if (cache.body) return send(res, 200, { ...cache.body, stale: true }, 60);
    return send(res, 502, {
      source: "error",
      configured: true,
      message: err.publicMessage || "Couldn't reach PlayHQ. Showing the club's saved fixtures instead.",
      ...(debug ? { detail: String(err && err.message) } : {}),
      fixtures: [],
    }, 30);
  }
}

/* ---------------- PlayHQ calls ---------------- */

function readEnv() {
  return {
    apiKey: (process.env.PLAYHQ_API_KEY || "").trim(),
    orgId: (process.env.PLAYHQ_ORG_ID || "").trim(),
    tenant: (process.env.PLAYHQ_TENANT || "ca").trim().toLowerCase(),
    teamMatch: (process.env.PLAYHQ_TEAM_MATCH || "Evandale").trim().toLowerCase(),
    seasonIds: (process.env.PLAYHQ_SEASON_IDS || "").split(",").map((s) => s.trim()).filter(Boolean),
    homeMatch: (process.env.HOME_VENUE_MATCH || "Evandale").trim().toLowerCase(),
  };
}

async function phq(env, path) {
  const r = await fetch(`${BASE}${path}`, {
    headers: {
      "x-api-key": env.apiKey,
      "x-phq-tenant": env.tenant,
      accept: "application/json",
    },
  });
  if (!r.ok) {
    const err = new Error(`PlayHQ ${r.status} on ${path}`);
    if (r.status === 401 || r.status === 403) err.publicMessage = "PlayHQ rejected the API key or tenant. Check PLAYHQ_API_KEY and PLAYHQ_TENANT.";
    if (r.status === 404) err.publicMessage = "PlayHQ couldn't find that organisation. Check PLAYHQ_ORG_ID.";
    throw err;
  }
  return r.json();
}

// Follows PlayHQ's cursor pagination and returns every item.
async function phqAll(env, path, maxPages = 20) {
  const items = [];
  let cursor = null;
  for (let i = 0; i < maxPages; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const json = await phq(env, cursor ? `${path}${sep}cursor=${encodeURIComponent(cursor)}` : path);
    const data = Array.isArray(json) ? json : json.data || [];
    items.push(...data);
    const meta = json.metadata || {};
    if (!meta.hasMore || !meta.nextCursor) break;
    cursor = meta.nextCursor;
  }
  return items;
}

async function loadFromPlayHQ(env, debug) {
  // 1. Seasons the club is in
  const allSeasons = await phqAll(env, `/organisations/${encodeURIComponent(env.orgId)}/seasons`);
  let seasons;
  if (env.seasonIds.length) {
    seasons = allSeasons.filter((s) => env.seasonIds.includes(s.id));
    // Allow forcing a season even if it isn't in the org list
    for (const id of env.seasonIds) if (!seasons.find((s) => s.id === id)) seasons.push({ id, name: id });
  } else {
    seasons = allSeasons.filter((s) => ["ACTIVE", "UPCOMING"].includes(String(s.status || "").toUpperCase()));
    if (!seasons.length && allSeasons.length) {
      // Off-season: fall back to the most recent season(s)
      seasons = [...allSeasons].sort((a, b) => seasonSortKey(b) - seasonSortKey(a)).slice(0, 2);
    }
  }

  // 2. Our teams in those seasons
  const ourTeams = [];
  const seenTeams = [];
  for (const season of seasons) {
    const teams = await phqAll(env, `/seasons/${encodeURIComponent(season.id)}/teams`);
    for (const t of teams) {
      seenTeams.push({ id: t.id, name: t.name, club: t.club && t.club.name, grade: t.grade && t.grade.name });
      if (isOurTeam(t, env)) ourTeams.push({ team: t, season });
    }
  }

  // 3. Fixture for each of our teams (in parallel)
  const lists = await Promise.all(
    ourTeams.map(async ({ team, season }) => {
      const games = await phqAll(env, `/teams/${encodeURIComponent(team.id)}/fixture`);
      return games.map((g) => normaliseGame(g, team, season, env)).filter(Boolean);
    })
  );

  // De-duplicate (same game can appear twice if two of our teams play each other)
  const byId = new Map();
  for (const fx of lists.flat()) if (!byId.has(fx.id)) byId.set(fx.id, fx);
  const fixtures = [...byId.values()].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  // 4. Ladder for each grade our teams play in. A ladder failing never breaks fixtures.
  const grades = new Map(); // gradeId -> { label, ourTeamIds:Set }
  ourTeams.forEach(({ team }, i) => {
    const gradeId = (team.grade && team.grade.id) || gradeIdFromGames(team, lists[i]);
    if (!gradeId) return;
    const entry = grades.get(gradeId) || { label: teamLabel(team, {}), ourTeamIds: new Set() };
    entry.ourTeamIds.add(team.id);
    grades.set(gradeId, entry);
  });
  const ladderResults = await Promise.allSettled(
    [...grades.entries()].map(async ([gradeId, info]) => {
      const json = await phq(env, `/grades/${encodeURIComponent(gradeId)}/ladder`);
      return normaliseLadder(json, info, env);
    })
  );
  const ladders = ladderResults
    .filter((r) => r.status === "fulfilled" && r.value && r.value.pools.length)
    .map((r) => r.value);

  return {
    fixtures,
    ladders,
    debug: debug
      ? {
          tenant: env.tenant,
          orgId: env.orgId,
          seasonsFound: allSeasons.map((s) => ({ id: s.id, name: s.name, status: s.status, competition: s.competition && s.competition.name })),
          seasonsUsed: seasons.map((s) => ({ id: s.id, name: s.name })),
          laddersLoaded: ladders.map((l) => l.team),
          ladderErrors: ladderResults.filter((r) => r.status === "rejected").map((r) => String(r.reason && r.reason.message)),
          teamsMatched: ourTeams.map(({ team }) => ({ id: team.id, name: team.name, grade: team.grade && team.grade.name })),
          teamsSeenInSeasons: seenTeams.length,
          sampleOfOtherTeams: seenTeams.slice(0, 15),
        }
      : undefined,
  };
}

function seasonSortKey(s) {
  const d = Date.parse(s.startDate || s.updatedAt || s.createdAt || "");
  if (!Number.isNaN(d)) return d;
  const y = parseInt(String(s.name || "").match(/\d{4}/), 10);
  return Number.isNaN(y) ? 0 : y;
}

function isOurTeam(team, env) {
  const clubId = (team.club && team.club.id) || (team.organisation && team.organisation.id);
  if (clubId) return clubId === env.orgId;
  const text = `${team.name || ""} ${(team.club && team.club.name) || ""}`.toLowerCase();
  return text.includes(env.teamMatch);
}

/* ---------------- Shape a PlayHQ game for the website ---------------- */

function first(x) {
  return Array.isArray(x) ? x[0] : x;
}

function normaliseGame(g, team, season, env) {
  const schedule = first(g.schedule) || {};
  const venue = first(g.venue || g.venues) || {};
  const competitors = g.competitors || g.teams || [];
  const status = String(g.status || "").toUpperCase();

  const us = competitors.find((c) => c.id === team.id) ||
             competitors.find((c) => String(c.name || "").toLowerCase().includes(env.teamMatch));
  const them = competitors.find((c) => c !== us);

  const isBye = status === "BYE" || competitors.length < 2 || !them;
  const date = String(schedule.date || "").slice(0, 10);
  if (!date) return null; // not scheduled yet

  const surface = venue.surfaceName && !/^main$/i.test(venue.surfaceName) ? venue.surfaceName : "";
  const venueName = [venue.name, surface].filter(Boolean).join(" – ") || "TBC";
  let home;
  if (us && typeof us.isHomeTeam === "boolean") home = us.isHomeTeam;
  else home = venueName.toLowerCase().includes(env.homeMatch);

  return {
    id: g.id || `${team.id}-${date}`,
    date,
    time: String(schedule.time || "").slice(0, 5) || "",
    timezone: schedule.timezone || "",
    team: teamLabel(team, g),
    opponent: isBye ? "Bye" : (them && them.name) || "TBC",
    venue: isBye ? "—" : venueName,
    home: !!home,
    round: (g.round && (g.round.abbreviatedName || g.round.name)) || "",
    isFinal: !!(g.round && g.round.isFinalRound),
    result: resultText(us, them, status, isBye),
    url: g.url || "",
    season: season.name || "",
    gradeId: (g.grade && g.grade.id) || (team.grade && team.grade.id) || "",
  };
}

// Prefer the grade name (e.g. "A Grade") so tabs are short and clear.
function teamLabel(team, g) {
  const grade = (team.grade && team.grade.name) || (g.grade && g.grade.name);
  if (grade) return grade;
  return team.name || "Panthers";
}

function resultText(us, them, status, isBye) {
  if (isBye) return "Bye";
  if (["CANCELLED", "ABANDONED", "POSTPONED", "FORFEIT"].includes(status)) {
    return status.charAt(0) + status.slice(1).toLowerCase();
  }
  const outcome = String((us && us.outcome) || "").toUpperCase();
  const finished = outcome || ["COMPLETED", "FINAL", "FINALISED", "PLAYED"].includes(status);
  if (!finished) return "";

  const score = us && them && us.scoreTotal != null && them.scoreTotal != null
    ? ` ${us.scoreTotal} v ${them.scoreTotal}` : "";
  if (outcome.startsWith("WIN") || outcome.startsWith("WON")) return `Won${score}`;
  if (outcome.startsWith("LOS")) return `Lost${score}`;
  if (outcome.startsWith("DRAW") || outcome === "TIE" || outcome === "TIED") return `Draw${score}`;
  if (outcome.includes("NO_RESULT") || outcome.includes("NO RESULT")) return "No result";
  return outcome ? outcome.charAt(0) + outcome.slice(1).toLowerCase().replace(/_/g, " ") : "Played";
}

function gradeIdFromGames(team, games) {
  const g = games.find((x) => x.gradeId);
  return g ? g.gradeId : null;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normaliseLadder(json, info, env) {
  const ladders = (json && (json.ladders || (json.data && json.data.ladders))) || [];
  const pools = ladders.map((l) => ({
    name: (l.pool && l.pool.name) || "",
    rows: (l.standings || []).map((s, i) => {
      const team = s.team || {};
      return {
        rank: num(s.ranking) || i + 1,
        team: team.name || "TBC",
        isUs: info.ourTeamIds.has(team.id) || String(team.name || "").toLowerCase().includes(env.teamMatch),
        played: num(s.played),
        won: num(s.won),
        lost: num(s.lost),
        drawn: num(s.drawn),
        byes: num(s.byes),
        points: num(s.competitionPoints),
        percentage: num(s.percentage),
      };
    }).sort((a, b) => a.rank - b.rank),
  })).filter((p) => p.rows.length);
  return { team: info.label, pools };
}

function send(res, status, body, maxAgeSeconds) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    maxAgeSeconds > 0 ? `public, s-maxage=${maxAgeSeconds}, stale-while-revalidate=3600` : "no-store"
  );
  res.status(status).send(JSON.stringify(body));
}
