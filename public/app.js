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

  finderForm.addEventListener('submit', async e => {
    e.preventDefault();
    finderResult.className = 'result-panel';
    finderResult.innerHTML = '';
    finderLoading.classList.add('show');
    $('#finderLoadingTitle').textContent = 'Menghubungi AM Finder…';
    finderSubmit.disabled = true;

    try {
      const data = await api('/api/finder', { url: $('#tiktokUrl').value.trim() });

      // backend lu pakai `ok`, fallback ke `found`
      if (!data.ok && !data.found) {
        throw new Error('Preset tidak ditemukan untuk video ini.');
      }

      // ── Heading
      const title = document.createElement('div');
      title.className = 'result-heading';
      title.innerHTML = '<span class="check">✓</span> Preset ditemukan';
      finderResult.append(title);

      // ── Video embed (pakai sourceUrl → /embed/)
      const videoUrl = data.sourceUrl || data.videoUrl || (data.video && data.video.url);
      if (videoUrl) {
        const videoWrap = document.createElement('div');
        videoWrap.className = 'tiktok-video';
        videoWrap.style.maxWidth = '320px';
        videoWrap.style.margin = '14px 0';

        const iframe = document.createElement('iframe');
        iframe.src = videoUrl.replace('/video/', '/embed/');
        iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
        iframe.allowFullscreen = true;
        iframe.loading = 'lazy';
        iframe.style.width = '100%';
        iframe.style.aspectRatio = '9/16';
        iframe.style.border = '0';
        iframe.style.display = 'block';

        videoWrap.append(iframe);
        finderResult.append(videoWrap);
      }

      // ── Author card
      const authorCard = document.createElement('div');
      authorCard.className = 'author-card';

      const uname = String(data.username || 'unknown').replace(/^@/, '');

      const avatar = document.createElement('div');
      avatar.className = 'author-avatar';
      avatar.textContent = uname.charAt(0).toUpperCase();

      const info = document.createElement('div');
      info.className = 'author-info';
      info.innerHTML = `
        <b>@${uname}</b>
        ${data.nickname && data.nickname !== data.username ? `<small>${data.nickname}</small>` : ''}
        ${data.caption ? `<p>${data.caption.replace(/\n/g, '<br>')}</p>` : ''}
      `;
      authorCard.append(avatar, info);
      finderResult.append(authorCard);

      // ── Stats (flat: views, likes)
      if (data.views != null || data.likes != null) {
        const stats = document.createElement('div');
        stats.className = 'video-stats';
        stats.style.marginTop = '10px';
        stats.innerHTML = `
          <span>👁 ${(data.views || 0).toLocaleString()}</span>
          <span>❤ ${(data.likes || 0).toLocaleString()}</span>
        `;
        finderResult.append(stats);
      }

      // ── Preset links (dari `links`, filter videoUrl)
      const presetLinks = (data.presetLinks || data.links || [])
        .filter(l => l && l.type !== 'videoUrl' && l.url);

      if (presetLinks.length) {
        const heading = document.createElement('div');
        heading.className = 'preset-subheading';
        heading.textContent = `Preset links (${presetLinks.length})`;
        finderResult.append(heading);

        const links = document.createElement('div');
        links.className = 'preset-links';

        presetLinks.forEach((item) => {
          const kind = String(item.type || '').toLowerCase();
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
          const meta = [item.size, item.ratio, item.verified ? '✓' : ''].filter(Boolean).join(' · ');
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