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

  function fmtNum(n) {
    if (n == null) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + ' M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + ' K';
    return String(n);
  }

  function truncUrl(url, max = 55) {
    try {
      const u = new URL(url);
      const s = u.hostname + u.pathname;
      return s.length > max ? s.slice(0, max) + '…' : s;
    } catch {
      return url.length > max ? url.slice(0, max) + '…' : url;
    }
  }

  finderForm.addEventListener('submit', async e => {
    e.preventDefault();
    finderResult.className = 'result-panel';
    finderResult.innerHTML = '';
    finderLoading.classList.add('show');
    $('#finderLoadingTitle').textContent = 'Menghubungi AM Finder…';
    finderSubmit.disabled = true;

    try {
      const data = await api('/api/finder', { url: $('#tiktokUrl').value.trim() });

      /* ── DEBUG: log the full proxy response so you can inspect field names ── */
      console.log('[AM Finder] raw response:', JSON.stringify(data, null, 2));

      if (!data.ok && !data.found && !data.presetLinks && !data.links) {
        throw new Error('Preset tidak ditemukan untuk video ini.');
      }

      /* ── Normalise nested objects ── */
      const video  = data.video  || data.videoInfo  || data.videoData || {};
      const author = data.authorDetail || data.authorInfo || data.author_detail || {};
      /* stats may live at video.stats, video.playCount/diggCount, or top-level */
      const stats  = video.stats || video.statistics || {
        views:    video.playCount    ?? video.play_count    ?? data.views    ?? null,
        likes:    video.diggCount    ?? video.digg_count    ?? data.likes    ?? null,
        comments: video.commentCount ?? video.comment_count ?? data.comments ?? null,
      };

      /* ── Video info section ──
         TikTok CDN URLs are CORS-blocked for direct embed/img.
         Show description + stats + an external link instead.             */
      const desc      = video.description || video.desc || data.caption || data.description || '';
      const videoLink = data.videoUrl || data.video_url || video.url || video.playUrl || data.url || '';

      /* only render section if there's something to show */
      if (desc || videoLink || stats.views != null || stats.likes != null) {
        const videoSection = document.createElement('div');
        videoSection.className = 'finder-video-section';

        const metaCard = document.createElement('div');
        metaCard.className = 'finder-video-meta';

        if (desc) {
          const descEl = document.createElement('div');
          descEl.className = 'finder-video-desc';
          descEl.textContent = desc.trim();
          metaCard.append(descEl);
        }

        if (videoLink) {
          const openLink = document.createElement('a');
          openLink.className = 'finder-video-link';
          openLink.href = videoLink;
          openLink.target = '_blank';
          openLink.rel = 'noopener noreferrer';
          openLink.innerHTML = '<span>▶</span> Tonton video di TikTok';
          metaCard.append(openLink);
        }

        videoSection.append(metaCard);

        if (stats.views != null || stats.likes != null) {
          const statsRow = document.createElement('div');
          statsRow.className = 'finder-stats-row';
          statsRow.innerHTML = `
            <span class="finder-stat"><span class="finder-stat-icon">👁</span>${fmtNum(stats.views)}</span>
            <span class="finder-stat"><span class="finder-stat-icon">❤</span>${fmtNum(stats.likes)}</span>
            ${stats.comments != null ? `<span class="finder-stat"><span class="finder-stat-icon">💬</span>${fmtNum(stats.comments)}</span>` : ''}
          `;
          videoSection.append(statsRow);
        }

        finderResult.append(videoSection);
      }

      /* ── Author card ── */
      const authorCard = document.createElement('div');
      authorCard.className = 'author-card';

      /* resolve username — try every field the proxy might use */
      const rawAuthor =
        (typeof data.author === 'string' ? data.author : '') ||
        data.username || data.user || data.creator ||
        author.uniqueId || author.unique_id || author.username ||
        (typeof data.author === 'object' && data.author ? data.author.uniqueId || data.author.username || '' : '') ||
        '';
      const uname = rawAuthor.replace(/^@/, '').trim() || 'unknown';

      const avatarEl = document.createElement('div');
      avatarEl.className = 'author-avatar';
      /* TikTok avatar URLs are also CORS-blocked — use initial fallback */
      avatarEl.textContent = uname.charAt(0).toUpperCase();

      const nickname = author.nickname || author.name || author.display_name || '';
      const infoEl = document.createElement('div');
      infoEl.className = 'author-info';
      infoEl.innerHTML = `
        <b>@${uname}</b>
        ${nickname ? `<small>${nickname}</small>` : ''}
      `;
      authorCard.append(avatarEl, infoEl);
      finderResult.append(authorCard);

      /* ── Preset links section ──
         The proxy may return: data.presetLinks, data.links, data.presets, data.data
         Filter out junk entries whose title is literally "url", "thumb", etc.
         Those are internal API artifacts injected by amfinder, not real presets. */
      const JUNK_TITLES = new Set(['url', 'thumb', 'thumbnail', 'cover', 'image']);
      const rawLinks = data.presetLinks || data.links || data.presets ||
                       (Array.isArray(data.data) ? data.data : []);
      const presetLinks = rawLinks.filter(l => {
        if (!l || !l.url) return false;
        const t = String(l.title || '').toLowerCase().trim();
        /* reject bare junk keys */
        if (JUNK_TITLES.has(t)) return false;
        /* reject items whose "url" field is actually a thumbnail CDN (not a preset link) */
        if (/\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(l.url)) return false;
        return true;
      });

      if (presetLinks.length) {
        /* heading row with count pill */
        const headRow = document.createElement('div');
        headRow.className = 'finder-preset-head';
        headRow.innerHTML = `
          <span class="finder-preset-line"></span>
          <span class="finder-preset-title">Preset links</span>
          <span class="finder-preset-count">${presetLinks.length}</span>
        `;
        finderResult.append(headRow);

        const cardList = document.createElement('div');
        cardList.className = 'finder-card-list';

        presetLinks.forEach(item => {
          const kind   = String(item.type || '').toLowerCase();
          const isXml  = kind === 'xml';
          const is5mb  = kind === '5mb';

          const card = document.createElement('div');
          card.className = 'finder-preset-card';

          /* ── left: thumbnail ── */
          const thumbEl = document.createElement('div');
          thumbEl.className = 'finder-preset-thumb';

          if (item.thumb || (item.thumbs && item.thumbs[0])) {
            const tImg = document.createElement('img');
            tImg.src = item.thumb || item.thumbs[0];
            tImg.alt = item.title || '';
            tImg.loading = 'lazy';
            tImg.onerror = () => {
              thumbEl.innerHTML = '';
              const ratioFallback = document.createElement('div');
              ratioFallback.className = 'finder-thumb-fallback';
              ratioFallback.textContent = item.ratio || kind.toUpperCase();
              thumbEl.append(ratioFallback);
            };
            thumbEl.append(tImg);
          } else {
            const fallback = document.createElement('div');
            fallback.className = 'finder-thumb-fallback';
            fallback.textContent = item.ratio || kind.toUpperCase();
            thumbEl.append(fallback);
          }
          card.append(thumbEl);

          /* ── right: body ── */
          const body = document.createElement('div');
          body.className = 'finder-preset-body';

          /* title row: name + badges */
          const titleRow = document.createElement('div');
          titleRow.className = 'finder-preset-title-row';

          const nameEl = document.createElement('span');
          nameEl.className = 'finder-preset-name';
          nameEl.textContent = item.title || 'Preset';
          titleRow.append(nameEl);

          const badgesEl = document.createElement('span');
          badgesEl.className = 'finder-preset-badges';
          const typeBadge = document.createElement('em');
          typeBadge.className = isXml ? 'badge badge-xml' : 'badge badge-5mb';
          typeBadge.textContent = isXml ? 'XML' : '5MB';
          badgesEl.append(typeBadge);
          if (item.size) {
            const sizeBadge = document.createElement('em');
            sizeBadge.className = 'badge badge-size';
            sizeBadge.textContent = item.size;
            badgesEl.append(sizeBadge);
          }
          titleRow.append(badgesEl);
          body.append(titleRow);

          /* source (@detail) */
          if (item.detail) {
            const sourceEl = document.createElement('div');
            sourceEl.className = 'finder-preset-source';
            sourceEl.textContent = item.detail.startsWith('@') ? item.detail : `@${item.detail}`;
            body.append(sourceEl);
          }

          /* url display */
          const urlEl = document.createElement('div');
          urlEl.className = 'finder-preset-url';
          urlEl.textContent = truncUrl(item.url);
          body.append(urlEl);

          /* action buttons */
          const btnRow = document.createElement('div');
          btnRow.className = 'finder-preset-btns';

          const openBtn = document.createElement('a');
          openBtn.className = isXml ? 'finder-btn finder-btn-file' : 'finder-btn finder-btn-open';
          openBtn.href = item.url;
          openBtn.target = '_blank';
          openBtn.rel = 'noopener noreferrer';
          openBtn.innerHTML = isXml
            ? '<span class="finder-btn-icon">⬇</span> Get file'
            : '<span class="finder-btn-icon">↗</span> Buka';
          btnRow.append(openBtn);

          const copyBtn = document.createElement('button');
          copyBtn.className = 'finder-btn finder-btn-copy';
          copyBtn.type = 'button';
          copyBtn.innerHTML = '<span class="finder-btn-icon">⧉</span> Salin';
          copyBtn.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(item.url);
              copyBtn.textContent = '✓ Disalin';
              setTimeout(() => { copyBtn.innerHTML = '<span class="finder-btn-icon">⧉</span> Salin'; }, 1800);
            } catch {
              toast('Gagal menyalin link.');
            }
          });
          btnRow.append(copyBtn);
          body.append(btnRow);

          card.append(body);
          cardList.append(card);
        });

        finderResult.append(cardList);
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
