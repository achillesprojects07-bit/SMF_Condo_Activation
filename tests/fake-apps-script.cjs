/* A small stand-in for Google Apps Script so gateway/Code.gs can be tested on a computer.
   Sheets live in memory. Usage: const gw = loadGateway(); gw.setupSheets(); gw.call('register', {...}) */
const fs = require("fs"), path = require("path"), vm = require("vm"), crypto = require("crypto");

function makeSheet(name) {
  const rows = [];
  const sheet = {
    name, rows,
    getLastRow: () => rows.length,
    getLastColumn: () => rows.reduce((m, r) => Math.max(m, r.length), 0),
    appendRow: r => { rows.push(r.slice()); return sheet; },
    getDataRange: () => ({ getValues: () => rows.map(r => { const w = sheet.getLastColumn(); const c = r.slice(); while (c.length < w) c.push(""); return c; }) }),
    getRange: (a, b, c, d) => {
      if (typeof a === "string") return { setNumberFormat: () => { } };
      const row = a, col = b, nr = c || 1, nc = d || 1;
      return {
        getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const src = rows[row - 1 + i] || []; out.push(Array.from({ length: nc }, (_, j) => src[col - 1 + j] ?? "")); } return out; },
        setValue: v => { while (rows.length < row) rows.push([]); const r = rows[row - 1]; while (r.length < col) r.push(""); r[col - 1] = v; },
        setFontWeight: function () { return this; }, setBackground: function () { return this; }, setNumberFormat: function () { return this; }
      };
    },
    setFrozenRows: () => { }
  };
  return sheet;
}

function loadGateway(opts = {}) {
  const sheets = new Map();
  const book = {
    getSheetByName: n => sheets.get(n) || null,
    insertSheet: n => { const s = makeSheet(n); sheets.set(n, s); return s; },
    getSheets: () => [...sheets.values()],
    deleteSheet: s => sheets.delete(s.name)
  };
  const props = new Map(Object.entries(opts.props || {}));
  const files = [];
  let clock = opts.now || new Date("2026-10-10T02:00:00Z"); // 10:00 Manila, Saturday Oct 10
  const fmt = (d, tz, pattern) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(d).map(x => [x.type, x.value]));
    return pattern.replace("yyyy", p.year).replace("MM", p.month).replace("dd", p.day).replace("HH", p.hour).replace("mm", p.minute).replace("ss", p.second);
  };
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(clock.getTime()); } static now() { return clock.getTime(); } }
  const ctx = {
    console, JSON, Math, String, Number, Object, Array, Error, RegExp, isNaN,
    Date: FakeDate,
    SpreadsheetApp: { getActiveSpreadsheet: () => book, flush: () => { } },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => { } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.get(k) || null, setProperty: (k, v) => props.set(k, v) }) },
    Utilities: {
      formatDate: fmt, getUuid: () => crypto.randomUUID(),
      base64Decode: s => Array.from(Buffer.from(s, "base64")),
      newBlob: (bytes, type, name) => ({ bytes, type, name })
    },
    DriveApp: {
      createFolder: n => ({ getId: () => "folder-1" }),
      getFolderById: () => ({ createFile: blob => { const id = "file-" + (files.length + 1); files.push({ id, blob }); return { getUrl: () => "https://drive.google.com/file/d/" + id, getId: () => id }; } })
    },
    ContentService: { createTextOutput: t => ({ text: t, setMimeType() { return this; } }), MimeType: { JSON: "json" } },
    Logger: { log: () => { } }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "gateway", "Code.gs"), "utf8"), ctx, { filename: "Code.gs" });
  ctx.setupSheets();
  const secret = props.get("GATEWAY_SECRET");
  return {
    ctx, sheets, files, props, secret,
    setNow: d => { clock = new RealDate(d); },
    /** Same path a real web request takes (doPost), so the secret check is tested too. */
    post: body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text),
    call: (action, payload) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ secret, action, payload }) } }).text),
    table: name => { const s = sheets.get(name); const [h, ...rest] = s.rows; return rest.map(r => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ""]))); },
    setSetting: (key, value) => { const s = sheets.get("SETTINGS"); const r = s.rows.find(x => x[0] === key); if (r) r[1] = value; else s.rows.push([key, value, ""]); },
    pinOf: code => sheets.get("STAFF").rows.find(r => r[0] === code)[2]
  };
}

module.exports = { loadGateway };
