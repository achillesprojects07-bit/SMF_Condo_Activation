/* Saves each "Sample given" on the phone first (IndexedDB), then sends it when there is signal.
   Nothing is removed from the phone until the server confirms it was saved. */
(function (global) {
  "use strict";
  var DB = "smf-condo-ba", STORE = "queue", VERSION = 1;

  function open() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "redemptionId" });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode), store = t.objectStore(STORE), out;
        out = fn(store);
        t.oncomplete = function () { resolve(out && "result" in out ? out.result : out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  var Q = {
    add: function (item) { return tx("readwrite", function (s) { return s.put(item); }); },
    all: function () { return tx("readonly", function (s) { return s.getAll(); }); },
    remove: function (id) { return tx("readwrite", function (s) { return s.delete(id); }); },
    count: function () { return tx("readonly", function (s) { return s.count(); }); },
    /** send(item) must resolve {done:true} when the server has it (saved, or a final answer like DUPLICATE). */
    flush: function (send) {
      return Q.all().then(function (items) {
        items.sort(function (a, b) { return String(a.phoneSavedAt).localeCompare(String(b.phoneSavedAt)); });
        var results = [];
        return items.reduce(function (p, item) {
          return p.then(function () {
            return send(item).then(function (r) {
              results.push({ item: item, r: r });
              if (r && r.done) return Q.remove(item.redemptionId);
            }, function (e) { results.push({ item: item, error: e }); });
          });
        }, Promise.resolve()).then(function () { return results; });
      });
    }
  };
  global.SMFQueue = Q;
})(typeof window !== "undefined" ? window : globalThis);
