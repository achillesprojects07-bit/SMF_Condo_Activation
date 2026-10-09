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
  const reg = await j("/api/register", { method: "POST", body: JSON.stringify({ condoId: "RR", regId: "abc-1", consent: "YES", promoOptIn: "NO", name: "Ben", mobile: "09170001111", petType: "CAT", cat: {profiles:[{name:"Muning",age:"ADULT",brand:"Whiskas",reason:"Pet likes it",photo:"data:image/jpeg;base64,/9j/AA=="}]} }) });
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
  const profiles=[{name:'Pup',age:'PUPPY',size:'SMALL',brand:'Pedigree',photo:'data:image/jpeg;base64,/9j/AA==',reason:'Price / budget'},{name:'Max',age:'ADULT',size:'LARGE',brand:'Vitality',photo:'data:image/jpeg;base64,/9j/AA==',reason:'Pet likes it'}];
  const r=await fetch('http://localhost:8787/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({condoId:'RR',consent:'YES',mobile:'09171111987',name:'Training Test',petType:'DOG',dog:{profiles,sampleIndex:1}})}).then(r=>r.json());
  assert.equal(r.ok,true);assert.deepEqual(r.ticket.samples.map(s=>s.id),['NC_PUPPY_LAMB','NC_MAINT_ADULT']);
  assert.deepEqual(JSON.parse(g3.table('REGISTRATIONS')[0].DOG_PROFILES).map(({photoUrl,photoFileId,...pet})=>pet),profiles.map(({photo,...pet})=>pet));
  const {buildReport}=await import('../worker/src/index.js');const report=buildReport(g3.call('report',{}));
  assert.equal(report.brands.DOG.Pedigree,1);assert.equal(report.brands.DOG.Vitality,1);assert.equal(report.days.find(d=>d.condoId==='RR').dogs,2);
 } finally {s3.close();}
});

test('BA OOS flag and unavailable variants survive HTTP; reporting still counts zero releases',async()=>{
 const {server:s4,gw:g4}=await startDevServer(8786,{testMode:false});
 try {
  const req=async(path,options={})=>fetch('http://localhost:8786'+path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}}).then(r=>r.json());
  const t=(await req('/api/register',{method:'POST',body:JSON.stringify({condoId:'RR',consent:'YES',mobile:'09179999876',petType:'DOG',dog:{profiles:[{name:'Dog',age:'ADULT',size:'SMALL',brand:'Pedigree',reason:'Pet likes it',photo:'data:image/jpeg;base64,/9j/AA=='}]}})})).ticket;
  const login=await req('/api/staff/login',{method:'POST',body:JSON.stringify({staffCode:'PM01',pin:g4.pinOf('PM01')})});
  const r=await req('/api/redeem',{method:'POST',headers:{Authorization:'Bearer '+login.token},body:JSON.stringify({redemptionId:'http-oos',code:t.code,outOfStock:true,oosProducts:['NC_SMALL_BREED']})});
  assert.equal(r.ok,true);assert.equal(r.result,'OOS');
  const {buildReport}=await import('../worker/src/index.js');const report=buildReport(g4.call('report',{}));
  assert.equal(report.flags[0].RESULT,'OOS');assert.equal(report.days.find(d=>d.condoId==='RR').claimed,0);assert.equal(report.days.find(d=>d.condoId==='RR').given.NC_SMALL_BREED,undefined);
 }finally{s4.close();}
});


test('gateway recovers from transient read failures without retrying photo or stock writes', async () => {
  const { gateway } = await import('../worker/src/index.js');
  const env = { GATEWAY_URL: 'https://script.example/exec', GATEWAY_SECRET: 'test-only' };
  for (const action of ['condo','staff_login','check_report_passcode','ticket','report']) {
    for (const failure of [() => new Response('Busy', {status:503}), () => new Response('<html>Unavailable</html>'), () => {throw new Error('connection reset');}]) {
      let calls=0;
      const result=await gateway(env,action,{},async()=>++calls===1?failure():new Response('{"ok":true}'));
      assert.equal(result.ok,true);assert.equal(calls,2);
    }
  }
  for (const action of ['register','redeem']) {
    let calls=0;
    await assert.rejects(gateway(env,action,{},async()=>{calls++;return new Response('Busy',{status:503});}));
    assert.equal(calls,1);
  }
  let calls=0;
  const rejected=await gateway(env,'staff_login',{},async()=>{calls++;return new Response('{"ok":false,"error":"BAD_PIN"}');});
  assert.equal(rejected.error,'BAD_PIN');assert.equal(calls,1);
  calls=0;
  await assert.rejects(gateway(env,'condo',{},async()=>{calls++;return new Response('{"ok":false,"error":"GATEWAY","message":"configuration error"}');}));
  assert.equal(calls,1);
});
