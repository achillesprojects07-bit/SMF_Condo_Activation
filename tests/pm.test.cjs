const test=require('node:test'),assert=require('node:assert/strict');
const {PMModel}=require('../public/pm-model.js');
const reg=(code,extra={})=>({CLAIM_CODE:code,CONDO_ID:'AR',CONDO_NAME:'Alder',DATE:'2026-10-17',REGISTERED_AT:'2026-10-17 09:10:00',STATUS:'WAITING',...extra});
test('PM separates advance registrations, pending tickets, completed households and packs',()=>{
 const m=PMModel.build({registrations:[reg('AR-1',{REGISTERED_AT:'2026-10-16 23:00:00',STATUS:'CLAIMED',CLAIMED_AT:'2026-10-17 09:30:00',SAMPLES_GIVEN:'PUPPY, CAT'}),reg('AR-2'),reg('AR-3',{STATUS:'NO_STOCK'}),reg('CC-1',{CONDO_ID:'CC',CONDO_NAME:'Cedar'}),reg('AR-old',{DATE:'2026-10-10'})],flags:[{DATE:'2026-10-17',CONDO_ID:'AR',CLAIM_CODE:'AR-3',RESULT:'OOS',SERVER_SAVED_AT:'2026-10-17 10:20:00'},{DATE:'2026-10-17',CONDO_ID:'AR',CLAIM_CODE:'AR-1',RESULT:'DUPLICATE'}]},'2026-10-17','AR');
 assert.deepEqual(m.totals,{registered:3,claimed:1,pending:1,noStock:1,packs:2,advance:1,newSignups:2,oos:1});
 assert.equal(m.hours[9].signups,2);assert.equal(m.hours[9].claims,1);assert.equal(m.events[0].type,'oos');assert.equal(m.events.filter(e=>e.type==='claim').length,1);
});
test('PM timestamps are interpreted in Manila, including UTC timestamps at midnight',()=>{
 assert.equal(PMModel.stamp('2026-10-16T16:01:00Z').date,'2026-10-17');assert.equal(PMModel.stamp('2026-10-17 00:01:00').hour,0);assert.equal(PMModel.stamp('2026-10-17 00:01:00').ms,PMModel.stamp('2026-10-16T16:01:00Z').ms);assert.equal(PMModel.stamp(''),null);assert.equal(PMModel.stamp('bad'),null);
});
test('PM shows scheduled condos with zero activity and never invents timestamps',()=>{
 const m=PMModel.build({days:[{date:'2026-10-17',condoId:'CC',condoName:'Cedar'}],registrations:[reg('AR-1',{REGISTERED_AT:'',STATUS:'CLAIMED',CLAIMED_AT:'',SAMPLES_GIVEN:'CAT, CAT'})]},'2026-10-17','ALL');
 assert.equal(m.rows.length,2);assert.equal(m.rows.find(r=>r.id==='CC').registered,0);assert.equal(m.totals.packs,1);assert.equal(m.events.length,0);assert.equal(m.totals.claimed,1);
});
test('PM caps recent activity and orders it newest first',()=>{
 const m=PMModel.build({registrations:Array.from({length:35},(_,i)=>reg('AR-'+i,{REGISTERED_AT:'2026-10-17 09:'+String(i).padStart(2,'0')+':00'}))},'2026-10-17','ALL');assert.equal(m.events.length,30);assert.equal(m.events[0].code,'AR-34');assert.equal(m.events[29].code,'AR-5');
});
