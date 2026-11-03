/* ============================================================
   /api/join  –  Vercel serverless function
   ------------------------------------------------------------
   Receives the "Join the Panthers" form and passes it to a
   Google Apps Script attached to a PRIVATE sign-ups Google Sheet
   (not the public content sheet). That script adds a row to a
   "Join requests" tab and emails the club.
   (Script: docs/join-form-apps-script.gs)

   Environment variables:
     JOIN_WEBHOOK_URL     the Apps Script web app URL (ends in /exec)
     JOIN_WEBHOOK_SECRET  any long random text; must match SECRET in the script

   If JOIN_WEBHOOK_URL isn't set, it replies 501 and the page opens
   the visitor's email app with their details filled in instead.
   ============================================================ */

const INTERESTS = ["Senior cricket", "Junior cricket", "Social cricket", "Coaching or umpiring", "Volunteering", "Sponsorship"];

// Light per-instance rate limit: 5 submissions per IP per 10 minutes.
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 5;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { ok: false, message: "Use POST." });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  // Honeypot field – real people never fill it in.
  if (body.website) return send(res, 200, { ok: true });

  const clean = (v, max) => String(v || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
  const data = {
    name: clean(body.name, 100),
    email: clean(body.email, 150),
    phone: clean(body.phone, 30),
    interests: (Array.isArray(body.interests) ? body.interests : []).filter((i) => INTERESTS.includes(i)),
    message: String(body.message || "").trim().slice(0, 2000),
  };

  const errors = {};
  if (!data.name) errors.name = "Enter your name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.email = "Enter an email address like name@example.com.";
  if (Object.keys(errors).length) return send(res, 400, { ok: false, errors, message: "Check the highlighted fields." });

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return send(res, 429, { ok: false, message: "Too many submissions. Try again in a few minutes." });

  const url = (process.env.JOIN_WEBHOOK_URL || "").trim();
  if (!url) return send(res, 501, { ok: false, configured: false, message: "Online sign-up isn't set up yet." });

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // Apps Script reads e.postData.contents
      body: JSON.stringify({ ...data, secret: process.env.JOIN_WEBHOOK_SECRET || "", submittedAt: new Date().toISOString() }),
      redirect: "follow",
    });
    const text = await r.text();
    let reply = {};
    try { reply = JSON.parse(text); } catch { /* Apps Script returned HTML */ }
    if (!r.ok || reply.ok === false) throw new Error(`Webhook ${r.status}: ${text.slice(0, 200)}`);
    return send(res, 200, { ok: true });
  } catch (err) {
    console.error("[join] webhook error:", err);
    return send(res, 502, { ok: false, message: "We couldn't send your details just now. Message us on Facebook instead." });
  }
}

function send(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(status).send(JSON.stringify(body));
}
