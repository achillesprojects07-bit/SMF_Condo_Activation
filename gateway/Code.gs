/**
 * SMF Condo Activation — Google Sheets Gateway
 *
 * Paste this into Extensions > Apps Script of the NEW condo Google Sheet
 * (never the Barker's sheet). Run setupSheets() once, then deploy as a Web app.
 *
 * Script Property needed: GATEWAY_SECRET (setupSheets() creates one for you).
 * Photos go to a Drive folder "SMF Condo Activation Photos" (created by setupSheets()).
 */

var TZ = 'Asia/Manila';
var VERSION = '1.3-one-pack-per-variant';

var TABLES = {
  CONDOS: ['CONDO_ID', 'CONDO_NAME', 'ADDRESS', 'BOOTH_LOCATION', 'CODE_PREFIX', 'STATUS'],
  SCHEDULE: ['DATE', 'CONDO_ID', 'STAFF_CODE', 'START_TIME', 'END_TIME'],
  STOCK: ['DATE', 'CONDO_ID', 'PRODUCT_ID', 'ALLOCATED'],
  PRODUCTS: ['PRODUCT_ID', 'PRODUCT_NAME', 'PET_TYPE', 'FOR_WHO'],
  STAFF: ['STAFF_CODE', 'BA_NAME', 'PIN', 'STATUS'],
  BRANDS: ['BRAND', 'PET_TYPE', 'STATUS'],
  SETTINGS: ['KEY', 'VALUE', 'NOTE'],
  REGISTRATIONS: ['CLAIM_CODE', 'REG_ID', 'REGISTERED_AT', 'DATE', 'CONDO_ID', 'CONDO_NAME',
    'CONSENT', 'PROMO_OPT_IN', 'RESIDENT_NAME', 'MOBILE', 'PET_TYPE',
    'DOG_COUNT', 'DOG_NAMES', 'DOG_AGE', 'DOG_SIZE', 'DOG_BRAND',
    'CAT_COUNT', 'CAT_NAMES', 'CAT_AGE', 'CAT_BRAND',
    'SAMPLE_DOG', 'SAMPLE_CAT', 'STATUS', 'CLAIMED_AT', 'CLAIMED_BY', 'SAMPLES_GIVEN', 'PHOTO_URL', 'PHOTO_CONSENT', 'CUSTOMER_PHOTO_URL', 'DATA_TYPE', 'DOG_PROFILES', 'CAT_PROFILES', 'DOG_BRAND_REASON', 'CAT_BRAND_REASON', 'SAMPLE_PRODUCTS', 'UNAVAILABLE_SAMPLES'],
  REDEMPTIONS: ['REDEMPTION_ID', 'CLAIM_CODE', 'DATE', 'CONDO_ID', 'STAFF_CODE', 'BA_NAME',
    'PRODUCTS_GIVEN', 'RESULT', 'PHOTO_URL', 'PHOTO_FILE_ID', 'PHONE_SAVED_AT', 'SERVER_SAVED_AT', 'NOTE', 'PHOTO_CONSENT', 'CUSTOMER_PHOTO_URL', 'CUSTOMER_PHOTO_FILE_ID', 'DATA_TYPE']
};

var PRODUCT_SEED = [
  ['NC_PUPPY_LAMB', 'NutriChunks Puppy Lamb 150g', 'DOG', 'Puppy'],
  ['NC_MAINT_ADULT', 'NutriChunks Maintenance Adult 150g', 'DOG', 'Adult dog (medium / large)'],
  ['NC_SMALL_BREED', 'NutriChunks Small Breed 150g', 'DOG', 'Adult dog (small breed)'],
  ['MJ_ADULT_SALMON', 'Majesty Adult Salmon 150g', 'CAT', 'Cat']
];
var DAILY_STOCK_SEED = { NC_PUPPY_LAMB: 24, NC_MAINT_ADULT: 111, NC_SMALL_BREED: 115, MJ_ADULT_SALMON: 250 };
var BRAND_SEED = [
  ['Pedigree', 'DOG'], ['Vitality', 'DOG'], ['Top Breed', 'DOG'], ['Beef Pro', 'DOG'], ['Royal Canin', 'BOTH'],
  ['Whiskas', 'CAT'], ['Friskies', 'CAT'], ['Goodest', 'CAT'], ['Aozi', 'CAT'],
  ['NutriChunks', 'DOG'], ['Majesty', 'CAT'], ['Home-cooked food', 'BOTH'], ['Other brand', 'BOTH']
];

