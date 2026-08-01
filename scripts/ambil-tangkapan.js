#!/usr/bin/env node
// ============================================================================
//  Mengambil tangkapan layar untuk tutorial - otomatis, dari data CONTOH
// ============================================================================
//  Tutorial ini dibagikan ke 27 orang. Tangkapan layarnya karena itu TIDAK
//  BOLEH memuat data sungguhan - nama vendor, nominal, atau nama orang. Skrip
//  ini membuat basis data contoh sesaat di folder sementara, mengisinya dengan
//  pengajuan karangan, memotret layarnya, lalu membuangnya.
//
//  Data asli (data/eapex.db maupun Supabase) tidak pernah disentuh.
//
//  Cara masuknya memakai pola yang sama dengan scripts/cek.js: basis data
//  contoh dibuat sendiri dan seluruh akunnya diberi sandi contoh yang sama.
//  Tidak ada sandi sungguhan yang dipakai di mana pun.
//
//  Jalankan:  node scripts/ambil-tangkapan.js
//  Hasil   :  docs/tangkapan/*.png
// ============================================================================

const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

// --- basis data contoh: DIPASANG SEBELUM apa pun me-require lib/db ----------
const DB_CONTOH = path.join(os.tmpdir(), 'eapex-tangkapan-' + process.pid + '.db');
process.env.SQLITE_PATH = DB_CONTOH;
process.env.SESSION_SECRET = 'tangkapan-layar-' + 'x'.repeat(30);
process.env.BATAS_LOGIN_UJI = '9999';
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;          // jangan pernah menyentuh Supabase

const PORT_APP = Number(process.env.PORT_TANGKAPAN) || 4712;
const PORT_PROXY = PORT_APP + 1;
const SANDI = 'ContohEapex123';
const DIR = path.join(__dirname, '..', 'docs', 'tangkapan');
const PROFIL = path.join(os.tmpdir(), 'eapex-chrome-' + process.pid);

const app = require('../app');
const db = require('../lib/db');
const { siapkan } = require('../lib/skema');
const bcrypt = require('bcryptjs');

// --------------------------------------------------------------- daftar foto
// nama berkas -> alamat halaman. Awalan track ditambahkan saat menyimpan.
const HALAMAN = {
  'dasbor': '/',
  'pilih-kategori': '/pengajuan/baru',
  'lampiran': '/pengajuan/baru/CAPEX',
  'form': '/pengajuan/baru/CAPEX',
  'cuti': '/cuti',
  'approval': '/approval',
  'ganti-sandi': '/ganti-sandi',
};

const AKUN = {
  cabang: { email: 'sm.smg@kla.co.id', formulir: '/pengajuan/baru/CAPEX' },
  backoffice: { email: 'staf.acc@kla.co.id', formulir: '/pengajuan/baru/CAPEX' },
};

// ------------------------------------------------------------------ bantuan
function cariChrome() {
  return [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean).find(p => fs.existsSync(p)) || null;
}

function ambil(url, opsi = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(url, opsi, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, teks: d }));
    });
    r.on('error', reject);
    if (opsi.body) r.write(opsi.body);
    r.end();
  });
}

// Masuk lewat HTTP biasa, mengembalikan nilai cookie sesi.
async function masuk(email) {
  const base = `http://127.0.0.1:${PORT_APP}`;
  const r1 = await ambil(base + '/login');
  const kue0 = (r1.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const tok = (/name="_csrf" value="([^"]+)"/.exec(r1.teks) || [])[1];
  if (!tok) throw new Error('token CSRF tidak ditemukan di halaman masuk');

  const body = new URLSearchParams({ _csrf: tok, tujuan: '/', email, sandi: SANDI }).toString();
  const r2 = await ambil(base + '/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'content-length': Buffer.byteLength(body),
      cookie: kue0,
    },
    body,
  });
  if (r2.status !== 302) throw new Error(`masuk sebagai ${email} gagal (status ${r2.status})`);
  const kue = (r2.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ') || kue0;
  return kue;
}

// Proxy kecil yang menyisipkan cookie sesi, supaya Chrome tidak perlu tahu
// apa-apa soal masuk - ia cukup membuka alamat biasa.
function buatProxy(kue) {
  return http.createServer((req, res) => {
    const p = http.request({
      host: '127.0.0.1', port: PORT_APP, path: req.url, method: req.method,
      headers: { ...req.headers, cookie: kue, host: `127.0.0.1:${PORT_APP}` },
    }, jawab => {
      res.writeHead(jawab.statusCode, jawab.headers);
      jawab.pipe(res);
    });
    p.on('error', () => { res.statusCode = 502; res.end('proxy gagal'); });
    req.pipe(p);
  });
}

