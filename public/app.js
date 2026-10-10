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

// ── Parse SSE stream dari /api/find ──
async function findPreset(tiktokUrl, onLog) {
  const res = await fetch(
    `https://amfinder.web.id/api/find?url=${encodeURIComponent(tiktokUrl)}`,
    { headers: { 'Accept': 'text/event-stream' } }
  );

  if (!res.ok) throw new Error('Gagal menghubungi AM Finder (' + res.status + ')');

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

      if (event === 'log') {
        onLog?.(parsed);
      } else if (event === 'result') {
        result = parsed;
      }
    }
  }

  if (!result) throw new Error('Server tidak mengirim hasil akhir.');
  return result;
}

finderForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  finderResult.className = 'result-panel';
  finderResult.innerHTML = '';
  finderLoading.classList.add('show');
  $('#finderLoadingTitle').textContent = 'Menghubungi AM Finder…';
  finderSubmit.disabled = true;

  try {
    const data = await findPreset($('#tiktokUrl').value.trim(), (msg) => {
      // tampilkan log realtime
      if (typeof msg === 'string') {
        $('#finderLoadingTitle').textContent = msg;
      }
    });

    if (!data.found) {
      throw new Error('Preset tidak ditemukan untuk video ini.');
    }

    // ── Heading
    const title = document.createElement('div');
    title.className = 'result-heading';
    title.innerHTML = '<span class="check">✓</span> Preset ditemukan';
    finderResult.append(title);

    // ── Video player (pakai playUrl mp4)
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

      const stats = document.createElement('div');
      stats.className = 'video-stats';
      const s = v.stats || {};
      stats.innerHTML = `
        <span>👁 ${(s.views || 0).toLocaleString()}</span>
        <span>❤ ${(s.likes || 0).toLocaleString()}</span>
        <span>💬 ${(s.comments || 0).toLocaleString()}</span>
        <span>↗ ${(s.shares || 0).toLocaleString()}</span>
      `;
      videoWrap.append(stats);
      finderResult.append(videoWrap);
    }

    // ── Author card
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

    // ── Caption video
    if (v.description) {
      const cap = document.createElement('div');
      cap.className = 'result-meta';
      cap.style.marginTop = '10px';
      cap.textContent = v.description;
      finderResult.append(cap);
    }

    // ── Preset links
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
        label.textContent = item.title || `Preset`;

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