/* ---------------- entry points ---------------- */

function doGet() {
  return json_({ ok: true, service: 'SMF Condo Activation Gateway', status: 'online', version: VERSION });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error('Request body is required.');
    var req = JSON.parse(e.postData.contents);
    checkSecret_(req.secret);
    return json_(handle_(req));
  } catch (err) {
    return json_({ ok: false, error: 'GATEWAY', message: String(err && err.message ? err.message : err) });
  }
}

function handle_(req) {
  var action = String(req.action || '').toLowerCase();
  var p = req.payload || {};
  switch (action) {
    case 'health': return { ok: true, version: VERSION, today: today_() };
    case 'condo': return condoInfo_(p);
    case 'register': return withLock_(function () { return register_(p); });
    case 'staff_login': return staffLogin_(p);
    case 'ticket': return ticket_(p);
    case 'redeem': return withLock_(function () { return redeem_(p); });
    case 'status': return status_(p);
    case 'report': return report_();
    case 'check_report_passcode': return checkReportPasscode_(p);
    default: throw new Error('Unsupported action: ' + action);
  }
}

/* ---------------- sheet helpers ---------------- */

function book_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name) {
  var sh = book_().getSheetByName(name);
  if (!sh) throw new Error('Missing tab ' + name + '. Run setupSheets() first.');
  return sh;
}

function cellText_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return v === null || v === undefined ? '' : String(v).trim();
}

function read_(name) {
  var sh = sheet_(name);
  var values = sh.getDataRange().getValues();
  if (!values.length) return [];
  var headers = values[0].map(cellText_);
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r], obj = { _row: r + 1 }, any = false;
    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      obj[headers[c]] = cellText_(row[c]);
      if (obj[headers[c]] !== '') any = true;
    }
    if (any) out.push(obj);
  }
  return out;
}

// Append new columns without moving existing data; supports existing deployed sheets.
function ensureColumns_(name) {
  var sh = sheet_(name), headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(cellText_);
  (TABLES[name] || []).forEach(function (key) {
    if (headers.indexOf(key) < 0) { sh.getRange(1, headers.length + 1).setValue(key); headers.push(key); }
  });
}

function headers_(name) {
  var sh = sheet_(name);
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(cellText_);
}

function append_(name, obj) {
  var h = headers_(name);
  sheet_(name).appendRow(h.map(function (k) { return obj[k] === undefined ? '' : obj[k]; }));
}

function update_(name, rowNo, obj) {
  var h = headers_(name), sh = sheet_(name);
  Object.keys(obj).forEach(function (k) {
    var c = h.indexOf(k);
    if (c >= 0) sh.getRange(rowNo, c + 1).setValue(obj[k]);
  });
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new Error('Busy, please try again.');
  try { var r = fn(); SpreadsheetApp.flush(); return r; } finally { lock.releaseLock(); }
}

function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function nowText_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }

function settings_() {
  var s = {};
  read_('SETTINGS').forEach(function (r) { s[r.KEY] = r.VALUE; });
  return s;
}

function checkSecret_(got) {
  var want = PropertiesService.getScriptProperties().getProperty('GATEWAY_SECRET');
  if (!want) throw new Error('GATEWAY_SECRET is not configured.');
  if (!got || String(got) !== want) throw new Error('Unauthorized.');
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- business rules ---------------- */

function normMobile_(v) {
  var d = String(v || '').replace(/[^0-9+]/g, '');
  if (/^\+639\d{9}$/.test(d)) return '0' + d.slice(3);
  if (/^639\d{9}$/.test(d)) return '0' + d.slice(2);
  if (/^9\d{9}$/.test(d)) return '0' + d;
  return d;
}

function findCondo_(id) {
  id = String(id || '').toUpperCase();
  var rows = read_('CONDOS');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].CONDO_ID.toUpperCase() === id && rows[i].STATUS.toUpperCase() !== 'INACTIVE') return rows[i];
  }
  return null;
}

/** Is this condo running today? (TEST_MODE = YES in SETTINGS lets any date through, for practice.) */
function trainingCondo_(id) { return String(id || '').trim().toUpperCase() === 'TRAIN'; }
function trainingStaff_(code) { return /^DEMO-\d+$/i.test(String(code || '').trim()); }
function trainingRow_(r) { return String(r.DATA_TYPE || '').toUpperCase() === 'TRAINING' || trainingCondo_(r.CONDO_ID) || trainingStaff_(r.STAFF_CODE); }

