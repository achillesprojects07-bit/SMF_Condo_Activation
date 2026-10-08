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
  const g = loadGateway({ now: new Date("2026-10-09T01:00:00Z") }); // Friday, YES by default
  const r = g.call("register", dogReg());
  assert.equal(r.ok, true); assert.deepEqual(r.ticket.samples.map(s => s.id), ["NC_SMALL_BREED"]);
  assert.equal(g.call("status", { condoId: "RR" }).stock.find(s => s.id === "NC_SMALL_BREED").left, 115);
  g.ctx.clearTrainingData();
  assert.equal(g.table("REGISTRATIONS").length, 0);
  assert.equal(g.table("SETTINGS").find(x => x.KEY === "TEST_MODE").VALUE, "NO");
  g.setNow("2026-10-10T02:00:00Z");
  assert.equal(g.call("register", dogReg()).ok, true); // same mobile works again on the real day
});
