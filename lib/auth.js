// ============================================================================
//  Autentikasi, sesi, dan penjaga wewenang
// ============================================================================
// Prinsip: GAGAL-TERTUTUP. Semua rute (kecuali daftar putih) menolak pengunjung
// yang tidak dikenal; pemeriksaan peran dilakukan di server, bukan di tampilan.
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('./db');
const { id, sekarang, samaAman } = require('./util');

// --------------------------------------------------------------- penyimpan sesi
// Satu penyimpan untuk dua mesin basis data, jadi sesi tidak hilang saat server
// dinyalakan ulang (baik lokal/SQLite maupun saat deploy/Postgres).
function buatPenyimpanSesi(session) {
  class PenyimpanSesi extends session.Store {
    constructor() {
      super();
      this.pembersih = setInterval(() => this.bersihkan(), 3600 * 1000);
      if (this.pembersih.unref) this.pembersih.unref();
    }
    async bersihkan() {
      try { await db.run('DELETE FROM sesi WHERE expire < ?', [Date.now()]); } catch (e) { /* abaikan */ }
    }
    kadaluarsa(sess) {
      const c = sess && sess.cookie;
      const ms = (c && (c.originalMaxAge || c.maxAge)) || 12 * 3600 * 1000;
      return Date.now() + ms;
    }
    get(sid, cb) {
      db.get('SELECT sess, expire FROM sesi WHERE sid = ?', [sid]).then(r => {
        if (!r) return cb(null, null);
        if (Number(r.expire) < Date.now()) { this.destroy(sid, () => cb(null, null)); return; }
        try { cb(null, JSON.parse(r.sess)); } catch (e) { cb(null, null); }
      }).catch(e => cb(e));
    }
    set(sid, sess, cb) {
      const data = JSON.stringify(sess);
      db.run(
        `INSERT INTO sesi (sid, sess, expire) VALUES (?,?,?)
         ON CONFLICT (sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire`,
        [sid, data, this.kadaluarsa(sess)]).then(() => cb(null)).catch(e => cb(e));
    }
    touch(sid, sess, cb) {
      db.run('UPDATE sesi SET expire = ? WHERE sid = ?', [this.kadaluarsa(sess), sid])
        .then(() => cb(null)).catch(() => cb(null));
    }
    destroy(sid, cb) {
      db.run('DELETE FROM sesi WHERE sid = ?', [sid]).then(() => cb(null)).catch(e => cb(e));
    }
  }
  return new PenyimpanSesi();
}

// --------------------------------------------------------------- pengguna
const KOLOM = `u.id, u.nama, u.email, u.peran, u.jabatan, u.cabang_id, u.area_id, u.departemen_id,
  u.aktif, u.wajib_ganti_sandi, c.nama AS cabang_nama, c.kode AS cabang_kode, c.tipe AS cabang_tipe,
  c.area_id AS cabang_area_id, d.nama AS departemen_nama, d.kode AS departemen_kode, a.nama AS area_nama`;

const DARI = `FROM pengguna u
  LEFT JOIN cabang c ON c.id = u.cabang_id
  LEFT JOIN departemen d ON d.id = u.departemen_id
  LEFT JOIN area a ON a.id = u.area_id`;

async function penggunaById(penggunaId) {
  return db.get(`SELECT ${KOLOM} ${DARI} WHERE u.id = ? AND u.aktif = 1`, [penggunaId]);
}

async function penggunaByEmail(email) {
  return db.get(`SELECT ${KOLOM}, u.sandi_hash ${DARI} WHERE LOWER(u.email) = ?`, [String(email || '').toLowerCase().trim()]);
}

// Verifikasi login. Pesan galat sengaja sama untuk email salah maupun sandi salah,
// supaya tidak bisa dipakai menebak email mana yang terdaftar.
const HASH_PEMBANDING_PALSU = bcrypt.hashSync('akun-tidak-ada', 10);

async function periksaLogin(email, sandi) {
  const GAGAL = { ok: false, pesan: 'Email atau sandi salah' };
  const u = await penggunaByEmail(email);
  if (!u) {
    // tetap jalankan satu perbandingan hash supaya lama jawaban tidak
    // membocorkan email mana yang terdaftar
    bcrypt.compareSync(String(sandi || ''), HASH_PEMBANDING_PALSU);
    return GAGAL;
  }
  if (!u.aktif) return { ok: false, pesan: 'Akun ini sudah tidak aktif. Hubungi Administrator.' };
  if (!bcrypt.compareSync(String(sandi || ''), u.sandi_hash)) return GAGAL;
  await db.run('UPDATE pengguna SET login_terakhir = ? WHERE id = ?', [sekarang(), u.id]);
  delete u.sandi_hash;
  return { ok: true, pengguna: u };
}