function runningToday_(condoId, date) {
  if (trainingCondo_(condoId)) return read_('SCHEDULE').some(function (s) { return trainingCondo_(s.CONDO_ID) && trainingStaff_(s.STAFF_CODE); });
  if (String(settings_().TEST_MODE || '').toUpperCase() === 'YES') return true;
  return read_('SCHEDULE').some(function (r) { return r.DATE === date && r.CONDO_ID.toUpperCase() === condoId.toUpperCase(); });
}

function products_() { return read_('PRODUCTS'); }

/** Stock picture for one condo on one date. reserved = tickets not yet claimed. */
function stockFor_(condoId, date, regs) {
  var out = {};
  products_().forEach(function (p) { out[p.PRODUCT_ID] = { allocated: 0, given: 0, reserved: 0 }; });
  var found = false;
  read_('STOCK').forEach(function (s) {
    if (s.DATE === date && s.CONDO_ID.toUpperCase() === condoId.toUpperCase() && out[s.PRODUCT_ID]) {
      out[s.PRODUCT_ID].allocated += Number(s.ALLOCATED) || 0;
      found = true;
    }
  });
  // Practice mode on a day with no STOCK rows (e.g. BA training): use the normal daily allocation.
  if (!found && (trainingCondo_(condoId) || String(settings_().TEST_MODE || '').toUpperCase() === 'YES')) {
    Object.keys(DAILY_STOCK_SEED).forEach(function (id) { if (out[id]) out[id].allocated = DAILY_STOCK_SEED[id]; });
  }
  (regs || read_('REGISTRATIONS')).forEach(function (r) {
    if (r.DATE !== date || r.CONDO_ID.toUpperCase() !== condoId.toUpperCase()) return;
    if (!trainingCondo_(condoId) && trainingRow_(r)) return;
    if (r.STATUS === 'CLAIMED') {
      String(r.SAMPLES_GIVEN || '').split(',').forEach(function (id) { id = id.trim(); if (out[id]) out[id].given++; });
    } else if (r.STATUS === 'WAITING') {
      assignedSamples_(r).forEach(function (id) { if (out[id]) out[id].reserved++; });
    }
  });
  Object.keys(out).forEach(function (k) {
    var x = out[k];
    x.left = x.allocated - x.given;
    x.free = x.allocated - x.given - x.reserved;
  });
  return out;
}

function nextClaimCode_(condo, regs) {
  var prefix = (condo.CODE_PREFIX || condo.CONDO_ID).toUpperCase();
  var max = 0;
  regs.forEach(function (r) {
    var m = String(r.CLAIM_CODE).match(/^([A-Z0-9]+)-(\d+)$/);
    if (m && m[1] === prefix) max = Math.max(max, Number(m[2]));
  });
  return prefix + '-' + ('000' + (max + 1)).slice(-4);
}

function condoInfo_(p) {
  var condo = findCondo_(p.condoId);
  if (!condo) return { ok: false, error: 'CONDO_NOT_FOUND', message: 'We could not find this condo. Please scan the QR code at the booth again.' };
  var date = today_();
  var brands = read_('BRANDS').filter(function (b) { return String(b.STATUS || 'ACTIVE').toUpperCase() !== 'INACTIVE'; })
    .map(function (b) { return { brand: b.BRAND, petType: b.PET_TYPE.toUpperCase() }; });
  return {
    ok: true, date: date, running: runningToday_(condo.CONDO_ID, date),
    condo: { id: condo.CONDO_ID, name: condo.CONDO_NAME, booth: condo.BOOTH_LOCATION },
    products: products_().map(function (x) { return { id: x.PRODUCT_ID, name: x.PRODUCT_NAME, petType: x.PET_TYPE }; }),
    brands: brands
  };
}

function normalizePet_(pet, kind) {
  if (!Array.isArray(pet.profiles)) return pet;
  var list=pet.profiles;
  if (!list.length || list.length>30 || list.some(function(x){return !x || !String(x.name||'').trim() || (kind==='DOG'?['PUPPY','ADULT']:['KITTEN','ADULT']).indexOf(x.age)<0 || (kind==='DOG'&&['SMALL','MEDIUM','LARGE'].indexOf(x.size)<0) || !String(x.brand||'').trim() || !String(x.reason||'').trim();})) return null;
  function unique(k){return list.map(function(x){return String(x[k]||'');}).filter(function(x,i,a){return a.indexOf(x)===i;}).join(', ');}
  return {profiles:list,count:list.length,names:list.map(function(x){return x.name;}).join(', '),age:unique('age'),size:unique('size'),brand:unique('brand'),reason:unique('reason')};
}

