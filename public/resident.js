/* Resident registration page. Opened from the QR poster at the booth: /?c=RR */
(function () {
  "use strict";
  var main = document.getElementById("main");
  var condoId = (new URLSearchParams(location.search).get("c") || "").trim().toUpperCase();
  var TICKET_KEY = "smfc_ticket_v1";
  var state = { consent: "", petType: "", dogCount: 1, catCount: 1, dogAge: "", dogSize: "", dogBrand: "", catAge: "", catBrand: "", promo: "" };
  var info = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : "r" + Date.now() + Math.random().toString(16).slice(2)); }
  function normMobile(v) {
    var d = String(v || "").replace(/[^0-9+]/g, "");
    if (/^\+639\d{9}$/.test(d)) return "0" + d.slice(3);
    if (/^639\d{9}$/.test(d)) return "0" + d.slice(2);
    if (/^9\d{9}$/.test(d)) return "0" + d;
    return d;
  }
  function loadTicket() { try { return JSON.parse(localStorage.getItem(TICKET_KEY) || "null"); } catch (e) { return null; } }
  function saveTicket(t) { try { localStorage.setItem(TICKET_KEY, JSON.stringify(t)); } catch (e) { } }

  async function api(path, opts) {
    var res = await fetch(path, Object.assign({ headers: { "Content-Type": "application/json" } }, opts || {}));
    var data = {};
    try { data = await res.json(); } catch (e) { data = { ok: false, message: "No response from the server. Please try again." }; }
    return data;
  }

  /* ---------- ticket ---------- */
  function qrSvg(text) {
    var q = qrcode(0, "M");
    q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }

  function showTicket(t) {
    main.innerHTML = $("ticketTpl").innerHTML;
    $("tkCode").textContent = t.code;
    $("tkPets").textContent = [t.petNames, t.name].filter(Boolean).join(" • ");
    var ids = (t.samples || []).map(function (s) { return s.id; });
    $("tkQr").innerHTML = qrSvg("SMFC1|" + t.code + "|" + ids.join(","));
    var html = (t.samples || []).map(function (s) { return '<div class="sample">🎁 ' + esc(s.name) + "</div>"; }).join("");
    if (t.noStock) html += '<div class="sample none">' + (ids.length ? "One of the packs" : "The pack") + " for your pet is out of stock today. Thank you for registering!</div>";
    $("tkSamples").innerHTML = html;
    $("tkMeta").textContent = (t.condoName || "") + " • " + (t.registeredAt || t.date || "");
    var box = main.querySelector(".ticket");
    if (t.status === "CLAIMED") {
      box.classList.add("claimed");
      box.querySelector(".tkTop").innerHTML = '<span class="stamp">✓ FREE PACK RECEIVED</span>';
    }
    var again = document.createElement("div");
    again.className = "center";
    again.innerHTML = '<button type="button" class="linkBtn" id="another">Registering someone else on this phone? Tap here</button>';
    main.appendChild(again);
    $("another").onclick = function () {
      if (!confirm("Register another person on this phone? (Please make sure this free pack has been received first.)")) return;
      try { localStorage.removeItem(TICKET_KEY); } catch (e) { }
      location.reload();
    };
  }

  async function refreshTicket(t) {
    showTicket(t);
    if (t.status === "CLAIMED") return;
    try {
      var r = await api("/api/my-ticket?code=" + encodeURIComponent(t.code) + "&reg=" + encodeURIComponent(t.regId));
      if (r.ok && r.ticket) { r.ticket.regId = t.regId; saveTicket(r.ticket); showTicket(r.ticket); }
    } catch (e) { /* offline: the saved ticket is enough */ }
  }

  /* ---------- form ---------- */
  function paintChoices(group) {
    var name = group.dataset.name;
    group.querySelectorAll(".choice").forEach(function (b) { b.classList.toggle("selected", b.dataset.v === state[name]); });
  }

  function brandButtons(pet) {
    var list = (info.brands || []).filter(function (b) { return b.petType === pet || b.petType === "BOTH"; }).map(function (b) { return b.brand; });
    return list.map(function (b) { return '<button type="button" class="choice" data-v="' + esc(b) + '">' + esc(b) + "</button>"; }).join("");
  }

  function isOther(v) { return /^iba/i.test(v || "") || /other/i.test(v || ""); }

  function answered() {
    var a = {};
    a.consent = state.consent === "YES";
    a.petType = !!state.petType;
    a.dogNames = !!($("dogNames").value.trim());
    a.dogCount = true;
    a.dogAge = !!state.dogAge;
    a.dogSize = !!state.dogSize;
    a.dogBrand = !!state.dogBrand && (!isOther(state.dogBrand) || !!$("dogBrandOther").value.trim());
    a.catNames = !!($("catNames").value.trim());
    a.catCount = true;
    a.catAge = !!state.catAge;
    a.catBrand = !!state.catBrand && (!isOther(state.catBrand) || !!$("catBrandOther").value.trim());
    a.name = $("name").value.trim().length >= 2;
    a.mobile = /^09\d{9}$/.test(normMobile($("mobile").value));
    a.promo = !!state.promo;
    return a;
  }

  function refresh() {
    var a = answered();
    main.querySelectorAll(".q").forEach(function (q) { q.classList.toggle("answered", !!a[q.dataset.q]); q.classList.remove("bad"); });
    $("noConsent").hidden = state.consent !== "NO";
    $("afterConsent").hidden = state.consent !== "YES";
    var dog = state.petType === "DOG" || state.petType === "BOTH", cat = state.petType === "CAT" || state.petType === "BOTH";
    $("dogPart").hidden = !dog; $("catPart").hidden = !cat;
    $("youPart").hidden = !state.petType;
    $("dogBrandOther").hidden = !isOther(state.dogBrand);
    $("catBrandOther").hidden = !isOther(state.catBrand);
    var m = $("mobile").value.trim();
    $("mobileHint").hidden = !m || a.mobile || m.replace(/\D/g, "").length < 10;
  }

  function missing() {
    var a = answered(), need = ["consent", "petType"];
    if (state.petType === "DOG" || state.petType === "BOTH") need = need.concat(["dogNames", "dogAge", "dogSize", "dogBrand"]);
    if (state.petType === "CAT" || state.petType === "BOTH") need = need.concat(["catNames", "catAge", "catBrand"]);
    need = need.concat(["name", "mobile", "promo"]);
    return need.filter(function (k) { return !a[k]; });
  }

  function buildForm() {
    main.innerHTML = $("formTpl").innerHTML;
    main.querySelector('[data-name="dogBrand"]').innerHTML = brandButtons("DOG");
    main.querySelector('[data-name="catBrand"]').innerHTML = brandButtons("CAT");
    main.querySelectorAll(".choices").forEach(function (group) {
      group.addEventListener("click", function (e) {
        var b = e.target.closest(".choice"); if (!b) return;
        state[group.dataset.name] = b.dataset.v;
        paintChoices(group); refresh();
      });
    });
    main.querySelectorAll(".stepper").forEach(function (st) {
      st.addEventListener("click", function (e) {
        var b = e.target.closest(".stepBtn"); if (!b) return;
        var n = st.dataset.name;
        state[n] = Math.max(1, Math.min(30, state[n] + Number(b.dataset.d)));
        st.querySelector(".stepValue").textContent = state[n];
      });
    });
    main.querySelectorAll("input").forEach(function (i) { i.addEventListener("input", refresh); });
    $("submit").onclick = submit;
    refresh();
  }

  async function submit() {
    var miss = missing(), err = $("formError");
    if (miss.length) {
      miss.forEach(function (k) { var q = main.querySelector('.q[data-q="' + k + '"]'); if (q) q.classList.add("bad"); });
      var first = main.querySelector(".q.bad");
      err.hidden = false; err.textContent = "Some answers are missing. Please complete the items marked in red.";
      if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    err.hidden = true;
    var btn = $("submit");
    btn.disabled = true; btn.textContent = "Saving…";
    var dogBrand = isOther(state.dogBrand) ? "Other: " + $("dogBrandOther").value.trim() : state.dogBrand;
    var catBrand = isOther(state.catBrand) ? "Other: " + $("catBrandOther").value.trim() : state.catBrand;
    var regId = uuid();
    var payload = {
      condoId: condoId, regId: regId, consent: "YES", promoOptIn: state.promo,
      name: $("name").value.trim(), mobile: normMobile($("mobile").value), petType: state.petType,
      dog: { names: $("dogNames").value.trim(), count: state.dogCount, age: state.dogAge, size: state.dogSize, brand: dogBrand },
      cat: { names: $("catNames").value.trim(), count: state.catCount, age: state.catAge, brand: catBrand }
    };
    var r;
    try { r = await api("/api/register", { method: "POST", body: JSON.stringify(payload) }); }
    catch (e) { r = { ok: false, message: "No internet connection. Please try again when you have signal, or ask our Pet Pals at the booth." }; }
    if (r.ok && r.ticket) {
      r.ticket.regId = regId;
      saveTicket(r.ticket);
      window.scrollTo(0, 0);
      showTicket(r.ticket);
      return;
    }
    btn.disabled = false; btn.textContent = "Get my FREE NutriChunks / Majesty";
    err.hidden = false; err.textContent = r.message || "Your registration was not saved. Please try again.";
    if (r.error === "ALREADY_REGISTERED" || r.error === "BAD_MOBILE") main.querySelector('.q[data-q="mobile"]').classList.add("bad");
  }

  async function start() {
    var t = loadTicket();
    if (t && t.code) { $("condoLine").textContent = t.condoName || ""; return refreshTicket(t); }
    if (!condoId) { main.innerHTML = '<div class="errbox">Please scan the QR code at the booth to register.</div>'; return; }
    try { info = await api("/api/condo?c=" + encodeURIComponent(condoId)); }
    catch (e) { info = { ok: false, message: "No internet connection. Please try again when you have signal." }; }
    if (!info.ok) { main.innerHTML = '<div class="errbox">' + esc(info.message || "Something went wrong. Please try again.") + "</div>"; return; }
    $("condoLine").textContent = info.condo.name;
    if (!info.running) { main.innerHTML = '<div class="warnbox">' + esc(info.condo.name) + ": there is no sampling today. We hope to see you at our next visit!</div>"; return; }
    buildForm();
  }

  start();
})();
