/**
 * SMF Condo Activation — Cloudflare Worker
 * Serves the three pages (resident form, BA app, client report) and the /api/* calls.
 * Talks to Google Sheets only through the Apps Script gateway (gateway/Code.gs).
 *
 * Secrets (set in Cloudflare, never in code):
 *   GATEWAY_URL       Apps Script web app URL of the NEW condo sheet
 *   GATEWAY_SECRET    same value as the gateway's GATEWAY_SECRET script property
 *   SESSION_SECRET    any long random text (signs BA sign-ins)
 *   REPORT_PASSCODE   8+ characters, given to the client for the report page
 */

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const SESSION_HOURS = 16;
const MAX_PHOTO_CHARS = 1_500_000; // about 1.1 MB of JPEG; the BA app sends ~100-200 KB

const hits = new Map(); // simple per-IP limiter (per Worker instance)
function limited(key, max, windowMs) {
  const now = Date.now(), list = (hits.get(key) || []).filter(t => now - t < windowMs);
  list.push(now); hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return list.length > max;
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export async function gateway(env, action, payload, fetchImpl = fetch) {
  if (!env.GATEWAY_URL || !env.GATEWAY_SECRET) throw new Error("Gateway is not configured.");
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetchImpl(env.GATEWAY_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: env.GATEWAY_SECRET, action, payload }), signal: controller.signal
    });
    const data = await res.json();
    if (data && data.error === "GATEWAY") throw new Error(data.message || "Gateway error");
    return data;
  } finally { clearTimeout(timer); }
}

/* ---------- signed tokens (HMAC-SHA256) ---------- */
const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uText = t => btoa(unescape(encodeURIComponent(t))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64uText = t => decodeURIComponent(escape(atob(t.replace(/-/g, "+").replace(/_/g, "/"))));
async function hmacKey(secret) { return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]); }

export async function signToken(secret, data) {
  const body = b64uText(JSON.stringify(data));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return body + "." + b64u(sig);
}
export async function readToken(secret, token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig || !secret) return null;
  const expect = b64u(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body)));
  if (expect !== sig) return null;
  try { const d = JSON.parse(fromB64uText(body)); return d.exp > Date.now() ? d : null; } catch { return null; }
}
function bearer(request) { return (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""); }

async function body(request) { try { return await request.json(); } catch { return null; } }

/* ---------- report numbers (done here so the sheet stays simple) ---------- */
export function buildReport(raw) {
  const productName = Object.fromEntries((raw.products || []).map(p => [p.PRODUCT_ID, p.PRODUCT_NAME]));
  const condoName = Object.fromEntries((raw.condos || []).map(c => [c.CONDO_ID, c.CONDO_NAME]));
  const days = new Map();
  const key = (d, c) => d + "|" + c;
  const day = (d, c) => {
    if (!days.has(key(d, c))) days.set(key(d, c), { date: d, condoId: c, condoName: condoName[c] || c, registered: 0, dogHomes: 0, catHomes: 0, bothHomes: 0, dogs: 0, cats: 0, claimed: 0, waiting: 0, noStock: 0, promoOptIn: 0, given: {}, allocated: {}, left: {} });
    return days.get(key(d, c));
  };
  for (const s of raw.stock || []) { const x = day(s.DATE, s.CONDO_ID); x.allocated[s.PRODUCT_ID] = (x.allocated[s.PRODUCT_ID] || 0) + (Number(s.ALLOCATED) || 0); }
  const brands = { DOG: {}, CAT: {} };
  for (const r of raw.registrations || []) {
    const x = day(r.DATE, r.CONDO_ID);
    x.registered++;
    if (r.PET_TYPE === "DOG") x.dogHomes++; else if (r.PET_TYPE === "CAT") x.catHomes++; else if (r.PET_TYPE === "BOTH") x.bothHomes++;
    x.dogs += Number(r.DOG_COUNT) || 0; x.cats += Number(r.CAT_COUNT) || 0;
    if (r.PROMO_OPT_IN === "YES") x.promoOptIn++;
    if (r.STATUS === "CLAIMED") { x.claimed++; for (const id of String(r.SAMPLES_GIVEN || "").split(",").map(s => s.trim()).filter(Boolean)) x.given[id] = (x.given[id] || 0) + 1; }
    else if (r.STATUS === "WAITING") x.waiting++;
    else if (r.STATUS === "NO_STOCK") x.noStock++;
    if (r.DOG_BRAND) brands.DOG[r.DOG_BRAND] = (brands.DOG[r.DOG_BRAND] || 0) + 1;
    if (r.CAT_BRAND) brands.CAT[r.CAT_BRAND] = (brands.CAT[r.CAT_BRAND] || 0) + 1;
  }
  for (const x of days.values()) for (const id of Object.keys(productName)) x.left[id] = (x.allocated[id] || 0) - (x.given[id] || 0);
  const rows = [...days.values()].sort((a, b) => a.date.localeCompare(b.date) || a.condoName.localeCompare(b.condoName));
  const flags = (raw.redemptions || []).filter(r => r.RESULT && r.RESULT !== "OK");
  return { today: raw.today, products: productName, days: rows, brands, flags, registrations: raw.registrations || [], redemptions: raw.redemptions || [] };
}

