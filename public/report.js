/* Client dashboard. All views and exports use the same date and condo filters. */
(function () {
  'use strict';
  var main = document.getElementById('main'), upd = document.getElementById('upd');
  var KEY = 'smfc_report_token_v1', token = null, data = null, filter = 'ALL', condoFilter = 'ALL', view = 'overview';
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function num(n) { return (Number(n) || 0).toLocaleString('en-PH'); }
  function sum(rows, fn) { return rows.reduce(function(a,r) { return a + (Number(fn(r)) || 0); },0); }
  function dateLabel(d) { if (!d) return '—'; var v = new Date(d + 'T00:00:00+08:00'); return isNaN(v) ? esc(d) : v.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric',timeZone:'Asia/Manila'}); }
  function empty(title, note) { return '<div class="empty"><strong>'+esc(title)+'</strong><p>'+esc(note)+'</p></div>'; }
  function panel(title, note, content) { return '<section class="panel"><h2>'+esc(title)+'</h2><p class="panel-note">'+esc(note)+'</p>'+content+'</section>'; }
  function bars(items, color) {
    var max = Math.max.apply(null,items.map(function(x){return x.value;}).concat([1]));
    return '<div class="chart" role="img" aria-label="'+esc(items.map(function(x){return x.label+': '+x.value;}).join('; '))+'">'+items.map(function(x){return '<div class="chart-row"><div class="chart-label">'+esc(x.label)+'</div><div class="chart-track"><div class="chart-fill '+(color || 'aqua')+'" style="width:'+(x.value/max*100)+'%"></div></div><strong>'+num(x.value)+'</strong></div>';}).join('')+'</div>';
  }
  function countBars(rows, field) {
    var m = {}; rows.forEach(function(r){ var k=typeof field==='function'?field(r):r[field]; if(k) m[k]=(m[k]||0)+1; });
    var list = Object.keys(m).map(function(k){return {label:k,value:m[k]};}).sort(function(a,b){return b.value-a.value;});
    return list.length ? bars(list) : empty('No resident data yet','This graph will appear after residents register.');
  }
  function petProfiles(r,pet) { try { var a=JSON.parse(r[pet+'_PROFILES']||'[]');return Array.isArray(a)?a:[]; } catch(e){return [];} }
  function profileBars(rows,pet,key,legacy) {
    var m={};rows.forEach(function(r){var a=petProfiles(r,pet), labels=a.length?a.map(function(p){return key==='ageSize'?p.age+' · '+p.size:p[key];}):[typeof legacy==='function'?legacy(r):r[legacy]];
      Array.from(new Set(labels.filter(Boolean))).forEach(function(k){m[k]=(m[k]||0)+1;});});
    var list=Object.keys(m).map(function(k){return {label:k,value:m[k]};}).sort(function(a,b){return b.value-a.value;});return list.length?bars(list):empty('No resident data yet','Answers will appear after residents register.');
  }
  function petDetails(r,pet) {return petProfiles(r,pet).map(function(p){return p.name+': '+p.age+(p.size?' / '+p.size:'')+'; Food: '+p.brand+'; Reason: '+p.reason;}).join(' | ');}
  function petPhotos(r) {return ['DOG','CAT'].map(function(pet){return petProfiles(r,pet).map(function(p,i){return '<div><dt>'+esc(p.name||pet+' '+(i+1))+' photo</dt><dd>'+photo(p.photoUrl,'View pet photo')+'</dd></div>';}).join('');}).join('');}
  function kpi(value,label,note,color) { return '<div class="metric '+color+'"><span>'+esc(label)+'</span><strong>'+num(value)+'</strong><small>'+esc(note)+'</small></div>'; }
  function status(r) { return r.STATUS==='CLAIMED'?'Sample received':r.STATUS==='WAITING'?'Awaiting collection':r.STATUS==='NO_STOCK'?'No sample available':r.STATUS||'Unknown'; }
  function match(date,condo) { return (filter==='ALL'||date===filter)&&(condoFilter==='ALL'||condo===condoFilter); }
  function photo(url,label) { return /^https:\/\//i.test(url||'') ? '<a href="'+esc(url)+'" target="_blank" rel="noopener">'+esc(label)+'</a>' : '—'; }
  try { token = sessionStorage.getItem(KEY); } catch(e) {}
  function login(msg) {
    main.innerHTML='<div class="login-card"><h2>Client sign in</h2><p>Enter your client access code.</p><label class="lbl" for="pass">Client code</label><input id="pass" class="big" type="password" autocomplete="current-password" placeholder="Client code"><div id="err" class="errbox" hidden></div><button id="go" class="btn primary huge" type="button">View dashboard</button></div>';
    if(msg){$('err').hidden=false;$('err').textContent=msg;}
    $('go').onclick=async function(){
      $('go').disabled=true;$('go').textContent='Signing in…';
      var r=await fetch('/api/report/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passcode:$('pass').value})}).then(function(x){return x.json();}).catch(function(){return {ok:false,message:'No connection. Please try again.'};});
      if(!r.ok){$('go').disabled=false;$('go').textContent='View dashboard';$('err').hidden=false;$('err').textContent=r.message||'Incorrect client code.';return;}
      token=r.token;try{sessionStorage.setItem(KEY,token);}catch(e){} load();
    };
    $('pass').onkeydown=function(e){if(e.key==='Enter'&&!$('go').disabled)$('go').click();};
  }
  async function load() {
    main.innerHTML='<div class="statusbox">Loading dashboard…</div>';
    var r=await fetch('/api/report',{headers:{Authorization:'Bearer '+token}}).then(function(x){return x.json();}).catch(function(){return {ok:false,message:'No connection. Please try again.'};});
    if(!r.ok){if(r.error==='SIGN_IN'||r.error==='FORBIDDEN')return login('Please sign in again.');main.innerHTML='<div class="errbox">'+esc(r.message||'Could not load the dashboard.')+'</div><button class="btn secondary" id="retry">Try again</button>';$('retry').onclick=load;return;}
    data=r;upd.textContent='Updated '+new Date().toLocaleTimeString('en-PH',{hour:'numeric',minute:'2-digit',timeZone:'Asia/Manila'});render();
  }
  function render() {
    var days=(data.days||[]).filter(function(d){return match(d.date,d.condoId);});
    var regs=(data.registrations||[]).filter(function(r){return match(r.DATE,r.CONDO_ID);});
    var reds=(data.redemptions||[]).filter(function(r){return match(r.DATE,r.CONDO_ID);});
    var flags=(data.flags||[]).filter(function(r){return match(r.DATE,r.CONDO_ID);});
    var pids=Object.keys(data.products||{}), dates=Array.from(new Set((data.days||[]).map(function(d){return d.date;}))).sort();
    var condos={};(data.days||[]).forEach(function(d){condos[d.condoId]=d.condoName;});
    var claimed=regs.filter(function(r){return r.STATUS==='CLAIMED';}), waiting=regs.filter(function(r){return r.STATUS==='WAITING';}).length;
    var given=sum(days,function(d){return sum(pids,function(p){return d.given[p];});});
    var h='<div class="dashboard-heading"><div><div class="eyebrow">CONDOMINIUM SAMPLING</div><h1>Program performance</h1><p>Resident registrations and free sample distribution.</p></div><button class="btn secondary" id="refresh" type="button">Refresh data</button></div>';
    h+='<div class="filterbar"><label for="day">Date<select id="day"><option value="ALL">All dates</option>'+dates.map(function(d){return '<option value="'+esc(d)+'"'+(d===filter?' selected':'')+'>'+dateLabel(d)+'</option>';}).join('')+'</select></label><label for="condo">Condominium<select id="condo"><option value="ALL">All condominiums</option>'+Object.keys(condos).map(function(c){return '<option value="'+esc(c)+'"'+(c===condoFilter?' selected':'')+'>'+esc(condos[c])+'</option>';}).join('')+'</select></label><span class="scope-note">Live program records only · Training excluded</span></div>';
    h+='<nav class="report-tabs" aria-label="Dashboard sections">'+[['overview','Overview'],['samples','Samples & stock'],['residents','Resident profiles'],['records','Records & photos']].map(function(t){return '<button type="button" data-view="'+t[0]+'" aria-current="'+(view===t[0]?'page':'false')+'" class="tab '+(view===t[0]?'active':'')+'">'+t[1]+'</button>';}).join('')+'</nav>';
    if(view==='overview') {
      h+='<div class="metrics">'+kpi(regs.length,'Households registered','One registration per mobile number','navy')+kpi(claimed.length,'Households served','Already received their free sample','aqua')+kpi(given,'Sample packs distributed','Counts packs, not households','coral')+kpi(waiting,'Awaiting collection','Registered with a sample available','gold')+'</div>';
      h+='<p class="definition">Each household receives one pack per applicable variant, regardless of pet count. A household with puppies, adult dogs and cats may receive three packs. This is why packs distributed can exceed households served.</p>';
      if(!regs.length)h+=empty('No live resident registrations yet','Totals are zero because no live registrations match these filters. Scheduled sample allocations are shown in Samples & stock.');
      var byCondo={};days.forEach(function(d){if(!byCondo[d.condoId])byCondo[d.condoId]={name:d.condoName,registered:0,claimed:0};});
      regs.forEach(function(r){var x=byCondo[r.CONDO_ID]||(byCondo[r.CONDO_ID]={name:r.CONDO_NAME,registered:0,claimed:0});x.registered++;if(r.STATUS==='CLAIMED')x.claimed++;});
      var max=Math.max.apply(null,Object.keys(byCondo).map(function(c){return byCondo[c].registered;}).concat([1]));
      var condoChart=Object.keys(byCondo).map(function(c){var x=byCondo[c];return '<div class="comparison"><strong>'+esc(x.name)+'</strong><div class="compare-row"><span>Registered</span><div class="chart-track"><div class="chart-fill navy" style="width:'+x.registered/max*100+'%"></div></div><b>'+num(x.registered)+'</b></div><div class="compare-row"><span>Served</span><div class="chart-track"><div class="chart-fill aqua" style="width:'+x.claimed/max*100+'%"></div></div><b>'+num(x.claimed)+'</b></div></div>';}).join('');
      h+='<div class="panel-grid">'+panel('Registrations and collection by condo','Households registered compared with households already served.',condoChart||empty('No condos in this view','Choose another date or condominium.'))+panel('Sample packs distributed','Actual packs released, by product. All samples are 150 g.',bars(pids.map(function(p){return {label:data.products[p],value:sum(days,function(d){return d.given[p];})};}),'coral'))+'</div>';
      var noStock=regs.filter(function(r){return r.STATUS==='NO_STOCK';}).length;
      if(noStock)h+='<div class="notice">'+num(noStock)+' registered household'+(noStock===1?'':'s')+' had no sample available. These are separate from households awaiting collection.</div>';
    }
    if(view==='samples') {
      h+=panel('Sample distribution by product','Packs distributed under the selected date and condo filters. Each pack is 150 g.',bars(pids.map(function(p){return {label:data.products[p],value:sum(days,function(d){return d.given[p];})};}),'coral'));
      h+='<div class="section-heading"><h2>Stock by condo and event date</h2><p>Allocated = planned supply. Remaining = allocated minus distributed, including packs reserved for unclaimed tickets.</p></div><div class="stock-grid">';
      days.forEach(function(d){var future=d.date>data.today;h+='<section class="panel stock-card"><div class="stock-title"><h3>'+esc(d.condoName)+'</h3><span class="badge '+(future?'scheduled':'')+'">'+(future?'Scheduled':'Event date')+'</span></div><p class="panel-note">'+dateLabel(d.date)+(future?' · This event has not started yet.':'')+'</p><table><thead><tr><th>Product</th><th>Allocated</th><th>Distributed</th><th>Remaining</th></tr></thead><tbody>'+pids.map(function(p){var a=Number(d.allocated[p])||0,g=Number(d.given[p])||0;return '<tr><td>'+esc(data.products[p])+'</td><td>'+num(a)+'</td><td>'+num(g)+'</td><td>'+num(a-g)+'</td></tr>';}).join('')+'</tbody></table></section>';});
      h+='</div>';if(!days.length)h+=empty('No stock allocations in this view','Choose another date or condominium.');
    }
    if(view==='residents') {
      h+='<div class="metrics resident-metrics">'+kpi(sum(regs,function(r){return r.DOG_COUNT;}),'Dogs recorded','Number of pets, not households','navy')+kpi(sum(regs,function(r){return r.CAT_COUNT;}),'Cats recorded','Number of pets, not households','aqua')+kpi(regs.filter(function(r){return r.PROMO_OPT_IN==='YES';}).length,'Agreed to receive promotions','Households with promotional consent','coral')+'</div>';
      h+='<div class="panel-grid">'+panel('Current dog food brands','Households using each brand. A household may use more than one brand.',profileBars(regs,'DOG','brand','DOG_BRAND'))+panel('Current cat food brands','Households using each brand. A household may use more than one brand.',profileBars(regs,'CAT','brand','CAT_BRAND'))+panel('Reasons for current dog food','Households reporting each reason for their dogs.',profileBars(regs,'DOG','reason','DOG_BRAND_REASON'))+panel('Reasons for current cat food','Households reporting each reason for their cats.',profileBars(regs,'CAT','reason','CAT_BRAND_REASON'))+panel('Pets in each household','Each household appears once. Dog & cat households form a separate group.',countBars(regs,function(r){return {DOG:'Dogs only',CAT:'Cats only',BOTH:'Dogs and cats'}[r.PET_TYPE]||'';}))+panel('Dog age and size','Households with each dog age and size. Mixed households may appear in more than one group.',profileBars(regs,'DOG','ageSize',function(r){return r.DOG_AGE?r.DOG_AGE+' · '+r.DOG_SIZE:'';}))+panel('Cat age','Households with each cat age. Mixed households may appear in more than one group.',profileBars(regs,'CAT','age','CAT_AGE'))+'</div>';
    }
    if(view==='records') {
      h+='<div class="section-heading records-heading"><div><h2>Resident records ('+num(regs.length)+')</h2><p>Open a resident to see their pet details, consent and photos.</p></div><div class="export-buttons"><button class="btn secondary" id="csvReg">Export registrations</button><button class="btn secondary" id="csvRed">Export claims log</button></div></div>';
      h+=regs.length?'<div class="record-list">'+regs.map(function(r){return '<details class="resident-record"><summary><span><strong>'+esc(r.RESIDENT_NAME||'Name not recorded')+'</strong><small>'+esc(r.CLAIM_CODE)+' · '+esc(r.CONDO_NAME)+' · '+dateLabel(r.DATE)+'</small></span><span class="badge '+(r.STATUS==='CLAIMED'?'received':'')+'">'+esc(status(r))+'</span></summary><dl>'+[['Mobile',r.MOBILE],['Pets',r.PET_TYPE],['Dogs',r.DOG_COUNT],['Dog names',r.DOG_NAMES],['Dog age / size',[r.DOG_AGE,r.DOG_SIZE].filter(Boolean).join(' / ')],['Current dog food',r.DOG_BRAND],['Dog food reasons',r.DOG_BRAND_REASON],['Each dog',petDetails(r,'DOG')],['Cats',r.CAT_COUNT],['Cat names',r.CAT_NAMES],['Cat age',r.CAT_AGE],['Current cat food',r.CAT_BRAND],['Cat food reasons',r.CAT_BRAND_REASON],['Each cat',petDetails(r,'CAT')],['Sample packs given',String(r.SAMPLES_GIVEN||'').split(',').map(function(p){return data.products[p.trim()]||p.trim();}).join(', ')],['Claimed by',r.CLAIMED_BY],['Claimed at',r.CLAIMED_AT],['Promotional consent',r.PROMO_OPT_IN],['Customer photo consent',r.PHOTO_CONSENT==='YES'?'Agreed':r.PHOTO_CONSENT==='NO'?'Declined':'Not recorded']].map(function(x){return '<div><dt>'+x[0]+'</dt><dd>'+esc(x[1]||'—')+'</dd></div>';}).join('')+petPhotos(r)+'<div><dt>Ticket photo</dt><dd>'+photo(r.PHOTO_URL,'View ticket photo')+'</dd></div><div><dt>Customer & sample photo</dt><dd>'+photo(r.CUSTOMER_PHOTO_URL,'View customer photo')+'</dd></div></dl></details>';}).join('')+'</div>':empty('No resident records yet','Live registrations will appear here. Training records are excluded.');
      var oos=flags.filter(function(f){return f.RESULT==='OOS';});
      if(oos.length)h+=panel('Customers tried to redeem — OOS ('+num(oos.length)+')','Recorded attempts with no sample released. These do not count as households served or packs distributed.','<div class="table-scroll"><table><thead><tr><th>Ticket</th><th>BA</th><th>Unavailable variant</th><th>Recorded at</th></tr></thead><tbody>'+oos.map(function(f){return '<tr><td>'+esc(f.CLAIM_CODE)+'</td><td>'+esc(f.BA_NAME||f.STAFF_CODE)+'</td><td>'+esc(String(f.PRODUCTS_UNAVAILABLE||'').split(',').map(function(id){return data.products[id.trim()]||id.trim();}).join(', '))+'</td><td>'+esc(f.SERVER_SAVED_AT)+'</td></tr>';}).join('')+'</tbody></table></div>');
      flags=flags.filter(function(f){return f.RESULT!=='OOS';});
      if(flags.length)h+=panel('Claim attempts to review ('+num(flags.length)+')','These are unsuccessful attempts, not additional sample distributions. Duplicate means the ticket was already claimed.','<div class="table-scroll"><table><thead><tr><th>Ticket</th><th>BA</th><th>What happened</th></tr></thead><tbody>'+flags.map(function(f){return '<tr><td>'+esc(f.CLAIM_CODE)+'</td><td>'+esc(f.BA_NAME)+'</td><td>'+esc(f.NOTE||f.RESULT)+'</td></tr>';}).join('')+'</tbody></table></div>');
    }
    main.innerHTML=h;
    $('day').onchange=function(){filter=this.value;render();};$('condo').onchange=function(){condoFilter=this.value;render();};$('refresh').onclick=load;
    main.querySelectorAll('[data-view]').forEach(function(b){b.onclick=function(){view=b.getAttribute('data-view');render();};});
    if($('csvReg'))$('csvReg').onclick=function(){csv('condo-registrations.csv',regs);};
    if($('csvRed'))$('csvRed').onclick=function(){csv('condo-claims-log.csv',reds);};
  }
  function csv(name,rows){
    if(!rows.length){alert('No records match these filters.');return;}
    var cols=Object.keys(rows[0]),q=function(v){v=String(v==null?'':v);if(/^[=+\-@]/.test(v))v="'"+v;return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};
    var footer=cols.map(function(_,i){return i===0?q('© 2026 Aileen Narciso / Slingshotz Advertising Inc.'):'';}).join(',');
    var text='\uFEFF'+[cols.join(',')].concat(rows.map(function(r){return cols.map(function(c){return q(r[c]);}).join(',');}),['',footer]).join('\n');
    var a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type:'text/csv'}));a.href=url;a.download=name;a.click();setTimeout(function(){URL.revokeObjectURL(url);},2000);
  }
  if(token)load();else login();
})();
