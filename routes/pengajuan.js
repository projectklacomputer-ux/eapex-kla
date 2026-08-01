// ============================================================================
//  Rute pengajuan: buat, ubah, ajukan, putuskan, lampiran, cetak
// ============================================================================
const express = require('express');
const fs = require('fs');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const ai = require('../lib/ai-penawaran');
const db = require('../lib/db');
const P = require('../lib/pengajuan');
const alur = require('../lib/alur');
const mesinAturan = require('../lib/aturan');
const form = require('../lib/formulir');
const { terimaBerkas, jalurBerkas, hapusBerkas, maksMB } = require('../lib/unggah');
const simpanan = require('../lib/simpanan');
const { id, sekarang, rp, tglSingkat, keRupiahBulat, namaBerkasAman, BULAN } = require('../lib/util');
const { labelStatus } = require('../lib/konstanta');
const xlsxTulis = require('../lib/xlsx-tulis');

const r = express.Router();

// --------------------------------------------------------------- master untuk formulir
async function masterFormulir(pengguna, wilayah) {
  const semuaCabang = await db.all('SELECT * FROM cabang WHERE aktif = 1 ORDER BY tipe DESC, nama');
  const departemen = await db.all('SELECT * FROM departemen WHERE aktif = 1 ORDER BY nama');
  const area = await db.all('SELECT * FROM area WHERE aktif = 1 ORDER BY urutan, nama');

  let cabang;
  if (wilayah === 'back_office') {
    cabang = semuaCabang.filter(c => c.tipe === 'back_office');
  } else {
    const store = semuaCabang.filter(c => c.tipe === 'store');
    const cabangSendiri = semuaCabang.find(c => c.id === pengguna.cabang_id);
    const bolehSemua = pengguna.peran === 'admin'
      || !cabangSendiri                                  // pengguna tanpa cabang (mis. HC/HO)
      || cabangSendiri.tipe === 'back_office'            // orang HO mengajukan biaya untuk store
      || pengguna.peran === 'area_manager';              // Area Manager: seluruh cabang di areanya
    if (bolehSemua) {
      cabang = (pengguna.peran === 'area_manager' && pengguna.area_id)
        ? store.filter(c => c.area_id === pengguna.area_id)
        : store;
      if (pengguna.peran === 'admin') cabang = store;
    } else {
      cabang = store.filter(c => c.id === pengguna.cabang_id);
    }
  }
  return { cabang, departemen, area, semuaCabang };
}

// --------------------------------------------------------------- daftar
r.get('/', async (req, res) => {
  const f = {
    pengguna: req.pengguna,
    status: bersih(req.query.status),
    kategori_id: bersih(req.query.kategori_id),
    cabang_id: bersih(req.query.cabang_id),
    jenis: bersih(req.query.jenis),
    cari: bersih(req.query.cari),
    mulai: Number(req.query.mulai || 0),
    // Unduhan mengambil jauh lebih banyak baris daripada yang tampil di layar:
    // yang diunduh dipakai untuk direkap, jadi dipotong 50 baris tidak ada gunanya.
    batas: req.query.format === 'xlsx' ? 2000 : 50,
  };
  if (req.query.punya_saya === '1') f.pemohon_id = req.pengguna.id;

  // Saringan periode. Memilih bulan tanpa memilih tahun tidak jelas maknanya,
  // jadi tahun berjalan dipakai dan pilihannya ikut ditampilkan balik ke layar.
  const bulan = bersih(req.query.bulan);
  let tahun = bersih(req.query.tahun);
  if (bulan && !tahun) tahun = String(new Date().getFullYear());
  const rentang = P.rentangPeriode(tahun, bulan);
  if (rentang) { f.dari = rentang.dari; f.sebelum = rentang.sebelum; }

  const hasil = await P.daftar(f);
  const kategori = await mesinAturan.kategoriAktif();
  const cabang = await db.all('SELECT * FROM cabang WHERE aktif = 1 ORDER BY tipe DESC, nama');
  const daftarTahun = await P.tahunTersedia();

  if (req.query.format === 'xlsx') {
    const keterangan = [tahun, bulan ? BULAN[Number(bulan) - 1] : null].filter(Boolean).join('-');
    return kirimExcel(res, hasil.baris, keterangan);
  }

  res.render('pengajuan-daftar', {
    judul: 'Daftar Pengajuan', menuAktif: 'pengajuan',
    hasil, kategori, cabang, daftarTahun,
    q: Object.assign({}, req.query, { bulan, tahun }),
  });
});

