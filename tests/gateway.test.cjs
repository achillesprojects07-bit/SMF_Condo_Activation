/* Rules saved in the Google Sheet: one sample per mobile, which pack, stock, claim once. */
const test = require("node:test"), assert = require("node:assert/strict");
const { loadGateway } = require("./fake-apps-script.cjs");

function fresh() { const g = loadGateway(); g.setSetting("TEST_MODE", "NO"); return g; }
const dogReg = (over = {}) => Object.assign({ condoId: "RR", consent: "YES", promoOptIn: "YES", name: "Ana Cruz", mobile: "09171234567", petType: "DOG", dog: { names: "Choco", count: 1, age: "ADULT", size: "SMALL", brand: "Pedigree" } }, over);

test("wrong secret is refused", () => {
  const g = fresh();
  const r = g.post({ secret: "nope", action: "health" });
  assert.equal(r.ok, false); assert.match(r.message, /Unauthorized/);
});

test("setup creates every tab and Saturday's two condos with stock", () => {
  const g = fresh();
  for (const t of ["CONDOS", "SCHEDULE", "STOCK", "PRODUCTS", "STAFF", "BRANDS", "SETTINGS", "REGISTRATIONS", "REDEMPTIONS"]) assert.ok(g.sheets.get(t), t);
  assert.deepEqual(g.table("CONDOS").map(c => c.CONDO_ID), ["RR", "LV"]);
  const rr = g.table("STOCK").filter(s => s.CONDO_ID === "RR");
  assert.deepEqual(Object.fromEntries(rr.map(s => [s.PRODUCT_ID, s.ALLOCATED])), { NC_PUPPY_LAMB: 24, NC_MAINT_ADULT: 111, NC_SMALL_BREED: 115, MJ_ADULT_SALMON: 250 });
  assert.match(g.pinOf("PM01"), /^\d{4}$/);
});

test("condo page info", () => {
  const g = fresh();
  const r = g.call("condo", { condoId: "rr" });
  assert.equal(r.ok, true); assert.equal(r.running, true); assert.equal(r.condo.name, "Rainbow Ridge Condominium");
  assert.ok(r.brands.some(b => b.brand === "Pedigree"));
  assert.equal(g.call("condo", { condoId: "ZZ" }).error, "CONDO_NOT_FOUND");
});

test("not running on a day without schedule (unless TEST_MODE)", () => {
  const g = fresh();
  g.setNow("2026-10-11T02:00:00Z");
  assert.equal(g.call("register", dogReg()).error, "NOT_TODAY");
  g.setSetting("TEST_MODE", "YES");
  assert.equal(g.call("register", dogReg()).ok, true);
});

test("register gives ticket with the right dog pack", () => {
  const g = fresh();
  const small = g.call("register", dogReg());
  assert.equal(small.ok, true); assert.equal(small.ticket.code, "RR-0001");
  assert.deepEqual(small.ticket.samples.map(s => s.id), ["NC_SMALL_BREED"]);
  const pup = g.call("register", dogReg({ mobile: "09170000002", dog: { names: "Bantay", age: "PUPPY", size: "LARGE", brand: "Vitality" } }));
  assert.deepEqual(pup.ticket.samples.map(s => s.id), ["NC_PUPPY_LAMB"]);
  assert.equal(pup.ticket.code, "RR-0002");
  const big = g.call("register", dogReg({ mobile: "09170000003", dog: { names: "Max", age: "ADULT", size: "LARGE", brand: "Top Breed" } }));
  assert.deepEqual(big.ticket.samples.map(s => s.id), ["NC_MAINT_ADULT"]);
});

test("dog & cat home gets one dog pack and one cat pack", () => {
  const g = fresh();
  const r = g.call("register", dogReg({ petType: "BOTH", cat: { names: "Mingming", count: 2, age: "ADULT", brand: "Whiskas" } }));
  assert.deepEqual(r.ticket.samples.map(s => s.id), ["NC_SMALL_BREED", "MJ_ADULT_SALMON"]);
  const row = g.table("REGISTRATIONS")[0];
  assert.equal(row.CAT_COUNT, 2); assert.equal(row.DOG_BRAND, "Pedigree"); assert.equal(row.CAT_BRAND, "Whiskas"); assert.equal(row.PROMO_OPT_IN, "YES");
});