/* ---------- API ---------- */
export async function handleApi(request, env, deps = {}) {
  const url = new URL(request.url), path = url.pathname, method = request.method;
  const gw = (a, p) => gateway(env, a, p, deps.fetch || fetch);
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  try {
    if (path === "/api/condo" && method === "GET") {
      return json(await gw("condo", { condoId: url.searchParams.get("c") || "" }));
    }

    if (path === "/api/my-ticket" && method === "GET") {
      if (limited("tk|" + ip, 60, 10 * 60 * 1000)) return json({ ok: false, error: "SLOW_DOWN" }, 429);
      const regId = url.searchParams.get("reg") || "";
      if (!regId) return json({ ok: false, error: "UNKNOWN_CODE" }, 404);
      return json(await gw("ticket", { code: url.searchParams.get("code") || "", regId, requireReg: true }));
    }

    if (path === "/api/register" && method === "POST") {
      if (limited("reg|" + ip, 20, 10 * 60 * 1000)) return json({ ok: false, error: "SLOW_DOWN", message: "Masyadong maraming try. Maghintay ng ilang minuto." }, 429);
      const b = await body(request);
      if (!b) return json({ ok: false, error: "BAD_REQUEST", message: "Invalid form." }, 400);
      const payload = {
        condoId: String(b.condoId || "").slice(0, 20), regId: String(b.regId || "").slice(0, 64),
        consent: b.consent === "YES" ? "YES" : "NO", promoOptIn: b.promoOptIn === "YES" ? "YES" : "NO",
        name: String(b.name || "").trim().slice(0, 80), mobile: String(b.mobile || "").slice(0, 20),
        petType: String(b.petType || "").toUpperCase(), dog: clean(b.dog), cat: clean(b.cat)
      };
      return json(await gw("register", payload));
    }

    if (path === "/api/staff/login" && method === "POST") {
      if (limited("login|" + ip, 10, 10 * 60 * 1000)) return json({ ok: false, error: "SLOW_DOWN", message: "Masyadong maraming mali. Maghintay ng 10 minuto." }, 429);
      const b = await body(request) || {};
      const r = await gw("staff_login", { staffCode: String(b.staffCode || "").slice(0, 20), pin: String(b.pin || "").slice(0, 8) });
      if (!r.ok) return json(r, 401);
      const token = await signToken(env.SESSION_SECRET, { role: "BA", staff: r.staff, condo: r.condo, exp: Date.now() + SESSION_HOURS * 3600e3 });
      return json({ ...r, token });
    }

    if (path === "/api/report/login" && method === "POST") {
      if (limited("rep|" + ip, 10, 10 * 60 * 1000)) return json({ ok: false, error: "SLOW_DOWN", message: "Too many tries. Wait 10 minutes." }, 429);
      const b = await body(request) || {}, pass = String(env.REPORT_PASSCODE || "");
      if (pass.length < 8) return json({ ok: false, error: "NOT_CONFIGURED", message: "Report passcode is not set up yet." }, 503);
      if (String(b.passcode || "") !== pass) return json({ ok: false, error: "BAD_PASSCODE", message: "Wrong passcode." }, 401);
      return json({ ok: true, token: await signToken(env.SESSION_SECRET, { role: "CLIENT", exp: Date.now() + 12 * 3600e3 }) });
    }

    if (path === "/api/report" && method === "GET") {
      const s = await readToken(env.SESSION_SECRET, bearer(request));
      if (!s || (s.role !== "CLIENT" && s.role !== "BA")) return json({ ok: false, error: "SIGN_IN", message: "Please sign in again." }, 401);
      if (s.role !== "CLIENT") return json({ ok: false, error: "FORBIDDEN", message: "Report is for the client only." }, 403);
      const raw = await gw("report", {});
      if (!raw.ok) return json(raw, 502);
      return json({ ok: true, ...buildReport(raw) });
    }

    // Everything below needs a BA sign-in.
    const s = await readToken(env.SESSION_SECRET, bearer(request));
    if (!s || s.role !== "BA") return json({ ok: false, error: "SIGN_IN", message: "Mag-sign in ulit." }, 401);

    if (path === "/api/ticket" && method === "GET") return json(await gw("ticket", { code: url.searchParams.get("code") || "" }));
    if (path === "/api/status" && method === "GET") return json(await gw("status", { condoId: s.condo.id }));
    if (path === "/api/redeem" && method === "POST") {
      const b = await body(request);
      if (!b) return json({ ok: false, error: "BAD_REQUEST", message: "Invalid save." }, 400);
      if (b.photo && String(b.photo).length > MAX_PHOTO_CHARS) return json({ ok: false, error: "PHOTO_TOO_BIG", message: "Masyadong malaki ang photo." }, 413);
      return json(await gw("redeem", {
        redemptionId: String(b.redemptionId || "").slice(0, 64), code: String(b.code || "").toUpperCase().slice(0, 20),
        products: Array.isArray(b.products) ? b.products.slice(0, 4).map(String) : [],
        photo: b.photo || "", phoneSavedAt: String(b.phoneSavedAt || "").slice(0, 40),
        staffCode: s.staff.code, staffName: s.staff.name, condoId: s.condo.id
      }));
    }
    return json({ ok: false, error: "NOT_FOUND" }, 404);
  } catch (e) {
    return json({ ok: false, error: "SERVER", message: "Hindi maabot ang server. Subukan ulit. (" + String(e.message || e).slice(0, 120) + ")" }, 502);
  }
}

function clean(x) {
  x = x && typeof x === "object" ? x : {};
  return {
    count: Math.max(1, Math.min(30, parseInt(x.count, 10) || 1)),
    names: String(x.names || "").trim().slice(0, 120),
    age: String(x.age || "").toUpperCase().slice(0, 10),
    size: String(x.size || "").toUpperCase().slice(0, 10),
    brand: String(x.brand || "").trim().slice(0, 60)
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env);
    if (url.pathname === "/ba") return Response.redirect(url.origin + "/ba.html", 302);
    if (url.pathname === "/report") return Response.redirect(url.origin + "/report.html", 302);
    return env.ASSETS.fetch(request);
  }
};
