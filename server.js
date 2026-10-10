require('dotenv').config();
const express = require('express');
const axios = require('axios');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const production = process.env.NODE_ENV === 'production';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: production ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(express.json({ limit: '12kb', strict: true }));
app.use((req, res, next) => {
  res.setHeader('Cache-Control', req.path.startsWith('/api/') ? 'no-store' : 'public, max-age=300');
  const origin = req.get('origin');
  if (origin && allowedOrigins.length && !allowedOrigins.includes(origin)) return res.status(403).json({ error: 'Origin tidak diizinkan.' });
  if (origin && !allowedOrigins.length && production && !origin.startsWith('https://')) return res.status(403).json({ error: 'Gunakan koneksi HTTPS.' });
  next();
});

const baseLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.API_RATE_LIMIT || 30), standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Terlalu banyak request. Coba lagi beberapa saat.' } });
const ampremLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.AMPREM_RATE_LIMIT || 6), standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Batas Amprem tercapai. Coba lagi nanti.' } });
const finderLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.FINDER_RATE_LIMIT || 12), standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Batas pencarian tercapai. Coba lagi nanti.' } });
app.use('/api', baseLimit);
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], index: 'index.html' }));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function safeError(err) {
  const status = err.response?.status;
  if (status === 429) return 'Layanan sedang sibuk. Coba lagi beberapa saat.';
  if (status >= 400 && status < 500) return 'Permintaan ditolak oleh layanan. Periksa data lalu coba lagi.';
  return 'Layanan sementara tidak tersedia. Coba lagi nanti.';
}
function validHttpsUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vt.tiktok.com'].includes(u.hostname.toLowerCase());
  } catch { return false; }
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'Alight Motion Hub', status: 'online' }));

// Amprem V2 proxy: email and magic link are never written to logs or persisted.
app.post('/api/amprem/send-link', ampremLimit, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  if (!req.body?.consent) return res.status(400).json({ error: 'Konfirmasi bahwa email ini milik Anda diperlukan.' });
  if (email.length > 254 || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Format email tidak valid.' });
  try {
    const upstream = await axios.post(process.env.AMPREM_SEND_URL, { email }, {
      timeout: 15000, maxRedirects: 0,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'AlightMotionHub/1.0' }
    });
    if (!upstream.data?.success) return res.status(422).json({ error: 'Link verifikasi belum dapat dikirim. Periksa email atau coba nanti.' });
    return res.json({ ok: true, message: 'Jika email dapat diproses, link verifikasi akan dikirim. Periksa inbox dan folder spam.' });
  } catch (err) {
    return res.status(502).json({ error: safeError(err) });
  }
});

app.post('/api/amprem/verify-link', ampremLimit, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const magicLink = typeof req.body?.magicLink === 'string' ? req.body.magicLink.trim() : '';
  if (!req.body?.consent) return res.status(400).json({ error: 'Konfirmasi bahwa email dan link milik Anda diperlukan.' });
  if (email.length > 254 || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Format email tidak valid.' });
  if (!/^https:\/\//i.test(magicLink) || magicLink.length > 4096) return res.status(400).json({ error: 'Magic link harus berupa URL HTTPS yang valid.' });
  try {
    const upstream = await axios.post(process.env.AMPREM_VERIFY_URL, { email, magicLink }, {
      timeout: 15000, maxRedirects: 0,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'AlightMotionHub/1.0' }
    });
    if (!upstream.data?.success) return res.status(422).json({ error: 'Verifikasi gagal. Pastikan link masih berlaku dan sesuai dengan email.' });
    const d = upstream.data;
    // Return only expected, non-secret fields; never echo the submitted link.
    return res.json({ ok: true, message: String(d.message || 'Verifikasi selesai.'), uid: d.uid == null ? null : String(d.uid), planName: d.planName == null ? null : String(d.planName), validUntil: d.validUntil == null ? null : String(d.validUntil) });
  } catch (err) {
    return res.status(502).json({ error: safeError(err) });
  }
});

