require('dotenv').config();
const express = require('express');
const axios = require('axios');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const production = process.env.NODE_ENV === 'production';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
const FINDER_TOKEN_SECRET = process.env.FINDER_TOKEN_SECRET || crypto.randomBytes(32).toString('hex');

function finderTokenKey() {
  return crypto.createHash('sha256').update(FINDER_TOKEN_SECRET).digest();
}

function sealFinderPayload(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', finderTokenKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

function openFinderPayload(token) {
  if (typeof token !== 'string' || token.length < 40 || token.length > 12000) return null;
  try {
    const raw = Buffer.from(token, 'base64url');
    if (raw.length < 29) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', finderTokenKey(), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'));
  } catch {
    return null;
  }
}


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
const AMPREM_COOLDOWN_MS = 5 * 60 * 1000;
const ampremCooldown = new Map();

function ampremLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const lastRequest = ampremCooldown.get(key);
  if (lastRequest && now - lastRequest < AMPREM_COOLDOWN_MS) {
    const retryAfter = Math.ceil((AMPREM_COOLDOWN_MS - (now - lastRequest)) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Amprem sedang cooldown. Coba lagi dalam 5 menit.', retryAfter });
  }
  ampremCooldown.set(key, now);
  next();
}
app.use('/api', (req, res, next) => {
  if (req.path === '/finder' || req.path === '/finder/video') return next();
  return baseLimit(req, res, next);
});
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

function httpsMediaUrl(value) {
  if (typeof value !== 'string' || value.length > 8192) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.href : null;
  } catch { return null; }
}

function resolveVideoMediaUrl(video = {}, data = {}) {
  const directCandidates = [
    video.playUrlNoWm, video.playUrlNoWatermark, video.play_url_no_wm,
    video.playUrl, video.play_url, video.videoUrl, video.video_url,
    video.downloadUrl, video.download_url, data.videoStreamUrl,
    data.videoUrl, data.video_url
  ];
  for (const value of directCandidates) {
    const url = httpsMediaUrl(value);
    if (url && !validHttpsUrl(url)) return url;
  }
  const walk = value => {
    if (!value || typeof value !== 'object') return null;
    if (Array.isArray(value)) {
      for (const child of value) { const found = walk(child); if (found) return found; }
      return null;
    }
    for (const [key, child] of Object.entries(value)) {
      const lower = key.toLowerCase();
      if (typeof child === 'string' && /(play|video|download|media).*(url|src|link)?/.test(lower)) {
        const url = httpsMediaUrl(child);
        if (url && !validHttpsUrl(url)) return url;
      }
      if (child && typeof child === 'object') { const found = walk(child); if (found) return found; }
    }
    return null;
  };
  return walk(video) || walk(data.video) || null;
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

app.post('/api/finder', async (req, res) => {
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!validHttpsUrl(url)) return res.status(400).json({ error: 'Masukkan URL video TikTok HTTPS yang valid.' });

  try {
    // Provider is contacted server-side only. Its raw response is NEVER returned.
    const upstream = await axios.get(process.env.AM_FINDER_URL, {
      params: { url },
      timeout: 30000,
      maxRedirects: 0,
      headers: {
        Accept: 'text/event-stream, application/json, text/plain, */*',
        'User-Agent': 'AlightMotionHub/1.0'
      },
      responseType: 'text',
      maxContentLength: 2 * 1024 * 1024,
      validateStatus: s => s >= 200 && s < 300
    });

    const raw = String(upstream.data || '').trim();
    let data = null;

    try {
      data = JSON.parse(raw);
    } catch {
      const lines = raw.split(/\r?\n/);
      let event = '';
      for (const line of lines) {
        if (line.startsWith('event:')) {
          event = line.slice(6).trim();
        } else if (line.startsWith('data:') && (!event || event === 'result')) {
          try {
            const parsed = JSON.parse(line.slice(5).trim());
            if (parsed && typeof parsed === 'object') data = parsed;
          } catch {}
        }
      }
    }

    if (!data || typeof data !== 'object') {
      return res.status(502).json({ error: 'Format respons layanan finder tidak dikenali.' });
    }

    const video = data.video && typeof data.video === 'object' ? data.video : {};
    const author = data.authorDetail && typeof data.authorDetail === 'object'
      ? data.authorDetail
      : {};

    // Only expose preset links required by the UI.
    const presetLinks = [];
    const seen = new Set();

    if (Array.isArray(data.presetLinks)) {
      for (const item of data.presetLinks.slice(0, 12)) {
        if (!item || typeof item !== 'object' || typeof item.url !== 'string') continue;

        try {
          const u = new URL(item.url);
          if (u.protocol !== 'https:' || seen.has(u.href)) continue;
          seen.add(u.href);

          presetLinks.push({
            title: String(item.title || item.type || 'Preset').slice(0, 80),
            type: String(item.type || '').slice(0, 30),
            url: u.href,
            size: item.size ? String(item.size).slice(0, 30) : null,
            ratio: item.ratio ? String(item.ratio).slice(0, 20) : null,
            thumb: httpsMediaUrl(item.thumb)
          });
        } catch {}
      }
    }

    if (!presetLinks.length) {
      return res.status(404).json({ error: 'Preset tidak ditemukan pada video ini.' });
    }

    const videoUrlCandidate = video.url || data.videoUrl || url;
    const videoUrl = validHttpsUrl(videoUrlCandidate) ? videoUrlCandidate : url;

    const normalizedVideo = {
      id: video.id == null ? null : String(video.id).slice(0, 80),
      url: videoUrl,
      description: String(video.description || video.desc || data.caption || '').slice(0, 1200),
      stats: {
        views: video.stats?.views == null ? null : Number(video.stats.views),
        likes: video.stats?.likes == null ? null : Number(video.stats.likes),
        comments: video.stats?.comments == null ? null : Number(video.stats.comments),
        shares: video.stats?.shares == null ? null : Number(video.stats.shares)
      },
      // Poster only. MP4 URLs are intentionally excluded from this DTO.
      cover: httpsMediaUrl(video.cover || video.coverUrl || video.thumbnail),
      width: Number.isFinite(Number(video.width)) ? Number(video.width) : null,
      height: Number.isFinite(Number(video.height)) ? Number(video.height) : null
    };

    const safeAuthor = {
      uniqueId: String(author.uniqueId || data.author || '').slice(0, 100),
      nickname: String(author.nickname || '').slice(0, 120),
      avatar: httpsMediaUrl(author.avatar),
      bio: String(author.bio || '').slice(0, 500)
    };

    const safeAuthorName = String(
      data.author || author.uniqueId || 'Tidak diketahui'
    ).slice(0, 100);

    // Build the exact DTO needed by the UI, then seal it server-side.
    // The public /api/finder response only exposes status + an opaque token.
    const dto = {
      ok: true,
      found: Boolean(data.found ?? true),
      author: safeAuthorName,
      username: safeAuthorName,
      nickname: safeAuthor.nickname,
      authorDetail: safeAuthor,
      caption: normalizedVideo.description,
      videoUrl: normalizedVideo.url,
      sourceUrl: normalizedVideo.url,
      video: normalizedVideo,
      videoWidth: normalizedVideo.width,
      videoHeight: normalizedVideo.height,
      cover: normalizedVideo.cover,
      views: normalizedVideo.stats.views,
      likes: normalizedVideo.stats.likes,
      comments: normalizedVideo.stats.comments,
      shares: normalizedVideo.stats.shares,
      presetLinks
    };

    const token = sealFinderPayload({
      iat: Date.now(),
      exp: Date.now() + 5 * 60 * 1000,
      dto
    });

    return res.json({ ok: true, found: dto.found, token });
  } catch (err) {
    return res.status(502).json({ error: safeError(err) });
  }
});


