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

test("only GATEWAY_URL + GATEWAY_SECRET set: sign-in works and the report passcode comes from the sheet", async () => {
  const { server: s2, gw: g2 } = await startDevServer(8798, { minimalSecrets: true });
  try {
    const b2 = "http://localhost:8798", jj = async (p, o = {}) => { const r = await fetch(b2 + p, { ...o, headers: { "Content-Type": "application/json", ...(o.headers || {}) } }); return { status: r.status, body: await r.json() }; };
    const login = await jj("/api/staff/login", { method: "POST", body: JSON.stringify({ staffCode: "JA01", pin: g2.pinOf("JA01") }) });
    assert.equal(login.body.ok, true);
    assert.equal((await jj("/api/status", { headers: { Authorization: "Bearer " + login.body.token } })).body.ok, true);
    assert.equal((await jj("/api/report/login", { method: "POST", body: JSON.stringify({ passcode: "whatever1" }) })).status, 503);
    g2.setSetting("REPORT_PASSCODE", "smfcondo2026");
    assert.equal((await jj("/api/report/login", { method: "POST", body: JSON.stringify({ passcode: "wrongpass" }) })).status, 401);
    const ok = await jj("/api/report/login", { method: "POST", body: JSON.stringify({ passcode: "smfcondo2026" }) });
    assert.equal(ok.body.ok, true);
    assert.equal((await jj("/api/report", { headers: { Authorization: "Bearer " + ok.body.token } })).body.ok, true);
  } finally { s2.close(); }
});

test('individual pet profiles survive the HTTP gateway and report counts each brand per household',async()=>{
 const {server:s3,gw:g3}=await startDevServer(8787,{testMode:false});
 try {
  const profiles=[{name:'Pup',age:'PUPPY',size:'SMALL',brand:'Pedigree',reason:'Price / budget'},{name:'Max',age:'ADULT',size:'LARGE',brand:'Vitality',reason:'Pet likes it'}];
  const r=await fetch('http://localhost:8787/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({condoId:'RR',consent:'YES',mobile:'09171111987',name:'Training Test',petType:'DOG',dog:{profiles,sampleIndex:1}})}).then(r=>r.json());
  assert.equal(r.ok,true);assert.equal(r.ticket.samples[0].id,'NC_MAINT_ADULT');
  assert.deepEqual(JSON.parse(g3.table('REGISTRATIONS')[0].DOG_PROFILES),profiles);
  const {buildReport}=await import('../worker/src/index.js');const report=buildReport(g3.call('report',{}));
  assert.equal(report.brands.DOG.Pedigree,1);assert.equal(report.brands.DOG.Vitality,1);assert.equal(report.days.find(d=>d.condoId==='RR').dogs,2);
 } finally {s3.close();}
});
