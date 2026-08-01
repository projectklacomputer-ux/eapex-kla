// ============================================================================
//  Menu Admin: pengguna, master unit, matriks approval, pengaturan, jejak audit
// ============================================================================
const express = require('express');
const crypto = require('crypto');
const db = require('../lib/db');
const auth = require('../lib/auth');
const alur = require('../lib/alur');
const { PERAN } = require('../lib/konstanta');
const { id, sekarang, keRupiahBulat, potong } = require('../lib/util');
const cuti = require('../lib/cuti');
const modulEmail = require('../lib/email');

const r = express.Router();
r.use(auth.wajibPeran('admin'));

const bersih = v => (v === undefined || v === null ? '' : String(v).trim());
const kosongJadiNull = v => (bersih(v) === '' ? null : bersih(v));

// --------------------------------------------------------------- ringkasan
r.get('/', async (req, res) => {
  const hitungan = {
    pengguna: Number(await db.nilai('SELECT COUNT(*) AS n FROM pengguna WHERE aktif = 1')),
    cabang: Number(await db.nilai('SELECT COUNT(*) AS n FROM cabang WHERE aktif = 1')),
    kategori: Number(await db.nilai('SELECT COUNT(*) AS n FROM kategori WHERE aktif = 1')),
    pengajuan: Number(await db.nilai('SELECT COUNT(*) AS n FROM pengajuan')),
  };
  // Peran yang belum punya satu pun pengguna aktif = alur approval berpotensi macet.
  const dipakai = await db.all('SELECT DISTINCT peran FROM aturan_langkah');
  const kosong = [];
  for (const p of dipakai) {
    const n = Number(await db.nilai('SELECT COUNT(*) AS n FROM pengguna WHERE peran = ? AND aktif = 1', [p.peran]));
    if (!n) kosong.push(p.peran);
  }
  res.render('admin-ringkas', { judul: 'Administrasi', menuAktif: 'admin', hitungan, peranKosong: kosong });
});

// --------------------------------------------------------------- pengguna
r.get('/pengguna', async (req, res) => {
  const daftar = await db.all(
    `SELECT u.*, c.nama AS cabang_nama, d.nama AS departemen_nama, a.nama AS area_nama
     FROM pengguna u
     LEFT JOIN cabang c ON c.id = u.cabang_id
     LEFT JOIN departemen d ON d.id = u.departemen_id
     LEFT JOIN area a ON a.id = u.area_id
     ORDER BY u.aktif DESC, u.nama`);
  const master = await muatMaster();
  const ubah = req.query.ubah ? daftar.find(u => u.id === req.query.ubah) : null;
  const aktif = daftar.filter(u => u.aktif);
  res.render('admin-pengguna', {
    judul: 'Pengguna', menuAktif: 'admin', daftar, master, ubah, PERAN,
    sedangCuti: cuti.sedangCuti, hariIni: cuti.tanggalWib(), kabarEmail: modulEmail.keterangan(),
    jmlAktif: aktif.length,
    tanpaEmailNotif: aktif.filter(u => !u.email_notifikasi).length,
    sandiBaru: req.query.sandi_baru ? String(req.query.sandi_baru) : null,
    emailSandiBaru: req.query.email ? String(req.query.email) : null,
  });
});

