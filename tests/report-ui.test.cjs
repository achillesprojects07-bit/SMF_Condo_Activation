const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
async function renderDashboard(data) {
  const elements=new Map();
  const tabs=['overview','samples','residents','records'].map(view=>({getAttribute:()=>view}));
  const el=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',querySelectorAll:()=>tabs});return elements.get(id);};
  const document={getElementById:el,createElement:()=>({click(){}})};
  const ctx={document,sessionStorage:{getItem:()=> 'test-token'},fetch:async()=>({json:async()=>data}),console,Date,Number,String,Object,Array,Set,Math,URL,Blob,setTimeout,alert(){}};
  vm.runInNewContext(fs.readFileSync(__dirname+'/../public/report.js','utf8'),ctx);
  await new Promise(resolve=>setImmediate(resolve));
  return {el,main:el('main'),tab:view=>tabs.find(t=>t.getAttribute()===view).onclick()};
}
const fixture={ok:true,today:'2026-10-09',products:{DOG:'Dog sample 150 g',CAT:'Cat sample 150 g'},days:[
 {date:'2026-10-09',condoId:'RR',condoName:'Rainbow Ridge',given:{DOG:1,CAT:1},allocated:{DOG:20,CAT:20}},
 {date:'2026-10-10',condoId:'LV',condoName:'La Verti',given:{},allocated:{DOG:30,CAT:30}}
],registrations:[
 {DATE:'2026-10-09',CONDO_ID:'RR',CONDO_NAME:'Rainbow Ridge',CLAIM_CODE:'RR-0001',RESIDENT_NAME:'A < B',STATUS:'CLAIMED',PET_TYPE:'BOTH',DOG_COUNT:2,CAT_COUNT:1,DOG_BRAND:'Brand A',CAT_BRAND:'Brand B'},
 {DATE:'2026-10-10',CONDO_ID:'LV',CONDO_NAME:'La Verti',CLAIM_CODE:'LV-0001',RESIDENT_NAME:'Next day',STATUS:'WAITING',PET_TYPE:'DOG',DOG_COUNT:1}
],redemptions:[],flags:[{DATE:'2026-10-09',CONDO_ID:'RR',CLAIM_CODE:'RR-0001',RESULT:'DUPLICATE',NOTE:'Already claimed'},{DATE:'2026-10-10',CONDO_ID:'LV',CLAIM_CODE:'LV-0001',NOTE:'Next day issue'}]};

test('dashboard distinguishes households from two packs and labels future allocations',async()=>{
 const ui=await renderDashboard(fixture);
 assert.match(ui.main.innerHTML,/Households served<\/span><strong>1/);
 assert.match(ui.main.innerHTML,/Sample packs distributed<\/span><strong>2/);
 assert.doesNotMatch(ui.main.innerHTML,/NaN|All registrations/);
 ui.tab('samples'); assert.match(ui.main.innerHTML,/Scheduled/);assert.match(ui.main.innerHTML,/This event has not started yet/);
 ui.tab('records');assert.match(ui.main.innerHTML,/A &lt; B/);
 ui.el('day').onchange.call({value:'2026-10-09'});
 assert.doesNotMatch(ui.main.innerHTML,/Next day issue|Next day<\/strong>/);
 ui.el('condo').onchange.call({value:'LV'});
 assert.match(ui.main.innerHTML,/No resident records yet/);assert.doesNotMatch(ui.main.innerHTML,/Already claimed/);
});
test('empty live report explains zero values without inventing chart activity',async()=>{
 const ui=await renderDashboard({...fixture,registrations:[],days:fixture.days.map(d=>({...d,given:{}})),flags:[]});
 assert.match(ui.main.innerHTML,/No live resident registrations yet/);
 assert.doesNotMatch(ui.main.innerHTML,/NaN|Infinity|width:[1-9]/);
 ui.tab('residents');assert.match(ui.main.innerHTML,/No resident data yet/);
});
module.exports={renderDashboard,fixture};

test('OOS attempts appear separately without becoming distributed packs',async()=>{
 const attempt={DATE:'2026-10-09',CONDO_ID:'RR',CLAIM_CODE:'RR-OOS',RESULT:'OOS',BA_NAME:'Training BA',PRODUCTS_UNAVAILABLE:'DOG',SERVER_SAVED_AT:'2026-10-09 13:00:00'};
 const ui=await renderDashboard({...fixture,flags:[attempt],redemptions:[attempt]});ui.tab('records');
 assert.match(ui.main.innerHTML,/Customers tried to redeem — OOS \(1\)/);assert.match(ui.main.innerHTML,/Dog sample 150 g/);assert.match(ui.main.innerHTML,/2026-10-09 13:00:00/);assert.doesNotMatch(ui.main.innerHTML,/Claim attempts to review/);
});
