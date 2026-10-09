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

test('background worker reads the real ticket pixels, including rotated and inverted QR',()=>{
 const vm=require('node:vm'),fs=require('node:fs');
 for(const [rotate,invert] of [[false,false],[true,false],[false,true]]){
  const p=image('SMFC1|RR-0001|NC_SMALL_BREED',rotate,invert);let answer;
  const self={postMessage:value=>answer=value};
  vm.runInNewContext(fs.readFileSync(__dirname+'/../public/qr-worker.js','utf8'),{self,importScripts(){},jsQR:globalThis.jsQR,Uint8ClampedArray});
  self.onmessage({data:{pixels:p.data.buffer,width:p.side,height:p.side}});
  assert.equal(SMFTicketPhoto.parse(answer.text).code,'RR-0001');
 }
});
test('photo reader starts small, yields to UI, increases detail only if needed, and cleans up its worker',async()=>{
 const vm=require('node:vm'),fs=require('node:fs');
 for(const successAttempt of [1,2]){
  const sizes=[];let terminated=false,revoked=false,uiTurn=false;
  const canvas={getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(canvas.width*canvas.height*4)})})};
  class Worker{postMessage(p){sizes.push(p.width);setImmediate(()=>{uiTurn=true;this.onmessage({data:{text:sizes.length===successAttempt?'SMFC1|RR-0001|NC_SMALL_BREED':''}});});}terminate(){terminated=true;}}
  class Image{naturalWidth=3000;naturalHeight=2000;set src(v){this.onload();}}
  const root={Worker};
  vm.runInNewContext(fs.readFileSync(__dirname+'/../public/ticket-photo.js','utf8'),{window:root,Image,URL:{createObjectURL:()=> 'photo-test',revokeObjectURL:()=>revoked=true},document:{createElement:()=>canvas},setTimeout,clearTimeout,Date,Promise});
  const found=await root.SMFTicketPhoto.read({});assert.equal(found.code,'RR-0001');
  assert.deepEqual(sizes,successAttempt===1?[960]:[960,1600]);assert.ok(uiTurn&&terminated&&revoked);
 }
});