function register_(p) {
  ensureColumns_('REGISTRATIONS');
  var condo = findCondo_(p.condoId);
  if (!condo) return { ok: false, error: 'CONDO_NOT_FOUND', message: 'We could not find this condo. Please scan the QR code at the booth again.' };
  var date = today_();
  if (!runningToday_(condo.CONDO_ID, date)) return { ok: false, error: 'NOT_TODAY', message: 'There is no sampling at this condo today.' };
  if (p.consent !== 'YES') return { ok: false, error: 'NO_CONSENT', message: 'Your privacy consent is needed to receive your free pack.' };
  var mobile = normMobile_(p.mobile);
  if (!/^09\d{9}$/.test(mobile)) return { ok: false, error: 'BAD_MOBILE', message: 'Please enter a valid mobile number (e.g. 09171234567).' };

  var regs = read_('REGISTRATIONS');
  for (var i = 0; i < regs.length; i++) {
    if (normMobile_(regs[i].MOBILE) === mobile && trainingRow_(regs[i]) === trainingCondo_(condo.CONDO_ID)) {
      return { ok: false, error: 'ALREADY_REGISTERED', message: 'This mobile number is already registered. Only one registration is allowed per mobile number, with one pack per applicable variant.' };
    }
  }

  var petType = String(p.petType || '').toUpperCase();
  var hasDog = petType === 'DOG' || petType === 'BOTH', hasCat = petType === 'CAT' || petType === 'BOTH';
  if (!hasDog && !hasCat) return { ok: false, error: 'BAD_PET', message: 'Please choose Dog, Cat, or Dog & Cat.' };
  var dog = hasDog ? normalizePet_(p.dog || {}, 'DOG') : {}, cat = hasCat ? normalizePet_(p.cat || {}, 'CAT') : {};
  if(!dog||!cat)return {ok:false,error:'BAD_PET_DETAILS',message:'Please complete the name, age, current food brand and reason for every pet, plus size for every dog.'};

  var stock = stockFor_(condo.CONDO_ID, date, regs);
  var eligible = [];
  function addVariant(id) { if (eligible.indexOf(id) < 0) eligible.push(id); }
  if (hasDog) (dog.profiles || [dog]).forEach(function (x) {
    addVariant(String(x.age || '').toUpperCase() === 'PUPPY' ? 'NC_PUPPY_LAMB' : String(x.size || '').toUpperCase() === 'SMALL' ? 'NC_SMALL_BREED' : 'NC_MAINT_ADULT');
  });
  if (hasCat) addVariant('MJ_ADULT_SALMON');
  var samples = eligible.filter(function (id) { return stock[id] && stock[id].free > 0; });
  var unavailable = eligible.filter(function (id) { return samples.indexOf(id) < 0; });
  var sampleDog = samples.filter(function (id) { return /^NC_/.test(id); })[0] || (hasDog ? 'NONE' : '');
  var sampleCat = samples.indexOf('MJ_ADULT_SALMON') >= 0 ? 'MJ_ADULT_SALMON' : (hasCat ? 'NONE' : '');
  var gotSome = samples.length > 0;

  var code = nextClaimCode_(condo, regs);
  var row = {
    CLAIM_CODE: code, REG_ID: String(p.regId || Utilities.getUuid()), REGISTERED_AT: nowText_(), DATE: date,
    CONDO_ID: condo.CONDO_ID, CONDO_NAME: condo.CONDO_NAME, CONSENT: 'YES', PROMO_OPT_IN: p.promoOptIn === 'YES' ? 'YES' : 'NO',
    RESIDENT_NAME: String(p.name || '').slice(0, 80), MOBILE: mobile, PET_TYPE: petType,
    DOG_COUNT: hasDog ? Number(dog.count) || 1 : '', DOG_NAMES: hasDog ? String(dog.names || '').slice(0, 2000) : '',
    DOG_AGE: hasDog ? String(dog.age || '') : '', DOG_SIZE: hasDog ? String(dog.size || '') : '', DOG_BRAND: hasDog ? String(dog.brand || '').slice(0, 3000) : '',
    CAT_COUNT: hasCat ? Number(cat.count) || 1 : '', CAT_NAMES: hasCat ? String(cat.names || '').slice(0, 2000) : '',
    CAT_AGE: hasCat ? String(cat.age || '') : '', CAT_BRAND: hasCat ? String(cat.brand || '').slice(0, 3000) : '',
    DOG_PROFILES: hasDog && dog.profiles ? JSON.stringify(dog.profiles) : '', CAT_PROFILES: hasCat && cat.profiles ? JSON.stringify(cat.profiles) : '', DOG_BRAND_REASON: hasDog ? String(dog.reason||'') : '', CAT_BRAND_REASON: hasCat ? String(cat.reason||'') : '',
    SAMPLE_DOG: sampleDog, SAMPLE_CAT: sampleCat, SAMPLE_PRODUCTS: samples.join(', '), UNAVAILABLE_SAMPLES: unavailable.join(', '), STATUS: gotSome ? 'WAITING' : 'NO_STOCK', DATA_TYPE: trainingCondo_(condo.CONDO_ID) ? 'TRAINING' : 'LIVE'
  };
  append_('REGISTRATIONS', row);
  return { ok: true, ticket: ticketView_(row, condo) };
}

