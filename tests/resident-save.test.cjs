const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function load(navigator={}){
 const els={main:{querySelector:()=>null},saveImageStatus:{},savedTicketPreview:{hidden:true,scrollIntoView(){}}};
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
 await hooks.saveTicketImage(file);assert.equal(shared,file);assert.equal(els.savedTicketPreview.hidden,true);assert.doesNotMatch(els.saveImageStatus.textContent,/successfully saved/i);
});
test('unsupported sharing uses a fallback; cancelled sharing does not duplicate the QR',async()=>{
 for(const name of ['unsupported','AbortError','NotAllowedError']){
 const {hooks,els}=load({canShare:()=>name!=='unsupported',share:()=>Promise.reject(Object.assign(new Error(),{name}))});
 await hooks.saveTicketImage({});assert.equal(els.savedTicketPreview.hidden,name==='AbortError');assert.match(els.saveImageStatus.textContent,name==='AbortError'?/screenshot/:/hold the image/);
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


test('another registration needs neither an image download nor a redeemed sample',()=>{
 let target;const context={document:{getElementById:()=>({})},URL,URLSearchParams,location:{search:'?c=AR',href:'https://example.com/?c=AR',assign:url=>target=url},localStorage:{removeItem(){throw new Error('storage unavailable');}}};
 vm.runInNewContext(fs.readFileSync('public/resident.js','utf8').replace('  start();','  globalThis.next = startAnotherRegistration;'),context);
 context.next({condoId:'AR',status:'PRE_REGISTERED'});assert.equal(new URL(target).searchParams.get('new'),'1');assert.equal(new URL(target).searchParams.get('c'),'AR');
});

test('ticket reminder opens automatically after sharing without claiming a confirmed save',async()=>{
 const created=[];let modalCount=0;
 const status={appendChild(){}},elements={main:{},saveImageStatus:status,savedTicketPreview:{hidden:true}};
 const document={getElementById:id=>elements[id]||null,body:{appendChild(){}},createElement:tag=>{const button={};const el={tag,innerHTML:'',querySelector:()=>button,setAttribute(){},addEventListener(){},showModal(){modalCount++;},close(){},remove(){}};created.push(el);return el;}};
 const context={document,location:{search:''},URLSearchParams,navigator:{canShare:()=>true,share:async()=>{}},Date};
 vm.runInNewContext(fs.readFileSync('public/resident.js','utf8').replace('  start();','  globalThis.save = saveTicketImage;'),context);
 await context.save({}, {date:'2026-10-17',status:'PRE_REGISTERED'},false);
 assert.equal(modalCount,1);assert.doesNotMatch(created[0].innerHTML,/Yes, I saved it|ticket is saved/);
 assert.match(created[0].innerHTML,/Keep your QR ticket handy/);assert.match(created[0].innerHTML,/take a screenshot/);
 assert.match(created[0].innerHTML,/October 17, 2026/);assert.match(created[0].innerHTML,/saved-pets.webp/);assert.match(created[0].innerHTML,/GOT IT/);
 context.navigator.share=async()=>{throw Object.assign(new Error(),{name:'AbortError'});};
 await context.save({}, {date:'2026-10-17'},false);assert.equal(modalCount,2);
 assert.equal(elements.savedTicketPreview.hidden,true);
 const count=created.length;await context.save({}, {date:'2026-10-17'},true);assert.equal(created.length,count);
});


test('registration message changes automatically at Manila midnight for each event date',()=>{
 const context={document:{getElementById:()=>({})},location:{search:''},URLSearchParams,Intl,Date};
 vm.runInNewContext(fs.readFileSync('public/resident.js','utf8').replace('  start();','  globalThis.notice = registrationNoticeText;'),context);
 assert.match(context.notice('2026-10-17',new Date('2026-10-16T15:59:59Z')),/^Pre-register/);
 assert.equal(context.notice('2026-10-17',new Date('2026-10-16T16:00:00Z')),'Register now to claim your FREE sample today!');
 assert.match(context.notice('2026-10-18',new Date('2026-10-16T16:00:00Z')),/^Pre-register/);
 assert.match(context.notice('2026-10-17',new Date('2026-10-17T16:00:00Z')),/date has passed/);
});
