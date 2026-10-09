/* QR pixels are processed away from the UI so buttons remain responsive. */
importScripts("vendor/jsQR.js");
self.onmessage = function (event) {
  try {
    var p = event.data;
    var result = jsQR(new Uint8ClampedArray(p.pixels), p.width, p.height, { inversionAttempts: "attemptBoth" });
    self.postMessage({ text: result ? result.data : "" });
  } catch (e) { self.postMessage({ text: "" }); }
};