r.post('/pengguna', async (req, res, next) => {
  try {
    const b = req.body || {};
    const nama = potong(bersih(b.nama), 120);
    const email = bersih(b.email).toLowerCase();
    const peran = bersih(b.peran);
    if (!nama || !email) throw pub('Nama dan email wajib diisi');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw pub('Format email tidak sah');
    if (!PERAN[peran]) throw pub('Peran tidak dikenal');

    const kembar = await db.get('SELECT id FROM pengguna WHERE LOWER(email) = ? AND id <> ?', [email, bersih(b.id) || '-']);
    if (kembar) throw pub('Email sudah dipakai pengguna lain');

    // Alamat kiriman TIDAK wajib. Alamat login boleh berupa alamat yang tidak
    // punya kotak surat sungguhan; kalau kolom ini kosong, orangnya sekadar tidak
    // menerima email — bukan galat, dan tidak menahan siapa pun.
    const emailNotif = bersih(b.email_notifikasi).toLowerCase();
    if (emailNotif && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailNotif)) {
      throw pub('Format email notifikasi tidak sah. Kosongkan saja kalau memang tidak dipakai.');
    }

    const nilai = [nama, email, peran, potong(bersih(b.jabatan), 120) || null,
      kosongJadiNull(b.cabang_id), kosongJadiNull(b.area_id), kosongJadiNull(b.departemen_id),
      b.aktif === '1' ? 1 : 0, emailNotif || null];

    if (bersih(b.id)) {
      await db.run(
        `UPDATE pengguna SET nama=?, email=?, peran=?, jabatan=?, cabang_id=?, area_id=?, departemen_id=?, aktif=?,
         email_notifikasi=? WHERE id = ?`, [...nilai, bersih(b.id)]);
      await alur.catatJejak(null, { pengguna: req.pengguna, aksi: 'admin-ubah-pengguna', detail: email, ip: req.ip });
      res.kilat('sukses', 'Data pengguna disimpan.');
      return res.redirect('/admin/pengguna');
    }

    const sandi = sandiAcak();
    await db.run(
      `INSERT INTO pengguna (id, nama, email, sandi_hash, peran, jabatan, cabang_id, area_id, departemen_id,
       aktif, wajib_ganti_sandi, dibuat, email_notifikasi) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)`,
      [id(), nama, email, auth.hashSandi(sandi), peran, potong(bersih(b.jabatan), 120) || null,
        kosongJadiNull(b.cabang_id), kosongJadiNull(b.area_id), kosongJadiNull(b.departemen_id),
        b.aktif === '0' ? 0 : 1, sekarang(), emailNotif || null]);
    await alur.catatJejak(null, { pengguna: req.pengguna, aksi: 'admin-tambah-pengguna', detail: email, ip: req.ip });
    // Sandi awal ditampilkan sekali di halaman (tidak dikirim lewat email/log).
    res.redirect('/admin/pengguna?sandi_baru=' + encodeURIComponent(sandi) + '&email=' + encodeURIComponent(email));
  } catch (e) { if (e.publik) { res.kilat('galat', e.message); return res.redirect('/admin/pengguna'); } next(e); }
});

// --------------------------------------------------- email notifikasi massal
// Mengisi 28 alamat satu per satu lewat formulir Ubah berarti 28 kali muat
// halaman. Di sini semuanya dalam satu daftar, satu tombol simpan.
r.get('/email-notifikasi', async (req, res) => {
  const daftar = await db.all(
    `SELECT u.id, u.nama, u.email, u.peran, u.email_notifikasi, c.nama AS cabang_nama
     FROM pengguna u LEFT JOIN cabang c ON c.id = u.cabang_id
     WHERE u.aktif = 1 ORDER BY u.peran, u.nama`);
  res.render('admin-email-notifikasi', {
    judul: 'Email Notifikasi', menuAktif: 'admin', daftar,
    kabarEmail: modulEmail.keterangan(),
  });
});

r.post('/email-notifikasi', async (req, res, next) => {
  try {
    const b = req.body || {};
    // Nama medan berbentuk email_<id>, jadi id-nya tidak perlu dikirim terpisah
    // dan tidak ada peluang isian tertukar antar baris.
    const kunci = Object.keys(b).filter(k => k.startsWith('email_'));
    const salah = [];
    let terisi = 0, dikosongkan = 0;

    for (const k of kunci) {
      const idPengguna = k.slice('email_'.length);
      const alamat = bersih(b[k]).toLowerCase();
      if (alamat && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(alamat)) { salah.push(alamat); continue; }
      const u = await db.get('SELECT id, email_notifikasi FROM pengguna WHERE id = ?', [idPengguna]);
      if (!u) continue;
      const lama = u.email_notifikasi || '';
      if (lama === alamat) continue;                   // tidak berubah, tidak perlu ditulis
      await db.run('UPDATE pengguna SET email_notifikasi = ? WHERE id = ?', [alamat || null, idPengguna]);
      if (alamat) terisi++; else dikosongkan++;
    }

    if (terisi || dikosongkan) {
      await alur.catatJejak(null, {
        pengguna: req.pengguna, aksi: 'admin-email-notifikasi', ip: req.ip,
        detail: `${terisi} diisi/diubah, ${dikosongkan} dikosongkan`,
      });
    }
    const pesan = [];
    if (terisi) pesan.push(`${terisi} alamat tersimpan`);
    if (dikosongkan) pesan.push(`${dikosongkan} dikosongkan`);
    if (salah.length) pesan.push(`${salah.length} dilewati karena formatnya tidak sah`);
    res.kilat(salah.length ? 'galat' : 'sukses',
      pesan.length ? pesan.join(', ') + '.' : 'Tidak ada yang berubah.');
    res.redirect('/admin/email-notifikasi');
  } catch (e) { next(e); }
});

