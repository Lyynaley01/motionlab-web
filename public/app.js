(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const names = {home:'Overview', explore:'Explore tools', finder:'AM Finder', activator:'Amprem V2', safety:'Security notes'};
  let currentPage = 'home';
  function go(page) {
    if (!names[page]) return;
    currentPage = page;
    $$('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
    $$('.nav-link').forEach(b => b.classList.toggle('active', b.dataset.page === page));
    $('#crumbName').textContent = names[page];
    $('#sidebar').classList.remove('open'); const ov = document.getElementById('sidebar-overlay'); if(ov) ov.classList.remove('show');
    window.scrollTo({top:0,behavior:'smooth'});
  }
  document.addEventListener('click', e => {
    const target = e.target.closest('[data-page]');
    if (target) { e.preventDefault(); go(target.dataset.page); }
  });
  $('#mobileMenu').addEventListener('click', () => { $('#sidebar').classList.toggle('open'); $('#sidebar-overlay').classList.toggle('show'); });
  $('#sidebar-overlay').addEventListener('click', () => { $('#sidebar').classList.remove('open'); const ov = document.getElementById('sidebar-overlay'); if(ov) ov.classList.remove('show'); $('#sidebar-overlay').classList.remove('show'); });
  function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2800); }
  async function api(path, body) {
    const res = await fetch(path, {method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(body),credentials:'same-origin'});
    let data; try { data = await res.json(); } catch { data = {}; }
    if (!res.ok) throw new Error(data.error || 'Permintaan gagal. Coba lagi.');
    return data;
  }
  fetch('/api/health').then(r=>r.json()).then(d=>{ $('#healthText').textContent = d.ok ? 'Online · protected proxy' : 'Temporarily unavailable'; }).catch(()=>{ $('#healthText').textContent='Status unavailable'; });

  const finderForm = $('#finderForm'), finderLoading = $('#finderLoading'), finderResult = $('#finderResult'), finderSubmit = $('#finderSubmit');
  $('#pasteBtn').addEventListener('click', async () => { try { $('#tiktokUrl').value = await navigator.clipboard.readText(); $('#tiktokUrl').focus(); } catch { toast('Clipboard tidak tersedia. Paste manual ya.'); } });
  finderForm.addEventListener('submit', async e => {
    e.preventDefault(); finderResult.className='result-panel'; finderResult.innerHTML=''; finderLoading.classList.add('show'); finderSubmit.disabled=true;
    try {
      const data = await api('/api/finder', {url:$('#tiktokUrl').value.trim()});
      const title = document.createElement('div'); title.className='result-heading'; title.innerHTML='<span class="check">✓</span> Preset results'; finderResult.append(title);
      const meta = document.createElement('div'); meta.className='result-meta'; meta.textContent = `Creator: @${data.username || 'Tidak diketahui'}${data.nickname ? ' · '+data.nickname : ''}${data.caption ? '\n'+data.caption : ''}`; finderResult.append(meta);
      const links = document.createElement('div'); links.className='preset-links';
      (data.links || []).forEach((item,i) => { const a=document.createElement('a'); a.className='preset-link'; a.href=item.url; a.target='_blank'; a.rel='noopener noreferrer'; const left=document.createElement('span'); left.textContent=(item.title || item.type || `Preset ${i+1}`)+(item.size ? ` · ${item.size}`:''); const right=document.createElement('span'); right.textContent='↗'; a.append(left,right); links.append(a); });
      finderResult.append(links); finderResult.classList.add('show');
    } catch(err) { finderResult.className='result-panel show error'; const h=document.createElement('div');h.className='result-heading';h.textContent='Could not find a preset';const p=document.createElement('div');p.className='result-meta';p.textContent=err.message;finderResult.append(h,p); }
    finally { finderLoading.classList.remove('show'); finderSubmit.disabled=false; }
  });

  const emailForm=$('#emailForm'), magicForm=$('#magicForm'), ampremLoading=$('#ampremLoading'), ampremResult=$('#ampremResult'), ampremError=$('#ampremError');
  let emailValue='';
  function ampError(message){ampremError.textContent=message;ampremError.classList.add('show');}
  function resetAmpResult(){ampremResult.className='result-panel';ampremResult.innerHTML='';ampremError.classList.remove('show');ampremError.textContent='';}
  function setStep(n){for(let i=1;i<=3;i++){const el=$(`#step${i}`);el.classList.toggle('active',i===n);el.classList.toggle('done',i<n);} }
  emailForm.addEventListener('submit', async e=>{
    e.preventDefault();resetAmpResult(); emailValue=$('#email').value.trim(); if(!$('#emailConsent').checked){ampError('Konfirmasi kepemilikan email diperlukan.');return;}
    const btn=$('#sendLinkBtn');btn.disabled=true;ampremLoading.classList.add('show');$('#ampremLoadingTitle').textContent='Sending verification link…';
    try{const d=await api('/api/amprem/send-link',{email:emailValue,consent:true});emailForm.classList.add('hidden');magicForm.classList.remove('hidden');$('#ampremStepTitle').textContent='Paste your magic link';$('#ampremLoadingTitle').textContent='Processing securely…';setStep(2);ampremResult.className='result-panel show';const h=document.createElement('div');h.className='result-heading';h.textContent='✓ Check your inbox';const p=document.createElement('div');p.className='result-meta';p.textContent=d.message||'Cek inbox atau folder spam untuk link verifikasi.';ampremResult.append(h,p);}
    catch(err){ampError(err.message);}finally{btn.disabled=false;ampremLoading.classList.remove('show');}
  });
  $('#backEmail').addEventListener('click',()=>{magicForm.classList.add('hidden');emailForm.classList.remove('hidden');$('#ampremStepTitle').textContent='Start with your email';setStep(1);resetAmpResult();});
  magicForm.addEventListener('submit',async e=>{
    e.preventDefault();resetAmpResult();const magicLink=$('#magicLink').value.trim();if(!$('#emailConsent').checked){ampError('Konfirmasi kepemilikan email diperlukan.');return;}if(!/^https:\/\//i.test(magicLink)){ampError('Magic link harus dimulai dengan https://');return;}
    const btn=$('#verifyBtn');btn.disabled=true;ampremLoading.classList.add('show');$('#ampremLoadingTitle').textContent='Verifying with provider…';
    try{const d=await api('/api/amprem/verify-link',{email:emailValue,magicLink,consent:true});setStep(3);$('#ampremStepTitle').textContent='Verification result';magicForm.classList.add('hidden');ampremResult.className='result-panel show';const h=document.createElement('div');h.className='result-heading';const check=document.createElement('span');check.className='check';check.textContent='✓';h.append(check,document.createTextNode(' Provider response'));ampremResult.append(h);const meta=document.createElement('div');meta.className='result-meta';meta.textContent=d.message||'Verifikasi selesai.';ampremResult.append(meta);const details=[['UID',d.uid],['Plan',d.planName],['Valid until',d.validUntil]].filter(x=>x[1]);if(details.length){const dl=document.createElement('div');dl.className='result-meta';dl.style.marginTop='10px';dl.textContent=details.map(x=>`${x[0]}: ${x[1]}`).join('\n');ampremResult.append(dl);}const restart=document.createElement('button');restart.className='btn btn-ghost';restart.style.marginTop='14px';restart.textContent='Start a new session';restart.addEventListener('click',()=>{magicForm.classList.add('hidden');emailForm.classList.remove('hidden');$('#email').value='';$('#magicLink').value='';$('#ampremStepTitle').textContent='Start with your email';setStep(1);resetAmpResult();});ampremResult.append(restart);}
    catch(err){ampError(err.message);}finally{btn.disabled=false;ampremLoading.classList.remove('show');}
  });
})();