// New tickets hold every reserved variant. Older tickets retain their original allocation.
function assignedSamples_(r) {
  var ids = r.SAMPLE_PRODUCTS ? String(r.SAMPLE_PRODUCTS).split(',').map(function (id) { return id.trim(); }) : [r.SAMPLE_DOG, r.SAMPLE_CAT];
  return ids.filter(function (id, i, all) { return id && id !== 'NONE' && all.indexOf(id) === i; });
}

function ticketView_(r, condo) {
  var names = {};
  products_().forEach(function (x) { names[x.PRODUCT_ID] = x.PRODUCT_NAME; });
  var samples = assignedSamples_(r);
  return {
    code: r.CLAIM_CODE, date: r.DATE, registeredAt: r.REGISTERED_AT, status: r.STATUS,
    condoId: r.CONDO_ID, condoName: (condo && condo.CONDO_NAME) || r.CONDO_NAME,
    name: r.RESIDENT_NAME, petType: r.PET_TYPE,
    petNames: [r.DOG_NAMES, r.CAT_NAMES].filter(String).join(', '),
    samples: samples.map(function (id) { return { id: id, name: names[id] || id }; }),
    noStock: !!r.UNAVAILABLE_SAMPLES || [r.SAMPLE_DOG, r.SAMPLE_CAT].indexOf('NONE') >= 0,
    claimedAt: r.CLAIMED_AT || '', claimedBy: r.CLAIMED_BY || ''
  };
}

function staffLogin_(p) {
  var code = String(p.staffCode || '').trim().toUpperCase(), pin = String(p.pin || '').trim();
  var staff = read_('STAFF').filter(function (s) { return s.STAFF_CODE.toUpperCase() === code && s.STATUS.toUpperCase() !== 'INACTIVE'; })[0];
  if (!staff) return { ok: false, error: 'BAD_STAFF', message: 'Mali ang Staff Code.' };
  var pad4 = function (v) { v = String(v).trim(); return /^\d{1,4}$/.test(v) ? ('0000' + v).slice(-4) : v; };
  if (pad4(staff.PIN) !== pad4(pin)) return { ok: false, error: 'BAD_PIN', message: 'Mali ang PIN.' };
  var date = today_(), test = String(settings_().TEST_MODE || '').toUpperCase() === 'YES';
  var sched = read_('SCHEDULE').filter(function (s) { return s.STAFF_CODE.toUpperCase() === code && (s.DATE === date || test || (trainingStaff_(code) && trainingCondo_(s.CONDO_ID))); });
  sched.sort(function (a, b) { return (a.DATE === date ? 0 : 1) - (b.DATE === date ? 0 : 1); });
  if (!sched.length) return { ok: false, error: 'NO_ASSIGNMENT', message: 'Wala kang naka-assign na condo ngayong araw. Tawagan ang supervisor.' };
  var condo = findCondo_(sched[0].CONDO_ID);
  if (!condo) return { ok: false, error: 'CONDO_NOT_FOUND', message: 'Hindi makita ang condo sa sheet.' };
  return { ok: true, staff: { code: staff.STAFF_CODE.toUpperCase(), name: staff.BA_NAME }, condo: { id: condo.CONDO_ID, name: condo.CONDO_NAME, booth: condo.BOOTH_LOCATION }, date: date, testMode: test };
}