function hashSandi(sandi) { return bcrypt.hashSync(String(sandi), 10); }

// Aturan sandi minimal — cukup ketat tanpa membuat orang menuliskannya di kertas.
function periksaKekuatanSandi(sandi) {
  const s = String(sandi || '');
  if (s.length < 8) return 'Sandi minimal 8 karakter';
  if (!/[A-Za-z]/.test(s)) return 'Sandi harus memuat huruf';
  if (!/[0-9]/.test(s)) return 'Sandi harus memuat angka';
  return null;
}

async function gantiSandi(penggunaId, sandiBaru) {
  const galat = periksaKekuatanSandi(sandiBaru);
  if (galat) throw Object.assign(new Error(galat), { publik: true, kode: 400 });
  await db.run('UPDATE pengguna SET sandi_hash = ?, wajib_ganti_sandi = 0 WHERE id = ?',
    [hashSandi(sandiBaru), penggunaId]);
}

// --------------------------------------------------------------- middleware
// Batas MUTLAK umur sesi, terpisah dari batas diam 60 menit di app.js. Tanpa ini,
// sesi yang dipakai terus-menerus tidak pernah berakhir — dan komputer bersama di
// cabang bisa tetap masuk berminggu-minggu asal ada yang menyentuhnya tiap jam.
const SESI_MAKS_JAM = () => (Number(process.env.SESI_MAKS_JAM) > 0 ? Number(process.env.SESI_MAKS_JAM) : 12);

// Penanda "peramban ini pernah dipakai masuk". Isinya cuma angka 1 — tidak ada
// data pengguna sama sekali. Gunanya satu: membedakan orang yang sesinya baru
// habis dari orang yang memang belum pernah masuk, supaya pesannya bisa tepat.
const KUE_PENANDA = 'eapex.pernah';

// Dibaca langsung dari headernya supaya tidak perlu menambah pustaka pengurai
// kue hanya untuk satu penanda berisi angka 1.
function kueDari(req, nama) {
  const mentah = req.headers && req.headers.cookie;
  if (!mentah) return null;
  for (const bagian of mentah.split(';')) {
    const i = bagian.indexOf('=');
    if (i > 0 && bagian.slice(0, i).trim() === nama) return bagian.slice(i + 1).trim();
  }
  return null;
}

// Dipasang saat login, dibuang saat orangnya keluar sendiri. Sengaja TIDAK
// dibuang saat sesi habis — justru penanda inilah yang membuat kita tahu bahwa
// yang datang adalah orang yang sesinya habis.
function pasangPenanda(res) {
  res.cookie(KUE_PENANDA, '1', {
    httpOnly: true, sameSite: 'lax',
    secure: !!process.env.DI_BELAKANG_PROXY,
    maxAge: 180 * 24 * 3600 * 1000,
  });
}

function buangPenanda(res) {
  res.clearCookie(KUE_PENANDA, {
    httpOnly: true, sameSite: 'lax', secure: !!process.env.DI_BELAKANG_PROXY,
  });
}

// Muat pengguna dari sesi ke res.locals untuk semua permintaan.
async function muatPengguna(req, res, next) {
  res.locals.pengguna = null;
  if (req.session && req.session.penggunaId) {
    const mulai = Number(req.session.mulai || 0);
    if (mulai && (Date.now() - mulai) > SESI_MAKS_JAM() * 3600 * 1000) {
      req.session.destroy(() => {});
      return next();
    }
    const u = await penggunaById(req.session.penggunaId);
    if (u) { req.pengguna = u; res.locals.pengguna = u; }
    else { req.session.destroy(() => {}); }
  }
  next();
}

const BOLEH_TANPA_LOGIN = [
  /^\/login$/, /^\/keluar$/, /^\/api\/health$/,
  /^\/css\//, /^\/js\//, /^\/gambar\//, /^\/favicon/,
  // Berkas pendukung aplikasi terpasang (PWA). Semuanya berkas statis tanpa data,
  // jadi aman terbuka — dan memang harus terbuka: peramban memuat service worker
  // dan manifest SEBELUM pengguna sempat login.
  /^\/sw\.js$/, /^\/manifest\.webmanifest$/, /^\/luring$/,
];

