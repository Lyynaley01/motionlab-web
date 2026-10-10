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
    $('#sidebar').classList.remove('open');
    const ov2 = document.getElementById('sidebar-overlay');
    if (ov2) ov2.classList.remove('show');
    window.scrollTo({top:0,behavior:'smooth'});
  }

  document.addEventListener('click', e => {
    const target = e.target.closest('[data-page]');
    if (target) { e.preventDefault(); go(target.dataset.page); }
  });

  const overlay = document.getElementById('sidebar-overlay');
  function closeSidebar() {
    $('#sidebar').classList.remove('open');
    const ov2 = document.getElementById('sidebar-overlay');
    if (ov2) ov2.classList.remove('show');
    if (overlay) overlay.classList.remove('show');
  }
  function openSidebar() {
    $('#sidebar').classList.add('open');
    if (overlay) overlay.classList.add('show');
  }
  $('#mobileMenu').addEventListener('click', () => {
    if ($('#sidebar').classList.contains('open')) closeSidebar();
    else openSidebar();
  });
  if (overlay) overlay.addEventListener('click', closeSidebar);

  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  async function api(path, body) {
    const res = await fetch(path, {
      method:'POST',
      headers:{'Content-Type':'application/json','Accept':'application/json'},
      body: JSON.stringify(body),
      credentials:'same-origin'
    });
    let data;
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok) throw new Error(data.error || 'Permintaan gagal. Coba lagi.');
    return data;
  }

  fetch('/api/health').then(r=>r.json()).then(d=>{
    $('#healthText').textContent = d.ok ? 'Online · protected proxy' : 'Temporarily unavailable';
  }).catch(()=>{
    $('#healthText').textContent = 'Status unavailable';
  });

  /* ═══════════════════════════════════════════
     AM FINDER
     ═══════════════════════════════════════════ */

  const finderForm = $('#finderForm');
  const finderLoading = $('#finderLoading');
  const finderResult = $('#finderResult');
  const finderSubmit = $('#finderSubmit');

  $('#pasteBtn').addEventListener('click', async () => {
    try {
      $('#tiktokUrl').value = await navigator.clipboard.readText();
      $('#tiktokUrl').focus();
    } catch {
      toast('Clipboard tidak tersedia. Paste manual ya.');
    }
  });

  async function findPreset(tiktokUrl, onLog) {
    const endpoint = `https://amfinder.web.id/api/find?url=${encodeURIComponent(tiktokUrl)}`;
    const res = await fetch(endpoint, { headers: { 'Accept': 'text/event-stream' } });

    if (!res.ok) throw new Error('Gagal menghubungi AM Finder (HTTP ' + res.status + ')');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop();

      for (const chunk of chunks) {
        const lines = chunk.split('\n');
        let event = 'message';
        let data = '';

        for (const line of lines) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }

        if (!data) continue;
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }

        if (event === 'log') onLog?.(parsed);
        else if (event === 'result') result = parsed;
      }
    }

    if (!result) throw new Error('Server tidak mengirim hasil akhir.');
    return result;
  }

  finderForm.addEventListener('submit', async e => {
    e.preventDefault();
    finderResult.className = 'result-panel';
    finderResult.innerHTML = '';
    finderLoading.classList.add('show');
    $('#finderLoadingTitle').textContent = 'Menghubungi AM Finder…';
    finderSubmit.disabled = true;

    try {
      const data = await findPreset($('#tiktokUrl').value.trim(), (msg) => {
        if (typeof msg === 'string') {
          $('#finderLoadingTitle').textContent = msg;
        }
      });

      if (!data.found) {
        throw new Error('Preset tidak ditemukan untuk video ini.');
      }

      const title = document.createElement('div');
      title.className = 'result-heading';
      title.innerHTML = '<span class="check">✓</span> Preset ditemukan';
      finderResult.append(title);

      const v = data.video || {};
      const a = data.authorDetail || {};

      if (v.playUrl) {
        const videoWrap = document.createElement('div');
        videoWrap.className = 'tiktok-video';

        const video = document.createElement('video');
        video.src = v.playUrl;
        video.poster = v.cover || '';
        video.controls = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.width = v.width || 576;
        video.height = v.height || 1024;

        videoWrap.append(video);

        const s = v.stats || {};
        const stats = document.createElement('div');
        stats.className = 'video-stats';
        stats.innerHTML = `
          <span>👁 ${(s.views || 0).toLocaleString()}</span>
          <span>❤ ${(s.likes || 0).toLocaleString()}</span>
          <span>💬 ${(s.comments || 0).toLocaleString()}</span>
          <span>↗ ${(s.shares || 0).toLocaleString()}</span>
        `;
        videoWrap.append(stats);
        finderResult.append(videoWrap);
      }

      const authorCard = document.createElement('div');
      authorCard.className = 'author-card';

      const avatar = document.createElement('div');
      avatar.className = 'author-avatar';
      if (a.avatar) {
        const img = document.createElement('img');
        img.src = a.avatar;
        img.alt = a.uniqueId || 'avatar';
        img.loading = 'lazy';
        avatar.append(img);
      } else {
        avatar.textContent = (a.uniqueId || '?').charAt(0).toUpperCase();
      }

      const info = document.createElement('div');
      info.className = 'author-info';
      info.innerHTML = `
        <b>@${a.uniqueId || 'unknown'}</b>
        ${a.nickname ? `<small>${a.nickname}</small>` : ''}
        ${a.bio ? `<p>${a.bio.replace(/\n/g, '<br>')}</p>` : ''}
        ${a.bioLink ? `<p><a href="${a.bioLink}" target="_blank" rel="noopener noreferrer">🔗 ${a.bioLink}</a></p>` : ''}
      `;
      authorCard.append(avatar, info);
      finderResult.append(authorCard);

      if (v.description) {
        const cap = document.createElement('div');
        cap.className = 'result-meta';
        cap.style.marginTop = '10px';
        cap.textContent = v.description;
        finderResult.append(cap);
      }

      if (data.presetLinks && data.presetLinks.length) {
        const heading = document.createElement('div');
        heading.className = 'preset-subheading';
        heading.textContent = `Preset links (${data.presetLinks.length})`;
        finderResult.append(heading);

        const links = document.createElement('div');
        links.className = 'preset-links';

        data.presetLinks.forEach((item) => {
          const kind = (item.type || '').toLowerCase();
          const isXml = kind === 'xml';

          const link = document.createElement('a');
          link.className = 'preset-link';
          link.href = item.url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';

          const left = document.createElement('span');
          left.className = 'preset-left';

          const badge = document.createElement('em');
          badge.className = isXml ? 'badge badge-xml' : 'badge badge-5mb';
          badge.textContent = isXml ? 'XML' : '5MB';

          const label = document.createElement('span');
          label.className = 'preset-label';
          label.textContent = item.title || 'Preset';

          left.append(badge, label);

          const right = document.createElement('span');
          right.className = 'preset-right';
          const meta = [item.size, item.ratio, item.verified ? '✓' : '']
            .filter(Boolean).join(' · ');
          right.innerHTML = `<small>${meta}</small> ↗`;

          link.append(left, right);
          links.append(link);
        });

        finderResult.append(links);
      } else {
        const empty = document.createElement('div');
        empty.className = 'result-meta';
        empty.textContent = 'Tidak ada link preset yang ditemukan.';
        finderResult.append(empty);
      }

      finderResult.classList.add('show');
    } catch (err) {
      finderResult.className = 'result-panel show error';
      const h = document.createElement('div');
      h.className = 'result-heading';
      h.textContent = 'Gagal menemukan preset';
      const p = document.createElement('div');
      p.className = 'result-meta';
      p.textContent = err.message;
      finderResult.append(h, p);
    } finally {
      finderLoading.classList.remove('show');
      finderSubmit.disabled = false;
    }
  });

  /* ═══════════════════════════════════════════
     AMPREM V2
     ═══════════════════════════════════════════ */

  const emailForm = $('#emailForm');
  const magicForm = $('#magicForm');
  const ampremLoading = $('#ampremLoading');
  const ampremResult = $('#ampremResult');
  const ampremError = $('#ampremError');
  let emailValue = '';

  function ampError(message) {
    ampremError.textContent = message;
    ampremError.classList.add('show');
  }
  function resetAmpResult() {
    ampremResult.className = 'result-panel';
    ampremResult.innerHTML = '';
    ampremError.classList.remove('show');
    ampremError.textContent = '';
  }
  function setStep(n) {
    for (let i = 1; i <= 3; i++) {
      const el = $(`#step${i}`);
      el.classList.toggle('active', i === n);
      el.classList.toggle('done', i < n);
    }
  }

  emailForm.addEventListener('submit', async e => {
    e.preventDefault();
    resetAmpResult();
    emailValue = $('#email').value.trim();
    if (!$('#emailConsent').checked) {
      ampError('Konfirmasi kepemilikan email diperlukan.');
      return;
    }

    const btn = $('#sendLinkBtn');
    btn.disabled = true;
    ampremLoading.classList.add('show');
    $('#ampremLoadingTitle').textContent = 'Sending verification link…';

    try {
      const d = await api('/api/amprem/send-link', { email: emailValue, consent: true });
      emailForm.classList.add('hidden');
      magicForm.classList.remove('hidden');
      $('#ampremStepTitle').textContent = 'Paste your magic link';
      $('#ampremLoadingTitle').textContent = 'Processing securely…';
      setStep(2);

      ampremResult.className = 'result-panel show';
      const h = document.createElement('div');
      h.className = 'result-heading';
      h.textContent = '✓ Check your inbox';
      const p = document.createElement('div');
      p.className = 'result-meta';
      p.textContent = d.message || 'Cek inbox atau folder spam untuk link verifikasi.';
      ampremResult.append(h, p);
    } catch (err) {
      ampError(err.message);
    } finally {
      btn.disabled = false;
      ampremLoading.classList.remove('show');
    }
  });

  $('#backEmail').addEventListener('click', () => {
    magicForm.classList.add('hidden');
    emailForm.classList.remove('hidden');
    $('#ampremStepTitle').textContent = 'Start with your email';
    setStep(1);
    resetAmpResult();
  });

  magicForm.addEventListener('submit', async e => {
    e.preventDefault();
    resetAmpResult();
    const magicLink = $('#magicLink').value.trim();
    if (!$('#emailConsent').checked) {
      ampError('Konfirmasi kepemilikan email diperlukan.');
      return;
    }
    if (!/^https:\/\//i.test(magicLink)) {
      ampError('Magic link harus dimulai dengan https://');
      return;
    }

    const btn = $('#verifyBtn');
    btn.disabled = true;
    ampremLoading.classList.add('show');
    $('#ampremLoadingTitle').textContent = 'Verifying with provider…';

    try {
      const d = await api('/api/amprem/verify-link', { email: emailValue, magicLink, consent: true });
      setStep(3);
      $('#ampremStepTitle').textContent = 'Verification result';
      magicForm.classList.add('hidden');
      ampremResult.className = 'result-panel show';

      const h = document.createElement('div');
      h.className = 'result-heading';
      const check = document.createElement('span');
      check.className = 'check';
      check.textContent = '✓';
      h.append(check, document.createTextNode(' Provider response'));
      ampremResult.append(h);

      const meta = document.createElement('div');
      meta.className = 'result-meta';
      meta.textContent = d.message || 'Verifikasi selesai.';
      ampremResult.append(meta);

      const details = [['UID', d.uid], ['Plan', d.planName], ['Valid until', d.validUntil]].filter(x => x[1]);
      if (details.length) {
        const dl = document.createElement('div');
        dl.className = 'result-meta';
        dl.style.marginTop = '10px';
        dl.textContent = details.map(x => `${x[0]}: ${x[1]}`).join('\n');
        ampremResult.append(dl);
      }

      const restart = document.createElement('button');
      restart.className = 'btn btn-ghost';
      restart.style.marginTop = '14px';
      restart.textContent = 'Start a new session';
      restart.addEventListener('click', () => {
        magicForm.classList.add('hidden');
        emailForm.classList.remove('hidden');
        $('#email').value = '';
        $('#magicLink').value = '';
        $('#ampremStepTitle').textContent = 'Start with your email';
        setStep(1);
        resetAmpResult();
      });
      ampremResult.append(restart);
    } catch (err) {
      ampError(err.message);
    } finally {
      btn.disabled = false;
      ampremLoading.classList.remove('show');
    }
  });
})();