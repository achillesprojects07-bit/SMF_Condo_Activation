/* Reads the existing claim QR from a still photo. No camera stream or external upload. */
(function (root) {
  "use strict";
  function parse(text) {
    var parts = String(text || "").trim().split("|");
    var code = parts[0] === "SMFC1" ? parts[1] : parts[0];
    if (!/^[A-Z0-9]{1,6}-\d{3,5}$/i.test(code || "")) return null;
    return { code: code.toUpperCase(), samples: parts[0] === "SMFC1" ? (parts[2] || "").split(",").filter(Boolean) : [] };
  }
  function decode(data, width, height) {
    var qr = root.jsQR(data, width, height, { inversionAttempts: "attemptBoth" });
    return qr ? parse(qr.data) : null;
  }
  async function read(file) {
    var url = URL.createObjectURL(file), img = new Image(), worker = null;
    try {
      await new Promise(function (resolve, reject) {
        var timer = setTimeout(function () { reject(new Error("Matagal buksan ang photo. Gumamit ng mas maliit na JPG o PNG.")); }, 10000);
        img.onload = function () { clearTimeout(timer); resolve(); };
        img.onerror = function () { clearTimeout(timer); reject(new Error("Hindi mabasa ang photo. Gumamit ng JPG o PNG.")); };
        img.src = url;
      });
      // Paint the reading message before preparing pixels.
      await new Promise(function (resolve) { setTimeout(resolve, 0); });
      try { if (typeof root.Worker === "function") worker = new root.Worker("qr-worker.js"); } catch (e) { }
      var deadline = Date.now() + 8000;
      var canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
      // Most screenshots work at 960px. Retain higher detail only when necessary.
      var sizes = worker ? [960, 1600, 2400] : [960, 1200], previousSize = "";
      for (var max of sizes) {
        var scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
        var size = canvas.width + "x" + canvas.height;
        if (size === previousSize) continue;
        previousSize = size;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        var pixels = ctx.getImageData(0, 0, canvas.width, canvas.height), found;
        if (worker) {
          var remaining = deadline - Date.now();
          if (remaining <= 0) return null;
          found = await new Promise(function (resolve) {
            var timer = setTimeout(function () { resolve(null); }, remaining);
            worker.onmessage = function (event) { clearTimeout(timer); resolve(parse(event.data.text)); };
            worker.onerror = function () { clearTimeout(timer); resolve(null); };
            worker.postMessage({ pixels: pixels.data.buffer, width: canvas.width, height: canvas.height }, [pixels.data.buffer]);
          });
        } else {
          await new Promise(function (resolve) { setTimeout(resolve, 0); });
          found = decode(pixels.data, canvas.width, canvas.height);
        }
        if (found) return found;
        if (Date.now() >= deadline) return null;
      }
      return null;
    } finally { if (worker) worker.terminate(); img.onload = img.onerror = null; URL.revokeObjectURL(url); }
  }
  root.SMFTicketPhoto = { parse: parse, decode: decode, read: read };
})(typeof window !== "undefined" ? window : globalThis);