// --------------------------------------------------------------- cuti penyetuju
// Ditandai manusia, tidak pernah ditebak sistem. Lihat lib/cuti.js untuk alasannya.
r.post('/pengguna/:id/cuti', async (req, res, next) => {
  try {
    const u = await db.get('SELECT id, nama FROM pengguna WHERE id = ?', [req.params.id]);
    if (!u) throw pub('Pengguna tidak ditemukan', 404);
    const b = req.body || {};
    const mulai = bersih(b.cuti_mulai);
    const selesai = bersih(b.cuti_selesai);

    const mode = bersih(b.cuti_approve) || 'tetap';
    await cuti.setel(u.id, {
      mulai, selesai, mode,
      alasan: bersih(b.cuti_alasan),
      penggantiId: kosongJadiNull(b.pengganti_id),
      oleh: req.pengguna,
    });

    await alur.catatJejak(null, {
      pengguna: req.pengguna, aksi: mulai ? 'admin-setel-cuti' : 'admin-hapus-cuti', ip: req.ip,
      detail: mulai ? `${u.nama}: ${mulai} s/d ${selesai} (${cuti.MODE_CUTI[mode] || mode})`
        : `${u.nama}: cuti dihapus`,
    });
    const pesanMode = {
      tetap: 'Approval-nya TIDAK berubah — dia tetap yang menyetujui, hanya ditandai sedang cuti.',
      pengganti: 'Tahap approval-nya dialihkan ke pengganti selama tanggal itu.',
      lewati: 'Tahap approval-nya dilewati selama tanggal itu, dan alasannya tercatat di tiap dokumen.',
    };
    res.kilat('sukses', mulai
      ? `Cuti ${u.nama} dicatat. ${pesanMode[mode] || ''}`
      : `Cuti ${u.nama} dihapus.`);
    res.redirect('/admin/pengguna');
  } catch (e) { if (e.publik) { res.kilat('galat', e.message); return res.redirect('/admin/pengguna'); } next(e); }
});

r.post('/pengguna/:id/reset-sandi', async (req, res, next) => {
  try {
    const u = await db.get('SELECT id, email FROM pengguna WHERE id = ?', [req.params.id]);
    if (!u) throw pub('Pengguna tidak ditemukan', 404);
    const sandi = sandiAcak();
    await db.run('UPDATE pengguna SET sandi_hash = ?, wajib_ganti_sandi = 1 WHERE id = ?',
      [auth.hashSandi(sandi), u.id]);
    await db.run('DELETE FROM sesi');   // paksa semua sesi login ulang setelah reset
    await alur.catatJejak(null, { pengguna: req.pengguna, aksi: 'admin-reset-sandi', detail: u.email, ip: req.ip });
    res.redirect('/admin/pengguna?sandi_baru=' + encodeURIComponent(sandi) + '&email=' + encodeURIComponent(u.email));
  } catch (e) { if (e.publik) { res.kilat('galat', e.message); return res.redirect('/admin/pengguna'); } next(e); }
});

// --------------------------------------------------------------- master unit
async function muatMaster() {
  return {
    area: await db.all('SELECT * FROM area ORDER BY urutan, nama'),
    cabang: await db.all(`SELECT c.*, a.nama AS area_nama FROM cabang c
      LEFT JOIN area a ON a.id = c.area_id ORDER BY c.tipe DESC, c.nama`),
    departemen: await db.all('SELECT * FROM departemen ORDER BY nama'),
  };
}

r.get('/master', async (req, res) => {
  res.render('admin-master', { judul: 'Master Unit', menuAktif: 'admin', master: await muatMaster() });
});

r.post('/master/area', async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!bersih(b.kode) || !bersih(b.nama)) throw pub('Kode dan nama area wajib diisi');
    if (bersih(b.id)) {
      await db.run('UPDATE area SET kode=?, nama=?, aktif=? WHERE id=?',
        [potong(bersih(b.kode), 20), potong(bersih(b.nama), 120), b.aktif === '0' ? 0 : 1, bersih(b.id)]);
    } else {
      await db.run('INSERT INTO area (id, kode, nama, urutan, aktif) VALUES (?,?,?,?,1)',
        [id(), potong(bersih(b.kode), 20), potong(bersih(b.nama), 120), Number(b.urutan || 99)]);
    }
    res.kilat('sukses', 'Area disimpan.');
  } catch (e) { if (!e.publik) return next(e); res.kilat('galat', e.message); }
  res.redirect('/admin/master');
});