// --------------------------------------------------------------- pilih kategori
r.get('/baru', async (req, res) => {
  const kategori = await mesinAturan.kategoriAktif();
  const dapat = [];
  for (const k of kategori) {
    const aturan = await mesinAturan.aturanUntukPengguna(k.id, req.pengguna);
    if (aturan.length) dapat.push({ ...k, aturan });
  }
  const grup = [];
  for (const k of dapat) {
    let g = grup.find(x => x.nama === k.grup);
    if (!g) { g = { nama: k.grup, isi: [] }; grup.push(g); }
    g.isi.push(k);
  }
  res.render('pengajuan-pilih', { judul: 'Pengajuan Baru', menuAktif: 'baru', grup, adaAkses: dapat.length > 0 });
});

// --------------------------------------------------------------- formulir baru
r.get('/baru/:kode', async (req, res) => {
  const kategori = await db.get('SELECT * FROM kategori WHERE kode = ? AND aktif = 1', [req.params.kode]);
  if (!kategori) return res.status(404).render('galat', { judul: 'Kategori tidak ada', pesan: 'Kategori pengajuan tidak ditemukan.' });
  const aturan = await mesinAturan.aturanUntukPengguna(kategori.id, req.pengguna);
  if (!aturan.length) {
    return res.status(403).render('galat', {
      judul: 'Tidak berwenang',
      pesan: `Peran Anda (${req.pengguna.peran}) tidak terdaftar sebagai pemohon untuk "${kategori.nama}".`,
    });
  }
  const dipilih = aturan.find(a => a.id === req.query.aturan_id) || aturan[0];
  const master = await masterFormulir(req.pengguna, dipilih.wilayah);
  const langkah = await mesinAturan.langkahAturan(dipilih.id);

  res.render('pengajuan-form', {
    judul: 'Pengajuan Baru — ' + kategori.nama, menuAktif: 'baru',
    kategori, aturan, aturanDipilih: dipilih, langkah, master,
    p: null, data: {}, items: [], galat: [], aiAktif: ai.aktif(), wajib: form.medanWajib(kategori.bentuk),
  });
});

// --------------------------------------------------------------- simpan baru
r.post('/', terimaBerkas('berkas', 10), async (req, res, next) => {
  try { await simpan(req, res, null); } catch (e) { next(e); }
});

// --------------------------------------------------------------- baca penawaran (AI)
// Harus didaftarkan SEBELUM rute '/:id', kalau tidak alamat ini ikut tertangkap
// sebagai id dokumen.
//
// Berkasnya sengaja TIDAK disimpan: unggahan yang sesungguhnya terjadi saat
// formulir dikirim. Di sini berkas hanya dibaca sekali lalu dibuang sendiri oleh
// bersihkanSisaBerkas (req.berkasDipakai tidak pernah disetel).
const batasBaca = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  // Dihitung per PENGGUNA, bukan per alamat IP: satu kantor keluar lewat satu IP,
  // jadi batas per-IP akan menghukum orang yang tidak melakukan apa-apa.
  keyGenerator: req => (req.pengguna ? 'u:' + req.pengguna.id : ipKeyGenerator(req.ip)),
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, pesan: 'Terlalu sering membaca penawaran. Tunggu beberapa menit.' },
});