// HARUS asinkron. Server yang dipotret hidup di dalam proses Node ini juga;
// memanggil Chrome secara sinkron memblokir event loop, sehingga server tidak
// bisa menjawab permintaan Chrome dan keduanya saling menunggu sampai habis
// waktu. Pesannya cuma 'ETIMEDOUT' pada chrome.exe - menunjuk ke tempat yang salah.
//
// Dua bendera lain yang juga wajib:
//   --headless=new    mode lama ('--headless' polos) tidak pernah selesai
//   --user-data-dir   tanpa profil sendiri, Chrome menyerahkan tugasnya ke
//                     jendela Chrome yang sedang terbuka lalu menunggu selamanya
function potret(chrome, url, keluar, tinggi) {
  return new Promise((selesai, gagal) => {
    const anak = spawn(chrome, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      `--user-data-dir=${PROFIL}`,
      `--window-size=1440,${tinggi || 950}`,
      `--screenshot=${keluar}`, '--virtual-time-budget=4000', url,
    ], { stdio: 'ignore' });

    const jam = setTimeout(() => { anak.kill(); gagal(new Error('Chrome kehabisan waktu')); }, 90000);
    anak.on('error', e => { clearTimeout(jam); gagal(e); });
    anak.on('exit', () => {
      clearTimeout(jam);
      if (fs.existsSync(keluar)) selesai();
      else gagal(new Error('Chrome selesai tanpa menghasilkan gambar'));
    });
  });
}

// ------------------------------------------------------------- data contoh
async function isiContoh() {
  await siapkan({ senyap: true });

  const hash = bcrypt.hashSync(SANDI, 10);
  await db.run('UPDATE pengguna SET sandi_hash = ?, wajib_ganti_sandi = 0', [hash]);

  // Beberapa pengajuan karangan supaya dasbor, daftar, dan kotak approval tidak
  // kosong melompong. Nominal dan vendor sengaja jelas-jelas contoh.
  const alur = require('../lib/alur');
  const { id } = require('../lib/auth');
  const sm = await db.get("SELECT * FROM pengguna WHERE email = 'sm.smg@kla.co.id'");
  const bo = await db.get("SELECT * FROM pengguna WHERE email = 'staf.acc@kla.co.id'");

  const contoh = [
    { u: sm, kat: 'CAPEX', judul: 'Penggantian AC ruang pamer (contoh)',
      item: { nama: 'AC Split 2 PK', qty: 2, harga: 6500000 } },
    { u: sm, kat: 'PERLENGKAPAN', judul: 'Perlengkapan kasir (contoh)',
      item: { nama: 'Kursi kasir', qty: 3, harga: 850000 } },
    { u: bo, kat: 'CAPEX', judul: 'Pengadaan laptop staf (contoh)',
      item: { nama: 'Laptop kerja', qty: 1, harga: 11000000 } },
  ];

  const dibuat = {};
  for (const c of contoh) {
    try {
      const kat = await db.get('SELECT * FROM kategori WHERE kode = ?', [c.kat]);
      if (!kat) continue;
      const wilayah = c.u.cabang_id === (await db.nilai("SELECT id FROM cabang WHERE kode = 'HO'"))
        ? 'back_office' : 'store';
      const aturan = await db.get(
        'SELECT * FROM aturan WHERE kategori_id = ? AND wilayah = ? AND aktif = 1 LIMIT 1',
        [kat.id, wilayah]);
      if (!aturan) continue;

      const pid = id();
      const total = c.item.qty * c.item.harga;
      const waktu = new Date().toISOString();
      const data = {
        // 'tujuan' adalah DAFTAR kode (formulirnya berupa centang berganda),
        // bukan teks bebas - kalau diisi teks, halaman rinciannya gagal dimuat.
        nama_proyek: c.judul, tujuan: ['penggantian', 'efisiensi'],
        kategori_aset: 'Inventaris', deskripsi: c.item.nama,
        lokasi: 'Ruang contoh', vendor: 'PT Vendor Contoh',
        jadwal_kebutuhan: 'Bulan depan', jalur_pengadaan: 'Pembelian langsung',
        periode: 'Bulan berjalan',
        penjelasan: 'Isi ini hanya contoh untuk keperluan panduan pemakaian.',
        justifikasi: 'Isi ini hanya contoh untuk keperluan panduan pemakaian.',
      };

      await db.run(
        `INSERT INTO pengajuan (id, nomor, kategori_id, aturan_id, wilayah, pemohon_id, cabang_id,
           departemen_id, judul, keterangan, status_anggaran, total, status, langkah_kini,
           data_json, dibuat, diperbarui)
         VALUES (?,NULL,?,?,?,?,?,?,?,NULL,NULL,?, 'draft', 0, ?, ?, ?)`,
        [pid, kat.id, aturan.id, wilayah, c.u.id, c.u.cabang_id, c.u.departemen_id,
          c.judul, total, JSON.stringify(data), waktu, waktu]);

      await db.run(
        `INSERT INTO pengajuan_item (id, pengajuan_id, urut, nama, qty, satuan, harga, nominal, keterangan)
         VALUES (?,?,1,?,?, 'unit', ?,?, NULL)`,
        [id(), pid, c.item.nama, c.item.qty, c.item.harga, total]);

      // Lampiran wajib diperiksa saat pengajuan. Barisnya dibuat supaya dokumen
      // contoh bisa berjalan; berkasnya sendiri tidak ada dan tidak dibutuhkan
      // karena layar hanya dipotret, bukan diunduh.
      await db.run(
        `INSERT INTO lampiran (id, pengajuan_id, nama_asli, nama_simpan, mime, ukuran, pengunggah_id, dibuat)
         VALUES (?,?, 'Penawaran-Contoh.pdf', 'contoh.pdf', 'application/pdf', 102400, ?, ?)`,
        [id(), pid, c.u.id, waktu]);

      await alur.ajukan(pid, c.u, '127.0.0.1');
      dibuat[c.u.email] = dibuat[c.u.email] || pid;
    } catch (e) {
      console.log('  (pengajuan contoh dilewati: ' + e.message.split('\n')[0] + ')');
    }
  }
  return dibuat;
}

