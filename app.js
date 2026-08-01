// ============================================================================
//  EAPEX — perakitan aplikasi Express
// ============================================================================
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const auth = require('./lib/auth');
const util = require('./lib/util');
const K = require('./lib/konstanta');
const notif = require('./lib/notifikasi');
const P = require('./lib/pengajuan');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', process.env.DI_BELAKANG_PROXY ? 1 : false);
app.disable('x-powered-by');

// --------------------------------------------------------------- keamanan dasar
// script-src dibiarkan ketat ('self') karena seluruh JavaScript aplikasi ada di
// berkas /js/app.js — tidak ada <script> sebaris. style-src mengizinkan inline
// hanya untuk lebar bilah grafik yang dihitung di server.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'same-origin' },
}));
app.use(compression());
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
// maxAge 0 + ETag: peramban tetap hemat (balasan 304 Not Modified) tetapi TIDAK
// pernah memakai CSS/JS lama setelah aplikasi diperbarui — penyebab bug yang
// sangat membingungkan karena "kodenya sudah benar tapi layarnya tidak berubah".
app.use('/css', express.static(path.join(__dirname, 'public/css'), { maxAge: 0 }));
app.use('/js', express.static(path.join(__dirname, 'public/js'), { maxAge: 0 }));
app.use('/gambar', express.static(path.join(__dirname, 'public/gambar'), { maxAge: 0 }));

// --------------------------------------------------------------- cap versi aset
// CSS & JS dipanggil dengan cap versi dari isi berkasnya, mis. /css/app.css?v=8f2a1c.
// Begitu berkasnya diubah, alamatnya ikut berubah — sehingga peramban DAN service
// worker pasti mengambil yang baru. Tanpa ini pernah terjadi: tampilan sudah diganti
// di server tetapi layar tetap menampilkan gaya lama karena service worker
// menyimpan salinan alamat yang sama.
function capBerkas(relatif) {
  try {
    const isi = require('fs').readFileSync(path.join(__dirname, 'public', relatif));
    return '?v=' + require('crypto').createHash('sha1').update(isi).digest('hex').slice(0, 8);
  } catch (e) {
    return '';
  }
}
const CAP_ASET = { css: capBerkas('css/app.css'), js: capBerkas('js/app.js') };
const MAKS_LAMPIRAN_MB = require('./lib/unggah').maksMB;

// --------------------------------------------------------------- berkas PWA
// Service worker HARUS disajikan dari akar alamat, kalau tidak cakupannya
// terbatas pada subfolder dan halaman lain tidak ikut terkendali.
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});
app.get('/manifest.webmanifest', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.sendFile(path.join(__dirname, 'public', 'manifest.webmanifest'));
});
app.get('/luring', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.render('luring', { judul: 'Tidak ada jaringan', capAset: CAP_ASET });
});

// --------------------------------------------------------------- sesi
const rahasia = process.env.SESSION_SECRET;
if (!rahasia && process.env.NODE_ENV === 'production') {
  throw new Error('SESSION_SECRET wajib diisi di produksi (lihat .env.example)');
}
// Sesi berakhir setelah 60 MENIT TANPA AKTIVITAS. Karena `rolling: true`, masa
// berlaku cookie disetel ulang pada setiap permintaan — jadi yang dihitung memang
// diamnya, bukan lama masuknya. Orang yang bekerja terus tidak akan terlempar
// keluar di tengah mengisi formulir.
//
// Kenapa perlu: aplikasi ini dibuka di komputer kasir dan komputer bersama di
// cabang. Layar yang ditinggal tanpa keluar berarti siapa pun yang lewat bisa
// menyetujui dokumen atas nama orang itu.
const SESI_MENIT = Number(process.env.SESI_MENIT) > 0 ? Number(process.env.SESI_MENIT) : 60;

app.use(session({
  name: 'eapex.sid',
  secret: rahasia || 'rahasia-pengembangan-lokal-jangan-dipakai-di-produksi',
  store: auth.buatPenyimpanSesi(session),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: !!process.env.DI_BELAKANG_PROXY,
    maxAge: SESI_MENIT * 60 * 1000,
  },
}));

// --------------------------------------------------------------- pembantu tampilan
app.use((req, res, next) => {
  res.locals.rp = util.rp;
  res.locals.angka = util.angka;
  res.locals.tglIndo = util.tglIndo;
  res.locals.tglSingkat = util.tglSingkat;
  res.locals.jamIndo = util.jamIndo;
  res.locals.selisihHari = util.selisihHari;
  res.locals.terbilangRupiah = util.terbilangRupiah;
  res.locals.terbilangAngkaKecil = util.terbilangAngka;
  res.locals.labelStatus = K.labelStatus;
  res.locals.warnaStatus = K.warnaStatus;
  res.locals.labelPeran = K.labelPeran;
  res.locals.WILAYAH = K.WILAYAH;
  res.locals.BENTUK = K.BENTUK;
  res.locals.PERAN = K.PERAN;
  res.locals.STATUS = K.STATUS;
  res.locals.TUJUAN_CAPEX = K.TUJUAN_CAPEX;
  res.locals.KATEGORI_ASET = K.KATEGORI_ASET;
  res.locals.ikonGrup = K.ikonGrup;
  res.locals.ringkasProgres = P.ringkasProgres;
  res.locals.capAset = CAP_ASET;
  res.locals.maksLampiranMB = MAKS_LAMPIRAN_MB;
  res.locals.sesiMenit = SESI_MENIT;
  res.locals.judul = 'EAPEX';
  res.locals.menuAktif = '';
  res.locals.jumlahInbox = 0;
  res.locals.jumlahNotif = 0;
  res.locals.pesanSukses = null;
  res.locals.pesanGalat = null;
  res.locals.pengaturan = {};
  next();
});

