#!/usr/bin/env node
// ============================================================================
//  GLADI BERSIH CABANG  —  npm run gladi [KODE|SEMUA]
// ============================================================================
// Bukan pengujian benar/salah seperti `npm run cek`. Ini menempuh satu HARI KERJA
// cabang: mengajukan beberapa dokumen yang bentuknya seperti aslinya, menempuh
// seluruh rantai approval, lalu melaporkan HAMBATAN yang akan ditemui orang.
//
// Dijalankan di basis data SEMENTARA. Data asli tidak tersentuh sama sekali.
//
// Seluruh cabang dijalankan dalam SATU proses dan SATU basis data — bukan
// lima belas proses terpisah. Selain jauh lebih cepat, cara ini sekalian
// membuktikan penomoran dokumen tidak tabrakan antar cabang.
const path = require('path');
const os = require('os');

const AKAR = path.join(__dirname, '..');
const tmp = path.join(os.tmpdir(), 'eapex-gladi-' + process.pid);
process.env.SQLITE_PATH = tmp + '.db';
process.env.LAMPIRAN_DIR = tmp + '-lampiran';
process.env.SESSION_SECRET = 'gladi-bersih-0123456789abcdefghij';
process.env.NODE_ENV = 'test';
process.env.BATAS_LOGIN_UJI = '2000';
delete process.env.DATABASE_URL;

const PILIHAN = (process.argv[2] || 'SEMUA').toUpperCase();
const SANDI = 'GladiBersih123';

const rp = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const AMBANG_KECIL = 1000000;

