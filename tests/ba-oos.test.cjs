const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
async function baFixture(ticket, readPhoto=async()=>null){
 const elements=new Map(),queued=[];const classes={toggle(){},add(){},remove(){}};
 const el=id=>{if(!elements.has(id))elements.set(id,{id,isConnected:true,innerHTML:'',textContent:'',value:'',classList:classes,querySelectorAll:()=>[],querySelector:selector=>el(selector),removeAttribute(){},remove(){}});return elements.get(id);};
 const session={token:'test-only',date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),staff:{code:'PM01',name:'Test BA'},condo:{id:'RR',name:'Test condo'}};
 const storage=new Map([['smfc_ba_session_v1',JSON.stringify(session)]]);
 const ctx={SMFTicketPhoto:{read:readPhoto},Image:class {width=1024;height=768;set src(value){this.onload();}},URL:{createObjectURL:()=> 'test-only',revokeObjectURL(){}},document:{getElementById:el,createElement:tag=>tag==='canvas'?{getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,test-only'}:el('toast'),body:{appendChild(){}}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},navigator:{onLine:true},window:{addEventListener(){}},SMFQueue:{count:async()=>0,add:async item=>queued.push(item),flush:async()=>[]},crypto:{randomUUID:()=> 'test-oos-id'},fetch:async path=>({status:200,json:async()=>path.startsWith('/api/ticket')?{ok:true,ticket}:{ok:true,registered:1,claimed:0,waiting:1,stock:[]}}),setTimeout(){},setInterval(){},Date,Intl,Number,String,Object,Array,Math,Promise,console};
 vm.runInNewContext(fs.readFileSync(__dirname+'/../public/ba.js','utf8'),ctx);await new Promise(r=>setImmediate(r));
 el('typed').value='RR-0001';el('find').onclick();await new Promise(r=>setImmediate(r));return {el,queued};
}
test('BA disables sample release when ticket stock is depleted and saves OOS without customer-photo consent',async()=>{
 const ui=await baFixture({code:'RR-0001',status:'WAITING',condoId:'RR',samples:[{id:'NC_SMALL_BREED',stockLeft:0}],unavailableSamples:[]});
 assert.equal(ui.el('give').disabled,true);assert.match(ui.el('warn').innerHTML,/OOS/);assert.match(ui.el('oosProds').innerHTML,/selected/);
 await ui.el('recordOos').onclick();assert.equal(ui.queued.length,1);assert.equal(ui.queued[0].outOfStock,true);assert.deepEqual(Array.from(ui.queued[0].oosProducts),['NC_SMALL_BREED']);assert.equal(ui.queued[0].products.length,0);
});
test('BA records a NO_STOCK registration using its unavailable variant and keeps other variants releasable',async()=>{
 const none=await baFixture({status:'NO_STOCK',condoId:'RR',samples:[],unavailableSamples:[{id:'MJ_ADULT_SALMON'}]});
 assert.equal(none.el('give').disabled,true);await none.el('recordOos').onclick();assert.equal(none.queued[0].oosProducts[0],'MJ_ADULT_SALMON');
 const partial=await baFixture({status:'WAITING',condoId:'RR',samples:[{id:'NC_PUPPY_LAMB',stockLeft:1}],unavailableSamples:[{id:'MJ_ADULT_SALMON'}]});
 assert.equal(partial.el('give').disabled,false);assert.match(partial.el('warn').innerHTML,/Majesty/);
});


test('claim photo for another ticket cannot be saved against the open ticket',async()=>{
 const ui=await baFixture({status:'WAITING',condoId:'RR',samples:[{id:'MJ_ADULT_SALMON',stockLeft:5}]},async()=>({code:'RR-0002',samples:['NC_PUPPY_LAMB']}));
 ui.el('claimGallery').files=[{}];await ui.el('claimGallery').onchange();
 assert.match(ui.el('claimPhotoMsg').textContent,/RR-0002.*RR-0001/);
 assert.equal(ui.el('prev').hidden,true);
 await ui.el('give').onclick();assert.equal(ui.queued.length,0);
 assert.match(ui.el('err').textContent,/claim screenshot/);
 assert.match(ui.el('prods').innerHTML,/Majesty/);assert.doesNotMatch(ui.el('prods').innerHTML,/Puppy/);
});
test('matching gallery QR is accepted; unreadable QR requires explicit matching ticket number',async()=>{
 for(const decoded of [{code:'RR-0001'},null]){
  const ui=await baFixture({status:'WAITING',condoId:'RR',samples:[{id:'MJ_ADULT_SALMON',stockLeft:5}]},async()=>decoded);
  ui.el('claimGallery').files=[{}];await ui.el('claimGallery').onchange();
  if(!decoded){
   await ui.el('give').onclick();assert.equal(ui.queued.length,0);
   ui.el('photoCode').value='RR-0002';ui.el('confirmPhoto').onclick();
   await ui.el('give').onclick();assert.equal(ui.queued.length,0);
   ui.el('photoCode').value='RR-0001';ui.el('confirmPhoto').onclick();
  }
  ui.el('consentChoices').onclick({target:{closest:()=>({dataset:{v:'NO'}})}});
  await ui.el('give').onclick();assert.equal(ui.queued.length,1);assert.equal(ui.queued[0].code,'RR-0001');assert.ok(ui.queued[0].photo);
 }
});
