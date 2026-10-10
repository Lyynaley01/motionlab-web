# MotionLab — Alight Motion Hub

Web app dengan halaman terpisah untuk Overview, Explore, AM Finder, Amprem V2, dan Security Notes. Backend Express mem-proxy request ke provider yang dirujuk di `index.js` yang kamu berikan.

## Fitur
- UI responsive, sidebar navigasi, animasi ringan, status backend, dan hasil pencarian yang dibuat sebagai DOM text (bukan HTML provider).
- AM Finder: input URL TikTok, validasi hostname, hasil link preset dari `https://amfinder.web.id/api/find`.
- Amprem V2: alur email → magic link → hasil provider dari endpoint Satriam yang ada pada source.
- Backend proxy: endpoint provider tidak dipanggil langsung dari browser; rate limiting, Helmet security headers, body-size limit, validasi input, timeout, no-store untuk API, dan respons error yang tidak membocorkan detail upstream.
- Tidak ada credential API yang ditanam di frontend. Tidak ada database dan email/magic link tidak disimpan aplikasi.

## Menjalankan lokal
1. Install Node.js 18 atau lebih baru.
2. Salin `.env.example` menjadi `.env`.
3. Jalankan `npm install`.
4. Jalankan `npm start`.
5. Buka `http://localhost:3000`.

## Deploy
- Deploy di platform Node.js (misalnya VPS/container/managed Node host).
- Aktifkan HTTPS di reverse proxy/platform.
- Set `NODE_ENV=production` dan `ALLOWED_ORIGINS=https://domain-kamu.example`.
- Jangan commit `.env`. Batasi akses server dan pantau penggunaan endpoint.
- Jalankan `npm audit` secara berkala dan update dependency.

## Endpoint backend
- `GET /api/health`
- `POST /api/finder` body `{ "url": "https://www.tiktok.com/..." }`
- `POST /api/amprem/send-link` body `{ "email": "...", "consent": true }`
- `POST /api/amprem/verify-link` body `{ "email": "...", "magicLink": "https://...", "consent": true }`

## Catatan keamanan penting
- Proxy menyembunyikan konfigurasi dan URL upstream dari source browser, tetapi endpoint backend milik kita tetap terlihat di tab Network. Ini normal; keamanan harus bertumpu pada validasi, rate limit, autentikasi bila diperlukan, serta pembatasan di server.
- Karena provider AM Finder dan Amprem tidak menyediakan API key dari source yang diberikan, proxy tidak dapat mencegah orang mengakses provider tersebut secara langsung jika provider-nya memang publik. Hub ini hanya mengontrol akses ke endpoint milik aplikasi.
- Untuk web publik/berbayar, tambahkan login server-side dan kuota per akun, serta simpan state rate-limit di Redis atau storage bersama bila server multi-instance.
- Amprem V2 memproses email dan magic link yang dikirim ke provider. Gunakan hanya untuk akun yang kamu miliki atau berwenang mengelola. Jangan masukkan password atau magic link milik orang lain.
- Status aktivasi, plan, dan masa berlaku sepenuhnya tergantung provider; project ini tidak menjamin hasil tertentu dan bukan produk resmi Alight Motion/TikTok.
