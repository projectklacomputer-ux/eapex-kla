// ============================================================================
//  Rute masuk / keluar / ganti sandi
// ============================================================================
const express = require('express');
const auth = require('../lib/auth');
const { catatJejak } = require('../lib/alur');

module.exports = function (batasLogin) {
  const r = express.Router();

  r.get('/login', (req, res) => {
    if (req.pengguna) return res.redirect('/');
    res.render('login', {
      judul: 'Masuk — EAPEX',
      tujuan: bersihkanTujuan(req.query.tujuan),
      galat: null,
      email: '',
      sesiHabis: req.query.habis === '1',
    });
  });

  r.post('/login', batasLogin, async (req, res) => {
    const { email, sandi } = req.body || {};
    const tujuan = bersihkanTujuan(req.body && req.body.tujuan);
    const hasil = await auth.periksaLogin(email, sandi);
    if (!hasil.ok) {
      await catatJejak(null, {
        pengguna: { id: null, nama: String(email || '').slice(0, 80) },
        aksi: 'login-gagal', detail: 'Percobaan login gagal', ip: req.ip,
      });
      return res.status(401).render('login', {
        judul: 'Masuk — EAPEX', tujuan, galat: hasil.pesan,
        email: String(email || '').slice(0, 120), sesiHabis: false,
      });
    }
    // Ganti id sesi setelah login (mencegah session fixation)
    req.session.regenerate(async err => {
      if (err) throw err;
      req.session.penggunaId = hasil.pengguna.id;
      // Dicatat untuk batas MUTLAK umur sesi (lihat lib/auth.js). Batas diam
      // 60 menit ditangani cookie yang masa berlakunya disetel ulang tiap permintaan.
      req.session.mulai = Date.now();
      auth.pasangPenanda(res);
      await catatJejak(null, { pengguna: hasil.pengguna, aksi: 'login', detail: 'Berhasil masuk', ip: req.ip });
      res.redirect(hasil.pengguna.wajib_ganti_sandi ? '/ganti-sandi' : tujuan);
    });
  });

  // Keluar atas kemauan sendiri: penandanya ikut dibuang, supaya saat kembali
  // tidak disambut pesan "sesi berakhir" yang tidak pernah terjadi.
  const keluar = (req, res) => {
    auth.buangPenanda(res);
    req.session.destroy(() => res.redirect('/login'));
  };
  r.post('/keluar', keluar);
  // Tautan "keluar" di menu memakai formulir POST; GET disediakan agar
  // sesi kedaluwarsa tetap bisa dibersihkan dari bilah alamat.
  r.get('/keluar', keluar);

  r.get('/ganti-sandi', (req, res) => {
    if (!req.pengguna) return res.redirect('/login');
    res.render('ganti-sandi', {
      judul: 'Ganti Sandi', wajib: !!req.pengguna.wajib_ganti_sandi, galat: null,
    });
  });

  r.post('/ganti-sandi', async (req, res) => {
    if (!req.pengguna) return res.redirect('/login');
    const { sandi_lama, sandi_baru, sandi_ulang } = req.body || {};
    const gagal = pesan => res.status(400).render('ganti-sandi', {
      judul: 'Ganti Sandi', wajib: !!req.pengguna.wajib_ganti_sandi, galat: pesan,
    });

    // Saat sandi awal wajib diganti, sandi lama tetap diminta supaya tautan
    // sesi yang bocor tidak bisa dipakai mengubah kredensial orang lain.
    const cek = await auth.periksaLogin(req.pengguna.email, sandi_lama);
    if (!cek.ok) return gagal('Sandi saat ini salah');
    if (String(sandi_baru || '') !== String(sandi_ulang || '')) return gagal('Sandi baru dan ulangannya tidak sama');
    if (String(sandi_baru || '') === String(sandi_lama || '')) return gagal('Sandi baru harus berbeda dari sandi lama');
    const lemah = auth.periksaKekuatanSandi(sandi_baru);
    if (lemah) return gagal(lemah);

    await auth.gantiSandi(req.pengguna.id, sandi_baru);
    await catatJejak(null, { pengguna: req.pengguna, aksi: 'ganti-sandi', detail: 'Sandi diubah', ip: req.ip });
    res.kilat('sukses', 'Sandi berhasil diganti.');
    res.redirect('/');
  });

  return r;
};

// Hanya izinkan pengalihan ke alamat internal (mencegah open redirect).
function bersihkanTujuan(t) {
  const s = String(t || '/');
  if (!s.startsWith('/') || s.startsWith('//')) return '/';
  return s;
}
