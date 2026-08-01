#!/usr/bin/env node
// ============================================================================
//  Uji perilaku DRAFT
// ============================================================================
//  Draft sengaja boleh disimpan belum lengkap - orang harus bisa berhenti di
//  tengah dan melanjutkannya besok. Yang TIDAK boleh: aplikasi diam soal apa
//  yang masih kurang. Orang yang mengisi lewat tombol AI lalu menekan Simpan
//  Draft akan mengira dokumennya beres, dan baru tahu berhari-hari kemudian.
//
//  Diuji juga: draft yang didiamkan diingatkan ke PEMILIKNYA. Pengingat draft
//  disimpan sebagai lonceng di dalam aplikasi - berbeda dari pengingat approval
//  yang cukup lewat HP/email, karena draft tidak pernah memberi tahu siapa pun
//  sebelumnya. Orang yang belum memasang aplikasi dan belum mengisi email
//  justru yang paling mungkin meninggalkan draft.
//
//  Basis data sementara di folder temp; data asli tidak pernah disentuh.
//
//  Jalankan:  npm run uji-draft
// ============================================================================

const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');

const DB = path.join(os.tmpdir(), 'eapex-uji-draft-' + process.pid + '.db');
process.env.SQLITE_PATH = DB;
process.env.SESSION_SECRET = 'uji-draft-' + 'q'.repeat(32);
process.env.BATAS_LOGIN_UJI = '9999';
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;

const PORT = Number(process.env.PORT_UJI_DRAFT) || 4719;
const SANDI = 'UjiDraft123';

const app = require('../app');
const db = require('../lib/db');
const { siapkan } = require('../lib/skema');
const bcrypt = require('bcryptjs');
const pengingat = require('../lib/pengingat');

let lulus = 0, gagal = 0;
function cek(nama, ok, ket) {
  if (ok) { lulus++; console.log(`  \x1b[32m✓\x1b[0m ${nama}${ket ? '  — ' + ket : ''}`); }
  else { gagal++; console.log(`  \x1b[31m✗ ${nama}${ket ? '  — ' + ket : ''}\x1b[0m`); }
}

function ambil(url, o = {}) {
  return new Promise((ok, no) => {
    const r = http.request(url, o, res => {
      let d = ''; res.on('data', c => (d += c));
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, teks: d }));
    });
    r.on('error', no);
    if (o.body) r.write(o.body);
    r.end();
  });
}

function borang(isi) {
  const body = new URLSearchParams(isi).toString();
  return { body, panjang: Buffer.byteLength(body) };
}

// Toples cookie yang MENGGABUNG, seperti peramban. Mengganti seluruh toples
// tiap tanggapan akan membuang cookie yang tidak ikut dikirim ulang - misalnya
// cookie token CSRF yang hanya terbit sekali - lalu menuduh aplikasinya salah.
const toples = new Map();
function telan(res) {
  for (const b of (res.headers['set-cookie'] || [])) {
    const p = b.split(';')[0];
    const s = p.indexOf('=');
    if (s > 0) toples.set(p.slice(0, s), p.slice(s + 1));
  }
}
const kueHeader = () => [...toples].map(([k, v]) => `${k}=${v}`).join('; ');