test("one sample per mobile number for the whole run, any format, any condo", () => {
  const g = fresh();
  assert.equal(g.call("register", dogReg()).ok, true);
  for (const m of ["09171234567", "+639171234567", "9171234567", "0917 123 4567"]) {
    assert.equal(g.call("register", dogReg({ mobile: m })).error, "ALREADY_REGISTERED", m);
  }
  assert.equal(g.call("register", dogReg({ condoId: "LV" })).error, "ALREADY_REGISTERED");
  g.setNow("2026-10-17T02:00:00Z"); g.setSetting("TEST_MODE", "YES");
  assert.equal(g.call("register", dogReg()).error, "ALREADY_REGISTERED");
});

test("needs consent and a real mobile", () => {
  const g = fresh();
  assert.equal(g.call("register", dogReg({ consent: "NO" })).error, "NO_CONSENT");
  assert.equal(g.call("register", dogReg({ mobile: "12345" })).error, "BAD_MOBILE");
  assert.equal(g.table("REGISTRATIONS").length, 0);
});

test("ticket numbers are per condo", () => {
  const g = fresh();
  assert.equal(g.call("register", dogReg()).ticket.code, "RR-0001");
  assert.equal(g.call("register", dogReg({ condoId: "LV", mobile: "09180000001" })).ticket.code, "LV-0001");
  assert.equal(g.call("register", dogReg({ mobile: "09180000002" })).ticket.code, "RR-0002");
});

test("when puppy packs run out, a puppy gets the next best pack; when all run out, NO_STOCK", () => {
  const g = fresh();
  const stock = g.sheets.get("STOCK").rows;
  for (const r of stock) if (r[1] === "RR") r[3] = r[2] === "NC_PUPPY_LAMB" ? 1 : r[2] === "NC_SMALL_BREED" ? 1 : r[2] === "NC_MAINT_ADULT" ? 0 : 0;
  const puppy = { names: "P", age: "PUPPY", size: "MEDIUM", brand: "Pedigree" };
  assert.deepEqual(g.call("register", dogReg({ mobile: "09170000011", dog: puppy })).ticket.samples.map(s => s.id), ["NC_PUPPY_LAMB"]);
  assert.deepEqual(g.call("register", dogReg({ mobile: "09170000012", dog: puppy })).ticket.samples.map(s => s.id), ["NC_SMALL_BREED"]);
  const none = g.call("register", dogReg({ mobile: "09170000013", dog: puppy }));
  assert.equal(none.ok, true); assert.equal(none.ticket.samples.length, 0); assert.equal(none.ticket.noStock, true);
  assert.equal(g.table("REGISTRATIONS")[2].STATUS, "NO_STOCK");
});

test("staff sign-in finds today's condo", () => {
  const g = fresh();
  assert.equal(g.call("staff_login", { staffCode: "pm01", pin: "0000" === g.pinOf("PM01") ? "1111" : "0000" }).error, "BAD_PIN");
  assert.equal(g.call("staff_login", { staffCode: "XX99", pin: "1234" }).error, "BAD_STAFF");
  const ok = g.call("staff_login", { staffCode: "pm01", pin: g.pinOf("PM01") });
  assert.equal(ok.ok, true); assert.equal(ok.condo.id, "RR"); assert.equal(ok.staff.name, "Princess Mabag");
  assert.equal(g.call("staff_login", { staffCode: "JA01", pin: g.pinOf("JA01") }).condo.id, "LV");
  g.setNow("2026-10-12T02:00:00Z");
  assert.equal(g.call("staff_login", { staffCode: "PM01", pin: g.pinOf("PM01") }).error, "NO_ASSIGNMENT");
});