r.post('/master/cabang', async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!bersih(b.kode) || !bersih(b.nama)) throw pub('Kode dan nama cabang wajib diisi');
    const tipe = b.tipe === 'back_office' ? 'back_office' : 'store';
    const nilai = [potong(bersih(b.kode), 20), potong(bersih(b.nama), 120), tipe,
      kosongJadiNull(b.area_id), potong(bersih(b.alamat), 300) || null, b.aktif === '0' ? 0 : 1];
    if (bersih(b.id)) {
      await db.run('UPDATE cabang SET kode=?, nama=?, tipe=?, area_id=?, alamat=?, aktif=? WHERE id=?',
        [...nilai, bersih(b.id)]);
    } else {
      await db.run('INSERT INTO cabang (id, kode, nama, tipe, area_id, alamat, aktif) VALUES (?,?,?,?,?,?,?)',
        [id(), ...nilai]);
    }
    res.kilat('sukses', 'Cabang disimpan.');
  } catch (e) { if (!e.publik) return next(e); res.kilat('galat', e.message); }
  res.redirect('/admin/master');
});

r.post('/master/departemen', async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!bersih(b.kode) || !bersih(b.nama)) throw pub('Kode dan nama departemen wajib diisi');
    if (bersih(b.id)) {
      await db.run('UPDATE departemen SET kode=?, nama=?, aktif=? WHERE id=?',
        [potong(bersih(b.kode), 20), potong(bersih(b.nama), 120), b.aktif === '0' ? 0 : 1, bersih(b.id)]);
    } else {
      await db.run('INSERT INTO departemen (id, kode, nama, aktif) VALUES (?,?,?,1)',
        [id(), potong(bersih(b.kode), 20), potong(bersih(b.nama), 120)]);
    }
    res.kilat('sukses', 'Departemen disimpan.');
  } catch (e) { if (!e.publik) return next(e); res.kilat('galat', e.message); }
  res.redirect('/admin/master');
});

// --------------------------------------------------------------- matriks approval
r.get('/kategori', async (req, res) => {
  const kategori = await db.all('SELECT * FROM kategori ORDER BY urutan, nama');
  const isi = [];
  for (const k of kategori) {
    const aturan = await db.all('SELECT * FROM aturan WHERE kategori_id = ? ORDER BY wilayah', [k.id]);
    for (const a of aturan) {
      a.langkah = await db.all('SELECT * FROM aturan_langkah WHERE aturan_id = ? ORDER BY urut', [a.id]);
    }
    isi.push({ ...k, aturan });
  }
  res.render('admin-kategori', { judul: 'Matriks Approval', menuAktif: 'admin', isi, PERAN });
});