// Pemicu pengingat harian untuk hosting tanpa server tetap (Vercel Cron dan
// sejenisnya), yang tidak punya proses hidup untuk menjalankan penjadwal sendiri.
//
// Dilindungi rahasia. Tanpa rahasia itu tersetel, rute ini MATI — bukan terbuka:
// alamat yang bisa dipanggil siapa saja bisa dipakai membanjiri seluruh penyetuju
// dengan pesan, atau memancing biaya kirim email.
//
// GET ikut diterima karena penjadwal Vercel memanggil dengan GET; POST tetap ada
// supaya bisa dipicu manual dari baris perintah.
app.all('/api/pengingat', async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ ok: false, pesan: 'Metode tidak didukung' });
  }
  // CRON_SECRET adalah nama yang dipakai penjadwal Vercel; PENGINGAT_SECRET
  // untuk pemicu lain (cron di VPS, layanan pemantau).
  const rahasia = process.env.PENGINGAT_SECRET || process.env.CRON_SECRET || '';
  if (!rahasia) return res.status(503).json({ ok: false, pesan: 'Pemicu pengingat belum dinyalakan' });

  const dikirim = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '')
    || req.get('x-pengingat-secret') || '';
  if (!util.samaAman(dikirim, rahasia)) {
    return res.status(401).json({ ok: false, pesan: 'Tidak berwenang' });
  }
  try {
    const hasil = await require('./lib/pengingat').jalankan();
    res.json({ ok: true, ...hasil });
  } catch (e) {
    console.error('[api/pengingat]', e);
    res.status(500).json({ ok: false, pesan: 'Pengingat gagal dijalankan' });
  }
});

app.use(auth.muatPengguna);
app.use(auth.csrf);
app.use(auth.wajibLogin);

// Pesan kilat sederhana (satu kali tampil) lewat sesi.
app.use((req, res, next) => {
  if (req.session && req.session.kilat) {
    res.locals.pesanSukses = req.session.kilat.sukses || null;
    res.locals.pesanGalat = req.session.kilat.galat || null;
    delete req.session.kilat;
  }
  res.kilat = (jenis, pesan) => {
    if (req.session) req.session.kilat = { [jenis]: pesan };
  };
  next();
});

// Angka lencana di kepala halaman + identitas perusahaan (untuk kop cetakan).
const db = require('./lib/db');
app.use(async (req, res, next) => {
  if (!req.pengguna || req.path.startsWith('/api/')) return next();
  try {
    res.locals.jumlahInbox = await P.jumlahKotakMasuk(req.pengguna.id);
    res.locals.jumlahNotif = await notif.jumlahBelumDibaca(req.pengguna.id);
    const baris = await db.all('SELECT kunci, nilai FROM pengaturan');
    res.locals.pengaturan = Object.fromEntries(baris.map(b => [b.kunci, b.nilai]));
  } catch (e) { /* lencana bukan hal kritis; jangan sampai menggagalkan halaman */ }
  next();
});

// --------------------------------------------------------------- rute
const BATAS_LOGIN_NORMAL = 20;

// Gerbang mutu menempuh puluhan login dari satu alamat dalam hitungan detik, jadi
// batasnya perlu dilonggarkan saat pengujian. Kelonggaran itu menuntut DUA syarat
// sekaligus, dan `NODE_ENV=test` bukan sesuatu yang tersetel tanpa sengaja di
// produksi. Di luar itu batasnya tetap 20 — tidak ada jalan lain menaikkannya.
const batasLoginTerpakai = (process.env.NODE_ENV === 'test' && process.env.BATAS_LOGIN_UJI)
  ? Number(process.env.BATAS_LOGIN_UJI) || BATAS_LOGIN_NORMAL
  : BATAS_LOGIN_NORMAL;

const batasLogin = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: batasLoginTerpakai,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Terlalu banyak percobaan login. Coba lagi beberapa menit.',
});

app.get('/api/health', async (req, res) => {
  try {
    await db.nilai('SELECT 1 AS a');
    res.json({ ok: true, db: db.jenis, waktu: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, pesan: 'Basis data tidak dapat dihubungi' });
  }
});

app.use('/', require('./routes/auth')(batasLogin));
app.use('/', require('./routes/dasbor'));
app.use('/pengajuan', require('./routes/pengajuan'));
app.use('/admin', require('./routes/admin'));

// --------------------------------------------------------------- 404 & galat
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, pesan: 'Tidak ditemukan' });
  res.status(404).render('galat', { judul: 'Halaman tidak ditemukan', pesan: 'Alamat ' + req.path + ' tidak ada.' });
});

app.use((err, req, res, next) => {
  const kode = err.kode || err.status || 500;
  // Galat teknis TIDAK dikirim ke layar pengguna; hanya pesan yang memang ditandai publik.
  const pesan = err.publik ? err.message : 'Terjadi kesalahan pada server. Coba lagi atau hubungi Administrator.';
  if (!err.publik) console.error('[galat]', req.method, req.originalUrl, '\n', err);
  if (req.path.startsWith('/api/')) return res.status(kode).json({ ok: false, pesan });
  res.status(kode).render('galat', { judul: 'Terjadi kesalahan', pesan });
});

module.exports = app;
