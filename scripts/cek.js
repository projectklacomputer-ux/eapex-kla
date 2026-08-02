#!/usr/bin/env node
// ============================================================================
//  GERBANG MUTU EAPEX  —  jalankan:  npm run cek
// ============================================================================
// Satu perintah yang selalu memeriksa hal yang sama persis, supaya kelayakan
// aplikasi tidak bergantung pada ketelitian orang saat itu.
//
//   A. SINTAKS   — semua berkas JavaScript bisa diurai
//   B. TAMPILAN  — semua berkas .ejs bisa dikompilasi (termasuk include)
//   C. HITUNGAN  — uang, terbilang, ambang approval, total per bentuk formulir
//   D. ALUR      — server sungguhan dijalankan di basis data sementara, lalu
//                  satu dokumen CAPEX ditempuh dari pengajuan sampai DISETUJUI
//                  oleh empat penyetuju berbeda; ambang CEO diuji dua arah;
//                  tolak/revisi, saringan bulan-tahun, dan master cabang ikut diuji
//   E. KEAMANAN  — tanpa login ditolak, bukan penyetuju ditolak, CSRF ditolak
//
// Keluar dengan kode 1 bila ada yang gagal.
const path = require('path');
const fs = require('fs');
const os = require('os');
const vm = require('vm');

const AKAR = path.join(__dirname, '..');
const P = f => path.join(AKAR, f);

// --- basis data sementara: jangan pernah menyentuh data asli
const DB_UJI = path.join(os.tmpdir(), 'eapex-uji-' + process.pid + '.db');
process.env.SQLITE_PATH = DB_UJI;
// Lampiran uji juga ditulis ke folder sementara, bukan ke data/lampiran asli.
const LAMPIRAN_UJI = path.join(os.tmpdir(), 'eapex-lampiran-uji-' + process.pid);
process.env.LAMPIRAN_DIR = LAMPIRAN_UJI;
delete process.env.DATABASE_URL;
process.env.SESSION_SECRET = 'rahasia-untuk-pengujian-saja-0123456789';
process.env.NODE_ENV = 'test';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.TELEGRAM_CHAT_ID = '';
// Pengujian menempuh puluhan login dari satu alamat. Kelonggaran ini HANYA
// berlaku saat NODE_ENV=test (lihat app.js) dan diperiksa lagi di bagian E.
process.env.BATAS_LOGIN_UJI = '400';

// Sidik jari catatan akun ASLI sebelum apa pun dijalankan. Pemeriksaan mutu
// pernah menimpa berkas ini dengan sandi dari basis data uji (31 Jul 2026),
// sehingga sandi yang sudah dibagikan ke orang tidak lagi cocok dengan sistem.
const BERKAS_AKUN = path.join(AKAR, 'data', 'AKUN-AWAL.txt');
const sidikAkunAwal = (() => {
  try { return require('crypto').createHash('sha256').update(fs.readFileSync(BERKAS_AKUN)).digest('hex'); }
  catch (e) { return null; }
})();

const daftarLampiranAsli = () => {
  try { return fs.readdirSync(path.join(AKAR, 'data', 'lampiran')).sort().join('|'); }
  catch (e) { return ''; }
};
const isiLampiranAsli = daftarLampiranAsli();

let gagal = 0, lulus = 0;
const ok = t => { lulus++; console.log('  \x1b[32m✓\x1b[0m ' + t); };
const no = t => { gagal++; console.log('  \x1b[31m✗ ' + t + '\x1b[0m'); };
const judul = t => console.log('\n\x1b[1m' + t + '\x1b[0m');
const cek = (syarat, teks) => (syarat ? ok(teks) : no(teks));
const rp = n => 'Rp ' + Number(n).toLocaleString('id-ID');

// ============================================================ A. SINTAKS
function berkasJs() {
  const kumpul = [];
  for (const dir of ['lib', 'routes', 'scripts', 'public/js']) {
    const d = P(dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) if (f.endsWith('.js')) kumpul.push(dir + '/' + f);
  }
  return kumpul.concat(['app.js', 'server.js']);
}

function cekSintaks() {
  judul('A. SINTAKS');
  let rusak = 0;
  const daftar = berkasJs();
  for (const f of daftar) {
    try { new vm.Script(fs.readFileSync(P(f), 'utf8'), { filename: f }); }
    catch (e) { no(f + ' — ' + e.message); rusak++; }
  }
  if (!rusak) ok(daftar.length + ' berkas JavaScript lulus urai');
}