function wajibLogin(req, res, next) {
  if (BOLEH_TANPA_LOGIN.some(r => r.test(req.path))) return next();
  if (!req.pengguna) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ ok: false, pesan: 'Belum login' });
    const tujuan = encodeURIComponent(req.originalUrl || '/');
    // Peramban ini pernah dipakai masuk tapi sesinya sudah tidak ada = sesinya
    // habis. Dikatakan apa adanya, supaya orang tidak mengira aplikasinya rusak
    // atau sandinya bermasalah.
    const pernah = kueDari(req, KUE_PENANDA);
    return res.redirect('/login?tujuan=' + tujuan + (pernah ? '&habis=1' : ''));
  }
  // Paksa ganti sandi awal sebelum boleh memakai aplikasi.
  if (req.pengguna.wajib_ganti_sandi && !/^\/(ganti-sandi|keluar)$/.test(req.path)) {
    return res.redirect('/ganti-sandi');
  }
  next();
}

function wajibPeran(...peran) {
  const boleh = new Set(peran);
  return (req, res, next) => {
    if (!req.pengguna) return res.redirect('/login');
    if (!boleh.has(req.pengguna.peran)) {
      const pesan = 'Menu ini hanya untuk: ' + peran.join(', ');
      if (req.path.startsWith('/api/')) return res.status(403).json({ ok: false, pesan });
      return res.status(403).render('galat', { judul: 'Tidak berwenang', pesan });
    }
    next();
  };
}

// --------------------------------------------------------------- CSRF
// Token diperiksa pada semua permintaan yang mengubah data.
function tolakCsrf(req, res) {
  // Dicatat supaya penolakan bisa DILACAK, bukan ditebak. Dua kali sebelumnya
  // sebabnya salah didiagnosis justru karena tidak ada satu pun jejak: yang
  // terlihat hanya keluhan "muncul lagi". Tidak ada nilai token yang dicatat,
  // hanya bentuknya - panjang dan ada/tidaknya.
  const kiriman = (req.body && req.body._csrf) || req.get('x-csrf-token') || '';
  const dariKue = bacaKue(req, KUE_CSRF);
  console.warn('[csrf] ditolak', JSON.stringify({
    jalur: req.method + ' ' + req.path,
    kiriman: kiriman ? kiriman.length + ' huruf' : 'TIDAK ADA',
    kue: dariKue ? dariKue.length + ' huruf' : 'TIDAK ADA',
    cocokAwalan: !!(kiriman && dariKue) && kiriman.slice(0, 6) === dariKue.slice(0, 6),
    adaSesiLama: !!(req.session && req.session.csrf),
    masuk: !!(req.session && req.session.penggunaId),
  }));

  if (req.path.startsWith('/api/')) {
    return res.status(403).json({ ok: false, pesan: 'Token keamanan tidak cocok. Muat ulang halaman.' });
  }
  return res.status(403).render('galat', {
    judul: 'Token keamanan tidak cocok',
    pesan: 'Halaman mungkin terbuka terlalu lama. Muat ulang halaman lalu ulangi.',
  });
}

// Token CSRF TIDAK disimpan di dalam sesi, melainkan dihitung dari ID sesi.
//
// Kenapa: sesi disimpan ulang pada SETIAP permintaan (rolling: true, supaya
// batas 60 menit diam dihitung dari aktivitas terakhir). Di hosting tanpa
// server tetap, beberapa permintaan berjalan bersamaan - halaman yang dibuka
// juga menembakkan permintaan latar untuk notifikasi. Permintaan yang membaca
// sesi SEBELUM token dibuat akan menuliskannya kembali TANPA token itu, dan
// token yang baru dibuat lenyap. Orangnya tetap masuk, tapi kiriman
// formulirnya ditolak "Token keamanan tidak cocok" - berulang, tanpa pola yang
// jelas, dan tidak bisa ditiru di komputer sendiri karena di sana permintaan
// berjalan berurutan.
//
// Dihitung dari ID sesi + rahasia server, tokennya tetap sama sepanjang sesi
// tanpa perlu ditulis ke mana pun. Tidak ada yang bisa menimpanya. Penyerang
// tidak bisa menghitungnya: ID sesi ada di cookie httpOnly dan rahasianya di
// server.
// Token CSRF ditaruh di COOKIE SENDIRI, bukan di dalam sesi dan bukan pula
// diturunkan dari ID sesi.
//
// Dua kali sebelumnya salah, dan keduanya karena token ikut nasib sesi:
//
//   1. Disimpan DI DALAM sesi. Sesi ditulis ulang pada setiap permintaan
//      (rolling: true). Di hosting tanpa server tetap permintaan berjalan
//      bersamaan - halaman yang dibuka juga menembakkan permintaan latar untuk
//      notifikasi. Yang membaca sesi sebelum token dibuat menuliskannya kembali
//      TANPA token itu.
//
//   2. Dihitung dari ID SESI. ID sesi berganti tanpa membuat orang keluar:
//      req.session.regenerate() saat masuk, dan 'DELETE FROM sesi' saat
//      Administrator menyetel ulang sandi orang lain. Begitu ID berganti,
//      SELURUH halaman yang sedang terbuka jadi tidak sah sekaligus.
//
// Cookie tersendiri tidak ikut keduanya. Ia bertahan melewati penggantian sesi
// maupun penulisan sesi yang bersamaan.
//
// Aman karena httpOnly: situs lain tidak bisa membacanya, jadi tidak bisa
// menyusun formulir yang isinya cocok. Dipadu SameSite=lax, kiriman dari situs
// lain tidak membawanya sama sekali.
const KUE_CSRF = 'eapex.csrf';
const UMUR_CSRF = 12 * 3600 * 1000;

