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
