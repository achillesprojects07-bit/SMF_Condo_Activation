/* Resident registration page. Opened from the QR poster at the booth: /?c=RR */
(function () {
  "use strict";
  var main = document.getElementById("main");
  var condoId = (new URLSearchParams(location.search).get("c") || "").trim().toUpperCase();
  var TICKET_KEY = "smfc_ticket_v1";
  var state = { consent: "", petType: "", dogCount: 1, catCount: 1, dogAge: "", dogSize: "", dogBrand: "", catAge: "", catBrand: "", promo: "" };
  var info = null;
  var profiles = {dog: [], cat: []}, pendingRegId = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : "r" + Date.now() + Math.random().toString(16).slice(2)); }
  function normMobile(v) {
    var d = String(v || "").replace(/[^0-9+]/g, "");
    if (/^\+639\d{9}$/.test(d)) return "0" + d.slice(3);
    if (/^639\d{9}$/.test(d)) return "0" + d.slice(2);
    if (/^9\d{9}$/.test(d)) return "0" + d;
    return d;
  }
  function loadTicket() { try { return JSON.parse(localStorage.getItem(TICKET_KEY) || "null"); } catch (e) { return null; } }
  function saveTicket(t) { try { localStorage.setItem(TICKET_KEY, JSON.stringify(t)); } catch (e) { } }

  async function api(path, opts) {
    var res = await fetch(path, Object.assign({ headers: { "Content-Type": "application/json" } }, opts || {}));
    var data = {};
    try { data = await res.json(); } catch (e) { data = { ok: false, message: "No response from the server. Please try again." }; }
    return data;
  }

  /* ---------- ticket ---------- */
  function qrSvg(text) {
    var q = qrcode(0, "M");
    q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }

  function showTicket(t) {
    main.innerHTML = $("ticketTpl").innerHTML;
    $("tkCode").textContent = t.code;
    $("tkPets").textContent = [t.petNames, t.name].filter(Boolean).join(" • ");
    var ids = (t.samples || []).map(function (s) { return s.id; });
    $("tkQr").innerHTML = qrSvg("SMFC1|" + t.code + "|" + ids.join(","));
    var html = (t.samples || []).map(function (s) { return '<div class="sample ' + ({NC_PUPPY_LAMB:'variant-puppy',NC_MAINT_ADULT:'variant-maintenance',NC_SMALL_BREED:'variant-small',MJ_ADULT_SALMON:'variant-majesty'}[s.id] || '') + '">🎁 <span class="free">FREE</span> ' + esc(s.name) + "</div>"; }).join("");
    if (t.noStock) html += '<div class="sample none">' + (ids.length ? "One of the packs" : "The pack") + " for your pet is out of stock today. Thank you for registering!</div>";
    $("tkSamples").innerHTML = html;
    $("tkMeta").textContent = (t.condoName || "") + " • " + (t.registeredAt || t.date || "");
    var box = main.querySelector(".ticket");
    if (t.status === "CLAIMED") {
      box.classList.add("claimed");
      box.querySelector(".tkTop").innerHTML = '<span class="stamp">✓ FREE PACK RECEIVED</span>';
    }
    var again = document.createElement("div");
    again.className = "center";
    again.innerHTML = '<button type="button" class="linkBtn" id="another">Registering someone else on this phone? Tap here</button>';
    main.appendChild(again);
    $("another").onclick = function () {
      if (!confirm("Register another person on this phone? (Please make sure this free pack has been received first.)")) return;
      try { localStorage.removeItem(TICKET_KEY); } catch (e) { }
      location.reload();
    };
  }

  async function refreshTicket(t) {
    showTicket(t);
    if (t.status === "CLAIMED") return;
    try {
      var r = await api("/api/my-ticket?code=" + encodeURIComponent(t.code) + "&reg=" + encodeURIComponent(t.regId));
      if (r.ok && r.ticket) { r.ticket.regId = t.regId; saveTicket(r.ticket); showTicket(r.ticket); }
    } catch (e) { /* offline: the saved ticket is enough */ }
  }

  /* ---------- form ---------- */
  function paintChoices(group) {
    var name = group.dataset.name;
    group.querySelectorAll(".choice").forEach(function (b) { b.classList.toggle("selected", b.dataset.v === state[name]); });
  }

  function brandButtons(pet) {
    var list = (info.brands || []).filter(function (b) { return b.petType === pet || b.petType === "BOTH"; }).map(function (b) { return b.brand; });
    return list.map(function (b) { return '<button type="button" class="choice" data-v="' + esc(b) + '">' + esc(b) + "</button>"; }).join("");
  }

  function isOther(v) { return /^iba/i.test(v || "") || /other/i.test(v || ""); }

  function petBlank() { return {name:'', age:'', size:'', brand:'', brandOther:'', reason:'', reasonOther:'', photo:'', photoLoading:false}; }
  function profileValid(p, pet) { return !!p.photo && !p.photoLoading && p.name.trim() && p.age && (pet === 'cat' || p.size) && p.brand && (!isOther(p.brand) || p.brandOther.trim()) && p.reason && (p.reason !== 'Other' || p.reasonOther.trim()); }
  function options(list, selected) { return '<option value="">Choose an answer</option>' + list.map(function(x){var v=Array.isArray(x)?x[0]:x, label=Array.isArray(x)?x[1]:x;return '<option value="'+esc(v)+'"'+(v===selected?' selected':'')+'>'+esc(label)+'</option>';}).join(''); }
  function petPhotoFields(p,pet,i) {
    var attrs=' data-pet="'+pet+'" data-index="'+i+'" data-photo="true"';
    return '<div class="petPhoto"><strong>Pet photo (required)</strong><p class="qSub">Take a photo or upload one from your gallery. A clear group photo may be used for each pet shown in it.</p><div style="display:flex;gap:10px;flex-wrap:wrap"><label class="btn secondary">Take photo<input type="file" accept="image/*" capture="environment"'+attrs+' hidden></label><label class="btn secondary">Upload from gallery<input type="file" accept="image/*"'+attrs+' hidden></label></div><img class="photoPrev petPreview" alt="Pet photo preview"'+(p.photo?' src="'+p.photo+'"':' hidden')+'><div class="petPhotoStatus helper" role="status">'+(p.photoLoading?'Preparing photo…':p.photo?'Photo ready':'No photo added yet')+'</div></div>';
  }
  async function preparePetPhoto(file) {
    if(!/^image\//.test(file.type))throw new Error('Please choose an image file.');
    var url=URL.createObjectURL(file),img=new Image();
    try {
      await new Promise(function(resolve,reject){img.onload=resolve;img.onerror=function(){reject(new Error('This image could not be opened. Please choose another photo or take a new one.'));};img.src=url;});
      var scale=Math.min(1,960/Math.max(img.naturalWidth,img.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
      var photo=canvas.toDataURL('image/jpeg',0.65);
      if(photo.length>1500000)throw new Error('The photo is too large. Please choose a smaller image.');
      return photo;
    } finally {URL.revokeObjectURL(url);}
  }
  function renderPets(pet) {
    var n=state[pet+'Count']; while(profiles[pet].length<n) profiles[pet].push(petBlank());
    profiles[pet].length=n;
    $(pet+'Profiles').innerHTML=profiles[pet].map(function(p,i){
      var key=pet+'Profile'+i, brands=(info.brands||[]).filter(function(b){return b.petType===pet.toUpperCase()||b.petType==='BOTH';}).map(function(b){return b.brand;});
      function field(k,label,list) {return '<label style="display:block;margin:14px 0">'+label+(list?'<select class="big" data-pet="'+pet+'" data-index="'+i+'" data-field="'+k+'">'+options(list,p[k])+'</select>':'<input class="big" maxlength="60" data-pet="'+pet+'" data-index="'+i+'" data-field="'+k+'" value="'+esc(p[k])+'">')+'</label>';}
      return '<section class="q" data-q="'+key+'"><div class="qTitle">'+(pet==='dog'?'Dog':'Cat')+' '+(i+1)+'</div>'+field('name',"Pet's name")+petPhotoFields(p,pet,i)+field('age','Age',pet==='dog'?[['PUPPY','Puppy (below 1 yr)'],['ADULT','Adult (1 yr+)']]:[['KITTEN','Kitten (below 1 yr)'],['ADULT','Adult (1 yr+)']])+(pet==='dog'?field('size','Size',[['SMALL','Small'],['MEDIUM','Medium'],['LARGE','Large']]):'')+field('brand','Current '+pet+' food brand',brands)+ '<div data-extra="brand"'+(!isOther(p.brand)?' hidden':'')+'>'+field('brandOther','Other brand name')+'</div>'+field('reason','Why do you use this food for this '+pet+'?',['Pet likes it','Price / budget','Recommended by vet','Recommended by family / friends','Easy to find','Nutrition / health needs','Used to this food','Other'])+'<div data-extra="reason"'+(p.reason!=='Other'?' hidden':'')+'>'+field('reasonOther','Other reason')+'</div></section>';
    }).join('');
  }
  function answered() {
    var a={consent:state.consent==='YES',petType:!!state.petType,name:$('name').value.trim().length>=2,mobile:/^09\d{9}$/.test(normMobile($('mobile').value)),promo:!!state.promo,dogCount:true,catCount:true};
    ['dog','cat'].forEach(function(pet){profiles[pet].forEach(function(p,i){a[pet+'Profile'+i]=!!profileValid(p,pet);});});return a;
  }
  function refresh() {
    var a=answered();main.querySelectorAll('.q').forEach(function(q){q.classList.toggle('answered',!!a[q.dataset.q]);q.classList.remove('bad');});
    $('noConsent').hidden=state.consent!=='NO';$('afterConsent').hidden=state.consent!=='YES';
    $('dogPart').hidden=state.petType!=='DOG'&&state.petType!=='BOTH';$('catPart').hidden=state.petType!=='CAT'&&state.petType!=='BOTH';$('youPart').hidden=!state.petType;
    var m=$('mobile').value.trim();$('mobileHint').hidden=!m||a.mobile||m.replace(/\D/g,'').length<10;
  }
  function missing() {
    var a=answered(),need=['consent','petType','name','mobile','promo'];
    ['dog','cat'].forEach(function(pet){if(state.petType===pet.toUpperCase()||state.petType==='BOTH')profiles[pet].forEach(function(p,i){need.push(pet+'Profile'+i);});});return need.filter(function(k){return !a[k];});
  }

  function buildForm() {
    main.innerHTML = $("formTpl").innerHTML;
    renderPets('dog');renderPets('cat');
    function profileInput(e) {
      var t=e.target;
      if(!t.dataset.pet || t.dataset.photo)return;
      var p=profiles[t.dataset.pet][Number(t.dataset.index)];p[t.dataset.field]=t.value;
      var card=t.closest('.q');card.querySelector('[data-extra="brand"]').hidden=!isOther(p.brand);card.querySelector('[data-extra="reason"]').hidden=p.reason!=='Other';refresh();
    }
    main.addEventListener('change',async function(e){
      var input=e.target;if(!input.dataset.photo)return;var file=input.files&&input.files[0];if(!file)return;
      var pet=input.dataset.pet,index=Number(input.dataset.index),p=profiles[pet][index],box=input.closest('.petPhoto');
      var photoToken=uuid();p.photoToken=photoToken;p.photoLoading=true;box.querySelector('.petPhotoStatus').textContent='Preparing photo…';refresh();
      try {var photo=await preparePetPhoto(file);if(profiles[pet][index]!==p || p.photoToken!==photoToken)return;p.photo=photo;var preview=box.querySelector('.petPreview');preview.src=photo;preview.hidden=false;box.querySelector('.petPhotoStatus').textContent='Photo ready';}
      catch(error){if(p.photoToken===photoToken)box.querySelector('.petPhotoStatus').textContent=error.message;}
      finally {if(p.photoToken===photoToken)p.photoLoading=false;input.value='';refresh();}
    });
    main.addEventListener('input',profileInput);main.addEventListener('change',profileInput);
    main.querySelectorAll(".choices").forEach(function (group) {
      group.addEventListener("click", function (e) {
        var b = e.target.closest(".choice"); if (!b) return;
        state[group.dataset.name] = b.dataset.v;
        paintChoices(group); refresh();
      });
    });
    main.querySelectorAll(".stepper").forEach(function (st) {
      st.addEventListener("click", function (e) {
        var b = e.target.closest(".stepBtn"); if (!b) return;
        var n = st.dataset.name;
        state[n] = Math.max(1, Math.min(30, state[n] + Number(b.dataset.d)));
        st.querySelector(".stepValue").textContent = state[n];
        renderPets(n==='dogCount'?'dog':'cat');refresh();
      });
    });
    main.querySelectorAll("input").forEach(function (i) { i.addEventListener("input", refresh); });
    $("submit").onclick = submit;
    refresh();
  }

  async function submit() {
    var miss = missing(), err = $("formError");
    if (miss.length) {
      miss.forEach(function (k) { var q = main.querySelector('.q[data-q="' + k + '"]'); if (q) q.classList.add("bad"); });
      var first = main.querySelector(".q.bad");
      err.hidden = false; err.textContent = "Some answers are missing. Please complete the items marked in red.";
      if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    err.hidden = true;
    var btn = $("submit");
    btn.disabled = true; btn.textContent = "Saving…";
    function petPayload(pet) {
      var list=profiles[pet].map(function(p){return {name:p.name.trim(),age:p.age,size:pet==='dog'?p.size:'',brand:isOther(p.brand)?'Other: '+p.brandOther.trim():p.brand,reason:p.reason==='Other'?'Other: '+p.reasonOther.trim():p.reason,photo:p.photo};});
      return {profiles:list,count:list.length};
    }
    var regId = pendingRegId || (pendingRegId = uuid());
    var payload = {
      condoId: condoId, regId: regId, consent: "YES", promoOptIn: state.promo,
      name: $("name").value.trim(), mobile: normMobile($("mobile").value), petType: state.petType,
      dog: petPayload('dog'), cat: petPayload('cat')
    };
    var r;
    try { r = await api("/api/register", { method: "POST", body: JSON.stringify(payload) }); }
    catch (e) { r = { ok: false, message: "No internet connection. Please try again when you have signal, or ask our Pet Pals at the booth." }; }
    if (r.ok && r.ticket) {
      r.ticket.regId = regId;
      saveTicket(r.ticket);
      window.scrollTo(0, 0);
      showTicket(r.ticket);
      return;
    }
    btn.disabled = false; btn.textContent = "Get my FREE NutriChunks / Majesty";
    err.hidden = false; err.textContent = r.message || "Your registration was not saved. Please try again.";
    if (r.error === "ALREADY_REGISTERED" || r.error === "BAD_MOBILE") main.querySelector('.q[data-q="mobile"]').classList.add("bad");
  }

  async function start() {
    var t = loadTicket();
    if (t && t.code && (!condoId || t.condoId === condoId)) { $("condoLine").textContent = t.condoName || ""; return refreshTicket(t); }
    if (!condoId) { main.innerHTML = '<div class="errbox">Please scan the QR code at the booth to register.</div>'; return; }
    try { info = await api("/api/condo?c=" + encodeURIComponent(condoId)); }
    catch (e) { info = { ok: false, message: "No internet connection. Please try again when you have signal." }; }
    if (!info.ok) { main.innerHTML = '<div class="errbox">' + esc(info.message || "Something went wrong. Please try again.") + "</div>"; return; }
    $("condoLine").textContent = info.condo.name;
    if (!info.running) { main.innerHTML = '<div class="warnbox">' + esc(info.condo.name) + ": there is no sampling today. We hope to see you at our next visit!</div>"; return; }
    buildForm();
  }

  start();
})();