class Orang {
  constructor(dasar, nama, email) { this.dasar = dasar; this.nama = nama; this.email = email; this.kue = new Map(); }
  get header() {
    const c = [...this.kue].map(([k, v]) => k + '=' + v).join('; ');
    return c ? { cookie: c } : {};
  }
  simpan(r) {
    for (const b of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) {
      const [p] = b.split(';'); const i = p.indexOf('=');
      if (i > 0) this.kue.set(p.slice(0, i).trim(), p.slice(i + 1).trim());
    }
  }
  async get(j) {
    const r = await fetch(this.dasar + j, { headers: this.header, redirect: 'manual' });
    this.simpan(r);
    return { status: r.status, teks: r.status === 302 ? '' : await r.text() };
  }
  async csrf(j) {
    const m = /name="_csrf" value="([^"]+)"/.exec((await this.get(j)).teks);
    return m ? m[1] : null;
  }
  async kirim(jalur, medan, berkas, token) {
    const fd = new FormData();
    fd.append('_csrf', token || '');
    for (const [k, v] of medan) fd.append(k, String(v));
    for (const b of (berkas || [])) fd.append('berkas', new Blob([b.isi], { type: b.mime }), b.nama);
    const r = await fetch(this.dasar + jalur, { method: 'POST', redirect: 'manual', headers: this.header, body: fd });
    this.simpan(r);
    return { status: r.status, teks: r.status === 302 ? '' : await r.text() };
  }
  async post(jalur, medan, token) {
    const body = new URLSearchParams();
    body.append('_csrf', token || '');
    for (const [k, v] of medan) body.append(k, String(v));
    const r = await fetch(this.dasar + jalur, {
      method: 'POST', redirect: 'manual',
      headers: { ...this.header, 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    this.simpan(r);
    return { status: r.status, teks: r.status === 302 ? '' : await r.text() };
  }
  async masuk() {
    const t = await this.csrf('/login');
    return this.post('/login', [['email', this.email], ['sandi', SANDI], ['tujuan', '/']], t);
  }
}

const PENAWARAN = [{ nama: 'Penawaran-Vendor.pdf', mime: 'application/pdf', isi: '%PDF-1.4 penawaran' }];

// Dokumen yang bentuknya seperti pengajuan sungguhan dari sebuah store.
const SKENARIO = [
  {
    nama: 'AC ruang kasir rusak', kode: 'CAPEX',
    medan: [
      ['judul', 'Penggantian AC 2 PK area kasir'],
      ['nama_proyek', 'Peremajaan pendingin ruang kasir'],
      ['tujuan[]', 'penggantian'], ['kategori_aset', 'Inventaris'],
      ['deskripsi', 'AC split 2 PK inverter, garansi kompresor 5 tahun'],
      ['lokasi', 'Area kasir lantai 1'], ['vendor', 'PT Sumber Elektronik Jaya'],
      ['jadwal_kebutuhan', '2026-08-15'],
      ['penjelasan', 'AC lama sudah tiga kali diservis dalam enam bulan terakhir.'],
      ['justifikasi', 'Biaya servis berulang sudah melebihi harga unit baru.'],
      ['status_anggaran', 'budgeted'],
      ['item_nama', 'AC 2 PK inverter'], ['item_qty', '2'], ['item_satuan', 'unit'], ['item_harga', '6.500.000'],
      ['pengiriman', '250.000'], ['instalasi', '750.000'],
    ],
  },
  {
    nama: 'Atap gudang bocor', kode: 'MTC-RUTIN',
    medan: [
      ['judul', 'Perbaikan atap gudang belakang bocor'],
      ['lokasi', 'Gudang belakang'], ['jenis_pekerjaan', 'Perbaikan kebocoran atap'],
      ['vendor', 'CV Karya Bangun'], ['tgl_rencana', '2026-08-05'],
      ['penjelasan', 'Bocor di tiga titik, air merembes ke rak penyimpanan.'],
      ['justifikasi', 'Barang dagangan berisiko rusak bila hujan deras berikutnya.'],
      ['item_nama', 'Jasa perbaikan atap + material'], ['item_qty', '1'], ['item_satuan', 'paket'],
      ['item_harga', '2.800.000'],
    ],
  },
  {
    nama: 'Kertas & ATK bulanan', kode: 'PERLENGKAPAN',
    medan: [
      ['judul', 'Perlengkapan kantor Agustus 2026'],
      ['jalur_pengadaan', 'Vendor langsung'],
      ['penjelasan', 'Kebutuhan rutin bulanan kasir dan administrasi.'],
      ['justifikasi', 'Stok bulan lalu habis; dipakai harian untuk nota dan laporan.'],
      ['item_nama', 'Kertas HVS A4'], ['item_qty', '10'], ['item_satuan', 'rim'], ['item_harga', '55.000'],
    ],
  },
  {
    nama: 'Refund uang muka pelanggan', kode: 'REFUND-UM',
    medan: [
      ['judul', 'Refund uang muka pembatalan pesanan'],
      ['nominal', '3.500.000'], ['nama_penerima', 'Budi Santoso'], ['bank', 'BCA'],
      ['no_rekening', '1234567890'], ['no_nota', 'NT-2026-0817'],
      ['alasan', 'Pelanggan membatalkan pesanan karena unit indent terlalu lama.'],
    ],
  },
];

// --------------------------------------------------------------- satu cabang
async function gladiSatuCabang(cab, area, db, dasar, pemakai) {
  const hasil = { cabang: cab, area, dokumen: [], temuan: [], selesai: 0 };
  const temuan = (berat, teks) => hasil.temuan.push({ berat, teks, cabang: cab.kode });

  const sm = await db.get(
    "SELECT * FROM pengguna WHERE cabang_id = ? AND peran = 'store_manager' AND aktif = 1", [cab.id]);
  if (!sm) {
    temuan('BERAT', `${cab.nama}: belum punya akun Store Manager — cabang ini tidak bisa mengajukan apa pun`);
    return hasil;
  }
  if (!cab.area_id) {
    temuan('BERAT', `${cab.nama}: belum terpasang di area mana pun — dokumennya tidak akan menemukan Area Manager`);
  }

  const pemohon = new Orang(dasar, sm.nama, sm.email);
  const rMasuk = await pemohon.masuk();
  if (rMasuk.status !== 302) {
    temuan('BERAT', `${cab.nama}: ${sm.email} tidak bisa masuk`);
    return hasil;
  }
  hasil.pemohon = sm;

  for (const s of SKENARIO) {
    const kategori = await db.get('SELECT * FROM kategori WHERE kode = ? AND aktif = 1', [s.kode]);
    if (!kategori) { temuan('BERAT', `Kategori ${s.kode} tidak ada`); continue; }

    const hal = await pemohon.get('/pengajuan/baru/' + s.kode);
    if (hal.status !== 200) {
      temuan('BERAT', `${cab.nama}: formulir ${kategori.nama} tidak bisa dibuka (status ${hal.status})`);
      continue;
    }
    const jmlWajib = ((/data-wajib="([^"]*)"/.exec(hal.teks) || [])[1] || '').split(',').filter(Boolean).length;
    const aturan = await db.get(
      "SELECT * FROM aturan WHERE kategori_id = ? AND wilayah = 'store' AND aktif = 1 LIMIT 1", [kategori.id]);
    if (!aturan) { temuan('BERAT', `Kategori ${kategori.nama} belum punya aturan untuk Store`); continue; }

    const judul = s.medan.find(m => m[0] === 'judul')[1] + ' — ' + cab.kode;
    const medan = [['kategori_id', kategori.id], ['aturan_id', aturan.id], ['cabang_id', cab.id]]
      .concat(s.medan.map(m => (m[0] === 'judul' ? ['judul', judul] : m)))
      .concat([['aksi', 'ajukan']]);
    const r = await pemohon.kirim('/pengajuan', medan, PENAWARAN,
      await pemohon.csrf('/pengajuan/baru/' + s.kode));

    const dok = await db.get('SELECT * FROM pengajuan WHERE judul = ?', [judul]);
    if (r.status === 400) {
      const kurang = (r.teks.match(/<li>([^<]+)<\/li>/g) || []).map(x => x.replace(/<[^>]+>/g, ''));
      temuan('BERAT', `${cab.nama}: "${s.nama}" ditolak — ${kurang.join('; ')}`);
      continue;
    }
    if (!dok || dok.status !== 'menunggu') {
      temuan('BERAT', `${cab.nama}: "${s.nama}" tidak masuk alur (${dok ? dok.status : 'tidak tersimpan'})`);
      continue;
    }

    const tahap = await db.all('SELECT * FROM persetujuan WHERE pengajuan_id = ? ORDER BY urut', [dok.id]);
    hasil.dokumen.push({ s, dok, tahap, jmlWajib, kategori });
  }

  // --- tempuh rantainya
  for (const d of hasil.dokumen) {
    let macet = null;
    for (const t of d.tahap) {
      const kandidat = await db.all(
        `SELECT u.* FROM persetujuan_kandidat k JOIN pengguna u ON u.id = k.pengguna_id
         WHERE k.persetujuan_id = ? AND u.aktif = 1`, [t.id]);
      if (!kandidat.length) { macet = t; break; }
      const u = kandidat[0];
      if (!pemakai.has(u.email)) {
        const o = new Orang(dasar, u.nama, u.email);
        await o.masuk();
        pemakai.set(u.email, o);
      }
      const o = pemakai.get(u.email);
      const tok = await o.csrf('/pengajuan/' + d.dok.id);
      if (!tok) { macet = t; break; }
      await o.post('/pengajuan/' + d.dok.id + '/putuskan', [['aksi', 'setuju'], ['komentar', 'Setuju.']], tok);
    }
    const akhir = await db.get('SELECT status FROM pengajuan WHERE id = ?', [d.dok.id]);
    d.status = akhir.status;
    if (akhir.status === 'disetujui') hasil.selesai++;
    else {
      temuan('BERAT', `${cab.nama}: "${d.s.nama}" berhenti di ${macet ? macet.label : '?'}`);
    }

    if (d.tahap.some(t => t.peran === 'ceo') && Number(d.dok.total) < AMBANG_KECIL) {
      temuan('PERIKSA', `"${d.s.nama}" hanya ${rp(d.dok.total)} tapi tetap butuh tanda tangan CEO `
        + `(${d.tahap.length} tahap) — periksa apakah ambang ${d.kategori.nama} memang sekecil itu`);
    }
  }
  return hasil;
}

// --------------------------------------------------------------- jalan
(async () => {
  const db = require(path.join(AKAR, 'lib/db'));
  const { siapkan } = require(path.join(AKAR, 'lib/skema'));
  const bcrypt = require(path.join(AKAR, 'node_modules/bcryptjs'));
  await siapkan({ senyap: true });
  await db.run('UPDATE pengguna SET sandi_hash = ?, wajib_ganti_sandi = 0', [bcrypt.hashSync(SANDI, 10)]);

  const app = require(path.join(AKAR, 'app'));
  const srv = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const dasar = 'http://127.0.0.1:' + srv.address().port;

  const semuaCabang = await db.all(
    "SELECT * FROM cabang WHERE aktif = 1 AND tipe = 'store' ORDER BY nama");
  const daftar = PILIHAN === 'SEMUA' ? semuaCabang : semuaCabang.filter(c => c.kode === PILIHAN);
  if (!daftar.length) {
    console.error('Cabang "' + PILIHAN + '" tidak ada. Kode yang ada: '
      + semuaCabang.map(c => c.kode).join(', '));
    process.exit(1);
  }

  console.log('\n\x1b[1m========================================');
  console.log(' GLADI BERSIH — ' + daftar.length + ' cabang');
  console.log('========================================\x1b[0m\n');
  console.log('  ' + 'Cabang'.padEnd(20) + 'Area'.padEnd(20) + 'Dokumen  Tahap  Store Manager');
  console.log('  ' + '-'.repeat(86));

  const semuaTemuan = [];
  const pemakai = new Map();
  let totalDok = 0, totalSelesai = 0;

  try {
    for (const cab of daftar) {
      const area = cab.area_id ? await db.get('SELECT * FROM area WHERE id = ?', [cab.area_id]) : null;
      const h = await gladiSatuCabang(cab, area, db, dasar, pemakai);
      semuaTemuan.push(...h.temuan);
      totalDok += h.dokumen.length;
      totalSelesai += h.selesai;

      const tahapTotal = h.dokumen.reduce((n, d) => n + d.tahap.length, 0);
      const lambang = (h.selesai === SKENARIO.length) ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
      console.log('  ' + lambang + ' ' + cab.nama.padEnd(18)
        + String(area ? area.nama : '(tanpa area)').padEnd(20)
        + (h.selesai + '/' + SKENARIO.length).padEnd(9)
        + String(tahapTotal).padEnd(7)
        + (h.pemohon ? h.pemohon.email : '\x1b[31mtidak ada\x1b[0m'));
    }

    // ------------------------------------------------- pemeriksaan menyeluruh
    console.log('\n  \x1b[1mPemeriksaan menyeluruh\x1b[0m');

    const peranDipakai = await db.all(
      `SELECT DISTINCT al.peran FROM aturan_langkah al
       JOIN aturan a ON a.id = al.aturan_id WHERE a.wilayah = 'store'`);
    for (const p of peranDipakai) {
      const n = Number(await db.nilai(
        'SELECT COUNT(*) AS n FROM pengguna WHERE peran = ? AND aktif = 1', [p.peran]));
      if (!n) semuaTemuan.push({ berat: 'BERAT', teks: `Peran "${p.peran}" dipakai rantai store tapi belum ada pengguna aktifnya` });
    }

    const areaSemua = await db.all('SELECT * FROM area WHERE aktif = 1');
    for (const a of areaSemua) {
      const n = Number(await db.nilai(
        "SELECT COUNT(*) AS n FROM pengguna WHERE peran = 'area_manager' AND area_id = ? AND aktif = 1", [a.id]));
      const jmlCab = Number(await db.nilai('SELECT COUNT(*) AS n FROM cabang WHERE area_id = ? AND aktif = 1', [a.id]));
      if (!n && jmlCab) {
        semuaTemuan.push({ berat: 'BERAT', teks: `${a.nama} punya ${jmlCab} cabang tapi belum ada Area Managernya` });
      }
    }

    // penomoran dokumen tidak boleh tabrakan antar cabang
    const kembar = await db.all(
      'SELECT nomor FROM pengajuan WHERE nomor IS NOT NULL GROUP BY nomor HAVING COUNT(*) > 1');
    if (kembar.length) semuaTemuan.push({ berat: 'BERAT', teks: `${kembar.length} nomor dokumen kembar antar cabang` });
    else console.log('  · penomoran dokumen: ' + totalDok + ' dokumen, tidak ada nomor kembar');

    const tanpaEmail = Number(await db.nilai(
      "SELECT COUNT(*) AS n FROM pengguna WHERE aktif = 1 AND (email_notifikasi IS NULL OR email_notifikasi = '')"));
    const totalAktif = Number(await db.nilai('SELECT COUNT(*) AS n FROM pengguna WHERE aktif = 1'));
    console.log('  · email notifikasi terisi: ' + (totalAktif - tanpaEmail) + '/' + totalAktif);
    if (tanpaEmail) {
      semuaTemuan.push({ berat: 'SEDANG', teks: `${tanpaEmail} dari ${totalAktif} akun belum punya email notifikasi — mereka hanya tahu ada approval kalau membuka aplikasi` });
    }

    const email = require(path.join(AKAR, 'lib/email'));
    const ai = require(path.join(AKAR, 'lib/ai-penawaran'));
    if (!email.aktif()) semuaTemuan.push({ berat: 'SEDANG', teks: 'Pengiriman email belum menyala (SMTP kosong) — pengingat harian tidak sampai ke luar aplikasi' });
    if (!process.env.VAPID_PUBLIC_KEY) semuaTemuan.push({ berat: 'SEDANG', teks: 'Notifikasi HP belum menyala di lingkungan ini' });
    if (!ai.aktif()) semuaTemuan.push({ berat: 'SEDANG', teks: 'Tombol "Baca penawaran" mati (OPENAI_API_KEY kosong) — semua isian diketik manual' });

    const cuti = require(path.join(AKAR, 'lib/cuti'));
    const sendat = await cuti.dokumenTersendat();
    if (sendat.length) semuaTemuan.push({ berat: 'BERAT', teks: `${sendat.length} dokumen tertahan tanpa penyetuju tersedia` });
  } catch (e) {
    console.error(e);
    semuaTemuan.push({ berat: 'BERAT', teks: 'Gladi berhenti: ' + e.message });
  } finally {
    srv.close();
    await require(path.join(AKAR, 'lib/db')).tutup();
    try { require('fs').rmSync(process.env.LAMPIRAN_DIR, { recursive: true, force: true }); } catch (e) { /* biarkan */ }
    try { require('fs').unlinkSync(process.env.SQLITE_PATH); } catch (e) { /* biarkan */ }
  }

  // ------------------------------------------------------------------ laporan
  console.log('\n\x1b[1m========================================');
  console.log(' HASIL: ' + totalSelesai + '/' + totalDok + ' dokumen tembus sampai disetujui');
  console.log('========================================\x1b[0m');

  const urut = { BERAT: 0, PERIKSA: 1, SEDANG: 2 };
  const label = {
    BERAT: '\x1b[31m● HARUS DIBERESKAN\x1b[0m',
    PERIKSA: '\x1b[35m● PERIKSA ATURAN\x1b[0m  ',
    SEDANG: '\x1b[33m● SEBAIKNYA\x1b[0m       ',
  };
  // Temuan yang sama persis dari banyak cabang dirangkum jadi satu baris —
  // lima belas baris identik hanya menenggelamkan yang penting.
  const rangkum = new Map();
  for (const t of semuaTemuan) {
    const kunci = t.berat + '|' + t.teks.replace(/^[^:]+: /, '');
    if (!rangkum.has(kunci)) rangkum.set(kunci, { ...t, jml: 0, cabang: [] });
    const r = rangkum.get(kunci);
    r.jml++;
    if (t.cabang) r.cabang.push(t.cabang);
  }
  const daftarTemuan = [...rangkum.values()].sort((a, b) => urut[a.berat] - urut[b.berat]);

  if (!daftarTemuan.length) console.log('\n  Tidak ada hambatan.\n');
  for (const t of daftarTemuan) {
    const ulang = t.jml > 1 ? `  \x1b[2m(${t.jml} cabang)\x1b[0m` : '';
    console.log('  ' + label[t.berat] + ' ' + t.teks.replace(/^[^:]+: /, '') + ulang);
  }
  console.log('');
  process.exit(daftarTemuan.some(t => t.berat === 'BERAT') ? 1 : 0);
})().catch(e => { console.error('GAGAL', e); process.exit(1); });