(async () => {
  await siapkan({ senyap: true });
  await db.run('UPDATE pengguna SET sandi_hash = ?, wajib_ganti_sandi = 0', [bcrypt.hashSync(SANDI, 10)]);

  const server = app.listen(PORT);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${PORT}`;

  // masuk
  const r1 = await ambil(base + '/login');
  telan(r1);
  const tokMasuk = /name="_csrf" value="([^"]+)"/.exec(r1.teks)[1];
  const m = borang({ _csrf: tokMasuk, tujuan: '/', email: 'sm.smg@kla.co.id', sandi: SANDI });
  const r2 = await ambil(base + '/login', { method: 'POST', body: m.body,
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': m.panjang, cookie: kueHeader() } });
  telan(r2);

  const f = await ambil(base + '/pengajuan/baru/CAPEX', { headers: { cookie: kueHeader() } });
  const tok = /name="_csrf" value="([^"]+)"/.exec(f.teks)[1];
  const kategoriId = /name="kategori_id" value="([^"]+)"/.exec(f.teks)[1];
  const aturanId = /name="aturan_id" value="([^"]+)"/.exec(f.teks)[1];
  const cabangId = (/<select name="cabang_id"[\s\S]*?value="([^"]+)"/.exec(f.teks) || [])[1] || '';

  const dasar = {
    _csrf: tok, kategori_id: kategoriId, aturan_id: aturanId, cabang_id: cabangId,
    nama_proyek: 'Uji', tujuan: 'efisiensi', kategori_aset: 'Inventaris',
    deskripsi: 'Uji', lokasi: 'Uji', vendor: 'Uji',
    item_nama: 'Barang', item_qty: '1', item_satuan: 'unit', item_harga: '1000000',
    aksi: 'draft',
  };

  const simpanDraft = async isi => {
    const b = borang(isi);
    const s = await ambil(base + '/pengajuan', { method: 'POST', body: b.body,
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': b.panjang, cookie: kueHeader() } });
    telan(s);
    const h = await ambil(base + s.headers.location, { headers: { cookie: kueHeader() } });
    return { simpan: s, halaman: h };
  };

  console.log('\n\x1b[1mDRAFT BELUM LENGKAP\x1b[0m\n');
  // jadwal_kebutuhan, penjelasan, justifikasi sengaja dikosongkan
  const a = await simpanDraft({ ...dasar, judul: 'Draft belum lengkap' });
  cek('draft tetap tersimpan, tidak ditolak', a.simpan.status === 302, 'status ' + a.simpan.status);
  cek('pesannya menyatakan BELUM BISA DIAJUKAN', /BELUM BISA DIAJUKAN/.test(a.halaman.teks));
  cek('pesannya menyebut isian yang kurang', /Jadwal kebutuhan/.test(a.halaman.teks));
  cek('tampil sebagai peringatan, bukan hilang diam-diam', /class="pesan ingat/.test(a.halaman.teks));

  console.log('\n\x1b[1mDRAFT LENGKAP\x1b[0m\n');
  const b2 = await simpanDraft({ ...dasar, judul: 'Draft lengkap',
    jadwal_kebutuhan: 'September 2026', penjelasan: 'Uji', justifikasi: 'Uji' });
  cek('dinyatakan sudah lengkap', /sudah lengkap/.test(b2.halaman.teks));
  cek('tidak memberi peringatan palsu', !/BELUM BISA DIAJUKAN/.test(b2.halaman.teks));

  console.log('\n\x1b[1mPENGINGAT DRAFT TERBENGKALAI\x1b[0m\n');
  const belumTua = await pengingat.jalankan({ paksa: true });
  cek('draft yang baru dibuat BELUM diingatkan', belumTua.draft === 0, 'draft=' + belumTua.draft);

  // Ditua-kan ke 29 jam: sudah lewat ambang PERINGATAN (1 hari) tapi belum
  // lewat ambang HAPUS (2 hari). Kalau langsung 3 hari, yang terjadi
  // penghapusan - dan yang diuji di bagian ini bukan itu.
  const seharilebih = new Date(Date.now() - 29 * 3600 * 1000).toISOString();
  await db.run("UPDATE pengajuan SET diperbarui = ? WHERE status = 'draft'", [seharilebih]);

  const sesudah = await pengingat.jalankan({ paksa: true });
  cek('belum dihapus - baru diperingatkan', sesudah.draftDihapus === 0, 'dihapus=' + sesudah.draftDihapus);
  cek('draft yang didiamkan ikut terhitung', sesudah.draft === 2, 'draft=' + sesudah.draft);
  cek('diingatkan ke pemiliknya sendiri', sesudah.draftPenerima === 1, 'penerima=' + sesudah.draftPenerima);

  const lonceng = await db.all("SELECT * FROM notifikasi WHERE judul LIKE '%draft%'");
  cek('lonceng dibuat di dalam aplikasi', lonceng.length > 0,
    'tanpa ini, orang yang belum pasang aplikasi & belum isi email tidak akan tahu');
  if (lonceng.length) {
    cek('menjelaskan draft belum sampai ke siapa pun', /belum sampai ke siapa pun/.test(lonceng[0].pesan || ''));
    cek('menjelaskan draft belum punya nomor', /belum punya nomor/i.test(lonceng[0].pesan || ''));
  }

  console.log('\n\x1b[1mPENGHAPUSAN DRAFT LEWAT TENGGAT\x1b[0m\n');
  // Pasang lampiran ber-ISI supaya bisa dibuktikan isinya ikut hilang, bukan
  // cuma baris penunjuknya. Isi lampiran menghuni basis data - itu yang mahal.
  const simpanan = require('../lib/simpanan');
  const { id } = require('../lib/auth');
  const draftAda = await db.all("SELECT id FROM pengajuan WHERE status = 'draft'");
  const namaSimpan = 'uji-lampiran-' + Date.now() + '.pdf';
  await db.run(
    `INSERT INTO lampiran (id, pengajuan_id, nama_asli, nama_simpan, mime, ukuran, pengunggah_id, dibuat)
     VALUES (?,?, 'Penawaran.pdf', ?, 'application/pdf', 2048, NULL, ?)`,
    [id(), draftAda[0].id, namaSimpan, new Date().toISOString()]);
  if (simpanan.diDb()) {
    await simpanan.siapkan();
    await db.run('INSERT INTO lampiran_isi (nama_simpan, isi_base64, dibuat) VALUES (?,?,?)',
      [namaSimpan, Buffer.from('isi berkas contoh').toString('base64'), new Date().toISOString()]);
  }

  const tigaHariLagi = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  await db.run("UPDATE pengajuan SET diperbarui = ? WHERE status = 'draft'", [tigaHariLagi]);

  const hapus = await pengingat.jalankan({ paksa: true });
  cek('draft lewat tenggat dihapus', hapus.draftDihapus === 2, 'dihapus=' + hapus.draftDihapus);

  const sisaDraft = Number(await db.nilai("SELECT COUNT(*) AS n FROM pengajuan WHERE status = 'draft'"));
  cek('tidak ada draft tersisa di basis data', sisaDraft === 0, sisaDraft + ' tersisa');

  const sisaLampiran = Number(await db.nilai('SELECT COUNT(*) AS n FROM lampiran'));
  cek('baris lampiran ikut terhapus', sisaLampiran === 0, sisaLampiran + ' tersisa');

  if (simpanan.diDb()) {
    const sisaIsi = Number(await db.nilai('SELECT COUNT(*) AS n FROM lampiran_isi WHERE nama_simpan = ?', [namaSimpan]));
    cek('ISI lampiran ikut terhapus dari basis data', sisaIsi === 0,
      'tanpa ini, berkasnya menghuni Supabase selamanya tanpa ada yang menunjuk kepadanya');
  }

  const sisaItem = Number(await db.nilai('SELECT COUNT(*) AS n FROM pengajuan_item'));
  cek('rincian barang ikut terhapus', sisaItem === 0, sisaItem + ' tersisa');

  const kabarHapus = await db.all("SELECT * FROM notifikasi WHERE judul LIKE '%dihapus%'");
  cek('pembuatnya diberi tahu draftnya dihapus', kabarHapus.length > 0);
  if (kabarHapus.length) {
    cek('dijelaskan tidak ada nomor dokumen yang hilang',
      /belum pernah punya nomor/i.test(kabarHapus[0].pesan || ''));
  }

  console.log(`\n\x1b[1m  ${lulus} lulus, ${gagal} gagal\x1b[0m\n`);

  await new Promise(r => server.close(r));
  await db.tutup();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB + s); } catch (_) { /* mungkin tidak ada */ } }
  process.exit(gagal ? 1 : 0);
})().catch(async e => {
  console.error('\n  Gagal:', e.message, '\n');
  try { await db.tutup(); } catch (_) { /* abaikan */ }
  process.exit(1);
});