function findReg_(code, regs) {
  code = String(code || '').trim().toUpperCase();
  for (var i = 0; i < regs.length; i++) if (regs[i].CLAIM_CODE.toUpperCase() === code) return regs[i];
  return null;
}

function ticket_(p) {
  var r = findReg_(p.code, read_('REGISTRATIONS'));
  if (!r) return { ok: false, error: 'UNKNOWN_CODE', message: 'Walang ticket na ganitong number.' };
  // The resident's own phone may only see its own ticket (it proves this with the REG_ID it was given).
  if (p.requireReg && String(p.regId || '') !== r.REG_ID) return { ok: false, error: 'UNKNOWN_CODE', message: 'Walang ticket na ganitong number.' };
  return { ok: true, ticket: ticketView_(r, null) };
}

function savePhoto_(base64, name) {
  if (!base64) return { url: '', id: '' };
  var folderId = PropertiesService.getScriptProperties().getProperty('PHOTO_FOLDER_ID');
  if (!folderId) return { url: '', id: '' };
  var clean = String(base64).replace(/^data:image\/\w+;base64,/, '');
  var blob = Utilities.newBlob(Utilities.base64Decode(clean), 'image/jpeg', name + '.jpg');
  var file = DriveApp.getFolderById(folderId).createFile(blob);
  return { url: file.getUrl(), id: file.getId() };
}

function redeem_(p) {
  var rid = String(p.redemptionId || '');
  if (!rid) return { ok: false, error: 'BAD_REQUEST', message: 'Missing redemption id.' };
  var reds = read_('REDEMPTIONS');
  for (var i = 0; i < reds.length; i++) {
    if (reds[i].REDEMPTION_ID === rid) return { ok: true, already: true, result: reds[i].RESULT }; // phone re-sent the same save
  }
  if ((p.customerPhoto && p.photoConsent !== 'YES') || (p.photoConsent === 'YES' && !p.customerPhoto) || (p.photoConsent != null && ['YES', 'NO'].indexOf(p.photoConsent) < 0)) return { ok: false, error: 'PHOTO_CONSENT', message: 'I-check ang consent at customer photo.' };
  ensureColumns_('REGISTRATIONS'); ensureColumns_('REDEMPTIONS');
  var regs = read_('REGISTRATIONS'), reg = findReg_(p.code, regs);
  if (reg && trainingStaff_(p.staffCode) !== trainingRow_(reg)) return { ok: false, error: 'WRONG_ASSIGNMENT', message: 'Gamitin ang ticket para sa iyong assigned condo. Training accounts use TRAIN tickets.' };
  var products = {};
  products_().forEach(function (x) { products[x.PRODUCT_ID] = x; });
  var given = (p.products || []).filter(function (id, i, all) { return products[id] && all.indexOf(id) === i; });
  if (reg && given.some(function (id) { return assignedSamples_(reg).indexOf(id) < 0; })) return { ok: false, error: 'UNASSIGNED_PRODUCT', message: 'Ibigay lang ang naka-assign sa ticket: isang pack bawat applicable variant.' };
  var result = 'OK', note = '';
  if (!reg) { result = 'UNKNOWN_CODE'; note = 'Ticket number not found'; }
  else if (reg.STATUS === 'CLAIMED') { result = 'DUPLICATE'; note = 'Already claimed ' + reg.CLAIMED_AT + ' by ' + reg.CLAIMED_BY; }
  else if (!given.length) { result = 'NO_PRODUCT'; note = 'No sample selected'; }

  var photo = { url: '', id: '' };
  try { photo = savePhoto_(p.photo, (p.code || 'unknown') + '_' + rid.slice(0, 8)); } catch (e) { note = (note ? note + '; ' : '') + 'Photo not saved: ' + e.message; }

  var customerPhoto = { url: '', id: '' };
  if (p.photoConsent === 'YES' && p.customerPhoto) {
    try { customerPhoto = savePhoto_(p.customerPhoto, (p.code || 'unknown') + '_customer_' + rid.slice(0, 8)); if (!customerPhoto.url) throw new Error('Photo folder not configured'); }
    catch (e) { return { ok: false, error: 'PHOTO_SAVE_FAILED', message: 'Hindi na-save ang customer photo. Subukan ulit.' }; }
  }
  var date = today_();
  append_('REDEMPTIONS', {
    REDEMPTION_ID: rid, CLAIM_CODE: String(p.code || '').toUpperCase(), DATE: reg ? reg.DATE : date,
    CONDO_ID: p.condoId || '', STAFF_CODE: p.staffCode || '', BA_NAME: p.staffName || '',
    PRODUCTS_GIVEN: given.join(', '), RESULT: result, PHOTO_URL: photo.url, PHOTO_FILE_ID: photo.id,
    PHONE_SAVED_AT: String(p.phoneSavedAt || ''), SERVER_SAVED_AT: nowText_(), NOTE: note,
    PHOTO_CONSENT: p.photoConsent || 'NOT_RECORDED', CUSTOMER_PHOTO_URL: customerPhoto.url, CUSTOMER_PHOTO_FILE_ID: customerPhoto.id,
    DATA_TYPE: trainingStaff_(p.staffCode) || trainingCondo_(p.condoId) || (reg && trainingRow_(reg)) ? 'TRAINING' : 'LIVE'
  });
  if (result === 'OK') {
    update_('REGISTRATIONS', reg._row, {
      STATUS: 'CLAIMED', CLAIMED_AT: nowText_(), CLAIMED_BY: (p.staffName || p.staffCode || ''),
      SAMPLES_GIVEN: given.join(', '), PHOTO_URL: photo.url, PHOTO_CONSENT: p.photoConsent || 'NOT_RECORDED', CUSTOMER_PHOTO_URL: customerPhoto.url
    });
  }
  var msg = { OK: 'Saved', DUPLICATE: 'Na-claim na ang ticket na ito dati.', UNKNOWN_CODE: 'Walang ticket na ganitong number.', NO_PRODUCT: 'Walang napiling sample.' };
  return { ok: result === 'OK', result: result, message: msg[result] || result, note: note };
}

