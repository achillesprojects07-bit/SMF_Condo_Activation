/* Resident registration page. Opened from the QR poster at the booth: /?c=RR */
(function () {
  "use strict";
  var main = document.getElementById("main");
  var condoId = (new URLSearchParams(location.search).get("c") || "").trim().toUpperCase();
  var TICKET_KEY = "smfc_ticket_v1";
  var state = { consent: "", petType: "", dogCount: 1, catCount: 1, dogAge: "", dogSize: "", dogBrand: "", catAge: "", catBrand: "", promo: "" };
  var info = null;
  var profiles = {dog: [], cat: []}, pendingRegId = null;

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
  function eventDateLabel(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return '';
    return new Date(date+'T00:00:00+08:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'Asia/Manila'}).toUpperCase();
  }
  function claimNote(t) {
    return 'Claim on '+eventDateLabel(t.date)+(t.booth ? ' at '+t.booth+', '+t.condoName+'.' : ' at '+t.condoName+'.');
  }

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

  function ticketImage(t) {
    var canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
    var width = 960, lines = [], y = 48;
    function wrap(value, font, color) {
      ctx.font = font;
      var words = String(value || "").split(/\s+/), line = "";
      words.forEach(function (word) {
        var next = line ? line + " " + word : word;
        if (line && ctx.measureText(next).width > width - 100) { lines.push({ text: line, font: font, color: color }); line = word; }
        else line = next;
      });
      if (line) lines.push({ text: line, font: font, color: color });
    }
    canvas.width = width;
    wrap(t.status === "CLAIMED" ? "FREE PACK RECEIVED" : "FREE NutriChunks / Majesty", "bold 36px sans-serif", "#067647");
    wrap(t.code, "bold 48px sans-serif", "#1c2733");
    wrap([t.petNames, t.name].filter(Boolean).join(" • "), "28px sans-serif", "#344054");
    var headerLines = lines.length;
    wrap("Applicable variants for your pet(s)", "bold 30px sans-serif", "#0066b3");
    (t.samples || []).forEach(function (s) { wrap("1 FREE pack — " + s.name, "bold 30px sans-serif", "#067647"); });
    (t.unavailableSamples || []).forEach(function (s) { wrap(s.name + " — OUT OF STOCK", "bold 28px sans-serif", "#7a2e0e"); });
    if (t.noStock && !(t.unavailableSamples || []).length) wrap("Some applicable samples are out of stock.", "28px sans-serif", "#7a2e0e");
    wrap("One 150g pack per applicable variant, regardless of pet count.", "26px sans-serif", "#344054");
    wrap(t.status === "CLAIMED" ? "This ticket has already been redeemed." : "Present to our Pet Pals to redeem freebie", "bold 30px sans-serif", "#0066b3");
    wrap("Available while supplies last.", "26px sans-serif", "#344054");
    if (t.status !== 'CLAIMED' && eventDateLabel(t.date)) wrap(claimNote(t), "bold 28px sans-serif", "#0066b3");
    wrap((t.condoName || "") + " • " + (t.registeredAt || t.date || ""), "24px sans-serif", "#66717d");
    wrap("© 2026 Slingshotz Advertising Inc.", "22px sans-serif", "#526171");
    canvas.height = lines.length * 52 + 540 + 90;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.textAlign = "center"; ctx.textBaseline = "top";
    var q = qrcode(0, "M"), ids = (t.samples || []).map(function (s) { return s.id; });
    q.addData("SMFC1|" + t.code + "|" + ids.join(",")); q.make();
    var count = q.getModuleCount(), scale = Math.floor(500 / (count + 8)), side = (count + 8) * scale, left = Math.floor((width - side) / 2);
    lines.forEach(function (line, i) {
      if (i === headerLines) {
        ctx.fillStyle = "#000";
        for (var row = 0; row < count; row++) for (var col = 0; col < count; col++) if (q.isDark(row, col)) ctx.fillRect(left + (col + 4) * scale, y + (row + 4) * scale, scale, scale);
        y += 540;
      }
      ctx.fillStyle = line.color; ctx.font = line.font; ctx.fillText(line.text, width / 2, y); y += 52;
    });
    return canvas;
  }

  /* ---------- where to buy (STORES tab in the sheet) ---------- */
  var VARIANT = {
    NC_PUPPY_LAMB: { cls: "variant-puppy", bg: "#fff3d6", line: "#efa72c", ink: "#795006" },
    NC_MAINT_ADULT: { cls: "variant-maintenance", bg: "#e2f7f3", line: "#199e91", ink: "#096f64" },
    NC_SMALL_BREED: { cls: "variant-small", bg: "#ffedf0", line: "#e26e89", ink: "#99344a" },
    MJ_ADULT_SALMON: { cls: "variant-majesty", bg: "#f5eefa", line: "#6a2c91", ink: "#6a2c91" }
  };
  function variantLabel(id, t) {
    if (productInfo[id]) return productInfo[id].title;
    var s = (t.samples || []).concat(t.unavailableSamples || []).filter(function (x) { return x.id === id; })[0];
    return s ? String(s.name).replace(/\s*\d+\s*g$/i, "") : id;
  }
  function variantIds(t) { return (t.samples || []).concat(t.unavailableSamples || []).map(function (s) { return s.id; }).filter(function (v, i, a) { return a.indexOf(v) === i; }); }
  function storeAddress(st) { return [st.address, st.city].filter(Boolean).join(", "); }
  /** Draws the "Where to buy near you" panel; returns its height. measure = true only measures. */
  function drawStoresPanel(ctx, t, top, W, measure) {
    var stores = t.stores || []; if (!stores.length) return 0;
    var pad = 48, inner = W - pad * 2, y = top + 36;
    function f(size, w) { ctx.font = (w || 400) + " " + size + "px sans-serif"; }
    function wrapLines(text, maxW) { var words = String(text).split(/\s+/), out = [], cur = ""; words.forEach(function (w) { var n = cur ? cur + " " + w : w; if (cur && ctx.measureText(n).width > maxW) { out.push(cur); cur = w; } else cur = n; }); if (cur) out.push(cur); return out; }
    function rr(x, y2, w, h, r, fill, stroke, lw) { ctx.beginPath(); ctx.moveTo(x + r, y2); ctx.arcTo(x + w, y2, x + w, y2 + h, r); ctx.arcTo(x + w, y2 + h, x, y2 + h, r); ctx.arcTo(x, y2 + h, x, y2, r); ctx.arcTo(x, y2, x + w, y2, r); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.lineWidth = lw || 3; ctx.strokeStyle = stroke; ctx.stroke(); } }
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    var names = variantIds(t).map(function (id) { return variantLabel(id, t); });
    var startY = y;
    f(28, 500);
    var subLines = wrapLines("Stores near " + (t.condoName || "you"), inner - 56);
    var headerH = 118 + subLines.length * 38;
    if (!measure) {
      var panelH = drawStoresPanel(ctx, t, top, W, true) - 56;
      rr(pad, startY, inner, panelH, 28, "#f1f8ff");
      rr(pad, startY, inner, headerH, 28, "#0066b3");
    }
    y += 28; f(50, 900); if (!measure) { ctx.fillStyle = "#fff"; ctx.fillText("WHERE TO BUY", pad + 28, y); } y += 66;
    f(28, 500); subLines.forEach(function (l) { if (!measure) { ctx.fillStyle = "#fff"; ctx.fillText(l, pad + 28, y); } y += 38; });
    y = startY + headerH + 24;
    stores.forEach(function (st, i) {
      var tx = pad + 28 + 74, tw = inner - 56 - 74, row = y;
      f(32, 800); var nl = wrapLines(st.name, tw); f(26, 400); var al = wrapLines(storeAddress(st), tw);
      var h = nl.length * 40 + al.length * 34 + ((st.has || []).length ? 54 : 0) + 22;
      if (!measure) {
        var pinX = pad + 54, pinY = row + 24;
        ctx.beginPath(); ctx.arc(pinX, pinY, 24, Math.PI, 0);
        ctx.bezierCurveTo(pinX + 24, pinY + 20, pinX + 10, pinY + 31, pinX, pinY + 46);
        ctx.bezierCurveTo(pinX - 10, pinY + 31, pinX - 24, pinY + 20, pinX - 24, pinY);
        ctx.closePath(); ctx.fillStyle = "#0066b3"; ctx.fill();
        ctx.beginPath(); ctx.arc(pinX, pinY, 9, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill();
        var yy = row; f(32, 800); ctx.fillStyle = "#1c2733"; nl.forEach(function (l) { ctx.fillText(l, tx, yy); yy += 40; });
        f(26, 400); ctx.fillStyle = "#66717d"; al.forEach(function (l) { ctx.fillText(l, tx, yy); yy += 34; });
        var gx = tx; (st.has || []).forEach(function (id) {
          var c = VARIANT[id] || { bg: "#eef5fb", line: "#0066b3", ink: "#0066b3" }, label = variantLabel(id, t); f(21, 800);
          var w = ctx.measureText(label).width + 28; if (gx + w > tx + tw) return;
          rr(gx, yy + 8, w, 36, 18, c.bg, c.line, 2); ctx.fillStyle = c.ink; ctx.fillText(label, gx + 14, yy + 15); gx += w + 8;
        });
      }
      y += h;
    });
    y += 10;
    if (!measure) rr(pad, startY, inner, y - startY, 28, null, "#0066b3", 5);
    return y - top + 20;
  }

  function ticketProducts(t) {
    return (t.samples || []).concat(t.unavailableSamples || []).filter(function(s,i,all){return productInfo[s.id] && all.findIndex(function(x){return x.id===s.id;})===i;});
  }
  /* ---------- saved image: the branded ticket (logo, FREE NutriChunks or Majesty, QR, big number, packs),
     then product shots and the "where to buy" stores ---------- */
  var BRAND = { blue: "#0066b3", green: "#12a150", orange: "#f47b20", purple: "#6a2c91", ink: "#1c2733", muted: "#475467", line: "#e8edf2" };
  function loadImg(src) { return new Promise(function (res) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { res(null); }; i.src = src; }); }
  function rrect(ctx, x, y, w, h, r, fill, stroke, lw) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.lineWidth = lw || 4; ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  function brandFont(ctx, size, weight) { ctx.font = (weight || 400) + " " + size + "px -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"; }
  function wrapText(ctx, text, maxW) { var words = String(text || "").split(/\s+/), out = [], cur = ""; words.forEach(function (w) { var n = cur ? cur + " " + w : w; if (cur && ctx.measureText(n).width > maxW) { out.push(cur); cur = w; } else cur = n; }); if (cur) out.push(cur); return out; }

  function registeredLabel(t) {
    var m = String(t.registeredAt || "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (!m) return t.registeredAt || t.date || "";
    var months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    var h = Number(m[4]), ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
    return months[Number(m[2]) - 1] + " " + Number(m[3]) + ", " + m[1] + ", " + h + ":" + m[5] + " " + ap;
  }
  function drawBrandedTicket(ctx, t, W, logo, shots, draw, productsOnly) {
    var pad = 64, inner = W - pad * 2, y = 64;
    ctx.textBaseline = "top"; ctx.textAlign = "center";
    if (logo) { var lh = 112, lw = logo.width * lh / logo.height; if (draw) ctx.drawImage(logo, (W - lw) / 2, y, lw, lh); y += lh + 28; }
    if (!productsOnly) {
    // headline
    brandFont(ctx, 64, 900);
    var parts = [["FREE ", BRAND.green], ["NutriChunks", BRAND.orange], [" or ", BRAND.ink], ["Majesty", BRAND.purple]];
    var tw = parts.reduce(function (a, p) { return a + ctx.measureText(p[0]).width; }, 0), x = (W - tw) / 2;
    if (draw) { ctx.textAlign = "left"; parts.forEach(function (p) { ctx.fillStyle = p[1]; ctx.fillText(p[0], x, y); x += ctx.measureText(p[0]).width; }); ctx.textAlign = "center"; }
    y += 82;
    brandFont(ctx, 32, 600); if (draw) { ctx.fillStyle = BRAND.muted; ctx.fillText(t.condoName || "", W / 2, y); } y += 76;
    // QR in a blue box
    var ids = (t.samples || []).map(function (s) { return s.id; });
    var q = qrcode(0, "M"); q.addData("SMFC1|" + t.code + "|" + ids.join(",")); q.make();
    var n = q.getModuleCount(), size = 480, cell = Math.floor(size / (n + 4)), side = cell * (n + 4), qx = Math.round((W - side) / 2);
    if (draw) {
      rrect(ctx, qx - 22, y - 22, side + 44, side + 44, 34, "#fff", BRAND.blue, 10);
      ctx.fillStyle = "#000";
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) ctx.fillRect(qx + (c + 2) * cell, y + (r + 2) * cell, cell, cell);
    }
    y += side + 48;
    // the ticket number
    brandFont(ctx, 104, 900); if (draw) { ctx.fillStyle = BRAND.ink; ctx.fillText(t.code, W / 2, y); } y += 118;
    brandFont(ctx, 32, 600); var who = [t.petNames, t.name].filter(Boolean).join(" • ");
    if (who) { wrapText(ctx, who, inner).forEach(function (l) { if (draw) { ctx.fillStyle = BRAND.muted; ctx.fillText(l, W / 2, y); } y += 44; }); y += 10; }
    if (t.status === "CLAIMED") { brandFont(ctx, 34, 900); if (draw) { rrect(ctx, W / 2 - 240, y, 480, 66, 33, BRAND.green); ctx.fillStyle = "#fff"; ctx.fillText("✓ FREE PACK RECEIVED", W / 2, y + 14); } y += 90; }
    // packs
    (t.samples || []).forEach(function (s) {
      var c = VARIANT[s.id] || { bg: "#eef5fb", line: BRAND.blue, ink: BRAND.blue };
      var label = (productInfo[s.id] ? productInfo[s.id].title + " 150g" : s.name), fs = 34;
      brandFont(ctx, fs, 900); while (fs > 24 && ctx.measureText("FREE " + label).width > inner - 40) { fs -= 1; brandFont(ctx, fs, 900); }
      var w1 = ctx.measureText("FREE ").width, w2 = ctx.measureText(label).width;
      if (draw) { rrect(ctx, pad, y, inner, 84, 22, c.bg, c.line, 4); var sx = (W - w1 - w2) / 2; ctx.textAlign = "left"; var ty = y + (84 - fs * 1.2) / 2; ctx.fillStyle = BRAND.green; ctx.fillText("FREE ", sx, ty); ctx.fillStyle = c.ink; ctx.fillText(label, sx + w1, ty); ctx.textAlign = "center"; }
      y += 100;
    });
    (t.unavailableSamples || []).forEach(function (s) {
      brandFont(ctx, 30, 700); if (draw) { rrect(ctx, pad, y, inner, 72, 20, "#f2f4f7", "#d0d5dd", 3); ctx.fillStyle = BRAND.muted; ctx.fillText((productInfo[s.id] ? productInfo[s.id].title : s.name) + " — OUT OF STOCK", W / 2, y + 20); }
      y += 88;
    });
    brandFont(ctx, 26, 400); if (draw) { ctx.fillStyle = BRAND.muted; ctx.fillText("One 150g pack per applicable variant, regardless of pet count.", W / 2, y); } y += 44;
    if (t.status !== "CLAIMED" && eventDateLabel(t.date)) {
      brandFont(ctx, 30, 800); wrapText(ctx, claimNote(t), inner).forEach(function (l) { if (draw) { ctx.fillStyle = BRAND.blue; ctx.fillText(l, W / 2, y); } y += 42; }); y += 8;
    }
    }
    // product shots
    if (shots.length) {
      y += 24; if (draw) { ctx.fillStyle = BRAND.line; ctx.fillRect(pad, y, inner, 3); } y += 34;
      brandFont(ctx, 34, 900); if (draw) { ctx.fillStyle = BRAND.blue; ctx.fillText("Your applicable products", W / 2, y); } y += 58;
      var colW = inner / Math.min(2, shots.length);
      for (var i = 0; i < shots.length; i += 2) {
        var rowH = 0;
        shots.slice(i, i + 2).forEach(function (sh, k) {
          var cx = pad + (shots.length === 1 ? inner / 2 : colW * k + colW / 2), h = 0;
          if (sh.img) { var sc = Math.min(360 / sh.img.naturalWidth, 340 / sh.img.naturalHeight), iw = sh.img.naturalWidth * sc, ih = sh.img.naturalHeight * sc; if (draw) ctx.drawImage(sh.img, cx - iw / 2, y, iw, ih); h = ih + 16; }
          brandFont(ctx, 26, 800); var tl = wrapText(ctx, sh.title, colW - 30);
          tl.forEach(function (l, j) { if (draw) { ctx.fillStyle = BRAND.ink; ctx.fillText(l, cx, y + h + j * 34); } });
          rowH = Math.max(rowH, h + tl.length * 34);
        });
        y += rowH + 30;
      }
    }
    // where to buy
    var storesH = drawStoresPanel(ctx, t, y, W, !draw); ctx.textAlign = "center"; ctx.textBaseline = "top";
    y += storesH ? storesH + 10 : 20;
    if (productsOnly) {
      brandFont(ctx, 24, 400); if (draw) { ctx.fillStyle = BRAND.muted; ctx.fillText(t.condoName || '', W / 2, y); } y += 42;
      if (draw) ctx.fillText('© 2026 Slingshotz Advertising Inc.', W / 2, y);
      return y + 70;
    }
    // footer
    brandFont(ctx, 28, 700); wrapText(ctx, t.status === "CLAIMED" ? "This ticket has already been redeemed." : "Show this QR code to our NutriChunks & Majesty Pet Pals.", inner).forEach(function (l) { if (draw) { ctx.fillStyle = BRAND.ink; ctx.fillText(l, W / 2, y); } y += 40; });
    brandFont(ctx, 25, 400); if (draw) { ctx.fillStyle = BRAND.muted; ctx.fillText("Available while supplies last. One free pack per mobile number.", W / 2, y); } y += 38;
    brandFont(ctx, 21, 400); if (draw) { ctx.fillStyle = "#98a2b3"; ctx.fillText((t.condoName || "") + " • Registered " + registeredLabel(t), W / 2, y); } y += 32;
    if (draw) ctx.fillText("© 2026 Slingshotz Advertising Inc.", W / 2, y); y += 34;
    return y + 46;
  }

  async function ticketWithProductShots(t, productsOnly) {
    var W = 1080, logo = await loadImg("smf-logo.png");
    if (!productsOnly) t = Object.assign({}, t, {stores:[]});
    var shots = await Promise.all((productsOnly ? ticketProducts(t) : []).map(function (s) { return loadImg(productInfo[s.id].image).then(function (img) { return { img: img, title: productInfo[s.id].title }; }); }));
    var probe = document.createElement("canvas").getContext("2d");
    var H = Math.ceil(drawBrandedTicket(probe, t, W, logo, shots, false, productsOnly));
    var cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    var ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
    rrect(ctx, 14, 14, W - 28, H - 28, 40, null, BRAND.blue, 14);
    drawBrandedTicket(ctx, t, W, logo, shots, true, productsOnly);
    return cv.toDataURL("image/png");
  }
  function prepareTicketImage(t, productsOnly) {
    var button = $('saveImage'), status = $('saveImageStatus');
    button.disabled = true;
    status.textContent = productsOnly ? 'Preparing your products and stores image…' : 'Preparing your ticket image…';
    ticketWithProductShots(t, productsOnly).then(function(url) {
      if ($('saveImage') !== button) return;
      $('savedTicketImage').src = url;
      var raw = atob(url.split(',')[1]), bytes = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      var file = typeof File === 'function' ? new File([bytes], (productsOnly ? 'SMF-Products-Stores-' : 'SMF-Claim-') + String(t.code).replace(/[^A-Za-z0-9-]/g, '') + '.png', {type:'image/png'}) : null;
      button.onclick = function() { saveTicketImage(file); };
      button.disabled = false;
      status.textContent = 'Tap the save button, then choose Save Image / Photos if offered.';
    }).catch(function() {
      if ($('saveImage') !== button) return;
      status.textContent = 'The image could not be prepared. Tap to try again.';
      button.disabled = false;
      button.onclick = function() { prepareTicketImage(t, productsOnly); };
    });
  }
  function showSavePreview() {
    var preview = $('savedTicketPreview'), ticket = main.querySelector('.ticket');
    preview.hidden = false;
    // The fallback replaces the on-screen ticket instead of showing a second QR.
    if (ticket) {
      ticket.hidden = true;
      var back = $('closeSavePreview');
      if (!back) {
        back = document.createElement('button'); back.id = 'closeSavePreview';
        back.type = 'button'; back.className = 'linkBtn'; back.textContent = 'Back to my ticket';
        preview.prepend(back);
      }
      back.onclick = function() { preview.hidden = true; ticket.hidden = false; startPanelAtTop(); };
    }
    preview.scrollIntoView({behavior:'smooth', block:'start'});
  }
  async function saveTicketImage(file) {
    var status = $('saveImageStatus'), preview = $('savedTicketPreview');
    try {
      // Prepared before the tap so the native share sheet retains user activation.
      if (file && navigator.share && navigator.canShare && navigator.canShare({files:[file]})) {
        await navigator.share({files:[file]});
        status.textContent = 'If you chose Save Image / Photos, check your gallery. You can also take a screenshot of your ticket.';
        return;
      }
    } catch (e) {
      status.textContent = e.name === 'AbortError' ? 'Save menu closed. You can try again or take a screenshot of your ticket.' : 'Touch and hold the image below, then choose the available image-saving option.';
      if (e.name !== 'AbortError') showSavePreview();
      return;
    }
    status.textContent = 'Touch and hold the image below and choose Save Image / Save to Photos if offered. On a computer, right-click to save. Saving options depend on your browser.';
    showSavePreview();
  }

  // Product claims checked against San Miguel Pet Care variant pages.
  var productInfo = {
    NC_PUPPY_LAMB: {image:"products/puppy-lamb.svg", title:"NutriChunks Hi-Protein Puppy", detail:"Lamb flavor • For puppies", features:[
      ["ActivBoost", "Supports daily energy needs."], ["Prebiotics (MOS)", "Supports gut health and immunity."], ["Omega-3", "Supports puppy vision and learning."], ["Yucca extract", "Helps improve stool quality and reduce odor."]]},
    NC_MAINT_ADULT: {image:"products/adult-beef.svg", title:"NutriChunks Maintenance Adult", detail:"Beef flavor • For adult dogs", features:[
      ["ActivBoost", "Supports daily energy needs."], ["Yucca extract", "Helps improve stool quality and reduce odor."], ["Omega-3 & Omega-6", "Supports healthy skin and a shiny coat."]]},
    NC_SMALL_BREED: {image:"products/small-breed-lamb.svg", title:"NutriChunks Maintenance Small Breeds", detail:"Lamb flavor • For small adult dogs", features:[
      ["Small kibbles", "Easier to chew and gentle on gums."], ["ActivBoost", "Supports daily energy needs."], ["Yucca extract", "Helps reduce stool odor."], ["Omega-3 & Omega-6", "Supports healthy skin and a shiny coat."]]},
    MJ_ADULT_SALMON: {image:"products/majesty-salmon.svg", title:"Majesty Adult Salmon", detail:"Salmon flavor • For adult cats", features:[
      ["Taurine", "Supports heart health and vision."], ["Omega-6", "Supports healthy skin and a shiny coat."], ["Yucca extract", "Helps improve stool quality and reduce odor."], ["Calcium, phosphorus & vitamin D", "Supports strong bones and healthy teeth."]]}
  };
  function variantStores(t, id) {
    var stores = (t.stores || []).filter(function(st) { return (st.has || []).indexOf(id) >= 0; });
    if (!stores.length) return '';
    return '<section class="variantStores"><div class="buyHeader"><h3>WHERE TO BUY</h3><p>Stores near '+esc(t.condoName || 'you')+'</p></div><ul>'+stores.map(function(st) {
      return '<li><span class="storeMarker" aria-hidden="true">📍</span><div><div class="storeName">'+esc(st.name)+'</div><div class="storeAddr">'+esc(storeAddress(st))+'</div></div></li>';
    }).join('')+'</ul></section>';
  }
  function showApplicableProducts(t, features) {
    var available = (t.samples || []).map(function(s) {return s.id;});
    var samples = (t.samples || []).concat(t.unavailableSamples || []).filter(function(s,i,all) {return all.findIndex(function(x) {return x.id === s.id;}) === i;});
    $("applicableProducts").innerHTML = samples.map(function(s) {
      var p = productInfo[s.id]; if (!p) return "";
      return '<article class="productInfo"><h2>'+esc(p.title)+'</h2><p class="productDetail">'+esc(p.detail)+'</p><img class="productShot" src="'+p.image+'" alt="'+esc(p.title)+' product pack" loading="lazy" decoding="async"><p class="productAllocation">'+(available.indexOf(s.id)>=0?'Your applicable sample: 1 × 150g pack':'Applicable variant — currently OUT OF STOCK')+'</p>'+(features===false?'':'<h3>Quick features</h3><dl class="productFeatures">'+p.features.map(function(f){return '<div><dt>'+esc(f[0])+'</dt><dd>'+esc(f[1])+'</dd></div>';}).join('')+'</dl>')+variantStores(t,s.id)+'</article>';
    }).join("");
  }

  function startPanelAtTop() {
    // Reset after rendering: scrolling the old form lets browser anchoring
    // carry its bottom position into the new, shorter recommendations page.
    var heading = main.querySelector('h1');
    if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({preventScroll:true}); }
    window.scrollTo({top:0, left:0, behavior:'instant'});
    requestAnimationFrame(function() {
      window.scrollTo({top:0, left:0, behavior:'instant'});
    });
  }
  function showRecommendations(t) {
    main.innerHTML='<section><h1>Your pet’s recommended variants</h1><p>Explore the key features, then open and save your claim ticket.</p><section id="applicableProducts" class="applicableProducts" aria-label="Your applicable products and quick features"></section><button type="button" id="saveImage" class="btn saveProducts"><span class="saveProductsArrow" aria-hidden="true">↓</span><span>SAVE PRODUCTS &amp; STORES</span></button><div id="saveImageStatus" class="helper center" role="status" aria-live="polite"></div><div id="savedTicketPreview" hidden><p class="helper center">Touch and hold the image to save it to Photos if offered.</p><img id="savedTicketImage" class="photoPrev" alt="Your applicable products and nearby stores"></div><button type="button" id="viewTicket" class="btn saveImage">VIEW MY QR TICKET</button></section>';
    showApplicableProducts(t,true);
    prepareTicketImage(t,true);
    $('viewTicket').onclick=function(){showTicket(t);startPanelAtTop();};
    startPanelAtTop();
  }

  function showTicket(t) {
    main.innerHTML = $("ticketTpl").innerHTML;
    $("tkCode").textContent = t.code;
    $("tkPets").textContent = [t.petNames, t.name].filter(Boolean).join(" • ");
    var ids = (t.samples || []).map(function (s) { return s.id; });
    $("tkQr").innerHTML = qrSvg("SMFC1|" + t.code + "|" + ids.join(","));
    var html = (t.samples || []).map(function (s) { return '<div class="sample ' + ({NC_PUPPY_LAMB:'variant-puppy',NC_MAINT_ADULT:'variant-maintenance',NC_SMALL_BREED:'variant-small',MJ_ADULT_SALMON:'variant-majesty'}[s.id] || '') + '">🎁 <span class="free">FREE</span> ' + esc(productInfo[s.id] ? productInfo[s.id].title + " 150g" : s.name) + "</div>"; }).join("");
    html += (t.unavailableSamples || []).map(function (s) { return '<div class="sample none">' + esc(s.name) + ' — OUT OF STOCK</div>'; }).join("");
    if (t.noStock && !(t.unavailableSamples || []).length) html += '<div class="sample none">' + (ids.length ? "One of the packs" : "The pack") + " for your pet is out of stock today. Thank you for registering!</div>";
    $("tkSamples").innerHTML = html;
    $("tkMeta").textContent = (t.condoName || "") + " • Registered " + registeredLabel(t);
    if(t.status !== 'CLAIMED' && eventDateLabel(t.date)) $('tkClaimNote').textContent=claimNote(t);
    prepareTicketImage(t);
    $('viewFeatures').onclick=function(){showRecommendations(t);};
    if (t.status === "CLAIMED") main.querySelector(".redeemPrompt").textContent = "Your freebie has already been redeemed.";
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
      again.innerHTML = '<p class="helper">Keep a screenshot or saved copy of this QR ticket before continuing. You do not need to claim the sample first.</p><button type="button" id="continueAnother" class="btn primary">I have my screenshot or ticket — Continue</button><button type="button" id="cancelAnother" class="linkBtn">Back to my ticket</button>';
      $('continueAnother').onclick = function() { startAnotherRegistration(t); };
      $('cancelAnother').onclick = function() { showTicket(t); };
    };
  }

  function startAnotherRegistration(t) {
    try { localStorage.removeItem(TICKET_KEY); } catch (e) { }
    var next = new URL(location.href);
    next.searchParams.set('c', t.condoId || condoId);
    next.searchParams.set('new', '1');
    location.assign(next.href);
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

  function petBlank() { return {name:'', age:'', size:'', brand:'', brandOther:'', reason:'', reasonOther:'', photo:'', photoLoading:false}; }
  function profileValid(p, pet) { return !!p.photo && !p.photoLoading && p.name.trim() && p.age && (pet === 'cat' || p.size) && p.brand && (!isOther(p.brand) || p.brandOther.trim()) && p.reason && (p.reason !== 'Other' || p.reasonOther.trim()); }
  function options(list, selected) { return '<option value="">Choose an answer</option>' + list.map(function(x){var v=Array.isArray(x)?x[0]:x, label=Array.isArray(x)?x[1]:x;return '<option value="'+esc(v)+'"'+(v===selected?' selected':'')+'>'+esc(label)+'</option>';}).join(''); }
  function petPhotoFields(p,pet,i) {
    var attrs=' data-pet="'+pet+'" data-index="'+i+'" data-photo="true"';
    return '<div class="petPhoto"><strong>Pet photo (required)</strong><p class="qSub">Take a photo or upload one from your gallery. A clear group photo may be used for each pet shown in it.</p><div style="display:flex;gap:10px;flex-wrap:wrap"><label class="btn secondary">Take photo<input type="file" accept="image/*" capture="environment"'+attrs+' hidden></label><label class="btn secondary">Upload from gallery<input type="file" accept="image/*"'+attrs+' hidden></label></div><img class="photoPrev petPreview" alt="Pet photo preview"'+(p.photo?' src="'+p.photo+'"':' hidden')+'><div class="petPhotoStatus helper" role="status">'+(p.photoLoading?'Preparing photo…':p.photo?'Photo ready':'No photo added yet')+'</div></div>';
  }
  async function preparePetPhoto(file) {
    if(!/^image\//.test(file.type))throw new Error('Please choose an image file.');
    var url=URL.createObjectURL(file),img=new Image();
    try {
      await new Promise(function(resolve,reject){img.onload=resolve;img.onerror=function(){reject(new Error('This image could not be opened. Please choose another photo or take a new one.'));};img.src=url;});
      var scale=Math.min(1,960/Math.max(img.naturalWidth,img.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
      var photo=canvas.toDataURL('image/jpeg',0.65);
      if(photo.length>1500000)throw new Error('The photo is too large. Please choose a smaller image.');
      return photo;
    } finally {URL.revokeObjectURL(url);}
  }
  function renderPets(pet) {
    var n=state[pet+'Count']; while(profiles[pet].length<n) profiles[pet].push(petBlank());
    profiles[pet].length=n;
    $(pet+'Profiles').innerHTML=profiles[pet].map(function(p,i){
      var key=pet+'Profile'+i, brands=(info.brands||[]).filter(function(b){return b.petType===pet.toUpperCase()||b.petType==='BOTH';}).map(function(b){return b.brand;});
      function field(k,label,list) {return '<label style="display:block;margin:14px 0"><span'+(['age','size','brand','reason'].indexOf(k)>=0?' class="petFieldTitle"':'')+'>'+label+'</span>'+(list?'<select class="big" data-pet="'+pet+'" data-index="'+i+'" data-field="'+k+'">'+options(list,p[k])+'</select>':'<input class="big" maxlength="60" data-pet="'+pet+'" data-index="'+i+'" data-field="'+k+'" value="'+esc(p[k])+'">')+'</label>';}
      return '<section class="q" data-q="'+key+'"><div class="qTitle">'+(pet==='dog'?'Dog':'Cat')+' '+(i+1)+'</div>'+field('name',"Pet's name")+petPhotoFields(p,pet,i)+field('age','Age',pet==='dog'?[['PUPPY','Puppy (below 1 yr)'],['ADULT','Adult (1 yr+)']]:[['KITTEN','Kitten (below 1 yr)'],['ADULT','Adult (1 yr+)']])+(pet==='dog'?field('size','Size',[['SMALL','Small'],['MEDIUM','Medium'],['LARGE','Large']]):'')+field('brand','Current '+pet+' food brand',brands)+ '<div data-extra="brand"'+(!isOther(p.brand)?' hidden':'')+'>'+field('brandOther','Other brand name')+'</div>'+field('reason','Why do you use this food for this '+pet+'?',['Pet likes it','Price / budget','Recommended by vet','Recommended by family / friends','Easy to find','Nutrition / health needs','Used to this food','Other'])+'<div data-extra="reason"'+(p.reason!=='Other'?' hidden':'')+'>'+field('reasonOther','Other reason')+'</div></section>';
    }).join('');
  }
  function answered() {
    var a={consent:state.consent==='YES',petType:!!state.petType,name:$('name').value.trim().length>=2,mobile:/^09\d{9}$/.test(normMobile($('mobile').value)),promo:!!state.promo,dogCount:true,catCount:true};
    ['dog','cat'].forEach(function(pet){profiles[pet].forEach(function(p,i){a[pet+'Profile'+i]=!!profileValid(p,pet);});});return a;
  }
  function refresh() {
    var a=answered();main.querySelectorAll('.q').forEach(function(q){q.classList.toggle('answered',!!a[q.dataset.q]);q.classList.remove('bad');});
    $('noConsent').hidden=state.consent!=='NO';$('afterConsent').hidden=state.consent!=='YES';
    $('dogPart').hidden=state.petType!=='DOG'&&state.petType!=='BOTH';$('catPart').hidden=state.petType!=='CAT'&&state.petType!=='BOTH';$('youPart').hidden=!state.petType;
    var m=$('mobile').value.trim();$('mobileHint').hidden=!m||a.mobile||m.replace(/\D/g,'').length<10;
  }
  function missing() {
    var a=answered(),need=['consent','petType','name','mobile','promo'];
    ['dog','cat'].forEach(function(pet){if(state.petType===pet.toUpperCase()||state.petType==='BOTH')profiles[pet].forEach(function(p,i){need.push(pet+'Profile'+i);});});return need.filter(function(k){return !a[k];});
  }

  function buildForm() {
    main.innerHTML = $("formTpl").innerHTML;
    renderPets('dog');renderPets('cat');
    function profileInput(e) {
      var t=e.target;
      if(!t.dataset.pet || t.dataset.photo)return;
      var p=profiles[t.dataset.pet][Number(t.dataset.index)];p[t.dataset.field]=t.value;
      var card=t.closest('.q');card.querySelector('[data-extra="brand"]').hidden=!isOther(p.brand);card.querySelector('[data-extra="reason"]').hidden=p.reason!=='Other';refresh();
    }
    main.addEventListener('change',async function(e){
      var input=e.target;if(!input.dataset.photo)return;var file=input.files&&input.files[0];if(!file)return;
      var pet=input.dataset.pet,index=Number(input.dataset.index),p=profiles[pet][index],box=input.closest('.petPhoto');
      var photoToken=uuid();p.photoToken=photoToken;p.photoLoading=true;box.querySelector('.petPhotoStatus').textContent='Preparing photo…';refresh();
      try {var photo=await preparePetPhoto(file);if(profiles[pet][index]!==p || p.photoToken!==photoToken)return;p.photo=photo;var preview=box.querySelector('.petPreview');preview.src=photo;preview.hidden=false;box.querySelector('.petPhotoStatus').textContent='Photo ready';}
      catch(error){if(p.photoToken===photoToken)box.querySelector('.petPhotoStatus').textContent=error.message;}
      finally {if(p.photoToken===photoToken)p.photoLoading=false;input.value='';refresh();}
    });
    main.addEventListener('input',profileInput);main.addEventListener('change',profileInput);
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
        renderPets(n==='dogCount'?'dog':'cat');refresh();
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
    function petPayload(pet) {
      var list=profiles[pet].map(function(p){return {name:p.name.trim(),age:p.age,size:pet==='dog'?p.size:'',brand:isOther(p.brand)?'Other: '+p.brandOther.trim():p.brand,reason:p.reason==='Other'?'Other: '+p.reasonOther.trim():p.reason,photo:p.photo};});
      return {profiles:list,count:list.length};
    }
    var regId = pendingRegId || (pendingRegId = uuid());
    var payload = {
      condoId: condoId, regId: regId, consent: "YES", promoOptIn: state.promo,
      name: $("name").value.trim(), mobile: normMobile($("mobile").value), petType: state.petType,
      dog: petPayload('dog'), cat: petPayload('cat')
    };
    var r;
    try { r = await api("/api/register", { method: "POST", body: JSON.stringify(payload) }); }
    catch (e) { r = { ok: false, message: "No internet connection. Please try again when you have signal, or ask our Pet Pals at the booth." }; }
    if (r.ok && r.ticket) {
      r.ticket.regId = regId;
      saveTicket(r.ticket);
      showRecommendations(r.ticket);
      return;
    }
    btn.disabled = false; btn.textContent = "Get my FREE NutriChunks / Majesty";
    err.hidden = false; err.textContent = r.message || "Your registration was not saved. Please try again.";
    if (r.error === "ALREADY_REGISTERED" || r.error === "BAD_MOBILE") main.querySelector('.q[data-q="mobile"]').classList.add("bad");
  }

  async function start() {
    var fresh = new URLSearchParams(location.search).get('new') === '1';
    var t = fresh ? null : loadTicket();
    if (fresh) {
      try { localStorage.removeItem(TICKET_KEY); } catch (e) { }
      var cleanUrl = new URL(location.href); cleanUrl.searchParams.delete('new');
      history.replaceState(null, '', cleanUrl.href);
    }
    if (t && t.code && (!condoId || t.condoId === condoId)) { $("condoLine").textContent = t.condoName || ""; return refreshTicket(t); }
    if (!condoId) { main.innerHTML = '<div class="errbox">Please scan the QR code at the booth to register.</div>'; return; }
    try { info = await api("/api/condo?c=" + encodeURIComponent(condoId)); }
    catch (e) { info = { ok: false, message: "No internet connection. Please try again when you have signal." }; }
    if (!info.ok) { main.innerHTML = '<div class="errbox">' + esc(info.message || "Something went wrong. Please try again.") + "</div>"; return; }
    $("condoLine").textContent = info.condo.name;
    if (!info.running && !info.registrationOpen) { main.innerHTML = '<div class="warnbox">' + esc(info.condo.name) + ": there is no sampling today. We hope to see you at our next visit!</div>"; return; }
    buildForm();
    if(info.preregistration){var notice=document.createElement('p');notice.className='warnbox';notice.textContent='Pre-register now. Claim on '+eventDateLabel(info.eventDate)+' at '+info.condo.name+'.'+(info.condo.booth?' Booth: '+info.condo.booth+'.':'');main.prepend(notice);}
  }

  start();
})();