app.post('/api/finder', finderLimit, async (req, res) => {
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!validHttpsUrl(url)) return res.status(400).json({ error: 'Masukkan URL video TikTok HTTPS yang valid.' });
  try {
    const upstream = await axios.get(process.env.AM_FINDER_URL, {
      params: { url }, timeout: 30000, maxRedirects: 0,
      headers: { Accept: 'text/event-stream, application/json, text/plain, */*', 'User-Agent': 'AlightMotionHub/1.0' },
      responseType: 'text', maxContentLength: 2 * 1024 * 1024,
      validateStatus: s => s >= 200 && s < 300
    });
    const raw = String(upstream.data || '').trim();
    let data = null;
    try { data = JSON.parse(raw); } catch {
      const lines = raw.split(/\r?\n/); let event = '';
      for (const line of lines) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:') && (!event || event === 'result')) {
          try { const parsed = JSON.parse(line.slice(5).trim()); if (parsed && typeof parsed === 'object') data = parsed; } catch {}
        }
      }
    }
    if (!data || typeof data !== 'object') return res.status(502).json({ error: 'Format respons layanan finder tidak dikenali.' });
    const links = [];
    const seen = new Set();
    const walk = value => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) return value.forEach(walk);
      for (const [key, child] of Object.entries(value)) {
        if (child && typeof child === 'object') walk(child);
        else if (typeof child === 'string' && /^https:\/\//i.test(child) && /(preset|alight|\.xml(?:\?|$)|project|5mb)/i.test(`${key} ${child}`)) {
          try { const u = new URL(child); if (!seen.has(u.href)) { seen.add(u.href); links.push({ title: key.replace(/[_-]/g, ' ').slice(0, 80) || 'Preset', url: u.href }); } } catch {}
        }
      }
    };
    walk(data);
    // Prefer the provider's explicit presetLinks array and its labels.
    if (Array.isArray(data.presetLinks)) {
      for (const item of data.presetLinks) {
        if (!item?.url) continue;
        try { const u = new URL(item.url); if (u.protocol === 'https:' && !seen.has(u.href)) { seen.add(u.href); links.unshift({ title: String(item.title || item.type || 'Preset').slice(0, 80), type: String(item.type || '').slice(0, 30), url: u.href, size: item.size ? String(item.size).slice(0, 30) : null }); } } catch {}
      }
    }
    if (!links.length) return res.status(404).json({ error: 'Preset tidak ditemukan pada video ini.' });
    const video = data.video && typeof data.video === 'object' ? data.video : {};
    const author = data.authorDetail && typeof data.authorDetail === 'object' ? data.authorDetail : {};
    const httpsMediaUrl = value => {
      if (typeof value !== 'string' || value.length > 8192) return null;
      try { const parsed = new URL(value); return parsed.protocol === 'https:' ? parsed.href : null; } catch { return null; }
    };
    const videoUrl = validHttpsUrl(video.url || data.videoUrl || url) ? (video.url || data.videoUrl || url) : url;
    const normalizedVideo = {
      id: video.id == null ? null : String(video.id).slice(0, 80),
      url: videoUrl,
      description: String(video.description || video.desc || data.caption || '').slice(0, 1200),
      createTime: video.createTime ?? null,
      stats: {
        views: video.stats?.views ?? null,
        likes: video.stats?.likes ?? null,
        comments: video.stats?.comments ?? null,
        shares: video.stats?.shares ?? null
      },
      cover: httpsMediaUrl(video.cover || video.coverUrl || video.thumbnail),
      playUrl: httpsMediaUrl(video.playUrl || video.play_url),
      playUrlNoWm: httpsMediaUrl(video.playUrlNoWm || video.playUrlNoWatermark || video.play_url_no_wm),
      width: Number.isFinite(Number(video.width)) ? Number(video.width) : null,
      height: Number.isFinite(Number(video.height)) ? Number(video.height) : null
    };
    const normalizedLinks = (Array.isArray(data.presetLinks) ? data.presetLinks : []).slice(0, 12).map(item => ({
      title: String(item?.title || item?.type || 'Preset').slice(0, 80),
      type: String(item?.type || '').slice(0, 30),
      url: httpsMediaUrl(item?.url),
      size: item?.size ? String(item.size).slice(0, 30) : null,
      ratio: item?.ratio ? String(item.ratio).slice(0, 20) : null,
      thumb: httpsMediaUrl(item?.thumb)
    })).filter(item => item.url);
    return res.json({
      ok: true, found: Boolean(data.found ?? true),
      author: String(data.author || author.uniqueId || 'Tidak diketahui').slice(0, 100),
      username: String(data.author || author.uniqueId || 'Tidak diketahui').slice(0, 100),
      nickname: String(author.nickname || '').slice(0, 120),
      authorDetail: { uniqueId: String(author.uniqueId || data.author || '').slice(0, 100), nickname: String(author.nickname || '').slice(0, 120), avatar: httpsMediaUrl(author.avatar), bio: String(author.bio || '').slice(0, 500) },
      caption: normalizedVideo.description,
      videoUrl: normalizedVideo.url,
      sourceUrl: normalizedVideo.url,
      video: normalizedVideo,
      cover: normalizedVideo.cover,
      views: normalizedVideo.stats.views,
      likes: normalizedVideo.stats.likes,
      comments: normalizedVideo.stats.comments,
      shares: normalizedVideo.stats.shares,
      presetLinks: normalizedLinks,
      links: links.slice(0, 12)
    });
  } catch (err) {
    return res.status(502).json({ error: safeError(err) });
  }
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Endpoint tidak ditemukan.' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use((err, _req, res, _next) => {
  if (err instanceof SyntaxError) return res.status(400).json({ error: 'JSON request tidak valid.' });
  res.status(500).json({ error: 'Terjadi kesalahan internal.' });
});
app.listen(PORT, () => console.log(`Alight Motion Hub running on port ${PORT}`));
