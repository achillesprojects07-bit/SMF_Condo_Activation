/* Client report: registrations per condo per day, dogs vs cats, current brands, samples given, stock left, and every detail collected. */
(function () {
  "use strict";
  var main = document.getElementById("main"), upd = document.getElementById("upd");
  var KEY = "smfc_report_token_v1", token = null, data = null, filter = "ALL";
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function sum(arr, f) { return arr.reduce(function (a, x) { return a + (f(x) || 0); }, 0); }
  try { token = sessionStorage.getItem(KEY); } catch (e) { }

  function login(msg) {
    main.innerHTML = '<div style="max-width:420px;margin:30px auto"><div class="hero"><div class="heroTitle">Client sign in</div><div class="heroSub">Enter the report passcode.</div></div>' +
      '<input id="pass" class="big" type="password" autocomplete="current-password" placeholder="Passcode"><div id="err" class="errbox" hidden></div>' +
      '<button id="go" class="btn primary huge" type="button">View report</button></div>';
    if (msg) { $("err").hidden = false; $("err").textContent = msg; }
    $("go").onclick = async function () {
      var r = await fetch("/api/report/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passcode: $("pass").value }) }).then(function (x) { return x.json(); }).catch(function () { return { ok: false, message: "No connection." }; });
      if (!r.ok) { $("err").hidden = false; $("err").textContent = r.message || "Wrong passcode."; return; }
      token = r.token; try { sessionStorage.setItem(KEY, token); } catch (e) { }
      load();
    };
  }

  async function load() {
    main.innerHTML = '<div class="statusbox">Loading report…</div>';
    var r = await fetch("/api/report", { headers: { Authorization: "Bearer " + token } }).then(function (x) { return x.json(); }).catch(function () { return { ok: false, message: "No connection." }; });
    if (!r.ok) { if (r.error === "SIGN_IN" || r.error === "FORBIDDEN") return login("Please sign in."); main.innerHTML = '<div class="errbox">' + esc(r.message || "Could not load.") + "</div>"; return; }
    data = r; upd.textContent = "Updated " + new Date().toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
    render();
  }

  function render() {
    var days = data.days.filter(function (d) { return filter === "ALL" || d.date === filter; });
    var regs = data.registrations.filter(function (r) { return filter === "ALL" || r.DATE === filter; });
    var pids = Object.keys(data.products);
    var dates = Array.from(new Set(data.days.map(function (d) { return d.date; }))).sort();
    var given = sum(days, function (d) { return sum(pids, function (p) { return d.given[p]; }); });
    var alloc = sum(days, function (d) { return sum(pids, function (p) { return d.allocated[p]; }); });

    var h = '<div class="toolbar"><select id="day"><option value="ALL">All days</option>' + dates.map(function (d) { return '<option' + (d === filter ? " selected" : "") + ">" + d + "</option>"; }).join("") + "</select>" +
      '<button class="btn secondary" id="refresh" type="button">Refresh</button><button class="btn dark" id="csvReg" type="button">Download all registrations (CSV)</button><button class="btn secondary" id="csvRed" type="button">Download claims log (CSV)</button></div>';

    h += '<div class="kpis">' +
      kpi(sum(days, function (d) { return d.registered; }), "Registrations") +
      kpi(sum(days, function (d) { return d.dogs; }), "Dogs") +
      kpi(sum(days, function (d) { return d.cats; }), "Cats") +
      kpi(sum(days, function (d) { return d.claimed; }), "Residents who claimed") +
      kpi(given, "Sample packs given") +
      kpi(alloc - given, "Packs left (of " + alloc + ")") +
      kpi(sum(days, function (d) { return d.promoOptIn; }), "OK to receive promos") + "</div>";

    h += "<h2>Per condo per day</h2><div class=\"scroll\"><table><tr><th>Date</th><th>Condo</th><th class=n>Registered</th><th class=n>Dog homes</th><th class=n>Cat homes</th><th class=n>Dog &amp; cat</th><th class=n>Dogs</th><th class=n>Cats</th><th class=n>Claimed</th><th class=n>Not yet claimed</th></tr>" +
      days.map(function (d) { return "<tr><td>" + d.date + "</td><td>" + esc(d.condoName) + '</td><td class=n>' + d.registered + "</td><td class=n>" + d.dogHomes + "</td><td class=n>" + d.catHomes + "</td><td class=n>" + d.bothHomes + "</td><td class=n>" + d.dogs + "</td><td class=n>" + d.cats + "</td><td class=n>" + d.claimed + "</td><td class=n>" + d.waiting + "</td></tr>"; }).join("") + "</table></div>";

    h += "<h2>Samples given and stock left</h2><div class=\"scroll\"><table><tr><th>Date</th><th>Condo</th>" + pids.map(function (p) { return "<th class=n>" + esc(data.products[p]) + "<br>given / left</th>"; }).join("") + "</tr>" +
      days.map(function (d) { return "<tr><td>" + d.date + "</td><td>" + esc(d.condoName) + "</td>" + pids.map(function (p) { return "<td class=n>" + (d.given[p] || 0) + " / <b>" + (d.left[p] || 0) + "</b></td>"; }).join("") + "</tr>"; }).join("") + "</table></div>";

    h += '<div class="cols"><div><h2>Current dog food brands</h2>' + brandBars(regs, "DOG_BRAND") + '</div><div><h2>Current cat food brands</h2>' + brandBars(regs, "CAT_BRAND") + "</div></div>";
    h += '<div class="cols"><div><h2>Dog age and size</h2>' + countBars(regs, function (r) { return r.DOG_AGE ? r.DOG_AGE + " • " + (r.DOG_SIZE || "-") : ""; }) + '</div><div><h2>Cat age</h2>' + countBars(regs, function (r) { return r.CAT_AGE; }) + "</div></div>";

    if (data.flags.length) h += "<h2>Claims to check (" + data.flags.length + ")</h2><div class=\"scroll\"><table><tr><th>Ticket</th><th>Result</th><th>BA</th><th>Note</th><th>Photo</th></tr>" + data.flags.map(function (f) { return "<tr><td>" + esc(f.CLAIM_CODE) + "</td><td>" + esc(f.RESULT) + "</td><td>" + esc(f.BA_NAME) + "</td><td>" + esc(f.NOTE) + '</td><td class="photo">' + (f.PHOTO_URL ? '<a href="' + esc(f.PHOTO_URL) + '" target="_blank" rel="noopener">View</a>' : "") + "</td></tr>"; }).join("") + "</table></div>";

    var cols = ["CLAIM_CODE", "REGISTERED_AT", "CONDO_NAME", "RESIDENT_NAME", "MOBILE", "PET_TYPE", "DOG_COUNT", "DOG_NAMES", "DOG_AGE", "DOG_SIZE", "DOG_BRAND", "CAT_COUNT", "CAT_NAMES", "CAT_AGE", "CAT_BRAND", "PROMO_OPT_IN", "STATUS", "SAMPLES_GIVEN", "CLAIMED_AT", "CLAIMED_BY", "PHOTO_URL"];
    h += "<h2>All registrations (" + regs.length + ")</h2><div class=\"scroll\"><table><tr>" + cols.map(function (c) { return "<th>" + c.replace(/_/g, " ").toLowerCase() + "</th>"; }).join("") + "</tr>" +
      regs.map(function (r) { return "<tr>" + cols.map(function (c) { return c === "PHOTO_URL" ? '<td class="photo">' + (r[c] ? '<a href="' + esc(r[c]) + '" target="_blank" rel="noopener">View</a>' : "") + "</td>" : "<td>" + esc(r[c]) + "</td>"; }).join("") + "</tr>"; }).join("") + "</table></div>";

    main.innerHTML = h;
    $("day").onchange = function () { filter = this.value; render(); };
    $("refresh").onclick = load;
    $("csvReg").onclick = function () { csv("condo-registrations.csv", regs); };
    $("csvRed").onclick = function () { csv("condo-claims-log.csv", data.redemptions.filter(function (r) { return filter === "ALL" || r.DATE === filter; })); };
  }

  function kpi(n, label) { return '<div class="kpi"><b>' + n + "</b><span>" + esc(label) + "</span></div>"; }
  function countBars(rows, keyFn) {
    var m = {}; rows.forEach(function (r) { var k = keyFn(r); if (k) m[k] = (m[k] || 0) + 1; });
    var list = Object.keys(m).map(function (k) { return [k, m[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
    if (!list.length) return '<div class="helper">No data yet.</div>';
    var max = list[0][1];
    return list.map(function (x) { return '<div class="brandRow"><span>' + esc(x[0]) + '</span><div class="bar" style="width:' + Math.max(4, Math.round(x[1] / max * 100)) + '%"></div><b>' + x[1] + "</b></div>"; }).join("");
  }
  function brandBars(rows, field) { return countBars(rows, function (r) { return r[field]; }); }

  function csv(name, rows) {
    if (!rows.length) { alert("No rows yet."); return; }
    var cols = Object.keys(rows[0]);
    var q = function (v) { v = String(v == null ? "" : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var text = "﻿" + [cols.join(",")].concat(rows.map(function (r) { return cols.map(function (c) { return q(r[c]); }).join(","); })).join("\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  if (token) load(); else login();
})();