r.post('/baca-penawaran', terimaBerkas('berkas', 5), batasBaca, async (req, res, next) => {
  try {
    if (!(req.files || []).length) throw galatPublik('Tidak ada berkas yang terkirim');
    const berkas = req.files.map(f => ({
      nama: namaBerkasAman(f.originalname),
      mime: f.mimetype,
      isi: fs.readFileSync(jalurBerkas(f.filename)),
    }));
    const hasil = await ai.baca(berkas);
    // Pemakaian dicatat di server saja — biayanya perlu bisa ditelusuri,
    // tapi tidak ada gunanya di layar pemohon.
    console.log('[baca-penawaran]', req.pengguna.email, hasil.model,
      'berkas=' + hasil.berkasDibaca.length,
      hasil.pemakaian ? 'token=' + hasil.pemakaian.total_tokens : '');
    res.json({ ok: true, ...hasil, pemakaian: undefined });
  } catch (e) {
    if (!e.publik) return next(e);
    res.status(e.kode || 400).json({ ok: false, pesan: e.message });
  }
});

// --------------------------------------------------------------- detail
r.get('/:id', async (req, res) => {
  const p = await P.ambil(req.params.id);
  if (!p) return res.status(404).render('galat', { judul: 'Tidak ditemukan', pesan: 'Pengajuan tidak ada.' });
  if (!P.bolehMelihat(p, req.pengguna)) {
    return res.status(403).render('galat', { judul: 'Tidak berwenang', pesan: 'Anda tidak berhak melihat dokumen ini.' });
  }
  let pratinjau = null;
  if (['draft', 'revisi'].includes(p.status)) {
    try { pratinjau = await alur.pratinjauRantai(p); } catch (e) { pratinjau = null; }
  }
  const aturan = await mesinAturan.aturanById(p.aturan_id);
  res.render('pengajuan-detail', {
    judul: (p.nomor || 'Draft') + ' — ' + p.judul, menuAktif: 'pengajuan',
    p, aturan, pratinjau,
    bolehUbah: P.bolehMengubah(p, req.pengguna),
    bolehPutus: P.bolehMemutuskan(p, req.pengguna),
    langkahAktif: P.langkahAktif(p),
    // Untuk pilihan "lewati tahap berikutnya": penyetuju sekarang perlu tahu
    // siapa yang berikutnya, apakah tahapnya boleh dilewati, dan apakah orangnya
    // memang sedang tercatat berhalangan.
    tahapBerikut: await P.tahapBerikutnya(p),
    maksMB,
  });
});

// --------------------------------------------------------------- ubah
r.get('/:id/ubah', async (req, res) => {
  const p = await P.ambil(req.params.id);
  if (!p) return res.status(404).render('galat', { judul: 'Tidak ditemukan', pesan: 'Pengajuan tidak ada.' });
  if (!P.bolehMengubah(p, req.pengguna)) {
    return res.status(403).render('galat', {
      judul: 'Tidak bisa diubah',
      pesan: 'Dokumen yang sudah masuk alur approval tidak bisa diubah. Minta penyetuju mengembalikannya untuk revisi.',
    });
  }
  const kategori = p.kategori;
  const aturan = await mesinAturan.aturanUntukPengguna(kategori.id, req.pengguna);
  const dipilih = aturan.find(a => a.id === p.aturan_id) || aturan[0];
  const master = await masterFormulir(req.pengguna, p.wilayah);
  const langkah = await mesinAturan.langkahAturan(p.aturan_id);
  res.render('pengajuan-form', {
    judul: 'Ubah — ' + p.judul, menuAktif: 'pengajuan',
    kategori, aturan, aturanDipilih: dipilih, langkah, master,
    p, data: p.data, items: p.items, galat: [], aiAktif: ai.aktif(), wajib: form.medanWajib(kategori.bentuk),
  });
});

r.post('/:id', terimaBerkas('berkas', 10), async (req, res, next) => {
  try {
    const p = await P.ambil(req.params.id);
    if (!p) return res.status(404).render('galat', { judul: 'Tidak ditemukan', pesan: 'Pengajuan tidak ada.' });
    if (!P.bolehMengubah(p, req.pengguna)) {
      return res.status(403).render('galat', { judul: 'Tidak bisa diubah', pesan: 'Dokumen ini sudah masuk alur approval.' });
    }
    await simpan(req, res, p);
  } catch (e) { next(e); }
});