test("claim once: photo saved, stock goes down, second claim is DUPLICATE, resend is harmless", () => {
  const g = fresh();
  const t = g.call("register", dogReg()).ticket;
  const photo = "data:image/jpeg;base64," + Buffer.from("fake-jpeg").toString("base64");
  const r1 = g.call("redeem", { redemptionId: "r-1", code: t.code, products: ["NC_SMALL_BREED"], photo, staffCode: "PM01", staffName: "Princess Mabag", condoId: "RR" });
  assert.equal(r1.ok, true);
  assert.equal(g.files.length, 1);
  const reg = g.table("REGISTRATIONS")[0];
  assert.equal(reg.STATUS, "CLAIMED"); assert.equal(reg.SAMPLES_GIVEN, "NC_SMALL_BREED"); assert.match(reg.PHOTO_URL, /drive\.google\.com/); assert.equal(reg.CLAIMED_BY, "Princess Mabag");
  const again = g.call("redeem", { redemptionId: "r-1", code: t.code, products: ["NC_SMALL_BREED"], photo, staffCode: "PM01" });
  assert.equal(again.already, true);
  assert.equal(g.table("REDEMPTIONS").length, 1);
  const dup = g.call("redeem", { redemptionId: "r-2", code: t.code, products: ["NC_SMALL_BREED"], photo, staffCode: "PM01" });
  assert.equal(dup.ok, false); assert.equal(dup.result, "DUPLICATE");
  assert.equal(g.table("REDEMPTIONS")[1].RESULT, "DUPLICATE");
  const st = g.call("status", { condoId: "RR" });
  assert.equal(st.registered, 1); assert.equal(st.claimed, 1);
  assert.equal(st.stock.find(s => s.id === "NC_SMALL_BREED").left, 114);
});

test("unknown ticket is logged, not counted", () => {
  const g = fresh();
  const r = g.call("redeem", { redemptionId: "r-9", code: "RR-9999", products: ["NC_SMALL_BREED"], photo: "", staffCode: "PM01" });
  assert.equal(r.result, "UNKNOWN_CODE");
  assert.equal(g.call("status", { condoId: "RR" }).stock.find(s => s.id === "NC_SMALL_BREED").left, 115);
});

test("resident can only see own ticket", () => {
  const g = fresh();
  const t = g.call("register", dogReg({ regId: "reg-abc" })).ticket;
  assert.equal(g.call("ticket", { code: t.code, regId: "reg-abc", requireReg: true }).ok, true);
  assert.equal(g.call("ticket", { code: t.code, regId: "guess", requireReg: true }).ok, false);
  assert.equal(g.call("ticket", { code: t.code }).ok, true); // BA lookup
});

test("report has everything collected", () => {
  const g = fresh();
  g.call("register", dogReg({ petType: "BOTH", cat: { names: "Tiger", count: 1, age: "KITTEN", brand: "Friskies" } }));
  const r = g.call("report", {});
  assert.equal(r.ok, true);
  assert.equal(r.registrations.length, 1);
  assert.equal(r.registrations[0].MOBILE, "09171234567");
  for (const k of ["RESIDENT_NAME", "DOG_NAMES", "DOG_AGE", "DOG_SIZE", "DOG_BRAND", "CAT_NAMES", "CAT_AGE", "CAT_BRAND", "PROMO_OPT_IN", "CONSENT"]) assert.ok(r.registrations[0][k], k);
  assert.ok(!("PIN" in (r.schedule[0] || {})));
});

test("this app never points at the Barker's sheet", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "gateway", "Code.gs"), "utf8");
  assert.doesNotMatch(src, /1oNbOcEO3_78zUlTX-x5uhqqkIWxwGZGEG3PSpbYWsiI/);
  assert.doesNotMatch(src, /openById/);
});

test("training day (practice mode, no stock rows today) still gives samples; clearTrainingData resets", () => {
  const g = loadGateway({ now: new Date("2026-10-09T01:00:00Z") });
  g.setSetting('TEST_MODE', 'YES'); // legacy compatibility only; live defaults to NO
  const r = g.call("register", dogReg());
  assert.equal(r.ok, true); assert.deepEqual(r.ticket.samples.map(s => s.id), ["NC_SMALL_BREED"]);
  assert.equal(g.call("status", { condoId: "RR" }).stock.find(s => s.id === "NC_SMALL_BREED").left, 115);
  g.ctx.clearTrainingData();
  assert.equal(g.table("REGISTRATIONS").length, 0);
  assert.equal(g.table("SETTINGS").find(x => x.KEY === "TEST_MODE").VALUE, "NO");
  g.setNow("2026-10-10T02:00:00Z");
  assert.equal(g.call("register", dogReg()).ok, true); // same mobile works again on the real day
});

test("PIN that lost its leading zero in the sheet still works", () => {
  const g = fresh();
  g.sheets.get("STAFF").rows.find(r => r[0] === "JA01")[2] = 267; // sheet turned "0267" into a number
  assert.equal(g.call("staff_login", { staffCode: "JA01", pin: "0267" }).ok, true);
  assert.equal(g.call("staff_login", { staffCode: "JA01", pin: "267" }).ok, true);
  assert.equal(g.call("staff_login", { staffCode: "JA01", pin: "0268" }).error, "BAD_PIN");
});