function status_(p) {
  var condo = findCondo_(p.condoId);
  if (!condo) return { ok: false, error: 'CONDO_NOT_FOUND', message: 'Condo not found.' };
  var date = today_(), regs = read_('REGISTRATIONS');
  var mine = regs.filter(function (r) { return r.DATE === date && r.CONDO_ID.toUpperCase() === condo.CONDO_ID.toUpperCase() && (trainingCondo_(condo.CONDO_ID) || !trainingRow_(r)); });
  var stock = stockFor_(condo.CONDO_ID, date, regs);
  return {
    ok: true, date: date,
    registered: mine.length,
    claimed: mine.filter(function (r) { return r.STATUS === 'CLAIMED'; }).length,
    waiting: mine.filter(function (r) { return r.STATUS === 'WAITING'; }).length,
    stock: products_().map(function (x) { var s = stock[x.PRODUCT_ID]; return { id: x.PRODUCT_ID, name: x.PRODUCT_NAME, allocated: s.allocated, given: s.given, left: s.left }; })
  };
}

function checkReportPasscode_(p) {
  var want = String(settings_().REPORT_PASSCODE || '');
  if (want.length < 8) return { ok: false, error: 'NOT_CONFIGURED', message: 'Report passcode is not set up yet (SETTINGS > REPORT_PASSCODE, 8+ characters).' };
  return String(p.passcode || '') === want ? { ok: true } : { ok: false, error: 'BAD_PASSCODE', message: 'Wrong passcode.' };
}

