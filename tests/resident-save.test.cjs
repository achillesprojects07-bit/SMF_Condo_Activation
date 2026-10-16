const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function load(navigator={}){
 const els={main:{},saveImageStatus:{},savedTicketPreview:{hidden:true,scrollIntoView(){}}};
 const context={document:{getElementById:id=>els[id]},location:{search:'?c=MR'},URLSearchParams,navigator};
 const source=fs.readFileSync('public/resident.js','utf8').replace('  start();','  globalThis.hooks = {saveTicketImage, variantStores};');
 vm.runInNewContext(source,context);return {hooks:context.hooks,els};
}
test('variant store names are filtered per variant and escaped',()=>{
 const {hooks}=load();const t={condoName:'Mirea Residences',stores:[{name:'Dog & Cat',has:['NC_SMALL_BREED','MJ_ADULT_SALMON']},{name:'Cat Only',has:['MJ_ADULT_SALMON']}]};
 const html=hooks.variantStores(t,'NC_SMALL_BREED');assert.match(html,/Dog &amp; Cat/);assert.doesNotMatch(html,/Cat Only/);assert.equal(hooks.variantStores({stores:[]},'NC_SMALL_BREED'),'');
});
test('save opens native image sharing with the prepared file',async()=>{
 const file={type:'image/png'};let shared;
 const {hooks,els}=load({canShare:()=>true,share:data=>{shared=data.files[0];return Promise.resolve();}});
 await hooks.saveTicketImage(file);assert.equal(shared,file);assert.equal(els.savedTicketPreview.hidden,false);assert.doesNotMatch(els.saveImageStatus.textContent,/successfully saved/i);
});
test('unsupported sharing and cancelled/failed share keep the saveable image visible',async()=>{
 for(const name of ['unsupported','AbortError','NotAllowedError']){
 const {hooks,els}=load({canShare:()=>name!=='unsupported',share:()=>Promise.reject(Object.assign(new Error(),{name}))});
 await hooks.saveTicketImage({});assert.equal(els.savedTicketPreview.hidden,false);assert.match(els.saveImageStatus.textContent,/hold the image/);
 }
});


test('recommendations reset scroll after rendering and again on the next frame',()=>{
 const events=[],frames=[];
 const els={main:{querySelector:()=>({setAttribute(){},focus:opts=>{assert.equal(opts.preventScroll,true);events.push('focus');}})},applicableProducts:{},viewTicket:{}};
 Object.defineProperty(els.main,'innerHTML',{set(){events.push('render');}});
 const context={document:{getElementById:id=>els[id]},location:{search:''},URLSearchParams,
   window:{scrollTo:opts=>{assert.equal(opts.top,0);events.push('top');}},requestAnimationFrame:fn=>frames.push(fn)};
 vm.runInNewContext(fs.readFileSync('public/resident.js','utf8').replace('  start();','  globalThis.show = showRecommendations;').replace('    prepareTicketImage(t,true);',''),context);
 context.show({samples:[]});assert.deepEqual(events,['render','focus','top']);
 frames[0]();assert.deepEqual(events,['render','focus','top','top']);
});


test('separate exports keep the QR ticket and products/stores apart',()=>{
 const context={document:{getElementById:()=>({})},location:{search:''},URLSearchParams,qrcode:require('../public/vendor/qrcode.js')};
 vm.runInNewContext(fs.readFileSync('public/resident.js','utf8').replace('  start();','  globalThis.draw = drawBrandedTicket;'),context);
 const ticket={code:'MR-PREVIEW',condoName:'Mirea Residences',date:'2026-10-17',samples:[{id:'NC_SMALL_BREED',name:'Small Breeds 150g'}],stores:[{name:'LJL Poultry Supply',address:'119 Evangelista St.',city:'Pasig',has:['NC_SMALL_BREED']}]};
 function render(productsOnly){
  const text=[],ctx={measureText:s=>({width:s.length*13}),fillText:s=>text.push(s),beginPath(){},moveTo(){},arcTo(){},closePath(){},fill(){},stroke(){},fillRect(){},arc(){},bezierCurveTo(){},drawImage(){}};
  context.draw(ctx,productsOnly?ticket:{...ticket,stores:[]},1080,null,productsOnly?[{img:null,title:'NutriChunks Maintenance Small Breeds'}]:[],true,productsOnly);return text.join(' | ');
 }
 const qr=render(false),products=render(true);
 assert.match(qr,/MR-PREVIEW/);assert.doesNotMatch(qr,/WHERE TO BUY|LJL Poultry/);
 assert.match(products,/WHERE TO BUY/);assert.match(products,/LJL Poultry Supply/);assert.match(products,/119 Evangelista St/);assert.match(products,/NutriChunks Maintenance Small Breeds/);assert.doesNotMatch(products,/MR-PREVIEW|Show this QR/);
 const html=fs.readFileSync('public/index.html','utf8').split('<template id="ticketTpl">')[1].split('</template>')[0];assert.doesNotMatch(html,/id="applicableProducts"|id="buyBox"/);
});
