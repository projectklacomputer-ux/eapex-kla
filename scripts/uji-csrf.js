#!/usr/bin/env node
// ============================================================================
//  Uji ketahanan token CSRF terhadap permintaan yang berjalan BERSAMAAN
// ============================================================================
//  Bug yang diuji di sini nyata dan berulang di produksi: orang sedang masuk,
//  mengisi formulir, lalu ditolak "Token keamanan tidak cocok".
//
//  Sebabnya tiga hal yang bertemu:
//    1. token disimpan DI DALAM sesi
//    2. sesi ditulis ulang pada SETIAP permintaan (rolling: true)
//    3. halaman menembakkan permintaan latar saat dibuka
//
//  Permintaan latar yang membaca sesi sebelum token dibuat menuliskannya
//  kembali tanpa token itu. Di komputer sendiri hampir mustahil ditiru karena
//  permintaan berjalan berurutan; di hosting tanpa server tetap, bersamaan.
//
//  Jalankan:  npm run uji-csrf
// ============================================================================

const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');

const DB = path.join(os.tmpdir(), 'eapex-uji-csrf-' + process.pid + '.db');
process.env.SQLITE_PATH = DB;
process.env.SESSION_SECRET = 'uji-csrf-' + 'k'.repeat(32);
process.env.BATAS_LOGIN_UJI = '9999';
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;

const PORT = Number(process.env.PORT_UJI_CSRF) || 4721;
const SANDI = 'UjiCsrf123';

const app = require('../app');
const db = require('../lib/db');
const { siapkan } = require('../lib/skema');
const bcrypt = require('bcryptjs');

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

const kirim = (base, jalur, isi, kue) => {
  const body = new URLSearchParams(isi).toString();
  return ambil(base + jalur, { method: 'POST', body,
    headers: { 'content-type': 'application/x-www-form-urlencoded',
      'content-length': Buffer.byteLength(body), cookie: kue } });
};

(async () => {
  await siapkan({ senyap: true });
  await db.run('UPDATE pengguna SET sandi_hash = ?, wajib_ganti_sandi = 0', [bcrypt.hashSync(SANDI, 10)]);
  const server = app.listen(PORT);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${PORT}`;

  const r1 = await ambil(base + '/login');
  let kue = (r1.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const tokMasuk = /name="_csrf" value="([^"]+)"/.exec(r1.teks)[1];
  const r2 = await kirim(base, '/login',
    { _csrf: tokMasuk, tujuan: '/', email: 'sm.smg@kla.co.id', sandi: SANDI }, kue);
  kue = (r2.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ') || kue;
  cek('berhasil masuk', r2.status === 302);

  console.log('\n\x1b[1mTOKEN TETAP SAMA SEPANJANG SESI\x1b[0m\n');
  const a = await ambil(base + '/pengajuan/baru/CAPEX', { headers: { cookie: kue } });
  const b = await ambil(base + '/pengajuan/baru/CAPEX', { headers: { cookie: kue } });
  const tokA = /name="_csrf" value="([^"]+)"/.exec(a.teks)[1];
  const tokB = /name="_csrf" value="([^"]+)"/.exec(b.teks)[1];
  cek('dua kali buka halaman, token sama', tokA === tokB);
  cek('token tidak sepele ditebak', tokA.length >= 32, tokA.length + ' huruf');

  console.log('\n\x1b[1mTOKEN TIDAK DISIMPAN DI SESI\x1b[0m\n');
  // Inilah inti perbaikannya: kalau token ada di dalam sesi, permintaan yang
  // berjalan bersamaan bisa menimpanya.
  const barisSesi = await db.all('SELECT sess FROM sesi');
  const adaDiSesi = barisSesi.some(s => /"csrf"/.test(s.sess || ''));
  cek('tidak ada token tersimpan di baris sesi', !adaDiSesi,
    'kalau tersimpan, permintaan bersamaan bisa menghapusnya');

  console.log('\n\x1b[1mSESI DITIMPA PERMINTAAN LAIN — TOKEN HARUS BERTAHAN\x1b[0m\n');
  // Tiru persis kejadiannya: tulis ulang baris sesi tanpa medan csrf, seperti
  // yang dilakukan permintaan latar yang membaca sesi versi lama.
  for (const s of barisSesi) {
    const isi = JSON.parse(s.sess);
    delete isi.csrf;
    await db.run('UPDATE sesi SET sess = ? WHERE sess = ?', [JSON.stringify(isi), s.sess]);
  }
  const c = await ambil(base + '/pengajuan/baru/CAPEX', { headers: { cookie: kue } });
  const tokC = /name="_csrf" value="([^"]+)"/.exec(c.teks)[1];
  cek('token TETAP SAMA setelah sesi ditimpa', tokC === tokA,
    'inilah bug yang membuat "Token keamanan tidak cocok" berulang');

  const sah = await kirim(base, '/notifikasi/dibaca', { _csrf: tokC }, kue);
  cek('kiriman formulir tetap diterima', sah.status !== 403 && !/Token keamanan tidak cocok/.test(sah.teks),
    'status ' + sah.status);

  console.log('\n\x1b[1mTOKEN PALSU TETAP DITOLAK\x1b[0m\n');
  const palsu = await kirim(base, '/notifikasi/dibaca', { _csrf: 'a'.repeat(48) }, kue);
  cek('token karangan ditolak', /Token keamanan tidak cocok/.test(palsu.teks) || palsu.status === 403,
    'status ' + palsu.status);
  const kosong = await kirim(base, '/notifikasi/dibaca', {}, kue);
  cek('tanpa token ditolak', /Token keamanan tidak cocok/.test(kosong.teks) || kosong.status === 403);

  console.log('\n\x1b[1mSESI LAIN PUNYA TOKEN BERBEDA\x1b[0m\n');
  const lain = await ambil(base + '/login');
  const kueLain = (lain.headers['set-cookie'] || []).map(x => x.split(';')[0]).join('; ');
  const tokLain = /name="_csrf" value="([^"]+)"/.exec(lain.teks)[1];
  cek('token sesi lain berbeda', tokLain !== tokA);
  const silang = await kirim(base, '/notifikasi/dibaca', { _csrf: tokLain }, kue);
  cek('token milik sesi lain ditolak', /Token keamanan tidak cocok/.test(silang.teks) || silang.status === 403,
    'kalau diterima, tokennya tidak terikat sesi sama sekali');

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
