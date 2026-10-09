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
    var url = URL.createObjectURL(file), img = new Image();
    try {
      await new Promise(function (resolve, reject) { img.onload = resolve; img.onerror = function () { reject(new Error("Hindi mabasa ang photo. Gumamit ng JPG o PNG.")); }; img.src = url; });
      var canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
      // Try different resolutions, retaining detail in large phone-camera photos.
      for (var max of [1600, 2400, 1000]) {
        var scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        var pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        var found = decode(pixels.data, canvas.width, canvas.height);
        if (found) return found;
      }
      return null;
    } finally { URL.revokeObjectURL(url); }
  }
  root.SMFTicketPhoto = { parse: parse, decode: decode, read: read };
})(typeof window !== "undefined" ? window : globalThis);
