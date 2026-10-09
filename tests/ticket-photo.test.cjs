const test = require("node:test"), assert = require("node:assert/strict");
const qr = require("../public/vendor/qrcode.js");
globalThis.jsQR = require("../public/vendor/jsQR.js");
require("../public/ticket-photo.js");
function image(text, rotate = false, invert = false) {
  const q = qr(0, "M"); q.addData(text); q.make();
  const scale = 7, border = 4, side = (q.getModuleCount() + border * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const row = Math.floor(y / scale) - border, col = Math.floor(x / scale) - border;
    let dark = row >= 0 && col >= 0 && row < q.getModuleCount() && col < q.getModuleCount() && q.isDark(row, col);
    if (invert) dark = !dark;
    const i = (rotate ? x * side + side - 1 - y : y * side + x) * 4;
    data[i] = data[i+1] = data[i+2] = dark ? 0 : 255; data[i+3] = 255;
  }
  return { data, side };
}
test("reads actual claim QR pixels from still images, rotated and inverted", () => {
  for (const [rotated, inverted] of [[false,false], [true,false], [false,true]]) {
    const p = image("SMFC1|RR-0001|NC_SMALL_BREED,MJ_ADULT_SALMON", rotated, inverted);
    assert.deepEqual(SMFTicketPhoto.decode(p.data,p.side,p.side), { code: "RR-0001", samples: ["NC_SMALL_BREED", "MJ_ADULT_SALMON"] });
  }
});
test("rejects unrelated QR content and unreadable images", () => {
  const p = image("https://example.com/unrelated");
  assert.equal(SMFTicketPhoto.decode(p.data,p.side,p.side), null);
  assert.equal(SMFTicketPhoto.decode(new Uint8ClampedArray(100 * 100 * 4).fill(255),100,100), null);
  assert.equal(SMFTicketPhoto.parse("SMFC1|not-a-ticket|NC_SMALL_BREED"), null);
});