/*
 * Resolve a previously sealed Finder result.
 * The browser sees only the opaque token on the initial Finder request;
 * provider data is never returned by /api/finder itself.
 */
app.post('/api/finder/result', (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  const sealed = openFinderPayload(token);
  if (!sealed || !sealed.dto || sealed.exp < Date.now()) {
    return res.status(410).json({ error: 'Hasil Finder sudah kedaluwarsa. Silakan cari ulang.' });
  }
  return res.json(sealed.dto);
});


/* Stream the provider's MP4 through our own origin so the browser never
   has to request an expiring provider URL directly. */
app.get('/api/finder/video', async (req, res) => {
  const url = typeof req.query?.url === 'string' ? req.query.url.trim() : '';
  if (!validHttpsUrl(url)) return res.status(400).json({ error: 'URL video TikTok tidak valid.' });
  try {
    const upstream = await axios.get(process.env.AM_FINDER_URL, {
      params: { url }, timeout: 30000, maxRedirects: 0,
      headers: { Accept: 'text/event-stream, application/json, text/plain, */*', 'User-Agent': 'AlightMotionHub/1.0' },
      responseType: 'text', maxContentLength: 2 * 1024 * 1024, validateStatus: s => s >= 200 && s < 300
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
    if (!data || typeof data !== 'object') return res.status(502).json({ error: 'Format respons video provider tidak dikenali.' });
    const video = data.video && typeof data.video === 'object' ? data.video : {};
    const mediaUrl = resolveVideoMediaUrl(video, data);
    if (!mediaUrl) return res.status(404).json({ error: 'URL MP4 video tidak tersedia dari provider.' });
    const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
    const media = await axios.get(mediaUrl, {
      responseType: 'stream', timeout: 30000, maxRedirects: 2,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36',
        'Accept': 'video/mp4,video/*;q=0.9,*/*;q=0.8',
        'Referer': 'https://www.tiktok.com/',
        ...(range ? { Range: range } : {})
      },
      validateStatus: s => (s >= 200 && s < 300) || s === 206
    });
    const contentType = String(media.headers['content-type'] || 'video/mp4').split(';')[0];
    res.status(media.status);
    res.setHeader('Content-Type', contentType === 'application/octet-stream' ? 'video/mp4' : contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    if (media.headers['content-length']) res.setHeader('Content-Length', media.headers['content-length']);
    if (media.headers['content-range']) res.setHeader('Content-Range', media.headers['content-range']);
    res.setHeader('Cache-Control', 'private, max-age=120');
    media.data.on('error', () => res.destroy());
    req.on('close', () => { if (!res.writableEnded) media.data.destroy(); });
    media.data.pipe(res);
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
