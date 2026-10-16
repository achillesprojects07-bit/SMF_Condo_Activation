/* Pure aggregation: registrations are the source of truth for completed claims. */
(function(root){
  'use strict';
  function stamp(value){
    var text=String(value||'').trim();
    if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text))text=text.replace(' ','T')+'+08:00';
    if(!text)return null;
    var d=new Date(text);if(isNaN(d.getTime()))return null;
    var parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d),p={};
    parts.forEach(function(x){p[x.type]=x.value;});
    return {ms:d.getTime(),date:p.year+'-'+p.month+'-'+p.day,hour:Number(p.hour),time:p.hour+':'+p.minute};
  }
  function build(data,date,condo){
    var matches=function(r){return r.DATE===date&&(condo==='ALL'||r.CONDO_ID===condo);};
    var regs=(data.registrations||[]).filter(matches),flags=(data.flags||[]).filter(matches),by={},events=[],hours=Array.from({length:24},function(_,h){return {hour:h,signups:0,claims:0};});
    function row(id,name){return by[id]||(by[id]={id:id,name:name||id,registered:0,claimed:0,pending:0,noStock:0,packs:0,advance:0,newSignups:0,oos:0,last:null});}
    (data.days||[]).filter(function(d){return d.date===date&&(condo==='ALL'||d.condoId===condo);}).forEach(function(d){row(d.condoId,d.condoName);});
    function event(r,type,value){var t=stamp(value);if(!t)return;var x=row(r.CONDO_ID,r.CONDO_NAME);if(!x.last||x.last.ms<t.ms)x.last=t;events.push({type:type,code:r.CLAIM_CODE,condo:x.name,ba:r.CLAIMED_BY||r.BA_NAME||r.STAFF_CODE||'',at:t});if(t.date===date&&type!=='oos')hours[t.hour][type==='signup'?'signups':'claims']++;}
    regs.forEach(function(r){var x=row(r.CONDO_ID,r.CONDO_NAME),s=stamp(r.REGISTERED_AT);x.registered++;if(s&&s.date<date)x.advance++;if(s&&s.date===date)x.newSignups++;event(r,'signup',r.REGISTERED_AT);
      if(r.STATUS==='CLAIMED'){x.claimed++;x.packs+=new Set(String(r.SAMPLES_GIVEN||'').split(',').map(function(p){return p.trim();}).filter(Boolean)).size;event(r,'claim',r.CLAIMED_AT);}
      else if(r.STATUS==='WAITING'||r.STATUS==='PRE_REGISTERED')x.pending++;else if(r.STATUS==='NO_STOCK')x.noStock++;
    });
    var oos=flags.filter(function(f){return f.RESULT==='OOS';});oos.forEach(function(f){row(f.CONDO_ID,f.CONDO_NAME).oos++;event(f,'oos',f.SERVER_SAVED_AT);});
    var rows=Object.values(by).sort(function(a,b){return a.name.localeCompare(b.name);}),totals={};['registered','claimed','pending','noStock','packs','advance','newSignups','oos'].forEach(function(k){totals[k]=rows.reduce(function(n,r){return n+r[k];},0);});
    return {rows:rows,totals:totals,hours:hours,events:events.sort(function(a,b){return b.at.ms-a.at.ms;}).slice(0,30),oos:oos};
  }
  root.PMModel={build:build,stamp:stamp};
})(typeof module==='object'?module.exports:globalThis);