// --------------------------------------------------------------- inti simpan
async function simpan(req, res, pLama) {
  const b = req.body || {};
  const kategori = await db.get('SELECT * FROM kategori WHERE id = ? AND aktif = 1', [b.kategori_id]);
  if (!kategori) throw galatPublik('Kategori pengajuan tidak sah');

  const aturanBoleh = await mesinAturan.aturanUntukPengguna(kategori.id, req.pengguna);
  const aturan = aturanBoleh.find(a => a.id === b.aturan_id);
  if (!aturan) throw galatPublik('Anda tidak berwenang mengajukan kategori ini');

  const master = await masterFormulir(req.pengguna, aturan.wilayah);
  const data = form.bacaData(kategori.bentuk, b);
  const items = form.bacaItems(b);

  // Cabang/departemen wajib berasal dari daftar yang memang boleh dipakai pengguna ini,
  // supaya kiriman yang dimodifikasi tidak bisa menembus batas unit.
  let cabang_id = bersih(b.cabang_id) || null;
  let departemen_id = bersih(b.departemen_id) || null;
  if (aturan.wilayah === 'store') {
    if (!master.cabang.some(c => c.id === cabang_id)) cabang_id = master.cabang.length === 1 ? master.cabang[0].id : null;
    departemen_id = null;
  } else {
    const ho = master.cabang[0];
    cabang_id = ho ? ho.id : null;
    if (!master.departemen.some(d => d.id === departemen_id)) {
      departemen_id = req.pengguna.departemen_id || null;
    }
  }
  if (kategori.bentuk === 'pindah_area' && data.area_tujuan_id) {
    if (!master.area.some(a => a.id === data.area_tujuan_id)) throw galatPublik('Area tujuan tidak sah');
    if (req.pengguna.area_id && data.area_tujuan_id === req.pengguna.area_id) {
      throw galatPublik('Area tujuan tidak boleh sama dengan area asal');
    }
  }

  const judul = String(b.judul || '').trim().slice(0, 300);
  const galat = form.periksa(kategori.bentuk, {
    judul, data, items, wilayah: aturan.wilayah, cabang_id, departemen_id,
  });

  // Draft boleh disimpan belum lengkap; pemeriksaan penuh dijalankan saat "Ajukan".
  const langsungAjukan = b.aksi === 'ajukan';
  if (langsungAjukan && galat.length) {
    const langkah = await mesinAturan.langkahAturan(aturan.id);
    // Peramban tidak bisa mengisi ulang kotak berkas, jadi lampiran yang terlanjur
    // terkirim dibuang (oleh bersihkanSisaBerkas) dan penggunanya diberi tahu.
    if ((req.files || []).length) {
      galat.push('Lampiran belum ikut tersimpan — pilih berkasnya sekali lagi setelah isian di atas dilengkapi.');
    }
    return res.status(400).render('pengajuan-form', {
      judul: 'Periksa kembali isian', menuAktif: 'baru',
      kategori, aturan: aturanBoleh, aturanDipilih: aturan, langkah, master,
      p: pLama, data, items, galat, aiAktif: ai.aktif(), wajib: form.medanWajib(kategori.bentuk),
    });
  }

  const total = P.hitungTotal(kategori.bentuk, data, items);
  const waktu = sekarang();
  const pengajuanId = pLama ? pLama.id : id();
  const berkas = req.files || [];

  await db.tx(async ops => {
    if (pLama) {
      await ops.run(
        `UPDATE pengajuan SET kategori_id = ?, aturan_id = ?, wilayah = ?, cabang_id = ?, departemen_id = ?,
         judul = ?, keterangan = ?, status_anggaran = ?, total = ?, data_json = ?, diperbarui = ? WHERE id = ?`,
        [kategori.id, aturan.id, aturan.wilayah, cabang_id, departemen_id, judul,
          String(b.keterangan || '').slice(0, 4000) || null, bersih(b.status_anggaran) || null,
          total, JSON.stringify(data), waktu, pengajuanId]);
      await ops.run('DELETE FROM pengajuan_item WHERE pengajuan_id = ?', [pengajuanId]);
    } else {
      await ops.run(
        `INSERT INTO pengajuan (id, nomor, kategori_id, aturan_id, wilayah, pemohon_id, cabang_id, departemen_id,
         judul, keterangan, status_anggaran, total, status, langkah_kini, data_json, dibuat, diperbarui)
         VALUES (?,NULL,?,?,?,?,?,?,?,?,?,?, 'draft', 0, ?, ?, ?)`,
        [pengajuanId, kategori.id, aturan.id, aturan.wilayah, req.pengguna.id, cabang_id, departemen_id,
          judul, String(b.keterangan || '').slice(0, 4000) || null, bersih(b.status_anggaran) || null,
          total, JSON.stringify(data), waktu, waktu]);
    }
    for (const it of items) {
      await ops.run(
        `INSERT INTO pengajuan_item (id, pengajuan_id, urut, nama, qty, satuan, harga, nominal, keterangan)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [id(), pengajuanId, it.urut, it.nama, it.qty, it.satuan, it.harga, it.nominal, it.keterangan]);
    }
    // Lampiran yang ikut terkirim bersama formulir (penawaran vendor dsb.) masuk
    // dalam transaksi yang sama: kalau penyimpanan gagal, tidak ada baris lampiran
    // yang menunjuk ke dokumen yang tidak jadi ada.
    for (const f of berkas) {
      await ops.run(
        `INSERT INTO lampiran (id, pengajuan_id, nama_asli, nama_simpan, mime, ukuran, pengunggah_id, dibuat)
         VALUES (?,?,?,?,?,?,?,?)`,
        [id(), pengajuanId, namaBerkasAman(f.originalname), f.filename, f.mimetype, f.size, req.pengguna.id, waktu]);
      await simpanan.pindahkan(f.filename, ops);
    }
    await alur.catatJejak(ops, {
      pengajuan_id: pengajuanId, pengguna: req.pengguna, ip: req.ip,
      aksi: pLama ? 'ubah' : 'buat',
      detail: (pLama ? 'Draft diperbarui. ' : 'Draft dibuat. ') + `Total ${rp(total)}`
        + (berkas.length ? `, ${berkas.length} lampiran` : ''),
    });
  });
  req.berkasDipakai = true;

  if (langsungAjukan) {
    try {
      const hasil = await alur.ajukan(pengajuanId, req.pengguna, req.ip);
      res.kilat('sukses', pesanTerkirim(hasil));
    } catch (e) {
      if (!e.publik) throw e;
      res.kilat('galat', e.message);
    }
    return res.redirect('/pengajuan/' + pengajuanId);
  }
  res.kilat('sukses', 'Draft tersimpan'
    + (berkas.length ? ` bersama ${berkas.length} lampiran` : '')
    + '. Periksa sekali lagi lalu tekan "Ajukan Approval".');
  res.redirect('/pengajuan/' + pengajuanId);
}

// --------------------------------------------------------------- ajukan / putuskan
r.post('/:id/ajukan', async (req, res, next) => {
  try {
    const hasil = await alur.ajukan(req.params.id, req.pengguna, req.ip);
    res.kilat('sukses', pesanTerkirim(hasil));
  } catch (e) {
    if (!e.publik) return next(e);
    res.kilat('galat', e.message);
  }
  res.redirect('/pengajuan/' + req.params.id);
});

r.post('/:id/putuskan', async (req, res, next) => {
  const b = req.body || {};
  try {
    const hasil = await alur.putuskan(req.params.id, req.pengguna, b.aksi, b.komentar, req.ip, {
      lewatiBerikut: b.lewati_berikut === '1',
      alasanLewat: b.alasan_lewat,
    });
    let pesan = hasil.status === 'setuju'
      ? (hasil.berikut ? 'Disetujui. Diteruskan ke ' + hasil.berikut.label + '.' : 'Disetujui. Dokumen selesai penuh.')
      : (hasil.status === 'tolak' ? 'Pengajuan ditolak.' : 'Pengajuan dikembalikan untuk revisi.');
    if (hasil.dilewati) {
      pesan += ` Tahap ${hasil.dilewati.label} dilewati — alasannya tercatat di dokumen dan yang bersangkutan sudah diberi tahu.`;
    }
    res.kilat('sukses', pesan);
  } catch (e) {
    if (!e.publik) return next(e);
    res.kilat('galat', e.message);
  }
  res.redirect(b.kembali === 'approval' ? '/approval' : '/pengajuan/' + req.params.id);
});

r.post('/:id/batal', async (req, res, next) => {
  try {
    await alur.batalkan(req.params.id, req.pengguna, req.body && req.body.alasan, req.ip);
    res.kilat('sukses', 'Pengajuan dibatalkan.');
  } catch (e) {
    if (!e.publik) return next(e);
    res.kilat('galat', e.message);
  }
  res.redirect('/pengajuan/' + req.params.id);
});

r.post('/:id/komentar', async (req, res, next) => {
  try {
    await alur.komentari(req.params.id, req.pengguna, req.body && req.body.teks, req.ip);
  } catch (e) {
    if (!e.publik) return next(e);
    res.kilat('galat', e.message);
  }
  res.redirect('/pengajuan/' + req.params.id + '#diskusi');
});

// --------------------------------------------------------------- lampiran
r.post('/:id/lampiran', terimaBerkas('berkas', 10), async (req, res, next) => {
  try {
    const p = await P.ambil(req.params.id);
    if (!p) throw galatPublik('Pengajuan tidak ditemukan', 404);
    const boleh = P.bolehMelihat(p, req.pengguna) &&
      (P.bolehMengubah(p, req.pengguna) || P.bolehMemutuskan(p, req.pengguna) || p.pemohon_id === req.pengguna.id);
    if (!boleh) throw galatPublik('Tidak berhak menambah lampiran pada dokumen ini', 403);
    req.berkasDipakai = true;
    for (const f of req.files || []) {
      await db.run(
        `INSERT INTO lampiran (id, pengajuan_id, nama_asli, nama_simpan, mime, ukuran, pengunggah_id, dibuat)
         VALUES (?,?,?,?,?,?,?,?)`,
        [id(), p.id, namaBerkasAman(f.originalname), f.filename, f.mimetype, f.size, req.pengguna.id, sekarang()]);
      await simpanan.pindahkan(f.filename);
    }
    if ((req.files || []).length) {
      await alur.catatJejak(null, {
        pengajuan_id: p.id, pengguna: req.pengguna, aksi: 'lampiran', ip: req.ip,
        detail: req.files.map(f => namaBerkasAman(f.originalname)).join(', '),
      });
      res.kilat('sukses', req.files.length + ' lampiran diunggah.');
    } else {
      res.kilat('galat', 'Tidak ada berkas yang terkirim.');
    }
  } catch (e) {
    if (!e.publik) return next(e);
    res.kilat('galat', e.message);
  }
  res.redirect('/pengajuan/' + req.params.id);
});

r.get('/:id/lampiran/:lid', async (req, res, next) => {
  try {
    const p = await P.ambil(req.params.id);
    if (!p) throw galatPublik('Pengajuan tidak ditemukan', 404);
    if (!P.bolehMelihat(p, req.pengguna)) throw galatPublik('Tidak berhak', 403);
    const l = p.lampiran.find(x => x.id === req.params.lid);
    if (!l) throw galatPublik('Lampiran tidak ditemukan', 404);
    const isi = await simpanan.ambil(l.nama_simpan);
    if (!isi) throw galatPublik('Berkas sudah tidak ada di server', 404);
    // Nama berkas dikirim lewat header, bukan lewat alamat: nama asli boleh
    // memuat spasi dan huruf non-ASCII.
    res.setHeader('content-type', l.mime || 'application/octet-stream');
    res.setHeader('content-disposition',
      'attachment; filename*=UTF-8\'\'' + encodeURIComponent(l.nama_asli));
    res.send(isi);
  } catch (e) { next(e); }
});

r.post('/:id/lampiran/:lid/hapus', async (req, res, next) => {
  try {
    const p = await P.ambil(req.params.id);
    if (!p) throw galatPublik('Pengajuan tidak ditemukan', 404);
    const l = p.lampiran.find(x => x.id === req.params.lid);
    if (!l) throw galatPublik('Lampiran tidak ditemukan', 404);
    const boleh = req.pengguna.peran === 'admin' ||
      (l.pengunggah_id === req.pengguna.id && ['draft', 'revisi'].includes(p.status));
    if (!boleh) throw galatPublik('Lampiran hanya bisa dihapus oleh pengunggahnya saat dokumen masih draft/revisi', 403);
    await db.run('DELETE FROM lampiran WHERE id = ?', [l.id]);
    await simpanan.hapus(l.nama_simpan);
    await alur.catatJejak(null, {
      pengajuan_id: p.id, pengguna: req.pengguna, aksi: 'hapus-lampiran', ip: req.ip, detail: l.nama_asli,
    });
    res.kilat('sukses', 'Lampiran dihapus.');
  } catch (e) {
    if (!e.publik) return next(e);
    res.kilat('galat', e.message);
  }
  res.redirect('/pengajuan/' + req.params.id);
});

// --------------------------------------------------------------- cetak
r.get('/:id/cetak', async (req, res) => {
  const p = await P.ambil(req.params.id);
  if (!p) return res.status(404).render('galat', { judul: 'Tidak ditemukan', pesan: 'Pengajuan tidak ada.' });
  if (!P.bolehMelihat(p, req.pengguna)) {
    return res.status(403).render('galat', { judul: 'Tidak berwenang', pesan: 'Anda tidak berhak melihat dokumen ini.' });
  }
  res.render('cetak', { judul: 'Cetak ' + (p.nomor || ''), p });
});

// --------------------------------------------------------------- pembantu
function pesanTerkirim(hasil) {
  return `Pengajuan terkirim dengan nomor ${hasil.nomor}. Menunggu ${hasil.rantai[0].label}.`;
}

function bersih(v) { return v === undefined || v === null ? '' : String(v).trim(); }

function galatPublik(pesan, kode = 400) {
  return Object.assign(new Error(pesan), { publik: true, kode });
}

// Unduhan berformat Excel, bukan CSV. Bedanya bukan sekadar akhiran berkas:
// kolom Total di sini benar-benar ANGKA, jadi bisa langsung dijumlah dan
// disaring. CSV selalu berakhir jadi teks — pemisah titik-koma, titik ribuan,
// dan tanggal ikut salah tafsir tergantung pengaturan Windows tiap orang.
const KOLOM_UNDUHAN = [
  { judul: 'Nomor', lebar: 26, ambil: b => b.nomor || '(draft)' },
  { judul: 'Tanggal dibuat', lebar: 15, ambil: b => tglSingkat(b.dibuat) },
  { judul: 'Tanggal diajukan', lebar: 15, ambil: b => (b.diajukan ? tglSingkat(b.diajukan) : '') },
  { judul: 'Kategori', lebar: 30, ambil: b => b.kategori_nama },
  { judul: 'Kelompok', lebar: 20, ambil: b => b.kategori_grup },
  { judul: 'Perihal', lebar: 45, ambil: b => b.judul },
  { judul: 'Pemohon', lebar: 26, ambil: b => b.pemohon_nama },
  { judul: 'Unit', lebar: 22, ambil: b => b.cabang_nama || b.departemen_nama || '-' },
  { judul: 'Total (Rp)', lebar: 16, uang: true, ambil: b => keRupiahBulat(b.total) },
  { judul: 'Status', lebar: 18, ambil: b => labelStatus(b.status) },
  { judul: 'Progres', lebar: 30, ambil: b => { const r = P.ringkasProgres(b); return r.teks + ' — ' + r.rinci; } },
];

function kirimExcel(res, baris, keterangan) {
  const isi = xlsxTulis.buat({
    namaLembar: 'Daftar Pengajuan',
    kolom: KOLOM_UNDUHAN.map(k => ({ judul: k.judul, lebar: k.lebar, uang: k.uang })),
    baris: baris.map(b => KOLOM_UNDUHAN.map(k => k.ambil(b))),
  });
  // Nama berkas memuat saringan yang sedang dipakai, supaya unduhan bulan Juli
  // dan bulan Agustus tidak tertukar di folder Unduhan orang.
  const nama = 'EAPEX-Daftar-Pengajuan' + (keterangan ? '-' + keterangan : '') + '.xlsx';
  res.setHeader('Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="' + nama + '"');
  res.send(isi);
}

module.exports = r;