function report_() {
  var strip = function (rows) { return rows.map(function (r) { var o = {}; Object.keys(r).forEach(function (k) { if (k !== '_row') o[k] = r[k]; }); return o; }); };
  var regs = read_('REGISTRATIONS'), reds = read_('REDEMPTIONS'), excluded = {};
  regs.forEach(function (r) { if (trainingRow_(r)) excluded[r.CLAIM_CODE.toUpperCase()] = true; });
  // Retain exclusion for older claims made before DATA_TYPE existed.
  reds.forEach(function (r) { if (trainingRow_(r) && r.RESULT === 'OK') excluded[r.CLAIM_CODE.toUpperCase()] = true; });
  var live = function (r) { return !trainingRow_(r) && !excluded[String(r.CLAIM_CODE || '').toUpperCase()]; };
  return {
    ok: true, today: today_(),
    condos: strip(read_('CONDOS').filter(live)), schedule: strip(read_('SCHEDULE').filter(live)).map(function (s) { return { DATE: s.DATE, CONDO_ID: s.CONDO_ID, STAFF_CODE: s.STAFF_CODE }; }),
    stock: strip(read_('STOCK').filter(live)), products: strip(read_('PRODUCTS')),
    registrations: strip(regs.filter(live)).map(function (r) { r.MOBILE = String(r.MOBILE).replace(/^'/, ''); return r; }),
    redemptions: strip(reds.filter(live))
  };
}

/* ---------------- one-time setup ---------------- */

/** Run this once from the Apps Script editor. Safe to run again: it only adds what is missing. */
function setupSheets() {
  var b = book_();
  Object.keys(TABLES).forEach(function (name) {
    var sh = b.getSheetByName(name) || b.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(TABLES[name]);
      sh.getRange(1, 1, 1, TABLES[name].length).setFontWeight('bold').setBackground('#fff2a8');
      sh.setFrozenRows(1);
    } else { ensureColumns_(name); }
  });
  ['REGISTRATIONS', 'SCHEDULE', 'STOCK', 'STAFF'].forEach(function (n) { sheet_(n).getRange('A:Z').setNumberFormat('@'); });

  if (read_('PRODUCTS').length === 0) PRODUCT_SEED.forEach(function (r) { sheet_('PRODUCTS').appendRow(r); });
  if (read_('BRANDS').length === 0) BRAND_SEED.forEach(function (r) { sheet_('BRANDS').appendRow([r[0], r[1], 'ACTIVE']); });
  if (read_('SETTINGS').length === 0) {
    sheet_('SETTINGS').appendRow(['TEST_MODE', 'NO', 'Keep NO for live operation. Training accounts use the TRAIN assignment.']);
    sheet_('SETTINGS').appendRow(['REPORT_PASSCODE', '', 'Passcode the client types to open the report page (8+ characters).']);
  }
  if (read_('CONDOS').length === 0) {
    sheet_('CONDOS').appendRow(['RR', 'Rainbow Ridge Condominium', 'M.L. Quezon Avenue, Brgy. San Miguel, Taguig City', 'Hallway between Apo and Banahaw Building', 'RR', 'ACTIVE']);
    sheet_('CONDOS').appendRow(['LV', 'La Verti Residences', '1991 Taft Avenue, Pasay City', 'Lobby', 'LV', 'ACTIVE']);
  }
  if (read_('STAFF').length === 0) {
    sheet_('STAFF').appendRow(['PM01', 'Princess Mabag', randomPin_(), 'ACTIVE']);
    sheet_('STAFF').appendRow(['JA01', 'Jenny Azuela', randomPin_(), 'ACTIVE']);
  }
  if (read_('SCHEDULE').length === 0) {
    sheet_('SCHEDULE').appendRow(['2026-10-10', 'RR', 'PM01', '', '']);
    sheet_('SCHEDULE').appendRow(['2026-10-10', 'LV', 'JA01', '', '']);
  }
  if (read_('STOCK').length === 0) {
    ['RR', 'LV'].forEach(function (c) {
      Object.keys(DAILY_STOCK_SEED).forEach(function (id) { sheet_('STOCK').appendRow(['2026-10-10', c, id, DAILY_STOCK_SEED[id]]); });
    });
  }
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('GATEWAY_SECRET')) props.setProperty('GATEWAY_SECRET', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  if (!props.getProperty('PHOTO_FOLDER_ID')) props.setProperty('PHOTO_FOLDER_ID', DriveApp.createFolder('SMF Condo Activation Photos').getId());
  var blank = b.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && b.getSheets().length > 1) b.deleteSheet(blank);
  Logger.log('Setup done. GATEWAY_SECRET = ' + props.getProperty('GATEWAY_SECRET'));
}

/** Run before the real event: removes all registrations and claims (training data) and turns practice mode OFF.
    Photos in Drive are kept. */
function clearTrainingData() {
  ['REGISTRATIONS', 'REDEMPTIONS'].forEach(function (n) {
    var sh = sheet_(n), last = sh.getLastRow();
    if (last > 1) sh.deleteRows(2, last - 1);
  });
  var set = sheet_('SETTINGS'), vals = set.getDataRange().getValues();
  for (var r = 1; r < vals.length; r++) if (vals[r][0] === 'TEST_MODE') set.getRange(r + 1, 2).setValue('NO');
  Logger.log('Training data cleared. TEST_MODE = NO.');
}

function randomPin_() { return ('000' + Math.floor(Math.random() * 10000)).slice(-4); }
