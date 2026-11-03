/* ============================================================
   Evandale Panthers Cricket Club – site script
   ------------------------------------------------------------
   Where the data comes from:
     • Fixtures, results, ladder  → PlayHQ, via /api/fixtures
     • Squad, news, gallery, sponsors, teams, contact
                                  → the club's Google Sheet, via /api/content
     • Backup for both            → data/content.json
   You shouldn't need to edit this file to update the site.
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const pad = (n) => String(n).padStart(2, "0");
const DEFAULT_START = "13:00";

const state = {
  content: null,
  fixtures: [],
  ladders: [],
  fixtureSource: "manual",
  view: "upcoming",
  team: "All",
  countdownTimer: null,
};

/* ---------- helpers ---------- */
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// Allow https links, site-relative paths and #anchors only
function safeUrl(u) {
  const s = String(u || "").trim();
  if (/^https:\/\//i.test(s) || /^#[\w-]*$/.test(s) || /^\/?(assets|images|data)\//.test(s)) return s;
  return "";
}
function toDate(fx) {
  return new Date(`${fx.date}T${fx.time || DEFAULT_START}:00`);
}
function isBye(fx) { return String(fx.opponent).toLowerCase() === "bye"; }
function isUpcoming(fx, now = new Date()) {
  return !fx.result && toDate(fx) > now;
}
function initials(name) {
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}
function fmtDate(iso, opts = { day: "numeric", month: "long", year: "numeric" }) {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-AU", opts);
}
async function getJson(url, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/* ---------- data loading ---------- */
async function loadContent() {
  let backup = { club: {}, teams: [], squad: [], news: [], gallery: [], sponsors: [], fixtures: [] };
  try { backup = { ...backup, ...(await getJson("data/content.json")) }; } catch (_) { /* keep empty */ }

  try {
    const sheet = await getJson("/api/content");
    if (sheet && sheet.source === "sheet") {
      return {
        ...backup,
        club: { ...backup.club, ...sheet.club },
        teams: sheet.teams.length ? sheet.teams : backup.teams,
        squad: sheet.squad,
        news: sheet.news,
        gallery: sheet.gallery,
        sponsors: sheet.sponsors,
        source: "sheet",
      };
    }
  } catch (_) { /* sheet not connected – use backup */ }
  return { ...backup, source: "backup" };
}

async function loadFixtures(backupFixtures) {
  try {
    const json = await getJson("/api/fixtures");
    if (json && json.source === "playhq" && Array.isArray(json.fixtures) && json.fixtures.length) {
      return { list: json.fixtures, ladders: json.ladders || [], source: "playhq", updatedAt: json.updatedAt };
    }
  } catch (_) { /* PlayHQ not connected – use backup */ }
  return { list: backupFixtures || [], ladders: [], source: "manual", updatedAt: null };
}

/* ---------- nav ---------- */
function initNav() {
  const toggle = $(".nav-toggle");
  const nav = $("#site-nav");
  const close = () => { nav.classList.remove("is-open"); toggle.setAttribute("aria-expanded", "false"); };
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  nav.addEventListener("click", (e) => { if (e.target.closest("a")) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}
function showSection(id, show) {
  const sec = document.getElementById(id);
  if (sec) sec.hidden = !show;
  const link = $(`[data-nav="${id}"]`);
  if (link) link.hidden = !show;
}

/* ---------- scoreboard ---------- */
function renderScoreboard() {
  const next = state.fixtures.find((fx) => isUpcoming(fx) && !isBye(fx));
  const vs = $("#sb-vs"), meta = $("#sb-meta"), team = $("#sb-team"), count = $("#sb-count");
  if (state.countdownTimer) clearInterval(state.countdownTimer);

  if (!next) {
    team.textContent = "Off-season";
    vs.textContent = "No upcoming matches";
    meta.textContent = "Check back when the new draw is out.";
    count.hidden = true;
    return;
  }
  const when = toDate(next);
  count.hidden = false;
  team.textContent = next.team;
  vs.textContent = `Panthers v ${next.opponent}`;
  meta.textContent = `${when.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}, ` +
    `${when.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })} · ${next.home ? "Home" : "Away"}, ${next.venue}`;

  const cells = Object.fromEntries($$("[data-unit]", count).map((el) => [el.dataset.unit, el]));
  const tick = () => {
    let diff = Math.max(0, when - new Date());
    const d = Math.floor(diff / 864e5); diff -= d * 864e5;
    const h = Math.floor(diff / 36e5);  diff -= h * 36e5;
    const m = Math.floor(diff / 6e4);   diff -= m * 6e4;
    cells.days.textContent = pad(d);
    cells.hours.textContent = pad(h);
    cells.mins.textContent = pad(m);
    cells.secs.textContent = pad(Math.floor(diff / 1e3));
  };
  tick();
  state.countdownTimer = setInterval(tick, 1000);
}

/* ---------- fixtures & results ---------- */
function resultPill(fx) {
  if (isBye(fx)) return `<span class="pill pill-draw">Bye</span>`;
  const r = (fx.result || "").toLowerCase();
  if (!r) return toDate(fx) > new Date()
    ? `<span class="pill pill-up">Upcoming</span>`
    : `<span class="pill pill-up">Awaiting result</span>`;
  const cls = r.startsWith("won") ? "pill-win" : r.startsWith("lost") ? "pill-loss" : "pill-draw";
  return `<span class="pill ${cls}">${escapeHtml(fx.result)}</span>`;
}

function renderFixtures() {
  const body = $("#fixture-body");
  const now = new Date();
  let list = state.team === "All" ? state.fixtures : state.fixtures.filter((fx) => fx.team === state.team);
  list = state.view === "upcoming"
    ? list.filter((fx) => !fx.result && toDate(fx) > now)
    : list.filter((fx) => fx.result || toDate(fx) <= now).slice().reverse();
  const nextFx = state.view === "upcoming" ? list.find((fx) => !isBye(fx)) : null;

  if (!list.length) {
    const what = state.view === "upcoming" ? "upcoming matches" : "results yet";
    body.innerHTML = `<tr class="empty-row"><td colspan="5">No ${what}${state.team === "All" ? "" : " for " + escapeHtml(state.team)}.</td></tr>`;
    return;
  }

  body.innerHTML = list.map((fx) => {
    const d = toDate(fx);
    const day = d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
    const sub = [fx.round, d.toLocaleDateString("en-AU", { weekday: "short" }),
      fx.time ? d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }) : ""].filter(Boolean).join(" ");
    const bye = isBye(fx);
    const url = safeUrl(fx.url);
    const opp = bye ? "Bye" : `v ${escapeHtml(fx.opponent)}`;
    return `
      <tr class="${fx === nextFx ? "is-next" : ""}">
        <td class="fx-date">${day}<small>${escapeHtml(sub)}</small></td>
        <td class="fx-team">${escapeHtml(fx.team)}${fx.isFinal ? ' <span class="pill pill-final">Final</span>' : ""}</td>
        <td class="fx-opp">${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${opp}</a>` : opp}</td>
        <td class="fx-venue">${bye ? "" : `<span class="pill ${fx.home ? "pill-home" : "pill-away"}">${fx.home ? "Home" : "Away"}</span> ${escapeHtml(fx.venue)}`}</td>
        <td class="fx-result">${resultPill(fx)}</td>
      </tr>`;
  }).join("");
}

function initFixtureControls() {
  const teamOrder = (state.content.teams || []).map((t) => t.name);
  const inData = [...new Set(state.fixtures.map((fx) => fx.team))];
  const names = ["All", ...teamOrder.filter((n) => inData.includes(n)), ...inData.filter((n) => !teamOrder.includes(n)).sort()];
  const tabs = $("#fixture-tabs");
  tabs.innerHTML = names.length > 2 ? names.map((n) =>
    `<button type="button" class="tab" aria-pressed="${n === "All"}" data-team="${escapeHtml(n)}">${escapeHtml(n === "All" ? "All teams" : n)}</button>`).join("") : "";
  tabs.onclick = (e) => {
    const btn = e.target.closest(".tab"); if (!btn) return;
    $$(".tab", tabs).forEach((t) => t.setAttribute("aria-pressed", String(t === btn)));
    state.team = btn.dataset.team;
    renderFixtures();
  };

  // Start on Results if there's nothing upcoming
  if (!state.fixtures.some((fx) => isUpcoming(fx))) state.view = "results";
  $$(".seg").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.view === state.view));
    b.onclick = () => {
      state.view = b.dataset.view;
      $$(".seg").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      renderFixtures();
    };
  });
  renderFixtures();
}

function renderFixtureSource(updatedAt) {
  const note = $("#fixture-source");
  if (state.fixtureSource === "playhq") {
    const when = updatedAt ? new Date(updatedAt).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
    note.textContent = `Live from PlayHQ${when ? `, updated ${when}` : ""}. Select a match for the full scorecard.`;
  } else {
    note.textContent = "Draw subject to change. Check our Facebook page for late updates and team sheets.";
  }
}

/* ---------- ladder ---------- */
function renderLadder() {
  const ladders = state.ladders.filter((l) => l.pools && l.pools.length);
  showSection("ladder", ladders.length > 0);
  if (!ladders.length) return;

  const tabs = $("#ladder-tabs");
  const show = (i) => {
    $$(".tab", tabs).forEach((t, j) => t.setAttribute("aria-pressed", String(i === j)));
    const l = ladders[i];
    $("#ladder-body").innerHTML = l.pools.map((pool) => `
      ${pool.name && l.pools.length > 1 ? `<h3 class="pool-name">${escapeHtml(pool.name)}</h3>` : ""}
      <div class="ladder-wrap">
        <table class="ladder">
          <thead><tr>
            <th scope="col" class="num">#</th><th scope="col">Team</th>
            <th scope="col" class="num">P</th><th scope="col" class="num">W</th><th scope="col" class="num">L</th>
            <th scope="col" class="num hide-sm">D</th><th scope="col" class="num">Pts</th>
          </tr></thead>
          <tbody>${pool.rows.map((r) => `
            <tr class="${r.isUs ? "is-us" : ""}">
              <td class="num rank">${r.rank}</td>
              <td class="team-name">${escapeHtml(r.team)}</td>
              <td class="num">${r.played ?? "–"}</td><td class="num">${r.won ?? "–"}</td><td class="num">${r.lost ?? "–"}</td>
              <td class="num hide-sm">${r.drawn ?? "–"}</td><td class="num pts">${r.points ?? "–"}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>`).join("");
  };
  tabs.innerHTML = ladders.length > 1
    ? ladders.map((l, i) => `<button type="button" class="tab" data-i="${i}" aria-pressed="${i === 0}">${escapeHtml(l.team)}</button>`).join("")
    : "";
  tabs.onclick = (e) => { const b = e.target.closest(".tab"); if (b) show(Number(b.dataset.i)); };
  show(0);
}

/* ---------- squad ---------- */
const ROLES = [["All", "All roles"], ["Batter", "Batters"], ["Bowler", "Bowlers"], ["All-rounder", "All-rounders"], ["Keeper", "Keepers"]];
const isJuniorTeam = (name) => /\bu\s?\d{1,2}s?\b|under\s*\d+|junior/i.test(String(name || ""));

// A player's side: their own gender column, else their team's, else guessed from the team name.
function playerGender(p, teamsByName) {
  if (p.gender) return p.gender;
  const t = teamsByName[p.team];
  if (t && t.gender) return t.gender;
  if (/female|women|girls|boom/i.test(p.team)) return "Women";
  return "";
}

function renderSquad() {
  const club = state.content.club || {};
  const teams = state.content.teams || [];
  const teamsByName = Object.fromEntries(teams.map((t) => [t.name, t]));
  const showJuniors = /^(y|yes|true)$/i.test(club.show_junior_players || "");

  const all = (state.content.squad || []).map((p) => ({ ...p, side: playerGender(p, teamsByName) }));
  const hiddenJuniors = showJuniors ? 0 : all.filter((p) => isJuniorTeam(p.team)).length;
  const squad = showJuniors ? all : all.filter((p) => !isJuniorTeam(p.team));

  showSection("squad", squad.length > 0);
  if (!squad.length) return;
  $("#squad-sample").hidden = !squad.some((p) => p.sample);
  $("#squad-junior-note").hidden = hiddenJuniors === 0;

  // Team order follows the Teams list; unknown teams go last.
  const order = teams.map((t) => t.name);
  const teamNames = [...new Set(squad.map((p) => p.team || "Other"))]
    .sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
  const sides = ["Men", "Women"].filter((g) => squad.some((p) => p.side === g));
  const roles = new Set(squad.map((p) => p.role));

  const f = { team: "All", side: "All", role: "All" };

  $("#squad-side").innerHTML = sides.length > 1
    ? ["All", ...sides].map((g) => `<button type="button" class="seg" data-side="${g}" aria-pressed="${g === "All"}">${g === "All" ? "Everyone" : g === "Men" ? "Men's" : "Women's"}</button>`).join("")
    : "";
  $("#squad-side").hidden = sides.length < 2;

  const roleSel = $("#squad-role");
  roleSel.innerHTML = ROLES.filter(([r]) => r === "All" || roles.has(r)).map(([r, l]) => `<option value="${r}">${l}</option>`).join("");

  const teamTabs = $("#squad-tabs");
  const drawTeamTabs = () => {
    const visible = teamNames.filter((t) => f.side === "All" || squad.some((p) => p.team === t && p.side === f.side));
    if (f.team !== "All" && !visible.includes(f.team)) f.team = "All";
    teamTabs.innerHTML = visible.length > 1
      ? ["All", ...visible].map((t) => `<button type="button" class="tab" data-team="${escapeHtml(t)}" aria-pressed="${t === f.team}">${escapeHtml(t === "All" ? "All teams" : t)}</button>`).join("")
      : "";
  };

  const card = (p) => {
    const photo = safeUrl(p.photo);
    return `
      <li class="player">
        <div class="avatar">${photo ? `<img src="${escapeHtml(photo)}" alt="" loading="lazy">` : `<span>${escapeHtml(initials(p.name))}</span>`}
          ${p.captain ? `<span class="cap" title="${p.captain === "VC" ? "Vice-captain" : "Captain"}">${escapeHtml(p.captain)}</span>` : ""}
        </div>
        <div class="player-info">
          <strong>${escapeHtml(p.name)}</strong>
          <span>${escapeHtml(p.role || "")}</span>
          ${p.note ? `<em>${escapeHtml(p.note)}</em>` : ""}
        </div>
      </li>`;
  };

  const draw = () => {
    const list = squad.filter((p) =>
      (f.team === "All" || (p.team || "Other") === f.team) &&
      (f.side === "All" || p.side === f.side) &&
      (f.role === "All" || p.role === f.role));
    // Captain first, then vice-captain, then by name
    const rank = (p) => (p.captain === "C" ? 0 : p.captain === "VC" ? 1 : 2);
    list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

    const groups = teamNames.map((t) => [t, list.filter((p) => (p.team || "Other") === t)]).filter(([, ps]) => ps.length);
    $("#squad-list").innerHTML = groups.length
      ? groups.map(([t, ps]) => {
          const info = teamsByName[t] || {};
          return `
          <section class="squad-group">
            <h3 class="squad-team">${escapeHtml(t)}${info.competition ? `<small>${escapeHtml(info.competition)}</small>` : ""}<span class="count">${ps.length} ${ps.length === 1 ? "player" : "players"}</span></h3>
            <ul class="squad">${ps.map(card).join("")}</ul>
          </section>`;
        }).join("")
      : `<p class="squad-empty">No players match these filters.</p>`;
  };

  $("#squad-side").onclick = (e) => {
    const b = e.target.closest(".seg"); if (!b) return;
    f.side = b.dataset.side;
    $$(".seg", $("#squad-side")).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    drawTeamTabs(); draw();
  };
  teamTabs.onclick = (e) => {
    const b = e.target.closest(".tab"); if (!b) return;
    f.team = b.dataset.team;
    $$(".tab", teamTabs).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    draw();
  };
  roleSel.onchange = () => { f.role = roleSel.value; draw(); };

  drawTeamTabs();
  draw();
}

/* ---------- teams ---------- */
function renderTeams() {
  $("#teams-list").innerHTML = (state.content.teams || []).map((t) => `
    <article class="team">
      <h4>${escapeHtml(t.name)}</h4>
      ${t.competition ? `<p class="team-comp">${escapeHtml(t.competition)}</p>` : ""}
      ${t.blurb ? `<p>${escapeHtml(t.blurb)}</p>` : ""}
      <dl>
        ${t.plays ? `<dt>Plays</dt><dd>${escapeHtml(t.plays)}</dd>` : ""}
        ${t.training ? `<dt>Training</dt><dd>${escapeHtml(t.training)}</dd>` : ""}
      </dl>
    </article>`).join("");
}

/* ---------- news ---------- */
function renderNews() {
  const news = (state.content.news || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  showSection("news", news.length > 0);
  if (!news.length) return;
  $("#news-list").innerHTML = news.slice(0, 6).map((n, i) => {
    const link = safeUrl(n.link);
    const img = safeUrl(n.image);
    const external = /^https:/i.test(link);
    return `
      <article class="news-item ${i === 0 ? "is-lead" : ""}">
        ${img ? `<img class="news-img" src="${escapeHtml(img)}" alt="" loading="lazy">` : ""}
        <div>
          <time datetime="${escapeHtml(n.date)}">${escapeHtml(fmtDate(n.date))}</time>
          <h3>${link ? `<a href="${escapeHtml(link)}"${external ? ' target="_blank" rel="noopener"' : ""}>${escapeHtml(n.title)}</a>` : escapeHtml(n.title)}</h3>
          ${n.summary ? `<p>${escapeHtml(n.summary)}</p>` : ""}
        </div>
      </article>`;
  }).join("");
}

/* ---------- gallery ---------- */
function renderGallery() {
  const items = (state.content.gallery || []).filter((g) => safeUrl(g.image));
  const el = $("#gallery-list");
  const fb = safeUrl(state.content.club.facebook);
  if (!items.length) {
    el.classList.add("is-empty");
    el.innerHTML = `
      <div class="gallery-empty">
        <img src="assets/crest.png" alt="" width="96">
        <p><strong>Match-day photos are on the way.</strong> Got a good shot from the weekend? Send it to us and it could end up here.</p>
        ${fb ? `<a class="btn btn-dark" href="${escapeHtml(fb)}" target="_blank" rel="noopener">Send us a photo on Facebook</a>` : ""}
      </div>`;
    return;
  }
  el.classList.remove("is-empty");
  el.innerHTML = items.slice(0, 12).map((g, i) => `
    <figure class="shot">
      <button type="button" class="shot-btn" data-i="${i}" aria-label="Open photo${g.caption ? ": " + escapeHtml(g.caption) : ""}">
        <img src="${escapeHtml(safeUrl(g.image))}" alt="${escapeHtml(g.caption)}" loading="lazy">
      </button>
      ${g.caption ? `<figcaption>${escapeHtml(g.caption)}</figcaption>` : ""}
    </figure>`).join("");

  let dlg = $("#lightbox");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "lightbox";
    dlg.className = "lightbox";
    dlg.innerHTML = `<form method="dialog"><button class="lb-close" aria-label="Close photo">×</button></form><img alt=""><p></p>`;
    document.body.appendChild(dlg);
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  }
  el.onclick = (e) => {
    const b = e.target.closest(".shot-btn"); if (!b) return;
    const g = items[Number(b.dataset.i)];
    $("img", dlg).src = safeUrl(g.image);
    $("img", dlg).alt = g.caption || "";
    $("p", dlg).textContent = g.caption || "";
    dlg.showModal();
  };
}

/* ---------- sponsors ---------- */
function renderSponsors() {
  const fb = safeUrl(state.content.club.facebook) || "#contact";
  const items = (state.content.sponsors || []).map((s) => {
    const logo = safeUrl(s.logo);
    const inner = logo ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(s.name)}" loading="lazy">` : `<span>${escapeHtml(s.name)}</span>`;
    const tier = s.tier ? `<small>${escapeHtml(s.tier)} sponsor</small>` : "";
    const url = safeUrl(s.url);
    return url
      ? `<a class="sponsor" href="${escapeHtml(url)}" target="_blank" rel="noopener">${inner}${tier}</a>`
      : `<div class="sponsor">${inner}${tier}</div>`;
  });
  items.push(`<a class="sponsor sponsor-open" href="${escapeHtml(fb)}"${/^https/.test(fb) ? ' target="_blank" rel="noopener"' : ""}>Become a sponsor – get in touch</a>`);
  $("#sponsor-list").innerHTML = items.join("");
}

/* ---------- contact ---------- */
function renderContact() {
  const c = state.content.club || {};
  const rows = [];
  if (c.ground) rows.push(["Home ground", escapeHtml(c.ground) + (c.ground_address ? `<br><span class="addr">${escapeHtml(c.ground_address)}</span>` : "")]);
  if (c.training) rows.push(["Training", escapeHtml(c.training)]);
  if (c.email) rows.push(["Email", `<a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a>`]);
  if (c.phone) rows.push(["Phone", `<a href="tel:${escapeHtml(c.phone.replace(/\s+/g, ""))}">${escapeHtml(c.phone)}</a>`]);
  const fb = safeUrl(c.facebook), ig = safeUrl(c.instagram), phq = safeUrl(c.playhq_url);
  if (fb) rows.push(["Facebook", `<a href="${escapeHtml(fb)}" target="_blank" rel="noopener">${escapeHtml(fb.replace(/^https:\/\/(www\.)?/, "").replace(/\/$/, ""))}</a>`]);
  if (ig) rows.push(["Instagram", `<a href="${escapeHtml(ig)}" target="_blank" rel="noopener">${escapeHtml(ig.replace(/^https:\/\/(www\.)?/, "").replace(/\/$/, ""))}</a>`]);
  if (phq) rows.push(["PlayHQ", `<a href="${escapeHtml(phq)}" target="_blank" rel="noopener">Club page on PlayHQ</a>`]);
  $("#contact-list").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");

  const q = c.map_query || c.ground_address || c.ground || "Evandale Tasmania";
  $("#map-frame").src = `https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=14&output=embed`;

  if (c.training) $("#join-training").textContent = `${c.training}. Bring sneakers and water – we have club gear to borrow.`;
  const reg = safeUrl(c.registration_url);
  if (reg) $("#join-register").innerHTML = `Once you're keen, <a href="${escapeHtml(reg)}" target="_blank" rel="noopener">register on PlayHQ</a>.`;
  $("#year").textContent = new Date().getFullYear();
}

/* ---------- join form ---------- */
function initJoinForm() {
  const form = $("#join-form");
  const status = $("#jf-status");
  const submit = $("#jf-submit");

  const setError = (field, msg) => {
    const input = form.elements[field];
    const err = $(`#jf-${field}-error`);
    if (err) err.textContent = msg || "";
    if (input) input.setAttribute("aria-invalid", msg ? "true" : "false");
    if (input && err) input.setAttribute("aria-describedby", err.id);
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = {
      name: form.elements.name.value.trim(),
      email: form.elements.email.value.trim(),
      phone: form.elements.phone.value.trim(),
      interests: $$('input[name="interests"]:checked', form).map((i) => i.value),
      message: form.elements.message.value.trim(),
      website: form.elements.website.value,
    };

    setError("name"); setError("email");
    let bad = false;
    if (!data.name) { setError("name", "Enter your name."); bad = true; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) { setError("email", "Enter an email address like name@example.com."); bad = true; }
    if (bad) { status.textContent = "Check the highlighted fields."; status.className = "form-status is-error"; form.querySelector('[aria-invalid="true"]').focus(); return; }

    submit.disabled = true;
    submit.textContent = "Sending…";
    status.textContent = "";
    status.className = "form-status";

    try {
      const r = await fetch("/api/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const json = await r.json().catch(() => ({}));
      if (r.ok && json.ok) {
        form.reset();
        status.textContent = "Thanks! Your details are with the club and someone will be in touch soon.";
        status.className = "form-status is-ok";
      } else if (r.status === 400 && json.errors) {
        Object.entries(json.errors).forEach(([k, v]) => setError(k, v));
        status.textContent = json.message || "Check the highlighted fields.";
        status.className = "form-status is-error";
      } else if (r.status === 501 || r.status === 404 || r.status === 405) {
        emailFallback(data, status);
      } else {
        status.textContent = json.message || "We couldn't send your details just now. Message us on Facebook instead.";
        status.className = "form-status is-error";
      }
    } catch (_) {
      emailFallback(data, status);
    } finally {
      submit.disabled = false;
      submit.textContent = "Send my details";
    }
  });
}

// Used until the online form is connected: opens the visitor's email app, pre-filled.
function emailFallback(data, status) {
  const to = state.content.club.email || "";
  const body = [
    `Name: ${data.name}`, `Email: ${data.email}`, `Phone: ${data.phone || "-"}`,
    `Interested in: ${data.interests.join(", ") || "-"}`, "", data.message,
  ].join("\n");
  const href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent("Joining the Panthers – " + data.name)}&body=${encodeURIComponent(body)}`;
  status.innerHTML = `Online sign-up isn't connected yet. <a href="${href}">Email your details to the club</a> instead.`;
  status.className = "form-status is-error";
}

/* ---------- start ---------- */
document.addEventListener("DOMContentLoaded", async () => {
  initNav();
  initJoinForm();

  state.content = await loadContent();
  renderTeams();
  renderSquad();
  renderNews();
  renderGallery();
  renderSponsors();
  renderContact();

  const fx = await loadFixtures(state.content.fixtures);
  state.fixtures = fx.list.slice().sort((a, b) => toDate(a) - toDate(b));
  state.ladders = fx.ladders;
  state.fixtureSource = fx.source;
  renderScoreboard();
  initFixtureControls();
  renderFixtureSource(fx.updatedAt);
  renderLadder();
});