// ============================================================ B. TAMPILAN
function cekTampilan() {
  judul('B. TAMPILAN (kompilasi EJS)');
  const ejs = require('ejs');
  const dirView = P('views');
  const daftar = [];
  const jelajah = d => {
    for (const f of fs.readdirSync(d)) {
      const jalur = path.join(d, f);
      if (fs.statSync(jalur).isDirectory()) jelajah(jalur);
      else if (f.endsWith('.ejs')) daftar.push(jalur);
    }
  };
  jelajah(dirView);
  let rusak = 0;
  for (const f of daftar) {
    try { ejs.compile(fs.readFileSync(f, 'utf8'), { filename: f }); }
    catch (e) { no(path.relative(AKAR, f) + ' — ' + e.message); rusak++; }
  }
  if (!rusak) ok(daftar.length + ' berkas EJS lulus kompilasi');

  // Setiap halaman non-cetak wajib memakai kerangka bersama (kecuali login yang berdiri sendiri).
  const tanpaKerangka = daftar.filter(f => {
    const nama = path.basename(f);
    // login & luring sengaja berdiri sendiri: keduanya tampil tanpa data pengguna
    // (luring bahkan disimpan di HP, jadi tidak boleh memuat apa pun milik orang).
    if (nama === 'login.ejs' || nama === 'luring.ejs' || f.includes('partials')) return false;
    return !fs.readFileSync(f, 'utf8').includes("include('partials/atas')");
  });
  cek(!tanpaKerangka.length, 'semua halaman memakai kerangka bersama' +
    (tanpaKerangka.length ? ' — kecuali: ' + tanpaKerangka.map(f => path.basename(f)).join(', ') : ''));

  // Formulir yang mengubah data wajib menyertakan token CSRF.
  const tanpaCsrf = daftar.filter(f => {
    const isi = fs.readFileSync(f, 'utf8');
    return /<form[^>]*method=["']post["']/i.test(isi) && !isi.includes('name="_csrf"');
  });
  cek(!tanpaCsrf.length, 'semua formulir POST menyertakan token CSRF' +
    (tanpaCsrf.length ? ' — kurang di: ' + tanpaCsrf.map(f => path.basename(f)).join(', ') : ''));

  // Content-Security-Policy menolak skrip sebaris; halaman yang memakainya akan
  // "diam-diam mati" di peramban tanpa pesan galat di server.
  const adaSkripSebaris = daftar.filter(f => {
    const isi = fs.readFileSync(f, 'utf8');
    return /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(isi);
  });
  cek(!adaSkripSebaris.length, 'tidak ada <script> sebaris (CSP tetap bisa ketat)' +
    (adaSkripSebaris.length ? ' — ada di: ' + adaSkripSebaris.map(f => path.basename(f)).join(', ') : ''));

  // Kawat penghitung di peramban. Bug 30 Jul 2026: mengubah Qty atau Margin tidak
  // memicu hitung ulang karena hanya kolom uang yang punya pendengar sendiri;
  // dan formulir tanpa tabel rincian (Refund) selalu menampilkan Rp 0.
  const skrip = fs.readFileSync(P('public/js/app.js'), 'utf8');
  cek(/addEventListener\('input'/.test(skrip) && /pasangHitungUlang/.test(skrip),
    'app.js memasang pendengar input menyeluruh (Qty & Margin ikut memicu hitung ulang)');
  cek(/function tambahBaris[\s\S]{0,400}hitungTotal\(\)/.test(skrip),
    'menambah baris rincian ikut memicu hitung ulang');
  cek(/tabel-item[\s\S]{0,220}name="nominal"/.test(skrip),
    'formulir tanpa tabel rincian memakai kolom nilai tunggal (Refund Dana)');
}

// ============================================================ C. HITUNGAN
function cekHitungan() {
  judul('C. HITUNGAN');
  const u = require('../lib/util');
  const mesin = require('../lib/aturan');
  const Pj = require('../lib/pengajuan');

  cek(u.keRupiahBulat('1.500.000') === 1500000, 'uang "1.500.000" → 1500000');
  cek(u.keRupiahBulat('Rp 2.750.500') === 2750500, 'uang "Rp 2.750.500" → 2750500');
  cek(u.keRupiahBulat('4000000') === 4000000, 'uang "4000000" → 4000000');
  cek(u.keRupiahBulat('') === 0 && u.keRupiahBulat(null) === 0, 'uang kosong → 0');
  cek(u.keRupiahBulat('abc') === 0, 'uang bukan angka → 0');

  cek(u.terbilangRupiah(9450000) === 'SEMBILAN JUTA EMPAT RATUS LIMA PULUH RIBU RUPIAH',
    'terbilang 9.450.000 sesuai contoh CEA');
  cek(u.terbilangRupiah(1000) === 'SERIBU RUPIAH', 'terbilang 1.000 → SERIBU RUPIAH');
  cek(u.terbilangRupiah(0) === 'NOL RUPIAH', 'terbilang 0 → NOL RUPIAH');
  cek(u.terbilangRupiah(115000) === 'SERATUS LIMA BELAS RIBU RUPIAH', 'terbilang 115.000');

  // Ambang inklusif: nominal TEPAT ambang tetap wajib naik ke CEO.
  const langkah = [
    { peran: 'area_manager', min_nominal: null, maks_nominal: null },
    { peran: 'accounting', min_nominal: null, maks_nominal: null },
    { peran: 'ceo', min_nominal: 1000000, maks_nominal: null },
  ];
  cek(mesin.langkahBerlaku(langkah, 999999).length === 2, 'nominal 999.999 → tanpa CEO (2 tahap)');
  cek(mesin.langkahBerlaku(langkah, 1000000).length === 3, 'nominal tepat 1.000.000 → dengan CEO (3 tahap)');
  cek(mesin.langkahBerlaku(langkah, 5000000).length === 3, 'nominal 5.000.000 → dengan CEO');

  const items = [{ nominal: 3000000 }, { nominal: 500000 }];
  cek(Pj.hitungTotal('biaya', {}, items) === 3500000, 'total bentuk biaya = jumlah rincian');
  cek(Pj.hitungTotal('capex', { pengiriman: 100000, instalasi: 250000, biaya_lain: 0 }, items) === 3850000,
    'total CAPEX = rincian + pengiriman + instalasi + biaya lain');
  cek(Pj.hitungTotal('refund', { nominal: '750.000' }, []) === 750000, 'total refund dari kolom nominal');

  // Ringkasan progres dokumen — kalimat yang tampil di Daftar Pengajuan & Dasbor.
  const pDraft = Pj.ringkasProgres({ status: 'draft', jml_tahap: 0, tahap_selesai: 0 });
  cek(pDraft.persen === 0 && /Belum diajukan/.test(pDraft.teks), 'progres draft: belum diajukan, 0%');

  const pJalan = Pj.ringkasProgres({
    status: 'menunggu', jml_tahap: 4, tahap_selesai: 2, langkah_kini: 3, tahap_label: 'Finance / Accounting',
  });
  cek(pJalan.persen === 50 && pJalan.teks === 'Tahap 3 dari 4' && /Finance \/ Accounting/.test(pJalan.rinci),
    'progres berjalan: "' + pJalan.teks + ' · ' + pJalan.rinci + '" (' + pJalan.persen + '%)');

  const pSelesai = Pj.ringkasProgres({ status: 'disetujui', jml_tahap: 4, tahap_selesai: 4 });
  cek(pSelesai.persen === 100 && pSelesai.warna === 'hijau', 'progres selesai: 100% hijau');

  const pTolak = Pj.ringkasProgres({ status: 'ditolak', jml_tahap: 4, tahap_selesai: 1, tahap_ditolak: 'Area Manager' });
  cek(pTolak.warna === 'merah' && /Area Manager/.test(pTolak.rinci),
    'progres ditolak menyebut di tahap mana berhentinya');

  const pRevisi = Pj.ringkasProgres({ status: 'revisi', jml_tahap: 4, tahap_selesai: 1, tahap_revisi: 'Area Manager' });
  cek(pRevisi.warna === 'oranye' && /Dikembalikan/.test(pRevisi.teks), 'progres revisi: dikembalikan ke pemohon');

  const pBatal = Pj.ringkasProgres({ status: 'dibatalkan', jml_tahap: 4, tahap_selesai: 1 });
  cek(pBatal.persen === 0 && /Dibatalkan/.test(pBatal.teks), 'progres dibatalkan');

  // Jam Indonesia Barat. Waktu disimpan sebagai ISO UTC; yang tampil harus WIB,
  // dan harus tetap WIB walau server berzona lain.
  const contohIso = '2026-07-31T07:32:00.000Z';   // = 14.32 WIB
  cek(u.tglIndo(contohIso, true) === '31 Juli 2026, 14.32 WIB',
    'jam ditampilkan dalam WIB: ' + u.tglIndo(contohIso, true));
  cek(u.jamIndo(contohIso) === '14.32 WIB', 'jam saja: ' + u.jamIndo(contohIso));
  cek(u.tglIndo(contohIso) === '31 Juli 2026', 'tanggal tanpa jam tidak diberi label zona');
  cek(u.tglSingkat(contohIso) === '31/07/2026', 'tanggal singkat memakai zona Jakarta');
  cek(u.tglIndo(null) === '-' && u.tglSingkat('') === '-', 'waktu kosong tidak merusak tampilan');
  const zonaLain = require('child_process').spawnSync(process.execPath,
    ['-e', "require('" + P('lib/env').replace(/\\/g, '/') + "')();" +
      "console.log(require('" + P('lib/util').replace(/\\/g, '/') + "').tglIndo('" + contohIso + "', true))"],
    { encoding: 'utf8', env: { ...process.env, TZ: 'UTC' } });
  cek((zonaLain.stdout || '').trim() === '31 Juli 2026, 14.32 WIB',
    'jam tetap WIB walau server berzona UTC (' + (zonaLain.stdout || '').trim() + ')');

  const an = Pj.hitungAnalisaRetail({ sales_tambahan: 10000000, margin_persen: 20 }, 24000000);
  cek(an.profit === 2000000, 'analisa retail: profit/bulan = sales × margin');
  cek(an.payback === 12, 'analisa retail: payback = total ÷ profit');
  cek(an.roi === 100, 'analisa retail: ROI = profit setahun ÷ total');

  // Formulir: baris kosong dibuang, nominal = qty × harga
  const form = require('../lib/formulir');
  const hasil = form.bacaItems({
    item_nama: ['Kursi', '', 'Meja'], item_qty: ['2', '5', '1'],
    item_harga: ['500.000', '900.000', '1.250.000'], item_satuan: ['unit', 'unit', 'unit'], item_ket: ['', '', ''],
  });
  cek(hasil.length === 2, 'baris rincian tanpa uraian dibuang');
  cek(hasil[0].nominal === 1000000 && hasil[1].nominal === 1250000, 'nominal baris = qty × harga');

}

// ============================================================ Klien HTTP kecil
class Klien {
  constructor(dasar) { this.dasar = dasar; this.kue = new Map(); }
  get header() {
    const c = [...this.kue.entries()].map(([k, v]) => k + '=' + v).join('; ');
    return c ? { cookie: c } : {};
  }
  simpanKue(res) {
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const baris of set) {
      const [pasangan] = baris.split(';');
      const i = pasangan.indexOf('=');
      if (i > 0) this.kue.set(pasangan.slice(0, i).trim(), pasangan.slice(i + 1).trim());
    }
  }
  async get(jalur) {
    const res = await fetch(this.dasar + jalur, { headers: this.header, redirect: 'manual' });
    this.simpanKue(res);
    const teks = (res.status === 302 || res.status === 303) ? '' : await res.text();
    return { status: res.status, lokasi: res.headers.get('location'), teks };
  }
  async csrf(jalur) {
    const r = await this.get(jalur);
    const m = /name="_csrf" value="([^"]+)"/.exec(r.teks);
    return m ? m[1] : null;
  }
  async post(jalur, medan, token) {
    const body = new URLSearchParams();
    if (token !== null) body.append('_csrf', token === undefined ? '' : token);
    for (const [k, v] of medan) body.append(k, String(v));
    const res = await fetch(this.dasar + jalur, {
      method: 'POST', redirect: 'manual',
      headers: { ...this.header, 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    this.simpanKue(res);
    const teks = (res.status === 302 || res.status === 303) ? '' : await res.text();
    return { status: res.status, lokasi: res.headers.get('location'), teks };
  }
  // Kiriman formulir yang membawa berkas (multipart). Dipakai untuk membuktikan
  // lampiran bisa ikut sejak formulir pertama kali dikirim.
  async postBerkas(jalur, medan, berkas, token) {
    const fd = new FormData();
    if (token !== null) fd.append('_csrf', token === undefined ? '' : token);
    for (const [k, v] of medan) fd.append(k, String(v));
    for (const b of berkas) fd.append('berkas', new Blob([b.isi], { type: b.mime }), b.nama);
    const res = await fetch(this.dasar + jalur, {
      method: 'POST', redirect: 'manual', headers: this.header, body: fd,
    });
    this.simpanKue(res);
    const teks = (res.status === 302 || res.status === 303) ? '' : await res.text();
    return { status: res.status, lokasi: res.headers.get('location'), teks };
  }
  async masuk(email, sandi) {
    const token = await this.csrf('/login');
    const r = await this.post('/login', [['email', email], ['sandi', sandi], ['tujuan', '/']], token);
    return r;
  }
}

// --------------------------------------------------------------- pembantu kiriman
// Sejak semua isian dijadikan wajib (31 Jul 2026), kiriman uji harus benar-benar
// lengkap. Daftarnya SENGAJA ditulis ulang di sini, bukan diambil dari
// lib/formulir.js: kalau pengujian memakai daftar yang sama dengan yang diujinya,
// menghilangkan satu isian wajib tidak akan pernah ketahuan.
const BERKAS_UJI = [{ nama: 'Penawaran-Vendor.pdf', mime: 'application/pdf', isi: '%PDF-1.4 penawaran uji' }];

const ISIAN_LENGKAP = {
  capex: [['nama_proyek', 'Peremajaan perangkat'], ['tujuan[]', 'efisiensi'],
    ['kategori_aset', 'Inventaris'], ['deskripsi', 'AC 2 PK inverter, garansi resmi'],
    ['lokasi', 'Area kasir lantai 1'], ['vendor', 'PT Sumber Elektronik Jaya'],
    ['jadwal_kebutuhan', '2026-08'],
    ['penjelasan', 'AC lama sudah tiga kali diservis dalam enam bulan.'],
    ['justifikasi', 'Biaya servis berulang lebih besar daripada mengganti unit.']],
  barang: [['jalur_pengadaan', 'Vendor langsung'], ['penjelasan', 'Perlengkapan habis pakai kasir.'],
    ['justifikasi', 'Stok lama habis dan dipakai harian.']],
  biaya: [['penjelasan', 'Biaya rutin bulanan.'], ['vendor', 'PT Media Karya'],
    ['periode', '2026-08'], ['justifikasi', 'Sudah dianggarkan dan berjalan tiap bulan.']],
  perjalanan: [['tujuan_kota', 'Surabaya'], ['keperluan', 'Pendampingan buka cabang'],
    ['tgl_mulai', '2026-08-10'], ['tgl_selesai', '2026-08-12'], ['peserta', 'Store Manager Semarang'],
    ['moda', 'Kereta api'], ['justifikasi', 'Pembukaan cabang butuh pendampingan langsung.']],
  maintenance: [['lokasi', 'Atap gudang belakang'], ['jenis_pekerjaan', 'Perbaikan bocor'],
    ['vendor', 'CV Karya Bangun'], ['penjelasan', 'Bocor di tiga titik saat hujan deras.'],
    ['tgl_rencana', '2026-08-05'], ['justifikasi', 'Air merembes ke area penyimpanan barang.']],
  refund: [['nama_penerima', 'Budi Santoso'], ['bank', 'BCA'], ['no_rekening', '1234567890'],
    ['no_nota', 'NT-2026-0817'], ['alasan', 'Pembatalan pesanan oleh pelanggan.']],
  pindah_area: [['nama_karyawan', 'Andi Pratama'], ['jabatan_karyawan', 'Store Manager'],
    ['tgl_pindah', '2026-09-01'], ['penjelasan', 'Rotasi penempatan antar area.']],
};

// Menambahkan isian wajib yang BELUM ada pada kiriman uji, tanpa menimpa yang
// memang sengaja dibuat kosong oleh pengujian tertentu.
function lengkapi(bentuk, medan) {
  const sudahAda = new Set(medan.map(m => m[0]));
  return medan.concat((ISIAN_LENGKAP[bentuk] || []).filter(m => !sudahAda.has(m[0])));
}

// ============================================================ D & E. ALUR + KEAMANAN
async function cekAlur() {
  const db = require('../lib/db');
  const { siapkan } = require('../lib/skema');
  const bcrypt = require('bcryptjs');

  await siapkan({ senyap: true });

  // Semua akun contoh diberi sandi yang sama supaya bisa diuji.
  const SANDI = 'UjiEapex123';
  await db.run('UPDATE pengguna SET sandi_hash = ?, wajib_ganti_sandi = 0', [bcrypt.hashSync(SANDI, 10)]);

  const app = require('../app');
  const server = await new Promise(res => { const s = app.listen(0, () => res(s)); });
  const dasar = 'http://127.0.0.1:' + server.address().port;

  try {
    const kat = async kode => db.get('SELECT * FROM kategori WHERE kode = ?', [kode]);
    const aturanDari = async (kodeKategori, wilayah) => {
      const k = await kat(kodeKategori);
      return db.get('SELECT * FROM aturan WHERE kategori_id = ? AND wilayah = ?', [k.id, wilayah]);
    };
    const cabangKode = async kode => db.get('SELECT * FROM cabang WHERE kode = ?', [kode]);

    // ---------------------------------------------------------------- E. keamanan awal
    judul('E. KEAMANAN');
    const tamu = new Klien(dasar);
    const rDasbor = await tamu.get('/');
    cek(rDasbor.status === 302 && /\/login/.test(rDasbor.lokasi || ''), 'tanpa login: / dialihkan ke /login');
    const rDaftar = await tamu.get('/pengajuan');
    cek(rDaftar.status === 302, 'tanpa login: /pengajuan dialihkan');
    const rAdmin = await tamu.get('/admin/pengguna');
    cek(rAdmin.status === 302, 'tanpa login: /admin dialihkan');
    const rSehat = await tamu.get('/api/health');
    cek(rSehat.status === 200 && rSehat.teks.includes('"ok":true'), '/api/health terbuka & sehat');

    // Kelonggaran batas login untuk pengujian tidak boleh bisa dinyalakan di
    // produksi. Dibuktikan dengan menjalankan ulang berkasnya tanpa NODE_ENV=test.
    {
      const anak = require('child_process').spawnSync(process.execPath, ['-e', `
        process.env.NODE_ENV = 'production';
        process.env.BATAS_LOGIN_UJI = '9999';
        process.env.SESSION_SECRET = 'a'.repeat(40);
        process.env.SQLITE_PATH = ${JSON.stringify(DB_UJI + '-batas')};
        const isi = require('fs').readFileSync(${JSON.stringify(P('app.js'))}, 'utf8');
        const m = /limit:\\s*batasLoginTerpakai/.test(isi);
        const n = /BATAS_LOGIN_NORMAL\\s*=\\s*(\\d+)/.exec(isi);
        const pakaiEnv = new Function('return (' +
          /const batasLoginTerpakai = ([\\s\\S]*?);\\n/.exec(isi)[1].replace(/BATAS_LOGIN_NORMAL/g, n[1]) + ')')();
        console.log(JSON.stringify({ terpasang: m, nilai: pakaiEnv, normal: Number(n[1]) }));
      `], { encoding: 'utf8', timeout: 30000 });
      let hasilBatas = null;
      try { hasilBatas = JSON.parse((anak.stdout || '').trim()); } catch (e) { /* biarkan */ }
      cek(hasilBatas && hasilBatas.terpasang && hasilBatas.nilai === hasilBatas.normal,
        'kelonggaran batas login TIDAK bisa dinyalakan di luar lingkungan uji');
      try { fs.unlinkSync(DB_UJI + '-batas'); } catch (e) { /* biarkan */ }
    }

    const salah = new Klien(dasar);
    const rSalah = await salah.masuk('sm.smg@kla.co.id', 'sandi-salah');
    cek(rSalah.status === 401 && rSalah.teks.includes('Email atau sandi salah'), 'sandi salah ditolak');

    // ---------------------------------------------------------------- D. alur CAPEX
    judul('D. ALUR APPROVAL (CAPEX Store, semua nilai → CEO)');
    const sm = new Klien(dasar);
    const rMasuk = await sm.masuk('sm.smg@kla.co.id', SANDI);
    cek(rMasuk.status === 303 && rMasuk.lokasi === '/', 'Store Manager berhasil masuk');

    const katCapex = await kat('CAPEX');
    const aturCapex = await aturanDari('CAPEX', 'store');
    const smg = await cabangKode('SMG');

    const tokenBuat = await sm.csrf('/pengajuan/baru/CAPEX');
    cek(!!tokenBuat, 'halaman formulir CAPEX terbuka untuk Store Manager');

    const rBuat = await sm.postBerkas('/pengajuan', lengkapi('capex', [
      ['kategori_id', katCapex.id], ['aturan_id', aturCapex.id], ['cabang_id', smg.id],
      ['judul', 'Pengadaan AC 2 PK area kasir'], ['nama_proyek', 'Peremajaan AC Store Semarang'],
      ['justifikasi', 'AC lama sering bocor dan biaya servis tinggi.'],
      ['status_anggaran', 'budgeted'], ['kategori_aset', 'Inventaris'],
      ['item_nama', 'AC 2 PK'], ['item_qty', '2'], ['item_satuan', 'unit'], ['item_harga', '6.500.000'], ['item_ket', ''],
      ['pengiriman', '250.000'], ['instalasi', '750.000'], ['biaya_lain', '0'],
      ['sales_tambahan', '5.000.000'], ['margin_persen', '18'],
      ['aksi', 'ajukan'],
    ]), BERKAS_UJI, tokenBuat);
    cek(rBuat.status === 303, 'pengajuan CAPEX terkirim (dialihkan ke halaman dokumen)');

    const doc = await db.get(`SELECT * FROM pengajuan ORDER BY dibuat DESC LIMIT 1`);
    cek(!!doc && doc.status === 'menunggu', 'status dokumen = menunggu');
    cek(Number(doc.total) === 14000000, 'total dihitung server: 2×6.500.000 + 250.000 + 750.000 = ' + rp(14000000));
    cek(/^\d{4}\/CEA\/KLA\/SMG\/\d{2}\/\d{4}$/.test(doc.nomor || ''), 'nomor dokumen berpola benar: ' + doc.nomor);

    const tahap = await db.all('SELECT * FROM persetujuan WHERE pengajuan_id = ? ORDER BY urut', [doc.id]);
    cek(tahap.length === 4, '4 tahap approval dibentuk (Area → Regional → Accounting → CEO)');
    cek(tahap.map(t => t.peran).join(',') === 'area_manager,regional_manager,accounting,ceo',
      'urutan peran penyetuju sesuai List Of Approval');

    // kandidat tahap 1 harus Area Manager Barat (bukan area lain)
    const kand1 = await db.all(
      `SELECT u.email FROM persetujuan_kandidat k JOIN pengguna u ON u.id = k.pengguna_id
       WHERE k.persetujuan_id = ?`, [tahap[0].id]);
    cek(kand1.length === 1 && kand1[0].email === 'am.barat@kla.co.id',
      'penyetuju tahap 1 tepat Area Manager area cabang tersebut');

    // penyetuju tahap 2 belum boleh memutuskan (harus urut)
    const rm = new Klien(dasar);
    await rm.masuk('regional@kla.co.id', SANDI);
    const tokenRm = await rm.csrf('/pengajuan/' + doc.id);
    const rLangkahi = await rm.post('/pengajuan/' + doc.id + '/putuskan',
      [['aksi', 'setuju'], ['komentar', '']], tokenRm);
    const setelahLangkahi = await db.get('SELECT langkah_kini FROM pengajuan WHERE id = ?', [doc.id]);
    cek(Number(setelahLangkahi.langkah_kini) === 1, 'penyetuju tahap 2 tidak bisa melangkahi tahap 1');

    // pemohon tidak boleh menyetujui dokumennya sendiri
    const tokenSm = await sm.csrf('/pengajuan/' + doc.id);
    await sm.post('/pengajuan/' + doc.id + '/putuskan', [['aksi', 'setuju']], tokenSm);
    const setelahSendiri = await db.get('SELECT langkah_kini, status FROM pengajuan WHERE id = ?', [doc.id]);
    cek(Number(setelahSendiri.langkah_kini) === 1 && setelahSendiri.status === 'menunggu',
      'pemohon tidak bisa menyetujui dokumennya sendiri');

    // CSRF wajib
    const am = new Klien(dasar);
    await am.masuk('am.barat@kla.co.id', SANDI);
    const rTanpaToken = await am.post('/pengajuan/' + doc.id + '/putuskan', [['aksi', 'setuju']], 'token-palsu');
    cek(rTanpaToken.status === 403, 'keputusan tanpa token CSRF sah → ditolak 403');

    // kotak masuk Area Manager berisi dokumen ini
    const rInbox = await am.get('/approval');
    cek(rInbox.teks.includes(doc.nomor), 'dokumen tampil di kotak approval Area Manager');

    // jalankan approval berurutan
    // Rantai store: Area Manager → Regional Manager → Accounting → CEO.
    // (Regional Manager dipakai pada jalur "diajukan Area Manager sendiri", diuji di D6.)
    const urutan = [
      ['am.barat@kla.co.id', 'Area Manager'],
      ['regional@kla.co.id', 'Regional Manager'],
      ['accounting@kla.co.id', 'Accounting'],
      ['ceo@kla.co.id', 'CEO'],
    ];
    for (let i = 0; i < urutan.length; i++) {
      const [email, nama] = urutan[i];
      const k = new Klien(dasar);
      await k.masuk(email, SANDI);
      const t = await k.csrf('/pengajuan/' + doc.id);
      await k.post('/pengajuan/' + doc.id + '/putuskan',
        [['aksi', 'setuju'], ['komentar', 'Disetujui oleh ' + nama]], t);
      const st = await db.get('SELECT status, langkah_kini FROM pengajuan WHERE id = ?', [doc.id]);
      if (i < urutan.length - 1) {
        cek(st.status === 'menunggu' && Number(st.langkah_kini) === i + 2,
          `${nama} menyetujui → lanjut ke tahap ${i + 2}`);
      } else {
        cek(st.status === 'disetujui' && st.langkah_kini === 4,
          `${nama} menyetujui → dokumen DISETUJUI penuh`);
      }
    }

    const semuaTahap = await db.all('SELECT status, aktor_nama FROM persetujuan WHERE pengajuan_id = ?', [doc.id]);
    cek(semuaTahap.every(t => t.status === 'disetujui' && t.aktor_nama), 'keempat tahap tercatat lengkap dengan nama penyetuju');

    // --- susunan hasil simulasi 31 Jul 2026
    const rFormBaru = await sm.get('/pengajuan/baru/CAPEX');
    cek(rFormBaru.teks.includes('class="info-tetap"'), 'formulir: info tetap jadi baris keterangan, bukan kotak terkunci');
    cek(!/name="cabang_id"[^>]*readonly|readonly[^>]*name="cabang_id"/.test(rFormBaru.teks),
      'formulir: tidak ada kotak isian terkunci untuk info mati');
    cek(!rFormBaru.teks.includes('id="rantai-perkiraan"') && !rFormBaru.teks.includes('>Ringkasan<'),
      'formulir: panel ringkasan sudah dibuang');
    cek(rFormBaru.teks.includes('id="bar-bantu"'), 'formulir: bilah petunjuk pengisian tersedia');
    const jmlBantu = (rFormBaru.teks.match(/data-bantu="/g) || []).length;
    cek(jmlBantu >= 15, 'formulir: ' + jmlBantu + ' isian punya petunjuk pengisian');
    cek((rFormBaru.teks.match(/class="bulat-bagian"/g) || []).length >= 4,
      'formulir: tiap bagian bernomor bulat');
    cek(rFormBaru.teks.includes('id="total-pengajuan"') && rFormBaru.teks.includes('TOTAL PENGAJUAN'),
      'formulir: total pindah ke kaki tabel rincian');

    const rDetailBaru = await sm.get('/pengajuan/' + doc.id);
    cek(rDetailBaru.teks.includes('class="alur-lebar"'), 'detail: alur approval memakai susunan melebar');
    const jmlTahapTampil = (rDetailBaru.teks.match(/class="tahap /g) || []).length;
    cek(jmlTahapTampil === tahap.length + 1,
      'detail: seluruh tahap + baris pemohon tampil (' + jmlTahapTampil + ' baris)');
    cek(rDetailBaru.teks.includes('kolom-orang') && rDetailBaru.teks.includes('kolom-status'),
      'detail: kolom nama & status terpisah supaya sejajar');
    cek(/class="wib"/.test(rDetailBaru.teks), 'detail: jam approval diberi tanda WIB');
    cek((rDetailBaru.teks.match(/WIB/g) || []).length >= 4,
      'detail: WIB tampil pada seluruh tahap yang sudah berjalan');

    const admWib = new Klien(dasar);
    await admWib.masuk('admin@kla.co.id', SANDI);
    const rJejakWib = await admWib.get('/admin/jejak');
    cek(rJejakWib.teks.includes('WIB'), 'jejak audit ikut memakai WIB');

    const rCetak = await sm.get('/pengajuan/' + doc.id + '/cetak');
    cek(rCetak.status === 200 && rCetak.teks.includes('EMPAT BELAS JUTA RUPIAH'),
      'cetakan memuat nilai dalam huruf');
    cek(rCetak.teks.includes('DISETUJUI SECARA ELEKTRONIK'), 'cetakan memuat jejak persetujuan elektronik');

    // ---------------------------------------------------------------- ambang nominal
    judul('D2. AMBANG NOMINAL (Perlengkapan Kantor, CEO bila ≥ Rp 500.000)');
    const katPerl = await kat('PERLENGKAPAN');
    const aturPerl = await aturanDari('PERLENGKAPAN', 'store');

    async function ajukanPerlengkapan(harga) {
      const t = await sm.csrf('/pengajuan/baru/PERLENGKAPAN');
      await sm.postBerkas('/pengajuan', lengkapi('barang', [
        ['kategori_id', katPerl.id], ['aturan_id', aturPerl.id], ['cabang_id', smg.id],
        ['judul', 'Perlengkapan kantor ' + harga], ['justifikasi', 'kebutuhan rutin'],
        ['jalur_pengadaan', 'purchasing'],
        ['item_nama', 'Kertas HVS'], ['item_qty', '1'], ['item_satuan', 'rim'], ['item_harga', String(harga)],
        ['aksi', 'ajukan'],
      ]), BERKAS_UJI, t);
      const d = await db.get('SELECT * FROM pengajuan ORDER BY dibuat DESC LIMIT 1');
      const tp = await db.all('SELECT peran FROM persetujuan WHERE pengajuan_id = ? ORDER BY urut', [d.id]);
      return { d, peran: tp.map(x => x.peran) };
    }

    const kecil = await ajukanPerlengkapan(400000);
    cek(Number(kecil.d.total) === 400000 && !kecil.peran.includes('ceo'),
      'nominal 400.000 → tanpa CEO (' + kecil.peran.join(' → ') + ')');

    const pas = await ajukanPerlengkapan(500000);
    cek(pas.peran.includes('ceo'), 'nominal tepat 500.000 → CEO wajib (ambang inklusif)');

    const besar = await ajukanPerlengkapan(750000);
    cek(besar.peran.includes('ceo'), 'nominal 750.000 → CEO wajib (' + besar.peran.join(' → ') + ')');

    // ---------------------------------------------------------------- tolak & revisi
    judul('D4. TOLAK, REVISI, DAN PEMBATASAN AKSES');
    const katMtc = await kat('MTC-RUTIN');
    const aturMtc = await aturanDari('MTC-RUTIN', 'store');
    const tMtc = await sm.csrf('/pengajuan/baru/MTC-RUTIN');
    await sm.postBerkas('/pengajuan', lengkapi('maintenance', [
      ['kategori_id', katMtc.id], ['aturan_id', aturMtc.id], ['cabang_id', smg.id],
      ['judul', 'Perbaikan bocor gudang'], ['lokasi', 'Gudang belakang'],
      ['penjelasan', 'Atap bocor saat hujan deras.'],
      ['item_nama', 'Jasa perbaikan atap'], ['item_qty', '1'], ['item_satuan', 'paket'], ['item_harga', '2.500.000'],
      ['aksi', 'ajukan'],
    ]), BERKAS_UJI, tMtc);
    const mtc = await db.get('SELECT * FROM pengajuan WHERE kategori_id = ? ORDER BY dibuat DESC LIMIT 1', [katMtc.id]);

    // alasan wajib saat minta revisi
    const am2 = new Klien(dasar);
    await am2.masuk('am.barat@kla.co.id', SANDI);
    const tRev = await am2.csrf('/pengajuan/' + mtc.id);
    await am2.post('/pengajuan/' + mtc.id + '/putuskan', [['aksi', 'revisi'], ['komentar', '']], tRev);
    const mtcSetelah = await db.get('SELECT status FROM pengajuan WHERE id = ?', [mtc.id]);
    cek(mtcSetelah.status === 'menunggu', 'minta revisi tanpa alasan ditolak');

    const tRev2 = await am2.csrf('/pengajuan/' + mtc.id);
    await am2.post('/pengajuan/' + mtc.id + '/putuskan',
      [['aksi', 'revisi'], ['komentar', 'Lampirkan penawaran tukang dulu.']], tRev2);
    const mtcRevisi = await db.get('SELECT status, langkah_kini FROM pengajuan WHERE id = ?', [mtc.id]);
    cek(mtcRevisi.status === 'revisi' && Number(mtcRevisi.langkah_kini) === 0,
      'minta revisi dengan alasan → dokumen kembali ke pemohon');

    const rUbahLagi = await sm.get('/pengajuan/' + mtc.id + '/ubah');
    cek(rUbahLagi.status === 200, 'dokumen berstatus revisi bisa diubah pemohon');

    // ajukan ulang dengan nominal di atas ambang 4 juta → CEO ikut
    const tUlang = await sm.csrf('/pengajuan/' + mtc.id + '/ubah');
    await sm.post('/pengajuan/' + mtc.id, lengkapi('maintenance', [
      ['kategori_id', katMtc.id], ['aturan_id', aturMtc.id], ['cabang_id', smg.id],
      ['judul', 'Perbaikan bocor gudang (revisi)'], ['lokasi', 'Gudang belakang'],
      ['penjelasan', 'Atap bocor; sekalian ganti rangka.'],
      ['item_nama', 'Jasa perbaikan atap + rangka'], ['item_qty', '1'], ['item_satuan', 'paket'], ['item_harga', '6.000.000'],
      ['aksi', 'ajukan'],
    ]), tUlang);
    const mtcUlang = await db.get('SELECT * FROM pengajuan WHERE id = ?', [mtc.id]);
    const peranUlang = (await db.all('SELECT peran FROM persetujuan WHERE pengajuan_id = ? ORDER BY urut', [mtc.id]))
      .map(x => x.peran);
    cek(mtcUlang.status === 'menunggu' && Number(mtcUlang.total) === 6000000,
      'revisi diajukan ulang dengan nominal baru ' + rp(6000000));
    cek(peranUlang.includes('ceo'), 'rantai dihitung ulang: nominal ≥ 4 juta → CEO ikut (' + peranUlang.join(' → ') + ')');
    cek(mtcUlang.nomor === mtc.nomor, 'nomor dokumen tidak berubah setelah revisi');

    // tolak
    const tTolak = await am2.csrf('/pengajuan/' + mtc.id);
    await am2.post('/pengajuan/' + mtc.id + '/putuskan',
      [['aksi', 'tolak'], ['komentar', 'Nominal terlalu tinggi, cari vendor lain.']], tTolak);
    const mtcTolak = await db.get('SELECT status FROM pengajuan WHERE id = ?', [mtc.id]);
    const sisaTahap = await db.all(
      `SELECT status FROM persetujuan WHERE pengajuan_id = ? AND urut > 1`, [mtc.id]);
    cek(mtcTolak.status === 'ditolak', 'penolakan menghentikan dokumen');
    cek(sisaTahap.every(t => t.status === 'dilewati'), 'tahap sesudahnya ditandai dilewati (riwayat tetap jelas)');

    // batas akses antar unit: Store Manager cabang lain tidak boleh melihat
    const smLain = new Klien(dasar);
    await smLain.masuk('sm.sbym@kla.co.id', SANDI);
    const rLihat = await smLain.get('/pengajuan/' + doc.id);
    cek(rLihat.status === 403, 'Store Manager cabang lain tidak bisa membuka dokumen bukan wewenangnya');

    // peran yang tidak berhak mengajukan kategori tertentu
    const rTakBerhak = await smLain.get('/pengajuan/baru/MKT-ADS');
    cek(rTakBerhak.status === 403, 'peran yang tidak terdaftar sebagai pemohon ditolak di halaman formulir');

    // non-admin tidak boleh membuka menu admin
    const rAdminTolak = await sm.get('/admin/pengguna');
    cek(rAdminTolak.status === 403, 'non-admin ditolak di menu Admin');

    // Accounting boleh melihat semua dokumen (fungsi verifikasi)
    const acc = new Klien(dasar);
    await acc.masuk('accounting@kla.co.id', SANDI);
    const rAcc = await acc.get('/pengajuan/' + doc.id);
    cek(rAcc.status === 200, 'Accounting bisa melihat semua dokumen');

    const adm = new Klien(dasar);
    await adm.masuk('admin@kla.co.id', SANDI);
    const Pj = require('../lib/pengajuan');

    // ---------------------------------------------------------------- master cabang
    judul('D5. MASTER CABANG');
    const semuaCabang = await db.all("SELECT kode, nama FROM cabang WHERE tipe = 'store' ORDER BY nama");
    const HARUS_ADA = ['Semarang', 'Yogyakarta', 'Cirebon', 'Surabaya Merr', 'Tegal', 'Surabaya Babatan',
      'Kediri', 'Purwokerto', 'Pekalongan', 'Mojokerto', 'Ngaliyan', 'Sukoharjo', 'Solo', 'Slawi', 'Tasikmalaya'];
    const kurangCabang = HARUS_ADA.filter(n => !semuaCabang.some(c => c.nama === n));
    cek(!kurangCabang.length, '15 cabang terpasang' + (kurangCabang.length ? ' — kurang: ' + kurangCabang.join(', ') : ''));
    cek(semuaCabang.length >= 15, 'jumlah cabang store = ' + semuaCabang.length);
    const kodeKembar = semuaCabang.map(c => c.kode).filter((k, i, a) => a.indexOf(k) !== i);
    cek(!kodeKembar.length, 'tidak ada kode cabang kembar (nomor dokumen tetap unik per cabang)');
    const adaHo = await db.get("SELECT kode FROM cabang WHERE tipe = 'back_office'");
    cek(!!adaHo, 'unit Back Office (kantor pusat) tersedia');

    // Cabang tanpa Store Manager = cabang yang tidak bisa mengajukan apa pun,
    // dan itu tidak kelihatan sampai ada orang di sana yang mencoba.
    const cabangTanpaSm = await db.all(
      `SELECT c.nama FROM cabang c
       WHERE c.tipe = 'store' AND c.aktif = 1 AND NOT EXISTS (
         SELECT 1 FROM pengguna u WHERE u.cabang_id = c.id AND u.peran = 'store_manager' AND u.aktif = 1)
       ORDER BY c.nama`);
    cek(!cabangTanpaSm.length, 'setiap cabang punya akun Store Manager' +
      (cabangTanpaSm.length ? ' — belum ada di: ' + cabangTanpaSm.map(c => c.nama).join(', ') : ''));

    // Tiap area yang dipakai cabang juga wajib punya Area Manager, kalau tidak
    // rantai approval store akan tertahan di tahap pertama.
    const areaTanpaAm = await db.all(
      `SELECT a.nama FROM area a
       WHERE a.aktif = 1 AND EXISTS (SELECT 1 FROM cabang c WHERE c.area_id = a.id AND c.aktif = 1)
         AND NOT EXISTS (SELECT 1 FROM pengguna u WHERE u.area_id = a.id AND u.peran = 'area_manager' AND u.aktif = 1)
       ORDER BY a.nama`);
    cek(!areaTanpaAm.length, 'setiap area berisi cabang punya Area Manager' +
      (areaTanpaAm.length ? ' — belum ada di: ' + areaTanpaAm.map(a => a.nama).join(', ') : ''));

    const DEPT_RESMI = ['Accounting', 'Human Capital', 'Purchasing', 'Marketing', 'Sales (Regional & Area)',
      'Business Development Ekspansi', 'Business Development SOP', 'Customer Service', 'Internal Audit', 'Brand'];
    const dept = await db.all('SELECT kode, nama FROM departemen WHERE aktif = 1 ORDER BY nama');
    const kurangDept = DEPT_RESMI.filter(n => !dept.some(d => d.nama === n));
    cek(!kurangDept.length, '10 departemen Back Office terpasang' +
      (kurangDept.length ? ' — kurang: ' + kurangDept.join(', ') : ''));
    const lebihDept = dept.filter(d => !DEPT_RESMI.includes(d.nama));
    cek(!lebihDept.length, 'tidak ada departemen di luar daftar resmi' +
      (lebihDept.length ? ' — ada: ' + lebihDept.map(d => d.nama).join(', ') : ''));
    const kodeDeptKembar = dept.map(d => d.kode).filter((k, i, a) => a.indexOf(k) !== i);
    cek(!kodeDeptKembar.length, 'tidak ada kode departemen kembar');

    // Daftar departemen harus benar-benar sampai ke pilihan di formulir Back Office.
    const stafBo = new Klien(dasar);
    await stafBo.masuk('staf.acc@kla.co.id', SANDI);
    const rFormBo = await stafBo.get('/pengajuan/baru/CAPEX');
    // Nama yang memuat "&" tampil sebagai "&amp;" di HTML — bandingkan dalam bentuk itu.
    const keHtml = t => t.replace(/&/g, '&amp;');
    const deptTampil = DEPT_RESMI.filter(n => rFormBo.teks.includes(keHtml(n)));
    cek(rFormBo.status === 200 && deptTampil.length === DEPT_RESMI.length,
      'seluruh departemen muncul di pilihan formulir Back Office (' + deptTampil.length + '/' + DEPT_RESMI.length + ')');
    const rFormStore = await sm.get('/pengajuan/baru/CAPEX');
    const cabangTampil = HARUS_ADA.filter(n => rFormStore.teks.includes(n));
    cek(cabangTampil.length >= 1, 'pilihan cabang muncul di formulir Store (' + cabangTampil.length + ' cabang terlihat)');

    // ---------------------------------------------------------------- Regional Manager
    judul('D6. REGIONAL MANAGER MENGGANTIKAN BRAND MANAGER');
    const K = require('../lib/konstanta');
    const orangRm = await db.get("SELECT nama FROM pengguna WHERE peran = 'regional_manager' AND aktif = 1");
    cek(!!orangRm, 'ada pengguna berperan Regional Manager');

    // Brand Manager sudah tidak dipakai di rantai mana pun (31 Jul 2026).
    const sisaBm = await db.all("SELECT id FROM aturan_langkah WHERE peran = 'brand_manager'");
    cek(sisaBm.length === 0, 'tidak ada satu pun tahap approval yang masih Brand Manager');
    const bmAktif = await db.all("SELECT email FROM pengguna WHERE peran = 'brand_manager' AND aktif = 1");
    cek(bmAktif.length === 0, 'tidak ada akun aktif berperan Brand Manager');
    cek(!!K.PERAN.brand_manager && K.PERAN.brand_manager.riwayat === true,
      'peran Brand Manager tetap terdaftar sebagai riwayat — dokumen lama masih terbaca labelnya');

    // Brand Manager tidak lagi menyetujui apa pun, jadi tidak boleh lagi
    // membaca seluruh dokumen perusahaan.
    const Pmod = require('../lib/pengajuan');
    const bolehSemuaBm = Pmod.bolehMelihat(
      { pemohon_id: 'x', persetujuan: [], cabang_area_id: null },
      { id: 'y', peran: 'brand_manager' });
    cek(bolehSemuaBm === false, 'peran riwayat tidak lagi bisa membaca semua dokumen');

    // Store Manager mengajukan dinas -> lewat Area Manager & Regional Manager
    const katDinas = await kat('DINAS');
    const smgJtg = await cabangKode('SMG');
    const aturDinasSm = await db.get(
      "SELECT * FROM aturan WHERE kategori_id = ? AND wilayah = 'store' AND peran_pemohon = 'store_manager'", [katDinas.id]);
    cek(!!aturDinasSm, 'aturan Perjalanan Dinas untuk Store Manager tetap ada');
    const tDinasSm = await sm.csrf('/pengajuan/baru/DINAS');
    await sm.postBerkas('/pengajuan', lengkapi('perjalanan', [
      ['kategori_id', katDinas.id], ['aturan_id', aturDinasSm.id], ['cabang_id', smgJtg.id],
      ['judul', 'Dinas Store Manager ke Solo'], ['tujuan_kota', 'Solo'], ['keperluan', 'survei lokasi'],
      ['item_nama', 'Transport & penginapan'], ['item_qty', '1'], ['item_satuan', 'paket'], ['item_harga', '3.000.000'],
      ['aksi', 'ajukan'],
    ]), BERKAS_UJI, tDinasSm);
    const dinasSm = await db.get(
      'SELECT * FROM pengajuan WHERE kategori_id = ? ORDER BY dibuat DESC LIMIT 1', [katDinas.id]);
    const peranDinasSm = (await db.all('SELECT peran FROM persetujuan WHERE pengajuan_id = ? ORDER BY urut', [dinasSm.id]))
      .map(x => x.peran);
    cek(peranDinasSm.join(',') === 'area_manager,regional_manager,accounting,ceo',
      'dinas oleh Store Manager: ' + peranDinasSm.join(' → '));

    // Area Manager mengajukan sendiri -> langsung Regional Manager
    const amBarat = new Klien(dasar);
    await amBarat.masuk('am.barat@kla.co.id', SANDI);
    const aturDinasAm = await db.get(
      "SELECT * FROM aturan WHERE kategori_id = ? AND peran_pemohon = 'area_manager'", [katDinas.id]);
    cek(!!aturDinasAm && aturDinasAm.catatan === 'Diajukan Area Manager sendiri',
      'ada jalur khusus "Diajukan Area Manager sendiri"');

    const rFormAm = await amBarat.get('/pengajuan/baru/DINAS');
    cek(rFormAm.status === 200 && rFormAm.teks.includes('Diajukan Area Manager sendiri'),
      'Area Manager melihat jalur khusus itu di formulir');

    const tDinasAm = await amBarat.csrf('/pengajuan/baru/DINAS');
    await amBarat.postBerkas('/pengajuan', lengkapi('perjalanan', [
      ['kategori_id', katDinas.id], ['aturan_id', aturDinasAm.id], ['cabang_id', smgJtg.id],
      ['judul', 'Kunjungan area ke cabang Semarang'], ['tujuan_kota', 'Semarang'],
      ['keperluan', 'kunjungan rutin area'],
      ['item_nama', 'Transport & penginapan'], ['item_qty', '1'], ['item_satuan', 'paket'], ['item_harga', '3.500.000'],
      ['aksi', 'ajukan'],
    ]), BERKAS_UJI, tDinasAm);
    const dinasAm = await db.get(
      "SELECT * FROM pengajuan WHERE judul LIKE 'Kunjungan area%' ORDER BY dibuat DESC LIMIT 1");
    cek(!!dinasAm && dinasAm.status === 'menunggu', 'Area Manager berhasil mengajukan sendiri');
    const peranDinasAm = (await db.all('SELECT peran FROM persetujuan WHERE pengajuan_id = ? ORDER BY urut', [dinasAm.id]))
      .map(x => x.peran);
    cek(peranDinasAm.join(',') === 'regional_manager,accounting,ceo',
      'dinas oleh Area Manager: ' + peranDinasAm.join(' → '));
    cek(!peranDinasAm.includes('area_manager'), 'tidak ada tahap Area Manager pada jalur ini');
    cek(!peranDinasAm.includes('area_manager'), 'tidak ada tahap Area Manager (dia pemohonnya)');

    const kandidatRm = await db.all(
      `SELECT u.email FROM persetujuan s JOIN persetujuan_kandidat k ON k.persetujuan_id = s.id
       JOIN pengguna u ON u.id = k.pengguna_id WHERE s.pengajuan_id = ? AND s.urut = 1`, [dinasAm.id]);
    cek(kandidatRm.length === 1 && kandidatRm[0].email === 'regional@kla.co.id',
      'penyetuju pertama tepat Regional Manager');

    // Perpindahan area juga memakai Regional Manager
    const katPindah = await kat('PINDAH-AREA');
    const aturPindah = await db.get('SELECT id FROM aturan WHERE kategori_id = ?', [katPindah.id]);
    const peranPindah = (await db.all('SELECT peran FROM aturan_langkah WHERE aturan_id = ? ORDER BY urut', [aturPindah.id]))
      .map(x => x.peran);
    cek(peranPindah.includes('regional_manager') && !peranPindah.includes('brand_manager'),
      'perpindahan area memakai Regional Manager: ' + peranPindah.join(' → '));

    // Jaring pengaman: peran berwilayah tidak boleh nyasar ke wilayah lain
    const mesinAturan = require('../lib/aturan');
    const areaBarat = await db.get("SELECT id FROM area WHERE kode = 'BRT'");
    const amBaratUser = await db.get("SELECT id FROM pengguna WHERE email = 'am.barat@kla.co.id'");
    const calonSalah = await mesinAturan.kandidatLangkah(
      { peran: 'area_manager', lingkup: 'auto' },
      { pemohon_id: amBaratUser.id, cabang_id: smgJtg.id, area_id: areaBarat.id });
    cek(calonSalah.length === 0,
      'tahap Area Manager tidak dialihkan ke Area Manager wilayah lain saat calonnya habis');
    const calonCeo = await mesinAturan.kandidatLangkah(
      { peran: 'ceo', lingkup: 'auto' }, { pemohon_id: amBaratUser.id, cabang_id: smgJtg.id, area_id: areaBarat.id });
    cek(calonCeo.length === 1, 'peran kantor pusat (CEO) tetap ketemu dari unit mana pun');

    // ---------------------------------------------------------------- saringan periode
    judul('D7. SARINGAN BULAN & TAHUN');
    const kini = new Date();
    const tahunIni = kini.getFullYear();
    const bulanIni = kini.getMonth() + 1;
    const bulanLain = bulanIni === 1 ? 12 : bulanIni - 1;
    const tahunLain = bulanIni === 1 ? tahunIni - 1 : tahunIni;

    const rentang = Pj.rentangPeriode(tahunIni, bulanIni);
    cek(rentang.dari === new Date(tahunIni, bulanIni - 1, 1).toISOString() &&
        rentang.sebelum === new Date(tahunIni, bulanIni, 1).toISOString(),
      'rentang bulan dihitung dari waktu setempat lalu diubah ke UTC');

    const rBulanIni = await adm.get(`/pengajuan?bulan=${bulanIni}&tahun=${tahunIni}`);
    cek(rBulanIni.status === 200 && rBulanIni.teks.includes(doc.nomor),
      'saringan bulan berjalan menampilkan dokumen bulan ini');

    const rBulanLain = await adm.get(`/pengajuan?bulan=${bulanLain}&tahun=${tahunLain}`);
    cek(rBulanLain.status === 200 && !rBulanLain.teks.includes(doc.nomor),
      'saringan bulan lain tidak menampilkan dokumen bulan ini');

    const rTahunLalu = await adm.get(`/pengajuan?tahun=${tahunIni - 1}`);
    cek(rTahunLalu.status === 200 && !rTahunLalu.teks.includes(doc.nomor),
      'saringan tahun lalu tidak menampilkan dokumen tahun ini');

    const rTahunIni = await adm.get(`/pengajuan?tahun=${tahunIni}`);
    cek(rTahunIni.status === 200 && rTahunIni.teks.includes(doc.nomor), 'saringan tahun berjalan menampilkan dokumen');

    const rCsvPeriode = await adm.get(`/pengajuan?bulan=${bulanLain}&tahun=${tahunLain}`);
    cek(rCsvPeriode.status === 200 && !rCsvPeriode.teks.includes(doc.nomor),
      'daftar ikut memakai saringan periode');

    const rPilihanTahun = await adm.get('/pengajuan');
    cek(rPilihanTahun.teks.includes('name="bulan"') && rPilihanTahun.teks.includes('name="tahun"'),
      'pilihan bulan & tahun tampil di halaman daftar');
    cek(rPilihanTahun.teks.includes('>' + tahunIni + '<'), 'tahun berjalan tersedia di pilihan');

    // ---------------------------------------------------------------- halaman utama
    judul("D8. HALAMAN UTAMA & ADMIN");
    for (const [jalur, penanda] of [['/', 'Dasbor'], ['/pengajuan', 'Daftar Pengajuan'],
      ['/pengajuan/baru', 'Pengajuan'], ['/approval', 'Kotak Approval'], ['/notifikasi', 'Notifikasi']]) {
      const r = await sm.get(jalur);
      cek(r.status === 200 && r.teks.includes(penanda), 'halaman ' + jalur + ' tampil');
    }

    // Halaman Pengajuan Baru memakai susunan dua panel (pilihan pengguna 31 Jul 2026).
    const rPilih = await sm.get('/pengajuan/baru');
    cek(rPilih.teks.includes('dua-panel') && rPilih.teks.includes('panel-kiri'),
      'halaman Pengajuan Baru memakai susunan dua panel');
    const jmlTombolGrup = (rPilih.teks.match(/class="grup-tombol/g) || []).length;
    const jmlIsiGrup = (rPilih.teks.match(/class="isi-grup/g) || []).length;
    cek(jmlTombolGrup > 0 && jmlTombolGrup === jmlIsiGrup,
      'tiap kelompok punya tombol dan isinya (' + jmlTombolGrup + ' kelompok)');
    cek((rPilih.teks.match(/ aktif"/g) || []).length >= 1 && rPilih.teks.includes('sembunyi'),
      'satu kelompok terbuka sejak awal, sisanya tersembunyi');
    // Jumlah baris HARUS sama dengan jumlah kategori yang boleh diajukan peran itu —
    // bukan seluruh kategori. Store Manager sengaja tidak melihat kategori Back Office.
    const jmlBaris = (rPilih.teks.match(/class="baris"/g) || []).length;
    const bolehSm = Number(await db.nilai(
      `SELECT COUNT(DISTINCT k.id) AS n FROM kategori k JOIN aturan a ON a.kategori_id = k.id
       WHERE k.aktif = 1 AND a.aktif = 1 AND (a.peran_pemohon = 'store_manager'
         OR a.peran_pemohon LIKE 'store_manager,%' OR a.peran_pemohon LIKE '%,store_manager'
         OR a.peran_pemohon LIKE '%,store_manager,%')`));
    cek(jmlBaris === bolehSm,
      'baris yang tampil = kategori yang boleh diajukan perannya (' + jmlBaris + '/' + bolehSm + ')');
    cek(rPilih.teks.includes('href="/pengajuan/baru/CAPEX"'), 'tiap baris menautkan ke formulirnya');

    // Administrator melihat seluruh kategori aktif.
    const rPilihAdm = await adm.get('/pengajuan/baru');
    const barisAdm = (rPilihAdm.teks.match(/class="baris"/g) || []).length;
    const semuaKategori = Number(await db.nilai('SELECT COUNT(*) AS n FROM kategori WHERE aktif = 1'));
    cek(barisAdm === semuaKategori,
      'Administrator melihat seluruh kategori (' + barisAdm + '/' + semuaKategori + ')');
    cek(!rPilih.teks.includes('MKT-ADS'), 'Store Manager tidak melihat kategori Back Office');

    const skripPilih = fs.readFileSync(P('public/js/app.js'), 'utf8');
    cek(/pasangPilihKategori/.test(skripPilih) && /classList\.toggle\('sembunyi'/.test(skripPilih),
      'perpindahan kelompok ditangani berkas skrip (bukan skrip sebaris — CSP tetap ketat)');
    const gayaPilih = fs.readFileSync(P('public/css/app.css'), 'utf8');
    cek(/@media \(max-width: 820px\)[\s\S]{0,400}\.panel-kiri \{ display: none/.test(gayaPilih),
      'di layar sempit menu kelompok disembunyikan dan semua kelompok ditampilkan');
    for (const jalur of ['/admin', '/admin/pengguna', '/admin/master', '/admin/kategori', '/admin/pengaturan', '/admin/jejak']) {
      const r = await adm.get(jalur);
      cek(r.status === 200, 'halaman ' + jalur + ' tampil untuk Administrator');
    }
    // Kolom progres harus benar-benar terisi dari data, bukan sekadar ada kotaknya.
    const rDaftarProgres = await adm.get('/pengajuan');
    cek(rDaftarProgres.teks.includes('class="progres"'), 'Daftar Pengajuan punya kolom progres');
    cek(/Tahap \d+ dari \d+/.test(rDaftarProgres.teks) || /Selesai — disetujui/.test(rDaftarProgres.teks),
      'progres menyebut tahap ke berapa dari berapa');
    cek(/menunggu [A-Za-z]/.test(rDaftarProgres.teks) || /dari \d+ tahap/.test(rDaftarProgres.teks),
      'progres menyebut siapa yang sedang ditunggu');
    cek(/<span style="width: \d+%">/.test(rDaftarProgres.teks), 'bilah progres terisi sesuai persentasenya');

    const barisDb = await db.all(
      `SELECT p.status, p.langkah_kini,
              (SELECT COUNT(*) FROM persetujuan s WHERE s.pengajuan_id = p.id) AS jml,
              (SELECT COUNT(*) FROM persetujuan s WHERE s.pengajuan_id = p.id AND s.status = 'disetujui') AS oke
       FROM pengajuan p WHERE p.status = 'disetujui' LIMIT 1`);
    if (barisDb.length) {
      cek(Number(barisDb[0].oke) === Number(barisDb[0].jml),
        'dokumen berstatus disetujui memang seluruh tahapnya sudah disetujui (' +
        barisDb[0].oke + '/' + barisDb[0].jml + ')');
    }

    const rDasborProgres = await adm.get('/');
    cek(rDasborProgres.teks.includes('class="progres"'), 'Dasbor ikut menampilkan progres yang sama');

    // --- unduhan Excel (bukan CSV): dibaca ulang dengan pembaca .xlsx sendiri,
    // supaya yang dibuktikan bukan "ada berkasnya" tapi "isinya benar".
    const rXlsx = await fetch(dasar + '/pengajuan?format=xlsx', { headers: adm.header });
    const isiXlsx = Buffer.from(await rXlsx.arrayBuffer());
    cek(rXlsx.status === 200 && isiXlsx.slice(0, 2).toString() === 'PK',
      'unduhan daftar pengajuan berupa berkas Excel sungguhan (arsip ZIP)');
    cek(/spreadsheetml\.sheet/.test(rXlsx.headers.get('content-type') || ''),
      'jenis berkasnya dinyatakan sebagai Excel, bukan teks biasa');
    cek(/filename="EAPEX-Daftar-Pengajuan[^"]*\.xlsx"/.test(rXlsx.headers.get('content-disposition') || ''),
      'nama berkasnya jelas: ' + String(rXlsx.headers.get('content-disposition')).slice(0, 60));

    const bacaXlsx = require('../lib/xlsx-ringkas');
    const teksXlsx = bacaXlsx.keTeks(isiXlsx);
    cek(teksXlsx.includes('Nomor') && teksXlsx.includes('Total (Rp)') && teksXlsx.includes('Progres'),
      'baris kepala tabel lengkap di dalam berkasnya');
    cek(teksXlsx.includes(doc.nomor), 'dokumen yang ada di layar ikut terbawa ke berkas Excel');
    // Kolom uang harus ANGKA, bukan teks — kalau teks, Accounting tidak bisa menjumlahnya.
    cek(new RegExp('\\t' + Number(doc.total) + '(\\t|$)', 'm').test(teksXlsx),
      'kolom Total tersimpan sebagai angka (' + doc.total + '), bukan teks berformat');
    cek(!/format=csv/.test((await adm.get('/pengajuan')).teks), 'tombol unduhan CSV sudah tidak ada di layar');

    // notifikasi tercatat untuk penyetuju
    const jmlNotif = Number(await db.nilai(
      `SELECT COUNT(*) AS n FROM notifikasi WHERE pengguna_id = (SELECT id FROM pengguna WHERE email = 'am.barat@kla.co.id')`));
    cek(jmlNotif > 0, 'notifikasi tercatat untuk penyetuju (' + jmlNotif + ' pesan)');

    // jejak audit terisi
    const jmlJejak = Number(await db.nilai('SELECT COUNT(*) AS n FROM jejak'));
    cek(jmlJejak > 10, 'jejak audit terisi (' + jmlJejak + ' kejadian)');
    const adaLoginGagal = Number(await db.nilai("SELECT COUNT(*) AS n FROM jejak WHERE aksi = 'login-gagal'"));
    cek(adaLoginGagal > 0, 'percobaan login gagal ikut tercatat di jejak audit');

    // ---------------------------------------------------------------- wajib ganti sandi
    // Ditaruh paling akhir di antara pemeriksaan HTTP karena menyetel ulang sandi
    // lewat menu Admin mengakhiri SEMUA sesi login yang sedang berjalan.
    judul('D9. WAJIB GANTI SANDI SAAT LOGIN PERTAMA');
    const SANDI_BARU = 'SandiBaru2026';
    const emailUji = 'mkt.staf@kla.co.id';
    await db.run('UPDATE pengguna SET wajib_ganti_sandi = 1 WHERE email = ?', [emailUji]);

    const baru = new Klien(dasar);
    const rMasukBaru = await baru.masuk(emailUji, SANDI);
    cek(rMasukBaru.status === 303 && rMasukBaru.lokasi === '/ganti-sandi',
      'login pertama langsung diarahkan ke halaman Ganti Sandi');

    const rDasborTertahan = await baru.get('/');
    cek(rDasborTertahan.status === 302 && rDasborTertahan.lokasi === '/ganti-sandi',
      'halaman lain tetap dipantulkan ke Ganti Sandi sebelum sandi diganti');
    const rDaftarTertahan = await baru.get('/pengajuan');
    cek(rDaftarTertahan.status === 302 && rDaftarTertahan.lokasi === '/ganti-sandi',
      'daftar pengajuan juga tertahan');

    // Bahkan permintaan yang MENGUBAH data harus tertahan, bukan cuma halaman biasa.
    const katMkt = await kat('MKT-ADS');
    const aturMkt = await db.get('SELECT id FROM aturan WHERE kategori_id = ?', [katMkt.id]);
    const jmlSebelum = Number(await db.nilai('SELECT COUNT(*) AS n FROM pengajuan'));
    // Pakai token CSRF yang SAH, supaya yang diuji benar-benar penjaga ganti-sandi
    // dan bukan penjaga CSRF yang kebetulan lebih dulu menolak.
    const tokenSah = await baru.csrf('/ganti-sandi');
    const rKirimTertahan = await baru.postBerkas('/pengajuan', lengkapi('biaya', [
      ['kategori_id', katMkt.id], ['aturan_id', aturMkt ? aturMkt.id : ''], ['judul', 'Uji tembus'],
      ['item_nama', 'Ads'], ['item_qty', '1'], ['item_harga', '1.000.000'], ['aksi', 'ajukan'],
    ]), BERKAS_UJI, tokenSah);
    const jmlSesudah = Number(await db.nilai('SELECT COUNT(*) AS n FROM pengajuan'));
    cek(rKirimTertahan.status === 303 && rKirimTertahan.lokasi === '/ganti-sandi' && jmlSesudah === jmlSebelum,
      'pengiriman data pun dipantulkan ke Ganti Sandi — tidak ada dokumen yang tercipta');

    const halGanti = await baru.get('/ganti-sandi');
    cek(halGanti.status === 200 && halGanti.teks.includes('wajib diganti'),
      'halaman Ganti Sandi menjelaskan kenapa sandi harus diganti');

    const cobaGanti = async (lama, b1, b2) => {
      const t = await baru.csrf('/ganti-sandi');
      return baru.post('/ganti-sandi', [['sandi_lama', lama], ['sandi_baru', b1], ['sandi_ulang', b2]], t);
    };

    const rPendek = await cobaGanti(SANDI, 'abc12', 'abc12');
    cek(rPendek.status === 400 && rPendek.teks.includes('minimal 8'), 'sandi baru terlalu pendek ditolak');

    const rTanpaAngka = await cobaGanti(SANDI, 'sandipanjang', 'sandipanjang');
    cek(rTanpaAngka.status === 400 && rTanpaAngka.teks.includes('angka'), 'sandi baru tanpa angka ditolak');

    const rBeda = await cobaGanti(SANDI, SANDI_BARU, SANDI_BARU + 'x');
    cek(rBeda.status === 400 && rBeda.teks.includes('tidak sama'), 'ulangan sandi yang tidak sama ditolak');

    const rSama = await cobaGanti(SANDI, SANDI, SANDI);
    cek(rSama.status === 400 && rSama.teks.includes('berbeda dari sandi lama'), 'sandi baru sama dengan sandi lama ditolak');

    const rSalahLama = await cobaGanti('sandi-lama-salah', SANDI_BARU, SANDI_BARU);
    cek(rSalahLama.status === 400 && rSalahLama.teks.includes('Sandi saat ini salah'),
      'tidak bisa mengganti sandi tanpa tahu sandi lamanya');

    const masihWajib = Number(await db.nilai('SELECT wajib_ganti_sandi AS n FROM pengguna WHERE email = ?', [emailUji]));
    cek(masihWajib === 1, 'setelah semua penolakan, statusnya masih wajib ganti sandi');

    const rBerhasil = await cobaGanti(SANDI, SANDI_BARU, SANDI_BARU);
    cek(rBerhasil.status === 303, 'penggantian sandi yang sah diterima');
    const sudahGanti = Number(await db.nilai('SELECT wajib_ganti_sandi AS n FROM pengguna WHERE email = ?', [emailUji]));
    cek(sudahGanti === 0, 'penanda "wajib ganti sandi" dicabut setelah diganti');

    const rDasborLolos = await baru.get('/');
    cek(rDasborLolos.status === 200, 'setelah ganti sandi, aplikasi bisa dipakai normal');

    const lamaTakBisa = new Klien(dasar);
    const rSandiLama = await lamaTakBisa.masuk(emailUji, SANDI);
    cek(rSandiLama.status === 401, 'sandi lama tidak bisa dipakai lagi');
    const rSandiBaru = await lamaTakBisa.masuk(emailUji, SANDI_BARU);
    cek(rSandiBaru.status === 303 && rSandiBaru.lokasi === '/', 'sandi baru langsung masuk tanpa dipaksa ganti lagi');

    // Akun yang baru dibuat Administrator juga harus wajib ganti sandi
    const tBuatUser = await adm.csrf('/admin/pengguna');
    await adm.post('/admin/pengguna', [
      ['nama', 'Uji Pengguna Baru'], ['email', 'uji.baru@kla.co.id'], ['peran', 'staf'], ['aktif', '1'],
    ], tBuatUser);
    const userBaru = await db.get(
      "SELECT wajib_ganti_sandi FROM pengguna WHERE email = 'uji.baru@kla.co.id'");
    cek(userBaru && Number(userBaru.wajib_ganti_sandi) === 1,
      'akun yang dibuat Administrator juga wajib ganti sandi saat login pertama');

    // Setel ulang sandi oleh Administrator mengembalikan kewajiban itu
    const idUji = await db.nilai('SELECT id FROM pengguna WHERE email = ?', [emailUji]);
    const tReset = await adm.csrf('/admin/pengguna');
    await adm.post('/admin/pengguna/' + idUji + '/reset-sandi', [], tReset);
    const setelahReset = Number(await db.nilai('SELECT wajib_ganti_sandi AS n FROM pengguna WHERE email = ?', [emailUji]));
    cek(setelahReset === 1, 'setel ulang sandi oleh Administrator mewajibkan ganti sandi lagi');
    const sesiTersisa = Number(await db.nilai('SELECT COUNT(*) AS n FROM sesi'));
    cek(sesiTersisa === 0, 'setel ulang sandi mengakhiri seluruh sesi login yang sedang berjalan');

    // ---------------------------------------------------------------- PWA
    judul('D10. APLIKASI HP (PWA) & NOTIFIKASI');
    // Bagian D9 menyetel ulang sandi lewat menu Admin, yang sengaja mengakhiri
    // SELURUH sesi login. Klien di bawah ini harus masuk lagi.
    await sm.masuk('sm.smg@kla.co.id', SANDI);

    const rManifest = await tamu.get('/manifest.webmanifest');
    cek(rManifest.status === 200, 'manifest terbuka tanpa login (peramban memuatnya sebelum login)');
    let manifest = null;
    try { manifest = JSON.parse(rManifest.teks); } catch (e) { manifest = null; }
    cek(!!manifest, 'manifest berupa JSON yang sah');
    if (manifest) {
      cek(manifest.name && manifest.short_name && manifest.start_url === '/' && manifest.display === 'standalone',
        'manifest memuat nama, start_url, dan mode standalone');
      const ukuran = (manifest.icons || []).map(i => i.sizes);
      cek(ukuran.includes('192x192') && ukuran.includes('512x512'), 'manifest memuat ikon 192 & 512');
      cek((manifest.icons || []).some(i => i.purpose === 'maskable'), 'manifest memuat ikon maskable (Android)');
    }

    // Pembaca piksel PNG seadanya — cukup untuk memeriksa warna latar ikon.
    const bacaPiksel = (berkas, x, y) => {
      const b = fs.readFileSync(berkas);
      const lebar = b.readUInt32BE(16);
      const potongan = [];
      let i = 8;
      while (i < b.length) {
        const panjang = b.readUInt32BE(i);
        if (b.slice(i + 4, i + 8).toString('ascii') === 'IDAT') potongan.push(b.slice(i + 8, i + 8 + panjang));
        i += 12 + panjang;
      }
      const mentah = require('zlib').inflateSync(Buffer.concat(potongan));
      const o = y * (lebar * 4 + 1) + 1 + x * 4;
      return [mentah[o], mentah[o + 1], mentah[o + 2], mentah[o + 3]];
    };

    for (const berkasIkon of ['/gambar/ikon-192.png', '/gambar/ikon-512.png',
      '/gambar/ikon-maskable-512.png', '/gambar/apple-touch-icon.png']) {
      const jalurIkon = P('public' + berkasIkon);
      const adaIkon = fs.existsSync(jalurIkon);
      const sahPng = adaIkon && fs.readFileSync(jalurIkon).slice(0, 8).toString('hex') === '89504e470d0a1a0a';
      cek(sahPng, 'ikon ' + path.basename(berkasIkon) + ' ada dan berupa PNG yang sah');
    }

    // Ikon maskable (Android) & apple-touch (iPhone) dipasang TANPA sudut tumpul
    // oleh sistemnya sendiri, jadi latarnya wajib pekat sampai ke pojok. Pernah
    // keliru jadi abu-abu 50% tembus pandang (31 Jul 2026).
    const UNGU_MEREK = [70, 24, 102];   // #461866, diambil dari berkas logo KLA
    for (const berkasPenuh of ['ikon-maskable-512.png', 'apple-touch-icon.png']) {
      const [m, e, r, a] = bacaPiksel(P('public/gambar/' + berkasPenuh), 4, 4);
      cek(a === 255 && m === UNGU_MEREK[0] && e === UNGU_MEREK[1] && r === UNGU_MEREK[2],
        berkasPenuh + ' berlatar penuh warna merek (RGBA ' + [m, e, r, a].join(',') + ')');
    }
    const [, , , alphaPojok] = bacaPiksel(P('public/gambar/ikon-512.png'), 2, 2);
    cek(alphaPojok === 0, 'ikon biasa tetap bersudut tumpul (pojoknya tembus pandang)');

    // Cap versi aset. Tanpa ini, service worker menyajikan CSS/JS lama selamanya
    // dan pembaruan tampilan tidak pernah sampai ke layar (kejadian 31 Jul 2026).
    const rHalamanMasuk = await tamu.get('/login');
    const capCss = /\/css\/app\.css\?v=([0-9a-f]{8})/.exec(rHalamanMasuk.teks);
    cek(!!capCss, 'alamat CSS memakai cap versi' + (capCss ? ' (' + capCss[1] + ')' : ''));
    const capJs = /\/js\/app\.js\?v=([0-9a-f]{8})/.exec(rHalamanMasuk.teks);
    cek(!!capJs, 'alamat JavaScript memakai cap versi' + (capJs ? ' (' + capJs[1] + ')' : ''));
    if (capCss) {
      const capSeharusnya = require('crypto').createHash('sha1')
        .update(fs.readFileSync(P('public/css/app.css'))).digest('hex').slice(0, 8);
      cek(capCss[1] === capSeharusnya, 'cap versi CSS sesuai isi berkasnya saat ini');
    }

    const rSw = await tamu.get('/sw.js');
    cek(rSw.status === 200 && /addEventListener\('push'/.test(rSw.teks),
      'service worker terbuka di akar alamat dan menangani notifikasi push');
    cek(!/'\/css\/app\.css'|'\/js\/app\.js'/.test(rSw.teks),
      'service worker tidak lagi mengunci alamat CSS/JS tanpa cap versi');
    // Bagian penanganan halaman (navigate) tidak boleh menyimpan apa pun ke cache:
    // isi dokumen memuat nominal & keputusan approval, jangan tertinggal di HP.
    const bagianNavigasi = rSw.teks.slice(rSw.teks.indexOf("req.mode === 'navigate'"));
    cek(rSw.teks.includes("req.mode === 'navigate'") && !/caches\.open|cache\.put/.test(bagianNavigasi),
      'halaman dokumen tidak ikut disimpan di HP (hanya kerangka aplikasi)');

    const rLuring = await tamu.get('/luring');
    cek(rLuring.status === 200 && rLuring.teks.includes('Tidak ada jaringan'),
      'halaman luring tersedia untuk ditampilkan saat jaringan mati');
    cek(!rLuring.teks.includes('Store Manager') && !rLuring.teks.includes('Keluar'),
      'halaman luring tidak memuat data pengguna (aman disimpan di HP)');

    // Identitas merek: logo KLA & warna ungu harus benar-benar terpasang.
    cek(fs.existsSync(P('public/gambar/logo-kla.png')), 'berkas logo KLA ada di proyek');
    cek(fs.existsSync(P('public/gambar/logo-kla-lambang.png')), 'lambang logo tanpa latar tersedia');

    // Lambang hasil potongan harus BENAR-BENAR terpangkas & transparan, bukan
    // kotak ungu utuh yang cuma diperkecil lewat CSS.
    const lambang = fs.readFileSync(P('public/gambar/logo-kla-lambang.png'));
    const lebarLambang = lambang.readUInt32BE(16), tinggiLambang = lambang.readUInt32BE(20);
    cek(lebarLambang > tinggiLambang * 1.6,
      'lambang sudah dipangkas jadi memanjang (' + lebarLambang + 'x' + tinggiLambang + '), bukan kotak');
    // Sudut gambar TIDAK dipakai sebagai penanda: potongannya pas di tepi huruf,
    // jadi sudut kiri-atas justru bagian huruf "K". Yang membuktikan latarnya
    // benar-benar dibuang adalah banyaknya piksel tembus pandang di sela huruf.
    const porsiTembus = (() => {
      const b = fs.readFileSync(P('public/gambar/logo-kla-lambang.png'));
      const lebar = b.readUInt32BE(16), tinggi = b.readUInt32BE(20);
      const potongan = [];
      let i = 8;
      while (i < b.length) {
        const panjang = b.readUInt32BE(i);
        if (b.slice(i + 4, i + 8).toString('ascii') === 'IDAT') potongan.push(b.slice(i + 8, i + 8 + panjang));
        i += 12 + panjang;
      }
      const mentah = require('zlib').inflateSync(Buffer.concat(potongan));
      let tembus = 0;
      for (let y = 0; y < tinggi; y++) {
        for (let x = 0; x < lebar; x++) {
          if (mentah[y * (lebar * 4 + 1) + 1 + x * 4 + 3] === 0) tembus++;
        }
      }
      return tembus / (lebar * tinggi);
    })();
    cek(porsiTembus > 0.25,
      'latar lambang dibuang — ' + Math.round(porsiTembus * 100) + '% pikselnya tembus pandang');

    const wajahMerek = [
      ['views/partials/atas.ejs', 'logo-kla-lambang.png', 'lambang di bilah samping'],
      ['views/login.ejs', 'logo-kla-lambang.png', 'lambang di halaman masuk'],
      ['views/luring.ejs', 'logo-kla-lambang.png', 'lambang di halaman luring'],
      ['views/cetak.ejs', 'logo-kla.png', 'logo penuh di kop cetakan (di atas kertas putih)'],
    ];
    for (const [berkasMerek, berkasLogo, sebutan] of wajahMerek) {
      cek(fs.readFileSync(P(berkasMerek), 'utf8').includes('src="/gambar/' + berkasLogo + '"'), sebutan);
    }
    const gaya = fs.readFileSync(P('public/css/app.css'), 'utf8');
    cek(gaya.includes('#461866') && gaya.includes('#f7bf0a'), 'palet CSS memakai ungu & emas merek KLA');
    cek(!/#0f1c33|#1e4b8f|#16274a/.test(gaya), 'tidak ada sisa warna biru dari tema lama');
    // Ukuran logo dibatasi di CSS supaya tidak lagi tampil sebesar sebelumnya.
    cek(/\.samping \.merek img\.logo \{[^}]*height: 26px/.test(gaya), 'lambang di bilah samping dibatasi 26px');
    cek(/\.kotak-masuk \.merek img\.logo \{[^}]*height: 34px/.test(gaya), 'lambang di halaman masuk dibatasi 34px');
    cek(gaya.includes('backdrop-filter') && gaya.includes('linear-gradient'),
      'tema memakai efek kaca & gradasi (tampilan futuristik)');
    cek(/body \{[\s\S]{0,400}background: var\(--ungu-900\)/.test(gaya), 'latar aplikasi gelap sesuai tema');
    const manifestTeks = fs.readFileSync(P('public/manifest.webmanifest'), 'utf8');
    cek(manifestTeks.includes('"theme_color": "#461866"'), 'warna tema aplikasi terpasang = ungu merek');
    for (const [berkasTema] of [['views/partials/atas.ejs'], ['views/login.ejs'], ['views/luring.ejs']]) {
      cek(fs.readFileSync(P(berkasTema), 'utf8').includes('content="#461866"'),
        'warna bilah status HP di ' + path.basename(berkasTema) + ' = ungu merek');
    }

    const rHalamanPwa = await sm.get('/');
    cek(rHalamanPwa.teks.includes('rel="manifest"') && rHalamanPwa.teks.includes('apple-touch-icon'),
      'halaman aplikasi menautkan manifest & ikon iPhone');
    cek(rHalamanPwa.teks.includes('apple-mobile-web-app-capable'),
      'penanda khusus iPhone terpasang (aplikasi tidak terbuka di dalam Safari biasa)');

    const rKunci = await sm.get('/api/notifikasi/kunci');
    const kunci = JSON.parse(rKunci.teks);
    cek(rKunci.status === 200 && kunci.ok === true, 'endpoint kunci notifikasi menjawab');
    cek(kunci.aktif === false && kunci.kunci === '',
      'tanpa kunci VAPID, notifikasi HP dinyatakan mati — bukan gagal diam-diam');

    const rLanggananTamu = await tamu.get('/api/notifikasi/kunci');
    cek(rLanggananTamu.status === 401, 'endpoint notifikasi menolak yang belum login');

    const tCsrfPush = await sm.csrf('/notifikasi');
    const rDaftarPush = await sm.post('/api/notifikasi/langganan', [], tCsrfPush);
    cek(rDaftarPush.status === 503, 'mendaftar notifikasi ditolak rapi saat server belum punya kunci');

    const rPushTanpaToken = await sm.post('/api/notifikasi/langganan', [], 'token-palsu');
    cek(rPushTanpaToken.status === 403, 'pendaftaran notifikasi tetap dijaga token CSRF');

    const rHalNotif = await sm.get('/notifikasi');
    cek(rHalNotif.teks.includes('tombol-notifikasi') && rHalNotif.teks.includes('petunjuk-ios'),
      'halaman notifikasi menyediakan tombol aktifkan & petunjuk iPhone');

    const modulPush = require('../lib/push');
    cek(modulPush.aktif() === false, 'modul push mati bila kunci VAPID kosong');
    const hasilKosong = await modulPush.kirimKe(['siapa-saja'], { judul: 'x', pesan: 'y' });
    cek(hasilKosong.terkirim === 0, 'mengirim tanpa kunci tidak melempar galat (approval tetap jalan)');

    // Penyimpanan langganan diuji langsung — bagian ini jalan walau kunci VAPID kosong,
    // dan justru di sinilah data perangkat pengguna disimpan.
    const idSm = await db.nilai("SELECT id FROM pengguna WHERE email = 'sm.smg@kla.co.id'");
    const langgananUji = {
      endpoint: 'https://contoh.push.example/abc123',
      keys: { p256dh: 'kunciP256DH', auth: 'kunciAuth' },
    };
    await modulPush.simpanLangganan(idSm, langgananUji, 'Uji/1.0');
    cek(await modulPush.jumlahLangganan(idSm) === 1, 'langganan notifikasi tersimpan untuk penggunanya');

    await modulPush.simpanLangganan(idSm, langgananUji, 'Uji/1.0');
    cek(await modulPush.jumlahLangganan(idSm) === 1,
      'mendaftar dua kali dari perangkat yang sama tidak menggandakan langganan');

    const idAm = await db.nilai("SELECT id FROM pengguna WHERE email = 'am.barat@kla.co.id'");
    await modulPush.simpanLangganan(idAm, langgananUji, 'Uji/1.0');
    cek(await modulPush.jumlahLangganan(idSm) === 0 && await modulPush.jumlahLangganan(idAm) === 1,
      'HP yang berpindah pemilik ikut berpindah langganan (notifikasi tidak nyasar)');

    let ditolakTakLengkap = false;
    try { await modulPush.simpanLangganan(idSm, { endpoint: 'https://a/b' }, ''); }
    catch (e) { ditolakTakLengkap = !!e.publik; }
    cek(ditolakTakLengkap, 'langganan tanpa kunci enkripsi ditolak');

    let ditolakBukanHttps = false;
    try {
      await modulPush.simpanLangganan(idSm, { endpoint: 'http://tidak-aman/x', keys: { p256dh: 'a', auth: 'b' } }, '');
    } catch (e) { ditolakBukanHttps = !!e.publik; }
    cek(ditolakBukanHttps, 'alamat layanan notifikasi non-HTTPS ditolak');

    await modulPush.hapusLangganan(langgananUji.endpoint);
    cek(await modulPush.jumlahLangganan(idAm) === 0, 'langganan bisa dicabut kembali');

    // ------------------------------------------------- D11. lampiran sejak awal
    judul('D11. LAMPIRAN PENAWARAN SEJAK FORMULIR PERTAMA');
    {
      const fsUji = require('fs');
      const { DIR: DIR_LAMPIRAN } = require('../lib/unggah');
      const isiDir = () => { try { return fsUji.readdirSync(DIR_LAMPIRAN); } catch (e) { return []; } };

      // Penyetel ulang sandi oleh Admin (diuji lebih dulu) sengaja menghapus SEMUA
      // sesi, jadi klien dari bagian sebelumnya sudah keluar. Keduanya masuk lagi
      // di sini — yang kedua dipakai membuktikan lampiran tidak bisa diambil orang
      // yang tidak berhak.
      await db.run('UPDATE pengguna SET wajib_ganti_sandi = 0');
      const smLain = new Klien(dasar);
      const rMasukLain = await smLain.masuk('sm.ygy@kla.co.id', SANDI);
      cek(rMasukLain.status === 303, 'Store Manager cabang lain berhasil masuk (untuk uji wewenang lampiran)');

      const smL = new Klien(dasar);
      await smL.masuk('sm.smg@kla.co.id', SANDI);
      const katBiaya = await kat('CAPEX');
      const aturBiaya = await aturanDari('CAPEX', 'store');
      const smgL = await cabangKode('SMG');
      const medanDasar = [
        ['kategori_id', katBiaya.id], ['aturan_id', aturBiaya.id], ['cabang_id', smgL.id],
        ['judul', 'Pengadaan rak display'], ['nama_proyek', 'Rak display'],
        ['justifikasi', 'Rak lama keropos.'], ['status_anggaran', 'budgeted'],
        ['kategori_aset', 'Inventaris'],
        ['item_nama', 'Rak'], ['item_qty', '1'], ['item_satuan', 'unit'], ['item_harga', '3.000.000'],
      ];
      const penawaran = { nama: 'Penawaran-Vendor.pdf', mime: 'application/pdf', isi: '%PDF-1.4 penawaran uji' };

      // 1) formulir baru + berkas dalam SATU kiriman → dokumen dan lampirannya jadi bersamaan
      const tokL = await smL.csrf('/pengajuan/baru/CAPEX');
      const sebelum = isiDir().length;
      const rL = await smL.postBerkas('/pengajuan',
        medanDasar.concat([['aksi', 'draft']]), [penawaran], tokL);
      cek(rL.status === 303, 'formulir berisi berkas diterima (multipart)');

      const docL = await db.get(
        `SELECT * FROM pengajuan WHERE judul = 'Pengadaan rak display' ORDER BY dibuat DESC LIMIT 1`);
      const lampL = docL ? await db.all('SELECT * FROM lampiran WHERE pengajuan_id = ?', [docL.id]) : [];
      cek(lampL.length === 1 && lampL[0].nama_asli === 'Penawaran-Vendor.pdf',
        'lampiran tersimpan bersama draft, tanpa langkah unggah terpisah');
      cek(!!lampL[0] && Number(lampL[0].ukuran) > 0 && lampL[0].nama_simpan !== lampL[0].nama_asli,
        'berkas disimpan dengan nama acak, nama aslinya di basis data');

      // 2) token CSRF salah → ditolak DAN berkasnya tidak tertinggal di cakram
      const sblmPalsu = isiDir().length;
      const rPalsu = await smL.postBerkas('/pengajuan',
        medanDasar.concat([['aksi', 'draft']]), [penawaran], 'token-palsu');
      cek(rPalsu.status === 403, 'kiriman berisi berkas dengan token CSRF palsu ditolak 403');
      await new Promise(r => setTimeout(r, 60));
      cek(isiDir().length === sblmPalsu, 'berkas dari kiriman yang ditolak tidak tertinggal di cakram');

      // 3) isian belum lengkap saat "ajukan" → berkas juga tidak tertinggal
      const sblmGagal = isiDir().length;
      const tokGagal = await smL.csrf('/pengajuan/baru/CAPEX');
      const rGagal = await smL.postBerkas('/pengajuan', [
        ['kategori_id', katBiaya.id], ['aturan_id', aturBiaya.id], ['cabang_id', smgL.id],
        ['judul', ''], ['aksi', 'ajukan'],
      ], [penawaran], tokGagal);
      cek(rGagal.status === 400 && /pilih berkasnya sekali lagi/i.test(rGagal.teks),
        'isian belum lengkap: pengguna diberi tahu lampirannya harus dipilih ulang');
      await new Promise(r => setTimeout(r, 60));
      cek(isiDir().length === sblmGagal, 'berkas dari kiriman gagal tidak menumpuk jadi berkas yatim');

      // 4) jenis berkas berbahaya tetap ditolak
      const rJahat = await smL.postBerkas('/pengajuan',
        medanDasar.concat([['aksi', 'draft']]),
        [{ nama: 'jahat.exe', mime: 'application/octet-stream', isi: 'MZ' }],
        await smL.csrf('/pengajuan/baru/CAPEX'));
      cek(rJahat.status >= 400, 'berkas berekstensi berbahaya (.exe) ditolak');

      cek(isiDir().length >= sebelum + 1, 'hanya berkas yang benar-benar dipakai yang tersisa di folder lampiran');

      // 5) formulirnya memang sudah bisa mengirim berkas
      const halForm = await smL.get('/pengajuan/baru/CAPEX');
      cek(/enctype="multipart\/form-data"/.test(halForm.teks), 'formulir dikirim sebagai multipart');
      const posisiUnggah = halForm.teks.indexOf('id="berkas-awal"');
      const posisiJudul = halForm.teks.indexOf('name="judul"');
      cek(posisiUnggah > 0 && posisiUnggah < posisiJudul,
        'kotak lampiran berada di AWAL formulir, sebelum isian dokumen');

      // 6) tidak ada rute berkas yang lolos tanpa pemeriksaan CSRF
      const kodeRute = fsUji.readdirSync(path.join(__dirname, '..', 'routes'))
        .map(f => fsUji.readFileSync(path.join(__dirname, '..', 'routes', f), 'utf8')).join('\n');
      cek(!/unggah\.array\s*\(/.test(kodeRute),
        'semua penerima berkas lewat terimaBerkas() — pemeriksaan CSRF tidak bisa terlewat');

      // 7) berkas bisa diunduh kembali utuh, oleh yang berhak saja
      const lampU = lampL[0];
      const rUnduh = await smL.get(`/pengajuan/${docL.id}/lampiran/${lampU.id}`);
      cek(rUnduh.status === 200 && rUnduh.teks.includes('penawaran uji'),
        'lampiran bisa diunduh kembali dengan isi yang sama persis');

      const rCuri = await smLain.get(`/pengajuan/${docL.id}/lampiran/${lampU.id}`);
      cek(rCuri.status === 403,
        'Store Manager cabang lain tidak bisa mengunduh lampiran cabang ini (status ' + rCuri.status + ')');
    }

    // ------------------------------------------- D13. isian & lampiran wajib
    judul('D13. ISIAN DAN LAMPIRAN WAJIB');
    {
      const smW = new Klien(dasar);
      await smW.masuk('sm.smg@kla.co.id', SANDI);
      const katW = await kat('CAPEX');
      const aturW = await aturanDari('CAPEX', 'store');
      const smgW = await cabangKode('SMG');
      const dasarMedan = [
        ['kategori_id', katW.id], ['aturan_id', aturW.id], ['cabang_id', smgW.id],
        ['judul', 'Uji isian wajib'],
        ['item_nama', 'AC 2 PK'], ['item_qty', '2'], ['item_satuan', 'unit'], ['item_harga', '6.500.000'],
      ];

      // 1) lengkap TAPI tanpa lampiran → tidak jadi diajukan
      const rTanpaLampiran = await smW.post('/pengajuan',
        lengkapi('capex', dasarMedan.concat([['aksi', 'ajukan']])),
        await smW.csrf('/pengajuan/baru/CAPEX'));
      const dokTanpa = await db.get("SELECT * FROM pengajuan WHERE judul = 'Uji isian wajib'");
      cek(!!dokTanpa && dokTanpa.status === 'draft',
        'isian lengkap tapi TANPA lampiran → tidak jadi diajukan, ditahan sebagai draft');
      cek(rTanpaLampiran.status === 303, 'pemohon dikembalikan ke dokumennya, bukan halaman galat');

      // 2) ada lampiran tapi isian kurang → ditolak, kolomnya disebut
      const rKurang = await smW.postBerkas('/pengajuan', [
        ['kategori_id', katW.id], ['aturan_id', aturW.id], ['cabang_id', smgW.id],
        ['judul', 'Uji isian kurang'], ['nama_proyek', 'Ada'],
        ['item_nama', 'AC 2 PK'], ['item_qty', '2'], ['item_satuan', 'unit'], ['item_harga', '6.500.000'],
        ['aksi', 'ajukan'],
      ], BERKAS_UJI, await smW.csrf('/pengajuan/baru/CAPEX'));
      cek(rKurang.status === 400, 'isian kurang → kiriman ditolak (400), tidak diteruskan ke penyetuju');
      cek(/Justifikasi wajib diisi/i.test(rKurang.teks) && /Vendor wajib diisi/i.test(rKurang.teks),
        'pesan galat menyebut kolom mana yang kosong, bukan sekadar "isian tidak lengkap"');

      // 3) draft boleh setengah jadi
      const rDraft = await smW.post('/pengajuan', [
        ['kategori_id', katW.id], ['aturan_id', aturW.id], ['cabang_id', smgW.id],
        ['judul', 'Draft setengah jadi'], ['aksi', 'draft'],
      ], await smW.csrf('/pengajuan/baru/CAPEX'));
      const dokDraft = await db.get("SELECT * FROM pengajuan WHERE judul = 'Draft setengah jadi'");
      cek(rDraft.status === 303 && !!dokDraft && dokDraft.status === 'draft',
        'draft tetap boleh disimpan walau isian belum lengkap dan tanpa lampiran');

      // 4) kolom yang SENGAJA tidak wajib tetap boleh nol/kosong
      const rNol = await smW.postBerkas('/pengajuan',
        lengkapi('capex', dasarMedan.map(m => (m[0] === 'judul' ? ['judul', 'Uji kolom boleh nol'] : m))
          .concat([['pengiriman', '0'], ['instalasi', '0'], ['biaya_lain', '0'],
            ['sales_tambahan', ''], ['margin_persen', ''], ['aksi', 'ajukan']])),
        BERKAS_UJI, await smW.csrf('/pengajuan/baru/CAPEX'));
      const dokNol = await db.get("SELECT status FROM pengajuan WHERE judul = 'Uji kolom boleh nol'");
      cek(rNol.status === 303 && !!dokNol && dokNol.status === 'menunggu',
        'ongkos kirim/instalasi/analisa retail boleh nol — nol itu jawaban yang sah');

      // 5) baris rincian tanpa harga ditolak
      const rHargaNol = await smW.postBerkas('/pengajuan',
        lengkapi('capex', [
          ['kategori_id', katW.id], ['aturan_id', aturW.id], ['cabang_id', smgW.id],
          ['judul', 'Uji harga nol'],
          ['item_nama', 'Barang tanpa harga'], ['item_qty', '1'], ['item_satuan', 'unit'], ['item_harga', '0'],
          ['aksi', 'ajukan'],
        ]), BERKAS_UJI, await smW.csrf('/pengajuan/baru/CAPEX'));
      cek(rHargaNol.status === 400 && /harga wajib diisi/i.test(rHargaNol.teks),
        'baris rincian berharga nol ditolak — total dokumen harus mencerminkan isinya');

      // 6) layar dan server memakai daftar wajib YANG SAMA
      const halW = await smW.get('/pengajuan/baru/CAPEX');
      const dariHalaman = (/data-wajib="([^"]*)"/.exec(halW.teks) || [])[1] || '';
      const dariServer = Object.keys(require('../lib/formulir').medanWajib('capex')).join(',');
      cek(dariHalaman === dariServer,
        'daftar isian wajib di layar sama persis dengan yang diperiksa server');
      cek(/data-lampiran-wajib="1"/.test(halW.teks), 'formulir menyatakan lampirannya wajib');
      cek(/formnovalidate/.test(halW.teks), 'tombol Simpan Draft dikecualikan dari penguncian');

      // 7) bisa dimatikan per kategori
      await db.run('UPDATE kategori SET lampiran_wajib = 0 WHERE id = ?', [katW.id]);
      const rBebas = await smW.post('/pengajuan',
        lengkapi('capex', dasarMedan.map(m => (m[0] === 'judul' ? ['judul', 'Uji lampiran tidak wajib'] : m))
          .concat([['aksi', 'ajukan']])),
        await smW.csrf('/pengajuan/baru/CAPEX'));
      const dokBebas = await db.get("SELECT status FROM pengajuan WHERE judul = 'Uji lampiran tidak wajib'");
      cek(rBebas.status === 303 && !!dokBebas && dokBebas.status === 'menunggu',
        'kewajiban lampiran bisa dimatikan per kategori');
      await db.run('UPDATE kategori SET lampiran_wajib = 1 WHERE id = ?', [katW.id]);
    }

    // -------------------------------- D14. ambang diubah dari menu Admin
    // Pertanyaan user 31 Jul 2026: "CEO 500k bisa diubah jadi 1 juta?" — yang
    // diuji di sini bukan formulirnya tersimpan, tapi ALUR DOKUMEN benar-benar
    // berubah sesudahnya.
    judul('D14. UBAH AMBANG DARI MENU ADMIN');
    {
      const admA = new Klien(dasar);
      await admA.masuk('admin@kla.co.id', SANDI);
      const katA = await kat('PERLENGKAPAN');
      const aturA = await aturanDari('PERLENGKAPAN', 'store');
      const langkahA = await db.all(
        'SELECT * FROM aturan_langkah WHERE aturan_id = ? ORDER BY urut', [aturA.id]);

      const halMatriks = await admA.get('/admin/kategori');
      cek(halMatriks.status === 200 && /name="langkah_min"/.test(halMatriks.teks),
        'ada menu Matriks Approval dengan kolom ambang yang bisa diubah');
      cek(!/name="ambang_ceo"/.test(halMatriks.teks),
        'tidak ada lagi kotak "ambang" kedua yang menyesatkan — hanya satu tempat mengubahnya');

      // Kirim seperti formulirnya: seluruh langkah dikirim ulang, ambang CEO 1 juta.
      const medanMatriks = [['aktif', '1']];
      for (const p of String(aturA.peran_pemohon || '').split(',')) {
        if (p) medanMatriks.push(['peran_pemohon', p]);
      }
      for (const l of langkahA) {
        medanMatriks.push(['langkah_peran', l.peran]);
        medanMatriks.push(['langkah_label', l.label || '']);
        medanMatriks.push(['langkah_min', l.peran === 'ceo' ? '1.000.000' : (l.min_nominal || '')]);
        medanMatriks.push(['langkah_lingkup', l.lingkup || 'auto']);
      }
      const rSimpan = await admA.post('/admin/kategori/aturan/' + aturA.id, medanMatriks,
        await admA.csrf('/admin/kategori'));
      cek(rSimpan.status === 303, 'perubahan matriks tersimpan');

      const ceoBaru = await db.get(
        "SELECT min_nominal FROM aturan_langkah WHERE aturan_id = ? AND peran = 'ceo'", [aturA.id]);
      cek(Number(ceoBaru.min_nominal) === 1000000, 'ambang CEO tersimpan jadi Rp 1.000.000');
      const aturSesudah = await db.get('SELECT ambang_ceo FROM aturan WHERE id = ?', [aturA.id]);
      cek(Number(aturSesudah.ambang_ceo) === 1000000,
        'penanda di daftar kategori ikut menyesuaikan sendiri — tidak bisa lagi berbeda');

      // Yang paling penting: dokumen 750.000 sekarang TIDAK lagi ke CEO.
      const smA = new Klien(dasar);
      await smA.masuk('sm.smg@kla.co.id', SANDI);
      const smgA = await cabangKode('SMG');
      const ajukanPerl = async (harga, judulDok) => {
        await smA.postBerkas('/pengajuan', lengkapi('barang', [
          ['kategori_id', katA.id], ['aturan_id', aturA.id], ['cabang_id', smgA.id],
          ['judul', judulDok],
          ['item_nama', 'Kertas HVS'], ['item_qty', '1'], ['item_satuan', 'rim'],
          ['item_harga', String(harga)], ['aksi', 'ajukan'],
        ]), BERKAS_UJI, await smA.csrf('/pengajuan/baru/PERLENGKAPAN'));
        const d = await db.get('SELECT * FROM pengajuan WHERE judul = ?', [judulDok]);
        const t = await db.all('SELECT peran FROM persetujuan WHERE pengajuan_id = ? ORDER BY urut', [d.id]);
        return t.map(x => x.peran);
      };

      const rantai750 = await ajukanPerl(750000, 'Ambang baru — 750 ribu');
      cek(!rantai750.includes('ceo'),
        'setelah ambang dinaikkan, dokumen Rp 750.000 TIDAK lagi ke CEO (' + rantai750.join(' → ') + ')');
      const rantai1jt = await ajukanPerl(1000000, 'Ambang baru — 1 juta');
      cek(rantai1jt.includes('ceo'),
        'dokumen Rp 1.000.000 tetap ke CEO (' + rantai1jt.join(' → ') + ')');

      // Dikembalikan supaya pemeriksaan lain tidak terpengaruh.
      const medanBalik = medanMatriks.map(m =>
        (m[0] === 'langkah_min' && m[1] === '1.000.000') ? ['langkah_min', '500.000'] : m);
      await admA.post('/admin/kategori/aturan/' + aturA.id, medanBalik, await admA.csrf('/admin/kategori'));
      const ceoBalik = await db.get(
        "SELECT min_nominal FROM aturan_langkah WHERE aturan_id = ? AND peran = 'ceo'", [aturA.id]);
      cek(Number(ceoBalik.min_nominal) === 500000, 'bisa dikembalikan lagi ke Rp 500.000');

      const jejakUbah = await db.all("SELECT * FROM jejak WHERE aksi = 'admin-ubah-aturan'");
      cek(jejakUbah.length >= 2, 'tiap perubahan matriks tercatat di jejak audit');
    }

    // ------------------------------------------- D12. kesiapan deploy (website)
    judul('D12. KESIAPAN DEPLOY');
    {
      const fsD = require('fs');
      const simpanan = require('../lib/simpanan');

      // Mode "disk" tidak selamat di hosting tanpa cakram tetap. Pilihan "db"
      // harus benar-benar bekerja, bukan sekadar ada namanya.
      cek(simpanan.keterangan().mode === 'disk' && !simpanan.keterangan().tahanDeploy,
        'bawaannya mode "disk" — jujur menyatakan belum tahan deploy');

      process.env.SIMPANAN = 'db';
      await simpanan.siapkan();
      const namaUji = 'uji-simpanan-' + Date.now() + '.pdf';
      fsD.writeFileSync(require('../lib/unggah').jalurBerkas(namaUji), Buffer.from('%PDF isi lampiran deploy'));
      await simpanan.pindahkan(namaUji);
      cek(!fsD.existsSync(require('../lib/unggah').jalurBerkas(namaUji)),
        'mode db: berkas tidak lagi bergantung pada cakram');
      const kembali = await simpanan.ambil(namaUji);
      cek(kembali && kembali.toString().includes('isi lampiran deploy'),
        'mode db: isi berkas kembali utuh dari basis data');
      await simpanan.hapus(namaUji);
      cek((await simpanan.ambil(namaUji)) === null, 'mode db: berkas bisa dihapus kembali');
      process.env.SIMPANAN = 'disk';

      // Berkas pendukung penyebaran
      const adaVercel = fsD.existsSync(P('vercel.json'));
      const adaApi = fsD.existsSync(P('api/index.js'));
      cek(adaVercel && adaApi, 'ada vercel.json dan titik masuk api/index.js');
      if (adaVercel) {
        const v = JSON.parse(fsD.readFileSync(P('vercel.json'), 'utf8'));
        cek(Array.isArray(v.rewrites) && v.rewrites.some(x => x.destination === '/api/index'),
          'semua alamat diarahkan ke satu titik masuk aplikasi');
      }
      if (adaApi) {
        const isiApi = fsD.readFileSync(P('api/index.js'), 'utf8');
        // Komentar dibuang dulu: berkasnya memang MENYEBUT app.listen untuk
        // menerangkan bedanya dengan server.js.
        const kodeApi = isiApi.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
        cek(!/app\.listen/.test(kodeApi), 'titik masuk hosting tidak memanggil app.listen');
        cek(/penyiapan\s*=\s*null/.test(isiApi), 'penyiapan basis data yang gagal tidak diingat sebagai berhasil');
      }

      // --- kompresi foto: syaratnya "harus tetap jelas", jadi angkanya dijaga
      const skripKompres = fsD.readFileSync(P('public/js/app.js'), 'utf8');
      const halKompres = fsD.readFileSync(P('views/pengajuan-form.ejs'), 'utf8');
      const maksPx = Number((/data-maks-piksel="(\d+)"/.exec(halKompres) || [])[1]);
      const mutuGbr = Number((/data-mutu-gambar="([\d.]+)"/.exec(halKompres) || [])[1]);
      cek(maksPx >= 1600,
        'foto dikecilkan paling banyak sampai ' + maksPx + ' piksel — di bawah 1600 tulisan mulai meragukan');
      cek(mutuGbr >= 0.8, 'mutu gambar ' + mutuGbr + ' — di bawah 0,8 angka nominal mulai kabur');
      cek(/imageOrientation:\s*'from-image'/.test(skripKompres),
        'arah foto dari HP diikutkan — foto potret tidak jadi miring');
      cek(/blob\.size >= file\.size/.test(skripKompres),
        'kalau hasilnya tidak lebih kecil, berkas asli yang dipakai');
      cek(/\/\^image\\\//.test(skripKompres) || /\/\^image\\\/\/.test\(/.test(skripKompres),
        'hanya berkas gambar yang disentuh — PDF/Excel/Word tidak pernah');
      cek(/kompresBerjalan/.test(skripKompres) && /e\.preventDefault\(\)/.test(skripKompres),
        'kiriman ditahan selama kompresi belum selesai');

      // --- Supabase
      const contohEnvDb = fsD.readFileSync(P('.env.example'), 'utf8');
      cek(/6543/.test(contohEnvDb) && /Transaction pooler/i.test(contohEnvDb),
        '.env.example mengarahkan ke Transaction pooler Supabase (port 6543)');
      const isiDb = fsD.readFileSync(P('lib/db.js'), 'utf8');
      cek(/VERCEL \|\| process\.env\.AWS_LAMBDA_FUNCTION_NAME/.test(isiDb) && /maksKolam/.test(isiDb),
        'kolam sambungan dikecilkan sendiri saat berjalan di hosting tanpa server tetap');

      const pkg = JSON.parse(fsD.readFileSync(P('package.json'), 'utf8'));
      cek(!!(pkg.optionalDependencies && pkg.optionalDependencies['better-sqlite3'])
        && !(pkg.dependencies && pkg.dependencies['better-sqlite3']),
        'better-sqlite3 jadi paket opsional — pemasangan di hosting tidak gagal karena modul asli');

      // Rahasia tidak boleh ikut ke repositori. Diuji dengan MENANYAKAN GIT
      // langsung, bukan mencocokkan pola di .gitignore — pernah terjadi
      // `data/AKUN-AWAL.txt` terdaftar tapi `data/EAPEX-Akun-Awal.docx` yang
      // isinya sama-sama sandi tidak, dan pemeriksaan berbasis pola meloloskannya.
      const RAHASIA = [
        '.env',
        'data/AKUN-AWAL.txt',
        'data/eapex.db',
        'data/EAPEX-Akun-Awal.docx',
        'data/lampiran/contoh-penawaran.pdf',
        'data/apa-pun-yang-baru.docx',
      ];
      const jalankanGit = a => require('child_process')
        .spawnSync('git', a, { cwd: P('.'), encoding: 'utf8' });
      const adaRepo = jalankanGit(['rev-parse', '--is-inside-work-tree']).status === 0;
      if (adaRepo) {
        const lolos = RAHASIA.filter(f => jalankanGit(['check-ignore', '-q', f]).status !== 0);
        cek(lolos.length === 0,
          'git benar-benar mengabaikan seluruh berkas rahasia di data/'
          + (lolos.length ? ' — LOLOS: ' + lolos.join(', ') : ''));
      } else {
        const abaikan = fsD.readFileSync(P('.gitignore'), 'utf8');
        cek(/^\.env$/m.test(abaikan) && /^data\/\*$/m.test(abaikan),
          '.gitignore memblokir .env dan seluruh isi data/ (repo belum dibuat, diperiksa dari polanya)');
      }
      // Skrip PowerShell HARUS murni ASCII. PowerShell 5.1 membaca berkas .ps1
      // tanpa BOM sebagai ANSI; satu em dash saja berubah jadi tiga karakter,
      // yang terakhir kebetulan tanda kutip tipografis — dan PowerShell
      // menerimanya sebagai penutup string. Sisa berkasnya lalu diurai sebagai
      // perintah, dan pesan galatnya menunjuk ke baris yang sama sekali tidak
      // bersalah. Sudah terjadi DUA KALI di sini.
      const berkasPs = fsD.readdirSync(P('scripts')).filter(f => f.endsWith('.ps1'));
      const kotor = berkasPs.filter(f => {
        const isi = fsD.readFileSync(P('scripts/' + f), 'utf8');
        return [...isi].some(c => c.charCodeAt(0) > 126);
      });
      cek(kotor.length === 0,
        `${berkasPs.length} skrip PowerShell murni ASCII`
        + (kotor.length ? ' — BERMASALAH: ' + kotor.join(', ') : ''));

      const contohEnv = fsD.readFileSync(P('.env.example'), 'utf8');
      cek(/OPENAI_API_KEY=\s*$/m.test(contohEnv) || /# OPENAI_API_KEY=\s*$/m.test(contohEnv),
        '.env.example memuat OPENAI_API_KEY tanpa nilai sungguhan');
      cek(/SIMPANAN/.test(contohEnv), '.env.example menerangkan pilihan penyimpanan lampiran');

      // Kunci sesi tidak boleh punya nilai bawaan diam-diam di produksi
      const isiApp = fsD.readFileSync(P('app.js'), 'utf8');
      cek(!/SESSION_SECRET\s*\|\|\s*['"][a-z0-9]{8,}/i.test(isiApp)
        || /NODE_ENV/.test(isiApp),
        'kunci sesi tidak dipatok diam-diam di kode untuk produksi');
    }

    // ---------------------------------------------------------------- kolom bulan
    judul('D15. KOLOM "JADWAL DIBUTUHKAN" & "PERIODE" — KALENDER BULAN');
    {
      const { bulanTahun } = require('../lib/util');
      cek(bulanTahun('2026-08') === 'Agustus 2026',
        'nilai kalender bulan diterjemahkan ke Bahasa Indonesia');
      cek(bulanTahun('2026-01') === 'Januari 2026' && bulanTahun('2026-12') === 'Desember 2026',
        'ujung tahun (Januari & Desember) diterjemahkan benar');
      cek(bulanTahun('Minggu kedua Agustus 2026') === 'Minggu kedua Agustus 2026',
        'data lama berformat bebas dikembalikan apa adanya, bukan dibuang — dokumen lama tetap terbaca');
      cek(bulanTahun('') === '-' && bulanTahun(null) === '-' && bulanTahun(undefined) === '-',
        'kosong ditampilkan sebagai "-"');
      cek(bulanTahun('2026-13') === '2026-13' && bulanTahun('2026-00') === '2026-00',
        'bulan di luar 1-12 dikembalikan apa adanya, bukan menebak');

      const formForm = fs.readFileSync(P('views/pengajuan-form.ejs'), 'utf8');
      cek(/type="month" name="jadwal_kebutuhan"/.test(formForm) && /type="month" name="periode"/.test(formForm),
        'kedua kolom memakai kalender bulan, bukan lagi teks bebas');

      const cssApp = fs.readFileSync(P('public/css/app.css'), 'utf8');
      cek(/input\[type=month\]/.test(cssApp),
        'kalender bulan ikut diberi gaya gelap — tanpa ini tampil putih polos, beda sendiri dari isian lain');
    }

    // ---------------------------------------------------------------- kebersihan data
    judul('F. KEBERSIHAN DATA');
    const nomorKembar = await db.all(
      'SELECT nomor, COUNT(*) AS n FROM pengajuan WHERE nomor IS NOT NULL GROUP BY nomor HAVING COUNT(*) > 1');
    cek(!nomorKembar.length, 'tidak ada nomor dokumen kembar');

    const yatim = await db.all(
      `SELECT COUNT(*) AS n FROM persetujuan s WHERE NOT EXISTS (SELECT 1 FROM pengajuan p WHERE p.id = s.pengajuan_id)`);
    cek(Number(yatim[0].n) === 0, 'tidak ada baris persetujuan yatim');

    const totalTakCocok = await db.all(
      `SELECT p.id, p.total, COALESCE(SUM(i.nominal),0) AS jml FROM pengajuan p
       LEFT JOIN pengajuan_item i ON i.pengajuan_id = p.id
       JOIN kategori k ON k.id = p.kategori_id
       WHERE k.bentuk IN ('biaya','barang','maintenance','perjalanan')
       GROUP BY p.id, p.total HAVING p.total <> COALESCE(SUM(i.nominal),0)`);
    cek(!totalTakCocok.length, 'total dokumen selalu sama dengan jumlah rinciannya');

    const sandiTeks = await db.all("SELECT id FROM pengguna WHERE sandi_hash NOT LIKE '$2%'");
    cek(!sandiTeks.length, 'semua sandi tersimpan dalam bentuk hash');

    // Pakta Integritas Vendor dikeluarkan dari lingkup aplikasi (31 Jul 2026).
    const sisaPakta = await db.get("SELECT id FROM kategori WHERE kode = 'PAKTA-RENOVASI'");
    cek(!sisaPakta, 'kategori Pakta Integritas tidak ada lagi di basis data');
    const sisaBerkas = ['views/pakta-form.ejs', 'views/cetak-pakta.ejs'].filter(f => fs.existsSync(P(f)));
    cek(!sisaBerkas.length, 'berkas tampilan Pakta Integritas sudah dibuang');
    const sisaKode = ['lib/formulir.js', 'lib/konstanta.js', 'lib/alur.js', 'routes/pengajuan.js', 'public/js/app.js']
      .filter(f => /pakta|klausul|ttd_vendor|tanpa_approval/i.test(fs.readFileSync(P(f), 'utf8')));
    cek(!sisaKode.length, 'tidak ada sisa kode Pakta Integritas' +
      (sisaKode.length ? ' — masih di: ' + sisaKode.join(', ') : ''));

    // Pemeriksaan mutu tidak boleh menyentuh data nyata sama sekali.
    let sidikSekarang = null;
    try { sidikSekarang = require('crypto').createHash('sha256').update(fs.readFileSync(BERKAS_AKUN)).digest('hex'); }
    catch (e) { sidikSekarang = null; }
    cek(sidikSekarang === sidikAkunAwal, 'catatan akun asli (data/AKUN-AWAL.txt) tidak tersentuh pengujian');
    cek(!fs.existsSync(P('data/eapex.db')) || fs.statSync(P('data/eapex.db')).mtimeMs < Date.now() - 5000,
      'basis data asli (data/eapex.db) tidak ditulisi pengujian');
    cek(isiLampiranAsli === daftarLampiranAsli(),
      'lampiran asli (data/lampiran) tidak bertambah/berkurang karena pengujian');
  } finally {
    server.close();
    await require('../lib/db').tutup();
  }
}

// ============================================================ G. KIRIM NOTIFIKASI HP
// Dijalankan sebagai proses terpisah karena bagian ini butuh kunci VAPID terisi,
// sedangkan pemeriksaan di atas justru menguji keadaan saat kuncinya kosong.
// Menjalankan satu berkas uji terpisah dan menggabungkan hitungannya ke sini.
// Baris yang bukan hasil pemeriksaan (jejak galat yang memang sengaja dipicu)
// tidak ikut ditampilkan supaya keluarannya tetap terbaca.
function jalankanUjiTerpisah(berkas, namaUji) {
  const hasil = require('child_process').spawnSync(process.execPath, [P(berkas)], {
    encoding: 'utf8', timeout: 180000,
  });
  const keluaran = (hasil.stdout || '') + (hasil.stderr || '');
  const barisHasil = keluaran.split('\n').filter(b => /[✓✗]/.test(b));
  process.stdout.write(barisHasil.join('\n') + '\n');
  const jmlLulus = (keluaran.match(/✓/g) || []).length;
  const jmlGagal = (keluaran.match(/✗/g) || []).length;
  lulus += jmlLulus;
  gagal += jmlGagal;
  if (!jmlLulus && !jmlGagal) no(namaUji + ' tidak menghasilkan apa pun');
}

function cekKirimNotifikasi() { jalankanUjiTerpisah('scripts/uji-push.js', 'uji kirim notifikasi'); }
function cekBacaPenawaran() { jalankanUjiTerpisah('scripts/uji-baca-penawaran.js', 'uji baca penawaran'); }
function cekKabar() { jalankanUjiTerpisah('scripts/uji-kabar.js', 'uji email/pengingat/cuti'); }

// ============================================================ jalan
(async () => {
  console.log('\n\x1b[1m========================================');
  console.log(' GERBANG MUTU EAPEX');
  console.log('========================================\x1b[0m');
  try {
    cekSintaks();
    cekTampilan();
    cekHitungan();
    await cekAlur();
    judul('G. KIRIM NOTIFIKASI HP');
    cekKirimNotifikasi();
    judul('H. BACA PENAWARAN OTOMATIS (layanan OpenAI tiruan)');
    cekBacaPenawaran();
    judul('I. EMAIL, PENGINGAT HARIAN, DAN CUTI PENYETUJU');
    cekKabar();
  } catch (e) {
    no('PEMERIKSAAN BERHENTI: ' + e.message);
    console.error(e.stack);
  }
  try { fs.rmSync(LAMPIRAN_UJI, { recursive: true, force: true }); } catch (e) { /* biarkan */ }
  try { fs.unlinkSync(DB_UJI); } catch (e) { /* biarkan */ }
  for (const akhiran of ['-wal', '-shm']) { try { fs.unlinkSync(DB_UJI + akhiran); } catch (e) { /* biarkan */ } }

  console.log('\n\x1b[1m========================================');
  console.log(` HASIL: ${lulus} lulus, ${gagal} gagal`);
  console.log('========================================\x1b[0m');
  if (gagal) {
    console.log('\n\x1b[31mADA YANG GAGAL — jangan nyatakan selesai sebelum semuanya hijau.\x1b[0m\n');
    process.exit(1);
  }
  console.log('\n\x1b[32mSemua pemeriksaan lulus.\x1b[0m\n');
  process.exit(0);
})();