// --------------------------------------------------------------------- main
(async () => {
  const chrome = cariChrome();
  if (!chrome) { console.error('\n  Chrome/Edge tidak ditemukan.\n'); process.exit(1); }

  fs.mkdirSync(DIR, { recursive: true });
  const dokumen = await isiContoh();
  console.log(`\n  Basis data contoh siap (${Object.keys(dokumen).length} dokumen contoh).`);

  const server = app.listen(PORT_APP);
  await new Promise((selesai, gagal) => {
    server.once('listening', selesai);
    server.once('error', gagal);
  });

  // Pastikan servernya benar-benar menjawab sebelum Chrome dipanggil. Tanpa ini,
  // server yang diam membuat Chrome menunggu sampai kehabisan waktu, dan
  // pesannya cuma 'ETIMEDOUT' - menunjuk ke Chrome, padahal bukan Chrome.
  const uji = await ambil(`http://127.0.0.1:${PORT_APP}/login`);
  console.log(`  Server contoh di ${PORT_APP}: status ${uji.status}, ${uji.teks.length} byte`);
  if (uji.status !== 200) throw new Error(`server contoh menjawab ${uji.status}, bukan 200`);

  let jumlah = 0;

  // Halaman masuk: tidak perlu sesi sama sekali.
  await potret(chrome, `http://127.0.0.1:${PORT_APP}/login`, path.join(DIR, 'login.png'), 950);
  console.log('  login.png');
  jumlah++;

  for (const [track, akun] of Object.entries(AKUN)) {
    const kue = await masuk(akun.email);
    const proxy = buatProxy(kue);
    proxy.listen(PORT_PROXY);
    await new Promise(r => proxy.on('listening', r));

    const daftar = { ...HALAMAN };
    if (dokumen[akun.email]) daftar.detail = '/pengajuan/' + dokumen[akun.email];

    for (const [nama, jalur] of Object.entries(daftar)) {
      const url = `http://127.0.0.1:${PORT_PROXY}` + (nama === 'form' || nama === 'lampiran' ? akun.formulir : jalur);
      const keluar = path.join(DIR, `${track}-${nama}.png`);
      try {
        await potret(chrome, url, keluar, nama === 'form' ? 1400 : 950);
        console.log(`  ${track}-${nama}.png`);
        jumlah++;
      } catch (e) {
        console.log(`  GAGAL ${track}-${nama}.png - ${e.message.split('\n')[0]}`);
      }
    }
    await new Promise(r => proxy.close(r));
  }

  await new Promise(r => server.close(r));
  await db.tutup();
  for (const s of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(DB_CONTOH + s); } catch (_) { /* mungkin memang tidak ada */ }
  }
  try { fs.rmSync(PROFIL, { recursive: true, force: true }); } catch (_) { /* abaikan */ }

  console.log(`\n  ${jumlah} gambar tersimpan di docs/tangkapan/`);
  console.log('  Basis data contoh sudah dihapus. Data asli tidak disentuh.\n');
  console.log('  Lanjut:  node scripts/buat-tutorial.js\n');
  process.exit(0);
})().catch(async e => {
  console.error('\n  Gagal:', e.message, '\n');
  try { await db.tutup(); } catch (_) { /* abaikan */ }
  process.exit(1);
});