test("customer documentation photo requires separate consent; declining still claims", () => {
  const g = fresh(), code = g.call("register", dogReg()).ticket.code;
  const payload = { redemptionId: "photo-1", code, products: ["NC_SMALL_BREED"], photo: "data:image/jpeg;base64,AAAA", staffCode: "PM01" };
  assert.equal(g.call("redeem", { ...payload, photoConsent: "NO", customerPhoto: "data:image/jpeg;base64,AAAA" }).error, "PHOTO_CONSENT");
  assert.equal(g.files.length, 0);
  assert.equal(g.call("redeem", { ...payload, photoConsent: "YES" }).error, "PHOTO_CONSENT");
  assert.equal(g.call("redeem", { ...payload, photoConsent: "NO" }).ok, true);
  assert.equal(g.table("REDEMPTIONS")[0].PHOTO_CONSENT, "NO");
  assert.equal(g.table("REGISTRATIONS")[0].CUSTOMER_PHOTO_URL, "");
});

test("separate photos and consent survive an existing-sheet upgrade and a retry", () => {
  const g = fresh(), code = g.call("register", dogReg()).ticket.code;
  // Simulate headers from the old deployed sheet, with existing resident data.
  for (const name of ["REGISTRATIONS", "REDEMPTIONS"]) {
    const s = g.sheets.get(name), n = s.rows[0].indexOf("PHOTO_CONSENT");
    s.rows.forEach(row => row.splice(n));
  }
  const payload = { redemptionId: "photo-2", code, products: ["NC_SMALL_BREED"], photo: "data:image/jpeg;base64,AAAA", photoConsent: "YES", customerPhoto: "data:image/jpeg;base64,BBBB", staffCode: "PM01" };
  assert.equal(g.call("redeem", payload).ok, true);
  const red = g.table("REDEMPTIONS")[0], reg = g.table("REGISTRATIONS")[0];
  assert.equal(red.PHOTO_CONSENT, "YES");
  assert.ok(red.CUSTOMER_PHOTO_URL); assert.notEqual(red.CUSTOMER_PHOTO_URL, red.PHOTO_URL);
  assert.equal(reg.CUSTOMER_PHOTO_URL, red.CUSTOMER_PHOTO_URL);
  assert.equal(reg.RESIDENT_NAME, "Ana Cruz");
  assert.equal(g.call("redeem", payload).already, true);
  assert.equal(g.files.length, 2); assert.equal(g.table("REDEMPTIONS").length, 1);
});

function addTraining(g) {
  g.sheets.get('CONDOS').appendRow(['TRAIN', 'BA Training', '', 'Training', 'TRAIN', 'ACTIVE']);
  g.sheets.get('STAFF').appendRow(['DEMO-001', 'Demo BA 01', '1001', 'ACTIVE']);
  g.sheets.get('SCHEDULE').appendRow(['2026-10-09', 'TRAIN', 'DEMO-001', '', '']);
}

test('training uses live saves with global practice OFF and stays out of reports before and after claim', () => {
  const g = fresh(); addTraining(g);
  assert.equal(g.call('staff_login', {staffCode:'DEMO-001', pin:'1001'}).testMode, false);
  const t = g.call('register', dogReg({condoId:'TRAIN'}));
  assert.equal(t.ok, true);
  assert.equal(g.table('REGISTRATIONS')[0].DATA_TYPE, 'TRAINING');
  assert.equal(g.call('report', {}).registrations.length, 0);
  // Practice cannot use up the real resident's eligibility.
  const real = g.call('register', dogReg()); assert.equal(real.ok, true);
  const before = g.call('status', {condoId:'RR'}).stock;
  assert.equal(g.call('redeem', {redemptionId:'training-1', code:t.ticket.code, condoId:'TRAIN',staffCode:'DEMO-001',staffName:'Demo BA 01',products:['NC_SMALL_BREED'],photoConsent:'NO'}).ok,true);
  assert.deepEqual(g.call('status', {condoId:'RR'}).stock, before);
  const report = g.call('report', {});
  assert.equal(report.registrations.length,1); assert.equal(report.registrations[0].CLAIM_CODE,real.ticket.code);
  assert.equal(report.redemptions.length,0);
  assert.ok(report.condos.every(c=>c.CONDO_ID!=='TRAIN'));
  assert.ok(report.schedule.every(s=>s.STAFF_CODE!=='DEMO-001'));
  g.setNow('2026-10-12T02:00:00Z');
  assert.equal(g.call('staff_login', {staffCode:'DEMO-001',pin:'1001'}).ok,true);
  assert.equal(g.call('register', dogReg({condoId:'TRAIN',mobile:'09170000199'})).ok,true);
  assert.equal(g.call('register', dogReg({mobile:'09170000299'})).error,'NOT_TODAY');
});

