/* BA app: sign in, scan the resident's ticket, take a photo, tap "Sample given". Works offline (saves on the phone). */
(function () {
  "use strict";
  var main = document.getElementById("main"), who = document.getElementById("who"), net = document.getElementById("net");
  var SESSION_KEY = "smfc_ba_session_v1", RECENT_KEY = "smfc_ba_recent_v1", CACHE_KEY = "smfc_ba_status_v1";
  var session = null, stream = null, scanning = false, products = {};
  var PRODUCT_NAMES = {
    NC_PUPPY_LAMB: "NutriChunks Puppy Lamb 150g", NC_MAINT_ADULT: "NutriChunks Maintenance Adult 150g",
    NC_SMALL_BREED: "NutriChunks Small Breed 150g", MJ_ADULT_SALMON: "Majesty Adult Salmon 150g"
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : "x" + Date.now() + Math.random().toString(16).slice(2)); }
  function manilaDate() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
  function manilaTime() { return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" }).format(new Date()); }
  function get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  function toast(msg, ms) { var t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, ms || 1800); }
  function productName(id) { return products[id] || PRODUCT_NAMES[id] || id; }

  async function api(path, opts) {
    opts = opts || {};
    var headers = { "Content-Type": "application/json" };
    if (session && session.token) headers.Authorization = "Bearer " + session.token;
    var res = await fetch(path, Object.assign({}, opts, { headers: headers }));
    var data = {};
    try { data = await res.json(); } catch (e) { throw new Error("Walang sagot ang server"); }
    if (res.status === 401 && data.error === "SIGN_IN") { signOut(true); throw new Error("Mag-sign in ulit"); }
    return data;
  }

  function setNet() {
    var on = navigator.onLine;
    SMFQueue.count().then(function (n) {
      net.className = "pill" + (on && !n ? "" : " off");
      net.textContent = !on ? "Offline" + (n ? " • " + n + " to send" : "") : n ? n + " to send" : "Online";
      var q = $("queueNote");
      if (q) { q.hidden = !n; q.textContent = n + " claim(s) naka-save sa phone, ise-send pag may signal. Huwag i-clear ang browser."; }
    }).catch(function () { });
  }

  /* ---------- sign in ---------- */
  function signInScreen(msg) {
    who.textContent = "BA App";
    main.innerHTML =
      '<div class="hero"><div class="heroTitle">BA Sign In</div><div class="heroSub">Ilagay ang Staff Code at 4-digit PIN mo. Lalabas automatic ang condo mo ngayong araw.</div></div>' +
      '<label class="lbl" for="code">Staff Code</label><input id="code" class="big" autocapitalize="characters" autocomplete="username" placeholder="PM01">' +
      '<label class="lbl" for="pin">4-digit PIN</label><input id="pin" class="big" type="password" inputmode="numeric" maxlength="4" autocomplete="current-password" placeholder="••••">' +
      '<div id="err" class="errbox" hidden></div>' +
      '<button id="go" class="btn primary huge" type="button">Sign In</button>';
    if (msg) { $("err").hidden = false; $("err").textContent = msg; }
    $("go").onclick = async function () {
      var b = $("go"); b.disabled = true; b.textContent = "Signing in…";
      try {
        var r = await api("/api/staff/login", { method: "POST", body: JSON.stringify({ staffCode: $("code").value.trim(), pin: $("pin").value.trim() }) });
        if (!r.ok) throw new Error(r.message || "Hindi maka-sign in");
        session = { token: r.token, staff: r.staff, condo: r.condo, date: r.date, testMode: !!r.testMode };
        put(SESSION_KEY, session);
        home();
      } catch (e) {
        b.disabled = false; b.textContent = "Sign In";
        $("err").hidden = false; $("err").textContent = navigator.onLine ? e.message : "Kailangan ng internet para mag-sign in (isang beses lang bawat araw).";
      }
    };
  }

  function signOut(expired) {
    SMFQueue.count().then(function (n) {
      if (n && !expired && !confirm(n + " claim(s) hindi pa na-send. Mag-sign out pa rin? (Hindi mabubura, ise-send pag nag-sign in ulit.)")) return;
      session = null; try { localStorage.removeItem(SESSION_KEY); } catch (e) { }
      stopCamera(); signInScreen(expired ? "Nag-expire ang sign in. Mag-sign in ulit." : "");
    });
  }

  /* ---------- home ---------- */
  function home() {
    stopCamera();
    who.textContent = session.staff.name + " • " + session.condo.name;
    main.innerHTML =
      (session.testMode ? '<div class="warnbox" style="margin:0 0 12px">PRACTICE MODE (TEST_MODE = YES sa sheet)</div>' : "") +
      '<div id="queueNote" class="queueNote" hidden></div>' +
      '<button id="scan" class="btn primary huge" type="button" style="margin-top:0">📷 I-scan ang ticket</button>' +
      '<div class="card" style="margin-top:12px"><div class="cardTitle">O i-type ang ticket number</div><div class="codeRow"><input id="typed" class="big" placeholder="RR-0001" autocapitalize="characters" autocomplete="off"><button id="find" class="btn dark" type="button">Hanapin</button></div></div>' +
      '<div class="card"><div class="cardTitle">Ngayong araw • ' + esc(session.condo.name) + '</div><div class="stats"><div class="stat"><b id="sReg">–</b><span>Registered</span></div><div class="stat"><b id="sClaim">–</b><span>Na-claim</span></div><div class="stat"><b id="sWait">–</b><span>Naghihintay</span></div></div></div>' +
      '<div class="card"><div class="cardTitle">Natitirang sample (stock left)</div><div id="stock"><div class="helper">Loading…</div></div></div>' +
      '<div class="card"><div class="cardTitle">Huling na-claim sa phone na ito</div><div id="recent" class="recent"></div></div>' +
      '<button id="out" class="linkBtn" type="button">Sign out</button>';
    $("scan").onclick = scanScreen;
    $("find").onclick = function () { var c = $("typed").value.trim().toUpperCase(); if (c) claimScreen({ code: c }); };
    $("out").onclick = function () { signOut(false); };
    renderRecent();
    renderStatus(get(CACHE_KEY));
    loadStatus();
    setNet();
  }

  function renderRecent() {
    var list = (get(RECENT_KEY) || []).filter(function (x) { return x.date === manilaDate(); }).slice(0, 8);
    $("recent").innerHTML = list.length ? list.map(function (x) { return "<div><span><b>" + esc(x.code) + "</b> " + esc(x.items) + "</span><span>" + esc(x.time) + "</span></div>"; }).join("") : '<div class="helper" style="border:0">Wala pa.</div>';
  }

  function renderStatus(s) {
    if (!s || !$("stock")) return;
    $("sReg").textContent = s.registered; $("sClaim").textContent = s.claimed; $("sWait").textContent = s.waiting;
    (s.stock || []).forEach(function (x) { products[x.id] = x.name; });
    $("stock").innerHTML = (s.stock || []).map(function (x) {
      return '<div class="stockRow"><span>' + esc(x.name) + '</span><b class="' + (x.left <= 10 ? "low" : "") + '">' + x.left + " / " + x.allocated + "</b></div>";
    }).join("") + (s.savedAt ? '<div class="helper">Updated ' + esc(s.savedAt) + "</div>" : "");
  }

  async function loadStatus() {
    if (!navigator.onLine) return;
    try {
      var r = await api("/api/status");
      if (r.ok) { r.savedAt = manilaTime(); put(CACHE_KEY, r); renderStatus(r); }
    } catch (e) { }
  }

  /* ---------- scanner ---------- */
  function stopCamera() {
    scanning = false;
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
  }

  function parseQr(text) {
    var m = String(text || "").trim().split("|");
    if (m[0] === "SMFC1" && m[1]) return { code: m[1].toUpperCase(), samples: (m[2] || "").split(",").filter(Boolean) };
    if (/^[A-Z0-9]{1,6}-\d{3,5}$/i.test(String(text).trim())) return { code: String(text).trim().toUpperCase(), samples: [] };
    return null;
  }

  async function scanScreen() {
    main.innerHTML =
      '<div class="scanBox"><video id="vid" playsinline muted></video><div class="frame"></div></div>' +
      '<div class="helper center" id="scanMsg">Itapat ang camera sa QR code ng ticket.</div>' +
      '<button id="cancel" class="btn secondary" type="button" style="margin-top:14px">Bumalik</button>';
    $("cancel").onclick = home;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    } catch (e) {
      $("scanMsg").innerHTML = '<span style="color:#b42318">Hindi mabuksan ang camera. I-allow ang camera, o i-type na lang ang ticket number.</span>';
      return;
    }
    var v = $("vid"); v.srcObject = stream; await v.play().catch(function () { });
    scanning = true;
    var detector = ("BarcodeDetector" in window) ? new window.BarcodeDetector({ formats: ["qr_code"] }) : null;
    var canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
    async function tick() {
      if (!scanning) return;
      var text = null;
      try {
        if (v.readyState >= 2) {
          if (detector) { var codes = await detector.detect(v); if (codes.length) text = codes[0].rawValue; }
          else {
            var w = 480, h = Math.round(v.videoHeight / v.videoWidth * 480) || 480;
            canvas.width = w; canvas.height = h; ctx.drawImage(v, 0, 0, w, h);
            var img = ctx.getImageData(0, 0, w, h), r = window.jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
            if (r) text = r.data;
          }
        }
      } catch (e) { }
      var parsed = text && parseQr(text);
      if (parsed) { if (navigator.vibrate) navigator.vibrate(80); stopCamera(); claimScreen(parsed); return; }
      setTimeout(tick, 150);
    }
    tick();
  }

  /* ---------- claim ---------- */
  function compressPhoto(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 1024, s = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.7));
      };
      img.onerror = function () { reject(new Error("Hindi mabasa ang photo")); };
      img.src = url;
    });
  }

  async function claimScreen(found) {
    var code = found.code, chosen = {}, photo = "", blocked = false, offline = false;
    (found.samples || []).forEach(function (id) { chosen[id] = true; });
    main.innerHTML =
      '<div class="card"><div class="cardTitle">Ticket</div><div style="font-size:36px;font-weight:900;letter-spacing:2px">' + esc(code) + '</div><div id="tinfo" class="helper" style="margin-top:4px">Chine-check…</div></div>' +
      '<div id="warn"></div>' +
      '<section class="q" data-q="products"><div class="qTitle">Ibibigay na sample</div><div class="qSub">Naka-check na ang para sa ticket. Palitan lang kung kailangan.</div><div class="choices" id="prods" style="grid-template-columns:1fr"></div></section>' +
      '<section class="q" data-q="photo"><div class="qTitle">Picture ng ticket + sample</div><div class="qSub">Kunan ang phone ng resident (kita ang number) kasama ang sample.</div>' +
      '<label class="btn secondary" style="text-align:center">📷 Kunan ng picture<input id="cam" type="file" accept="image/*" capture="environment" hidden></label><img id="prev" class="photoPrev" hidden alt=""></section>' +
      '<div id="err" class="errbox" hidden></div>' +
      '<button id="give" class="btn primary huge" type="button">✓ Sample given</button>' +
      '<button id="back" class="btn secondary" type="button">Cancel</button>';
    $("back").onclick = home;

    function paint() {
      var ids = Object.keys(PRODUCT_NAMES);
      $("prods").innerHTML = ids.map(function (id) { return '<button type="button" class="choice' + (chosen[id] ? " selected" : "") + '" data-v="' + id + '">' + esc(productName(id)) + "</button>"; }).join("");
      main.querySelector('[data-q="products"]').classList.toggle("answered", Object.keys(chosen).some(function (k) { return chosen[k]; }));
      main.querySelector('[data-q="photo"]').classList.toggle("answered", !!photo);
    }
    $("prods").onclick = function (e) { var b = e.target.closest(".choice"); if (!b) return; chosen[b.dataset.v] = !chosen[b.dataset.v]; paint(); };
    $("cam").onchange = async function () {
      var f = this.files && this.files[0]; if (!f) return;
      try { photo = await compressPhoto(f); $("prev").src = photo; $("prev").hidden = false; } catch (e) { toast(e.message); }
      paint();
    };
    paint();

    // Check the ticket online (if there is signal). Offline: trust what the QR says, the server double-checks later.
    try {
      if (!navigator.onLine) throw new Error("offline");
      var r = await api("/api/ticket?code=" + encodeURIComponent(code));
      if (!r.ok) {
        blocked = true;
        $("tinfo").textContent = "";
        $("warn").innerHTML = '<div class="errbox">' + esc(r.message || "Walang ganitong ticket.") + " Huwag ibigay ang sample.</div>";
      } else {
        var t = r.ticket;
        $("tinfo").innerHTML = "<b>" + esc(t.petNames) + "</b> • " + esc(t.name) + "<br>" + esc(t.condoName) + " • " + esc(t.registeredAt);
        if (t.status === "CLAIMED") {
          blocked = true;
          $("warn").innerHTML = '<div class="errbox">NA-CLAIM NA ito (' + esc(t.claimedAt) + ", " + esc(t.claimedBy) + "). Huwag nang ibigay ulit.</div>";
        } else if (t.condoId && t.condoId !== session.condo.id) {
          $("warn").innerHTML = '<div class="warnbox">Ang ticket na ito ay galing sa ' + esc(t.condoName) + ". Siguraduhin bago ibigay.</div>";
        }
        if (!found.samples || !found.samples.length) { chosen = {}; (t.samples || []).forEach(function (s) { chosen[s.id] = true; }); paint(); }
        if (t.noStock && !(t.samples || []).length) $("warn").innerHTML += '<div class="warnbox">Walang sample na naka-assign (ubos ang stock nung nag-register).</div>';
      }
      if (blocked) {
        main.querySelectorAll('.q,#give').forEach(function (x) { x.hidden = true; });
        $("back").textContent = "Bumalik";
      }
    } catch (e) {
      offline = true;
      $("tinfo").textContent = "Offline: hindi ma-check ngayon. Ise-save sa phone at iche-check pag may signal.";
    }

    $("give").onclick = async function () {
      var ids = Object.keys(chosen).filter(function (k) { return chosen[k]; }), err = $("err");
      if (blocked) { err.hidden = false; err.textContent = "Hindi pwedeng i-claim ang ticket na ito."; return; }
      if (!ids.length) { err.hidden = false; err.textContent = "Pumili ng sample na ibinigay."; main.querySelector('[data-q="products"]').classList.add("bad"); return; }
      if (!photo) { err.hidden = false; err.textContent = "Kunan muna ng picture ang ticket + sample."; main.querySelector('[data-q="photo"]').classList.add("bad"); return; }
      var item = { redemptionId: uuid(), code: code, products: ids, photo: photo, phoneSavedAt: new Date().toISOString() };
      try { await SMFQueue.add(item); }
      catch (e) { err.hidden = false; err.textContent = "Hindi ma-save sa phone: " + e.message; return; }
      var recent = get(RECENT_KEY) || [];
      recent.unshift({ code: code, items: ids.map(function (id) { return productName(id).replace(/ 150g$/, "").replace("NutriChunks ", "NC ").replace("Majesty ", "MJ "); }).join(" + "), time: manilaTime(), date: manilaDate() });
      put(RECENT_KEY, recent.slice(0, 50));
      toast(offline ? "Saved sa phone ✓ (ise-send mamaya)" : "Saved ✓");
      home();
      sync();
    };
  }

  /* ---------- sending saved claims ---------- */
  var syncing = false;
  async function sync() {
    if (syncing || !session || !navigator.onLine) { setNet(); return; }
    syncing = true;
    try {
      var results = await SMFQueue.flush(async function (item) {
        var r = await api("/api/redeem", { method: "POST", body: JSON.stringify(item) });
        if (r.ok || r.already) return { done: true, r: r };
        if (["DUPLICATE", "UNKNOWN_CODE", "NO_PRODUCT", "PHOTO_TOO_BIG"].indexOf(r.result || r.error) >= 0) return { done: true, r: r }; // final answer, kept in REDEMPTIONS for checking
        return { done: false, r: r };
      });
      results.forEach(function (x) {
        var r = x.r && x.r.r;
        if (r && !r.ok && !r.already && (r.result === "DUPLICATE" || r.result === "UNKNOWN_CODE")) toast(x.item.code + ": " + (r.message || r.result), 4000);
      });
      if (results.length) loadStatus();
    } catch (e) { }
    syncing = false;
    setNet();
  }

  window.addEventListener("online", function () { setNet(); sync(); });
  window.addEventListener("offline", setNet);
  setInterval(sync, 20000);
  setInterval(function () { if (session && $("stock")) loadStatus(); }, 60000);

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () { });

  session = get(SESSION_KEY);
  if (session && session.date !== manilaDate() && !session.testMode) session = null;
  if (session) { home(); sync(); } else signInScreen();
})();
