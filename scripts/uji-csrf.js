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

// Toples cookie sederhana yang MENGGABUNG, bukan mengganti. Peramban bekerja
// begitu; uji yang mengganti seluruh toples tiap tanggapan akan membuang cookie
// yang tidak ikut dikirim ulang - dan lalu menuduh aplikasinya yang salah.
function buatToples() {
  const isi = new Map();
  return {
    telan(res) {
      for (const baris of (res.headers['set-cookie'] || [])) {
        const p = baris.split(';')[0];
        const s = p.indexOf('=');
        if (s > 0) isi.set(p.slice(0, s), p.slice(s + 1));
      }
    },
    get header() { return [...isi].map(([k, v]) => `${k}=${v}`).join('; '); },
    hapus(nama) { isi.delete(nama); },
  };
}

const kirim = (base, jalur, data, toples) => {
  const body = new URLSearchParams(data).toString();
  return ambil(base + jalur, { method: 'POST', body,
    headers: { 'content-type': 'application/x-www-form-urlencoded',
      'content-length': Buffer.byteLength(body), cookie: toples.header } })
    .then(r => { toples.telan(r); return r; });
};

const buka = (base, jalur, toples) =>
  ambil(base + jalur, { headers: { cookie: toples.header } })
    .then(r => { toples.telan(r); return r; });

const tokenDi = teks => (/name="_csrf" value="([^"]+)"/.exec(teks) || [])[1] || null;

(async () => {
  await siapkan({ senyap: true });
  await db.run('UPDATE pengguna SET sandi_hash = ?, wajib_ganti_sandi = 0', [bcrypt.hashSync(SANDI, 10)]);
  const server = app.listen(PORT);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${PORT}`;

  const toples = buatToples();
  const r1 = await buka(base, '/login', toples);
  const r2 = await kirim(base, '/login',
    { _csrf: tokenDi(r1.teks), tujuan: '/', email: 'sm.smg@kla.co.id', sandi: SANDI }, toples);
  cek('berhasil masuk', r2.status === 303, 'status ' + r2.status);

  console.log('\n\x1b[1mTOKEN TETAP SAMA SEPANJANG SESI\x1b[0m\n');
  const tokA = tokenDi((await buka(base, '/pengajuan/baru/CAPEX', toples)).teks);
  const tokB = tokenDi((await buka(base, '/pengajuan/baru/CAPEX', toples)).teks);
  cek('dua kali buka halaman, token sama', tokA === tokB);
  cek('token tidak sepele ditebak', tokA.length >= 32, tokA.length + ' huruf');

  console.log('\n\x1b[1mTOKEN TIDAK DISIMPAN DI SESI\x1b[0m\n');
  const barisSesi = await db.all('SELECT sess FROM sesi');
  cek('tidak ada token tersimpan di baris sesi',
    !barisSesi.some(x => /"csrf"/.test(x.sess || '')),
    'kalau tersimpan, permintaan bersamaan bisa menghapusnya');

  console.log('\n\x1b[1mSESI DITIMPA PERMINTAAN BERSAMAAN\x1b[0m\n');
  for (const x of barisSesi) {
    const isi = JSON.parse(x.sess); delete isi.csrf;
    await db.run('UPDATE sesi SET sess = ? WHERE sess = ?', [JSON.stringify(isi), x.sess]);
  }
  const tokC = tokenDi((await buka(base, '/pengajuan/baru/CAPEX', toples)).teks);
  cek('token bertahan', tokC === tokA);
  const sah = await kirim(base, '/notifikasi/dibaca', { _csrf: tokC }, toples);
  cek('kiriman formulir diterima', sah.status !== 403, 'status ' + sah.status);

  console.log('\n\x1b[1mID SESI BERGANTI — TOKEN HARUS TETAP SAH\x1b[0m\n');
  // 'DELETE FROM sesi' persis yang dijalankan saat Administrator menyetel ulang
  // sandi orang lain; regenerate() dijalankan setiap kali orang masuk.
  await db.run('DELETE FROM sesi');
  const lagi = await buka(base, '/login', toples);
  cek('token bertahan walau SELURUH sesi dihapus', tokenDi(lagi.teks) === tokA,
    'inilah yang terjadi tiap Administrator menyetel ulang sandi orang');

  const masukLagi = await kirim(base, '/login',
    { _csrf: tokA, tujuan: '/', email: 'sm.smg@kla.co.id', sandi: SANDI }, toples);
  cek('masuk lagi memakai token dari halaman lama', masukLagi.status === 303,
    'status ' + masukLagi.status);
  const tokSesudah = tokenDi((await buka(base, '/pengajuan/baru/CAPEX', toples)).teks);
  cek('token tetap sama sesudah masuk ulang', tokSesudah === tokA,
    'regenerate() mengganti ID sesi, token tidak boleh ikut berganti');

  console.log('\n\x1b[1mYANG TIDAK SAH TETAP DITOLAK\x1b[0m\n');
  const palsu = await kirim(base, '/notifikasi/dibaca', { _csrf: 'a'.repeat(48) }, toples);
  cek('token karangan ditolak', palsu.status === 403);
  const kosong = await kirim(base, '/notifikasi/dibaca', {}, toples);
  cek('tanpa token ditolak', kosong.status === 403);

  const orangLain = buatToples();
  const lain = await buka(base, '/login', orangLain);
  cek('peramban lain dapat token berbeda', tokenDi(lain.teks) !== tokA);
  const silang = await kirim(base, '/notifikasi/dibaca', { _csrf: tokenDi(lain.teks) }, toples);
  cek('token milik peramban lain ditolak', silang.status === 403,
    'kalau diterima, tokennya tidak terikat siapa pun');

  console.log('\n\x1b[1mPENGALIHAN SESUDAH POST HARUS 303\x1b[0m\n');
  // 302 sesudah POST tidak menjamin apa-apa: peramban BOLEH mengubahnya jadi
  // GET, tapi tidak wajib. Di Vercel 302 sampai ke peramban sebagai 307, dan
  // 307 justru MEMPERTAHANKAN metodenya - sehingga sesudah "Masuk" berhasil,
  // peramban mem-POST ulang ke alamat tujuan dan mendapat 404. 303 tidak punya
  // celah tafsir itu.
  const toples2 = buatToples();
  const awal = await buka(base, '/login', toples2);
  const masuk303 = await kirim(base, '/login',
    { _csrf: tokenDi(awal.teks), tujuan: '/', email: 'sm.smg@kla.co.id', sandi: SANDI }, toples2);
  cek('masuk mengalihkan dengan 303, bukan 302', masuk303.status === 303,
    'dapat ' + masuk303.status + ' — 302 bisa berubah jadi 307 di hosting');
  cek('mengarah ke dasbor', masuk303.headers.location === '/', masuk303.headers.location);

  const simpanCuti = await kirim(base, '/cuti-saya',
    { _csrf: tokenDi((await buka(base, '/cuti-saya', toples2)).teks), cuti_approve: 'tetap' }, toples2);
  cek('kiriman formulir lain juga 303', simpanCuti.status === 303, 'dapat ' + simpanCuti.status);

  const halamanBiasa = await buka(base, '/pengajuan', toples2);
  cek('halaman biasa tetap 200 (bukan ikut dialihkan)', halamanBiasa.status === 200);

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
