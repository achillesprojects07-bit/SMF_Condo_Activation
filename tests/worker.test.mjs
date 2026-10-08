/* Worker checks: sign-in tokens, who may call what, report numbers. */
import test from "node:test";
import assert from "node:assert/strict";
import { startDevServer } from "./dev-server.mjs";

const { server, gw } = await startDevServer(8799, { testMode: false });
const base = "http://localhost:8799";
const j = async (p, o = {}) => { const r = await fetch(base + p, { ...o, headers: { "Content-Type": "application/json", ...(o.headers || {}) } }); return { status: r.status, body: await r.json() }; };
test.after(() => server.close());

test("public condo + register + own ticket", async () => {
  assert.equal((await j("/api/condo?c=RR")).body.condo.name, "Rainbow Ridge Condominium");
  const reg = await j("/api/register", { method: "POST", body: JSON.stringify({ condoId: "RR", regId: "abc-1", consent: "YES", promoOptIn: "NO", name: "Ben", mobile: "09170001111", petType: "CAT", cat: { names: "Muning", count: 1, age: "ADULT", brand: "Whiskas" } }) });
  assert.equal(reg.body.ok, true); assert.equal(reg.body.ticket.samples[0].id, "MJ_ADULT_SALMON");
  assert.equal((await j("/api/my-ticket?code=" + reg.body.ticket.code + "&reg=abc-1")).body.ok, true);
  assert.equal((await j("/api/my-ticket?code=" + reg.body.ticket.code + "&reg=wrong")).body.ok, false);
});

test("BA-only calls need sign-in", async () => {
  for (const p of ["/api/status", "/api/ticket?code=RR-0001"]) assert.equal((await j(p)).status, 401);
  assert.equal((await j("/api/redeem", { method: "POST", body: "{}" })).status, 401);
  assert.equal((await j("/api/report")).status, 401);
  const forged = "eyJyb2xlIjoiQkEifQ.abc";
  assert.equal((await j("/api/status", { headers: { Authorization: "Bearer " + forged } })).status, 401);
});

test("BA signs in, claims, and the BA token cannot open the client report", async () => {
  const bad = await j("/api/staff/login", { method: "POST", body: JSON.stringify({ staffCode: "PM01", pin: "x" }) });
  assert.equal(bad.status, 401);
  const ok = await j("/api/staff/login", { method: "POST", body: JSON.stringify({ staffCode: "PM01", pin: gw.pinOf("PM01") }) });
  assert.equal(ok.body.ok, true); assert.ok(ok.body.token);
  const auth = { Authorization: "Bearer " + ok.body.token };
  const t = (await j("/api/ticket?code=RR-0001", { headers: auth })).body;
  assert.equal(t.ticket.status, "WAITING");
  const red = await j("/api/redeem", { method: "POST", headers: auth, body: JSON.stringify({ redemptionId: "w-1", code: "rr-0001", products: ["MJ_ADULT_SALMON"], photo: "data:image/jpeg;base64,AAAA" }) });
  assert.equal(red.body.ok, true);
  assert.equal(gw.table("REDEMPTIONS")[0].STAFF_CODE, "PM01"); // staff comes from the sign-in, not from the phone
  assert.equal((await j("/api/report", { headers: auth })).status, 403);
});

test("client report: passcode and numbers", async () => {
  assert.equal((await j("/api/report/login", { method: "POST", body: JSON.stringify({ passcode: "nope" }) })).status, 401);
  const tok = (await j("/api/report/login", { method: "POST", body: JSON.stringify({ passcode: "client2026" }) })).body.token;
  const r = (await j("/api/report", { headers: { Authorization: "Bearer " + tok } })).body;
  assert.equal(r.ok, true);
  const rr = r.days.find(d => d.condoId === "RR" && d.date === "2026-10-10");
  assert.equal(rr.registered, 1); assert.equal(rr.cats, 1); assert.equal(rr.claimed, 1);
  assert.equal(rr.given.MJ_ADULT_SALMON, 1); assert.equal(rr.left.MJ_ADULT_SALMON, 249);
  assert.equal(r.brands.CAT.Whiskas, 1);
  assert.ok(r.days.find(d => d.condoId === "LV"));
});
