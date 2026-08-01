// ============================================================================
//  Dasbor, kotak masuk approval, notifikasi
// ============================================================================
const express = require('express');
const db = require('../lib/db');
const P = require('../lib/pengajuan');
const notif = require('../lib/notifikasi');
const push = require('../lib/push');
const cuti = require('../lib/cuti');

const r = express.Router();

r.get('/', async (req, res) => {
  const ringkas = await P.ringkasan(req.pengguna);
  const inbox = await P.kotakMasuk(req.pengguna.id);
  const terakhir = await P.daftar({ pengguna: req.pengguna, batas: 8 });
  const rekap = await P.rekapKategori(req.pengguna);
  const maksRekap = rekap.reduce((a, b) => Math.max(a, Number(b.jml || 0)), 0);
  res.render('dasbor', {
    judul: 'Dasbor', menuAktif: 'dasbor',
    ringkas, inbox, terakhir: terakhir.baris, rekap, maksRekap,
  });
});

r.get('/approval', async (req, res) => {
  const inbox = await P.kotakMasuk(req.pengguna.id);
  // Riwayat keputusan pengguna ini
  const riwayat = await db.all(
    `SELECT p.id, p.nomor, p.judul, p.total, p.status, k.nama AS kategori_nama,
            s.label AS langkah_label, s.status AS keputusan, s.waktu, s.komentar
     FROM persetujuan s
     JOIN pengajuan p ON p.id = s.pengajuan_id
     JOIN kategori k ON k.id = p.kategori_id
     WHERE s.aktor_id = ? ORDER BY s.waktu DESC LIMIT 50`, [req.pengguna.id]);
  res.render('approval', { judul: 'Kotak Approval', menuAktif: 'approval', inbox, riwayat });
});

// --------------------------------------------------------------- cuti sendiri
// Orang yang paling dulu tahu dia akan cuti adalah dirinya sendiri. Menunggu
// Administrator memasukkan cuti 27 orang berarti catatannya selalu tertinggal,
// dan catatan cuti yang tertinggal sama saja dengan tidak ada.
//
// Administrator tetap bisa mengisikan untuk orang lain lewat Admin > Pengguna —
// lewat jalur mana pun, orangnya diberi tahu.
r.get('/cuti-saya', async (req, res) => {
  const saya = await db.get(
    `SELECT u.*, g.nama AS pengganti_nama FROM pengguna u
     LEFT JOIN pengguna g ON g.id = u.pengganti_id WHERE u.id = ?`, [req.pengguna.id]);
  const rekan = await db.all(
    'SELECT id, nama, peran FROM pengguna WHERE aktif = 1 AND id <> ? ORDER BY nama',
    [req.pengguna.id]);
  res.render('cuti-saya', {
    judul: 'Cuti Saya', menuAktif: 'cuti', saya, rekan,
    sedangCuti: cuti.sedangCuti(saya, cuti.tanggalWib()),
  });
});

r.post('/cuti-saya', async (req, res, next) => {
  const b = req.body || {};
  try {
    await cuti.setel(req.pengguna.id, {
      mulai: String(b.cuti_mulai || '').trim(),
      selesai: String(b.cuti_selesai || '').trim(),
      alasan: String(b.cuti_alasan || '').trim(),
      penggantiId: String(b.pengganti_id || '').trim() || null,
      mode: String(b.cuti_approve || '').trim(),
      oleh: req.pengguna,
    });
    res.kilat('sukses', String(b.cuti_mulai || '').trim()
      ? 'Cuti tercatat. Approval Anda diperlakukan sesuai pilihan di atas.'
      : 'Catatan cuti dihapus.');
  } catch (e) {
    if (!e.publik) return next(e);
    res.kilat('galat', e.message);
  }
  res.redirect('/cuti-saya');
});

r.get('/notifikasi', async (req, res) => {
  const daftar = await notif.daftar(req.pengguna.id, 60);
  res.render('notifikasi', {
    judul: 'Notifikasi', menuAktif: '', daftar,
    pushAktif: push.aktif(),
    jumlahPerangkat: await push.jumlahLangganan(req.pengguna.id),
  });
});

// --------------------------------------------------------------- notifikasi HP
// Dipakai oleh skrip peramban; jawabannya JSON supaya kegagalan bisa ditangani
// tanpa memuat ulang halaman.
r.get('/api/notifikasi/kunci', (req, res) => {
  res.json({ ok: true, aktif: push.aktif(), kunci: push.kunciPublik() });
});

r.post('/api/notifikasi/langganan', async (req, res) => {
  try {
    if (!push.aktif()) return res.status(503).json({ ok: false, pesan: 'Notifikasi HP belum disiapkan di server ini' });
    await push.simpanLangganan(req.pengguna.id, req.body && req.body.langganan, req.get('user-agent'));
    res.json({ ok: true, jumlah: await push.jumlahLangganan(req.pengguna.id) });
  } catch (e) {
    res.status(e.kode || 500).json({ ok: false, pesan: e.publik ? e.message : 'Gagal menyimpan langganan notifikasi' });
  }
});

r.post('/api/notifikasi/langganan/hapus', async (req, res) => {
  try {
    await push.hapusLangganan(req.body && req.body.endpoint);
    res.json({ ok: true, jumlah: await push.jumlahLangganan(req.pengguna.id) });
  } catch (e) {
    res.status(500).json({ ok: false, pesan: 'Gagal menghapus langganan notifikasi' });
  }
});

r.post('/api/notifikasi/uji', async (req, res) => {
  if (!push.aktif()) return res.status(503).json({ ok: false, pesan: 'Notifikasi HP belum disiapkan di server ini' });
  const hasil = await push.kirimKe([req.pengguna.id], {
    judul: 'Uji notifikasi EAPEX',
    pesan: 'Kalau pesan ini muncul, notifikasi approval sudah siap dipakai.',
    url: '/approval',
    tag: 'uji',
  });
  res.json({ ok: hasil.terkirim > 0, ...hasil });
});

r.post('/notifikasi/dibaca', async (req, res) => {
  await notif.tandaiDibaca(req.pengguna.id, req.body && req.body.id);
  res.redirect(req.body && req.body.kembali && String(req.body.kembali).startsWith('/')
    ? req.body.kembali : '/notifikasi');
});

module.exports = r;