r.post('/kategori/aturan/:id', async (req, res, next) => {
  try {
    const b = req.body || {};
    const aturan = await db.get('SELECT * FROM aturan WHERE id = ?', [req.params.id]);
    if (!aturan) throw pub('Aturan tidak ditemukan', 404);

    const peran = ambilArray(b.langkah_peran);
    const label = ambilArray(b.langkah_label);
    const min = ambilArray(b.langkah_min);
    const lingkup = ambilArray(b.langkah_lingkup);

    const langkah = [];
    for (let i = 0; i < peran.length; i++) {
      const p = bersih(peran[i]);
      if (!p) continue;
      if (!PERAN[p]) throw pub('Peran tidak dikenal: ' + p);
      langkah.push({
        peran: p,
        label: potong(bersih(label[i]), 120) || null,
        min: bersih(min[i]) === '' ? null : keRupiahBulat(min[i]),
        lingkup: ['auto', 'area_tujuan', 'global'].includes(bersih(lingkup[i])) ? bersih(lingkup[i]) : 'auto',
      });
    }
    if (!langkah.length) throw pub('Minimal satu langkah approval');

    const peranPemohon = ambilArray(b.peran_pemohon).map(bersih).filter(p => PERAN[p]);
    if (!peranPemohon.length) throw pub('Minimal satu peran pemohon');

    // `ambang_ceo` DITURUNKAN dari langkahnya, tidak diisi terpisah. Dulu ada dua
    // kotak isian yang sama-sama bernama "ambang": satu mengatur alur, satu hanya
    // penanda di layar. Mengubah yang salah tidak menghasilkan apa-apa, dan
    // diamnya itu yang berbahaya — orang mengira ambangnya sudah naik.
    const langkahCeo = langkah.find(l => l.peran === 'ceo');
    const ambangCeo = langkahCeo ? langkahCeo.min : null;

    await db.tx(async ops => {
      await ops.run('UPDATE aturan SET peran_pemohon = ?, ambang_ceo = ?, aktif = ? WHERE id = ?',
        [peranPemohon.join(','), ambangCeo, b.aktif === '0' ? 0 : 1, aturan.id]);
      await ops.run('DELETE FROM aturan_langkah WHERE aturan_id = ?', [aturan.id]);
      for (let i = 0; i < langkah.length; i++) {
        const l = langkah[i];
        await ops.run(
          `INSERT INTO aturan_langkah (id, aturan_id, urut, peran, label, min_nominal, maks_nominal, lingkup)
           VALUES (?,?,?,?,?,?,NULL,?)`,
          [id(), aturan.id, i + 1, l.peran, l.label, l.min, l.lingkup]);
      }
    });
    await alur.catatJejak(null, {
      pengguna: req.pengguna, aksi: 'admin-ubah-aturan', ip: req.ip,
      detail: `Aturan ${aturan.id} (${aturan.wilayah}): ` + langkah.map(l => l.peran + (l.min ? '>=' + l.min : '')).join(' -> '),
    });
    res.kilat('sukses', 'Matriks approval diperbarui. Dokumen yang sedang berjalan tidak berubah.');
  } catch (e) { if (!e.publik) return next(e); res.kilat('galat', e.message); }
  res.redirect('/admin/kategori');
});

r.post('/kategori/:id/aktif', async (req, res, next) => {
  try {
    const aktif = req.body && req.body.aktif === '1' ? 1 : 0;
    await db.run('UPDATE kategori SET aktif = ? WHERE id = ?', [aktif, req.params.id]);
    res.kilat('sukses', aktif ? 'Kategori diaktifkan.' : 'Kategori dinonaktifkan.');
  } catch (e) { next(e); }
  res.redirect('/admin/kategori');
});

// --------------------------------------------------------------- pengaturan
r.get('/pengaturan', async (req, res) => {
  const baris = await db.all('SELECT * FROM pengaturan ORDER BY kunci');
  res.render('admin-pengaturan', { judul: 'Pengaturan', menuAktif: 'admin', baris });
});

r.post('/pengaturan', async (req, res, next) => {
  try {
    const b = req.body || {};
    for (const [k, v] of Object.entries(b)) {
      if (k === '_csrf') continue;
      await db.run(
        `INSERT INTO pengaturan (kunci, nilai) VALUES (?,?)
         ON CONFLICT (kunci) DO UPDATE SET nilai = excluded.nilai`, [potong(k, 60), potong(String(v), 500)]);
    }
    await alur.catatJejak(null, { pengguna: req.pengguna, aksi: 'admin-pengaturan', ip: req.ip, detail: Object.keys(b).join(', ') });
    res.kilat('sukses', 'Pengaturan disimpan.');
  } catch (e) { next(e); }
  res.redirect('/admin/pengaturan');
});

// --------------------------------------------------------------- jejak audit
r.get('/jejak', async (req, res) => {
  const cari = bersih(req.query.cari);
  const params = [];
  let where = '';
  if (cari) {
    where = 'WHERE LOWER(j.nama) LIKE ? OR LOWER(j.aksi) LIKE ? OR LOWER(j.detail) LIKE ? OR LOWER(p.nomor) LIKE ?';
    const q = '%' + cari.toLowerCase() + '%';
    params.push(q, q, q, q);
  }
  const daftar = await db.all(
    `SELECT j.*, p.nomor, p.judul FROM jejak j LEFT JOIN pengajuan p ON p.id = j.pengajuan_id
     ${where} ORDER BY j.waktu DESC LIMIT 300`, params);
  res.render('admin-jejak', { judul: 'Jejak Audit', menuAktif: 'admin', daftar, cari });
});

function ambilArray(v) { return v === undefined || v === null ? [] : (Array.isArray(v) ? v : [v]); }
function pub(pesan, kode = 400) { return Object.assign(new Error(pesan), { publik: true, kode }); }
function sandiAcak() {
  const abjad = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const buf = crypto.randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) s += abjad[buf[i] % abjad.length];
  return s;
}

module.exports = r;