test('demo account cannot claim a live resident ticket', () => {
  const g = fresh(); addTraining(g);
  const t = g.call('register',dogReg());
  assert.equal(g.call('redeem',{redemptionId:'wrong',code:t.ticket.code,staffCode:'DEMO-001',condoId:'RR',products:['NC_SMALL_BREED']}).error,'WRONG_ASSIGNMENT');
  assert.equal(g.table('REGISTRATIONS')[0].STATUS,'WAITING');
  assert.equal(g.table('REDEMPTIONS').length,0);
});

test('old demo claims are excluded while failed demo attempts cannot hide a real registration', () => {
  const g = fresh();
  const t = g.call('register',dogReg());
  g.ctx.append_('REDEMPTIONS',{CLAIM_CODE:t.ticket.code, STAFF_CODE:'DEMO-002', RESULT:'UNKNOWN_CODE'});
  assert.equal(g.call('report',{}).registrations.length,1);
  g.ctx.append_('REDEMPTIONS',{CLAIM_CODE:t.ticket.code, STAFF_CODE:'DEMO-001', RESULT:'OK'});
  assert.equal(g.call('report',{}).registrations.length,0);
});

test('mixed puppy/adult and kitten/adult profiles keep separate brands and reasons', () => {
  const g=fresh();
  const dogProfiles=[{name:'Pup',age:'PUPPY',size:'SMALL',brand:'Pedigree',reason:'Price / budget'},{name:'Max',age:'ADULT',size:'LARGE',brand:'Vitality',reason:'Pet likes it'}];
  const catProfiles=[{name:'Kit',age:'KITTEN',brand:'Whiskas',reason:'Easy to find'},{name:'Ming',age:'ADULT',brand:'Cuties',reason:'Recommended by vet'}];
  const r=g.call('register',dogReg({petType:'BOTH',dog:{count:99,profiles:dogProfiles,sampleIndex:1},cat:{profiles:catProfiles}}));
  assert.equal(r.ok,true);assert.deepEqual(r.ticket.samples.map(s=>s.id),['NC_MAINT_ADULT','MJ_ADULT_SALMON']);
  const row=g.table('REGISTRATIONS')[0];assert.equal(row.DOG_COUNT,2);assert.equal(row.CAT_COUNT,2);
  assert.deepEqual(JSON.parse(row.DOG_PROFILES),dogProfiles);assert.deepEqual(JSON.parse(row.CAT_PROFILES),catProfiles);
  assert.match(row.DOG_BRAND_REASON,/Price/);assert.match(row.CAT_BRAND_REASON,/vet/);
  assert.equal(row.DOG_AGE,'PUPPY, ADULT');assert.equal(row.CAT_AGE,'KITTEN, ADULT');
  assert.equal(r.ticket.samples.length,2,'recording four pets does not multiply sample allowance');
  const second=g.call('register',dogReg({mobile:'09170000999',dog:{profiles:dogProfiles,sampleIndex:0}}));
  assert.deepEqual(second.ticket.samples.map(s=>s.id),['NC_PUPPY_LAMB']);
});

test('new pet profiles require every age, dog size, brand and reason; invalid sample target rejected',()=>{
 const g=fresh();const profile={name:'Pup',age:'PUPPY',size:'SMALL',brand:'Pedigree',reason:'Pet likes it'};
 for(const key of ['name','age','size','brand','reason'])assert.equal(g.call('register',dogReg({dog:{profiles:[{...profile,[key]:''}]}})).error,'BAD_PET_DETAILS',key);
 assert.equal(g.call('register',dogReg({dog:{profiles:[profile],sampleIndex:2}})).error,'BAD_PET_DETAILS');
 assert.equal(g.table('REGISTRATIONS').length,0);
});