function bacaKue(req, nama) {
  const mentah = req.headers && req.headers.cookie;
  if (!mentah) return null;
  for (const bagian of mentah.split(';')) {
    const p = bagian.indexOf('=');
    if (p < 0) continue;
    if (bagian.slice(0, p).trim() === nama) {
      try { return decodeURIComponent(bagian.slice(p + 1).trim()); } catch (e) { return null; }
    }
  }
  return null;
}

function pastikanTokenCsrf(req, res) {
  let token = bacaKue(req, KUE_CSRF);
  if (!token || token.length < 32) {
    token = crypto.randomBytes(24).toString('hex');
    res.cookie(KUE_CSRF, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: !!process.env.DI_BELAKANG_PROXY,
      maxAge: UMUR_CSRF,
      path: '/',
    });
    // Dipakai pada permintaan yang SAMA: kalau tidak, halaman pertama dirender
    // dengan token lama sementara cookienya sudah yang baru.
    req.tokenCsrfBaru = token;
  }
  return token;
}

function tokenCocok(req) {
  const kiriman = (req.body && req.body._csrf) || req.get('x-csrf-token');
  const dariKue = req.tokenCsrfBaru || bacaKue(req, KUE_CSRF);
  if (dariKue && samaAman(kiriman, dariKue)) return true;
  // Masa peralihan: halaman yang terbuka sebelum perubahan ini membawa token
  // lama yang tersimpan di sesi. Menolaknya berarti orang yang sedang mengisi
  // formulir kehilangan isiannya tepat saat penyebaran berjalan.
  return !!(req.session && req.session.csrf) && samaAman(kiriman, req.session.csrf);
}

function csrf(req, res, next) {
  res.locals.csrf = pastikanTokenCsrf(req, res);
  const perluPeriksa = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  if (!perluPeriksa) return next();

  // Kiriman berisi berkas (multipart) belum terurai pada titik ini — badannya baru
  // dibaca oleh penangan unggahan. Pemeriksaannya DITUNDA, bukan dilewati:
  // lib/unggah.js selalu memasang csrfSetelahUnggah tepat sesudah penangan berkas,
  // sehingga tidak ada jalur yang bisa lolos tanpa diperiksa.
  const jenisIsi = String(req.get('content-type') || '');
  if (jenisIsi.startsWith('multipart/form-data')) {
    req.csrfDitunda = true;
    return next();
  }

  if (!tokenCocok(req)) return tolakCsrf(req, res);
  next();
}

// Dipasang PERSIS setelah penangan unggahan berkas.
function csrfSetelahUnggah(req, res, next) {
  if (!req.csrfDitunda) return next();
  req.csrfDitunda = false;
  if (!tokenCocok(req)) {
    // Berkas yang terlanjur tersimpan harus dibuang: permintaannya tidak sah.
    const { hapusBerkas } = require('./unggah');
    (req.files || []).forEach(f => hapusBerkas(f.filename));
    return tolakCsrf(req, res);
  }
  next();
}

module.exports = {
  buatPenyimpanSesi, penggunaById, penggunaByEmail, periksaLogin, hashSandi,
  periksaKekuatanSandi, gantiSandi, muatPengguna, wajibLogin, wajibPeran,
  csrf, csrfSetelahUnggah, id, pasangPenanda, buangPenanda, SESI_MAKS_JAM,
};
