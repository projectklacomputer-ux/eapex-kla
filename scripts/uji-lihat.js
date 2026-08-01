#!/usr/bin/env node
// ============================================================================
//  Uji OTORISASI TAMPILAN — siapa boleh melihat dokumen siapa
// ============================================================================
//  Aturannya:
//    admin, accounting, ceo      seluruh perusahaan
//    regional_manager            seluruh dokumen SISI STORE, bukan Kantor Pusat
//    brand_manager               sama dengan regional_manager
//    area_manager                dokumen cabang di areanya
//    selain itu                  HANYA dokumennya sendiri (+ yang ia setujui)
//
//  Yang diuji bukan cuma daftar dokumen. Dasbor pernah membocorkan total
//  belanja SE-PERUSAHAAN ke semua orang - bocor yang jauh lebih halus, karena
//  tidak ada satu pun nama yang tampak, hanya nominal.
//
//  Jalankan:  npm run uji-lihat
// ============================================================================

const os = require('os');
const path = require('path');
const fs = require('fs');

const DB = path.join(os.tmpdir(), 'eapex-uji-lihat-' + process.pid + '.db');
process.env.SQLITE_PATH = DB;
process.env.SESSION_SECRET = 'uji-lihat-' + 'w'.repeat(32);
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;

const db = require('../lib/db');
const { siapkan } = require('../lib/skema');
const P = require('../lib/pengajuan');
const alur = require('../lib/alur');
const { id } = require('../lib/auth');

let lulus = 0, gagal = 0;
function cek(nama, ok, ket) {
  if (ok) { lulus++; console.log(`  \x1b[32m✓\x1b[0m ${nama}${ket ? '  — ' + ket : ''}`); }
  else { gagal++; console.log(`  \x1b[31m✗ ${nama}${ket ? '  — ' + ket : ''}\x1b[0m`); }
}

async function buatDokumen(pemohon, kodeKategori, judul) {
  const kat = await db.get('SELECT * FROM kategori WHERE kode = ?', [kodeKategori]);
  const wilayah = pemohon.cabang_kode === 'HO' ? 'back_office' : 'store';
  const aturan = await db.get(
    'SELECT * FROM aturan WHERE kategori_id = ? AND wilayah = ? AND aktif = 1 LIMIT 1', [kat.id, wilayah]);
  if (!aturan) return null;
  const pid = id();
  const waktu = new Date().toISOString();
  const data = { nama_proyek: judul, tujuan: ['efisiensi'], kategori_aset: 'Inventaris',
    deskripsi: judul, lokasi: 'Uji', vendor: 'Uji', jadwal_kebutuhan: 'Bulan depan',
    jalur_pengadaan: 'Pembelian langsung', periode: 'Bulan ini',
    penjelasan: 'Uji', justifikasi: 'Uji' };
  await db.run(
    `INSERT INTO pengajuan (id, nomor, kategori_id, aturan_id, wilayah, pemohon_id, cabang_id,
       departemen_id, judul, keterangan, status_anggaran, total, status, langkah_kini, data_json, dibuat, diperbarui)
     VALUES (?,NULL,?,?,?,?,?,?,?,NULL,NULL,?, 'draft', 0, ?, ?, ?)`,
    [pid, kat.id, aturan.id, wilayah, pemohon.id, pemohon.cabang_id, pemohon.departemen_id,
      judul, 5000000, JSON.stringify(data), waktu, waktu]);
  await db.run(
    `INSERT INTO pengajuan_item (id, pengajuan_id, urut, nama, qty, satuan, harga, nominal, keterangan)
     VALUES (?,?,1,'Barang',1,'unit',5000000,5000000,NULL)`, [id(), pid]);
  await db.run(
    `INSERT INTO lampiran (id, pengajuan_id, nama_asli, nama_simpan, mime, ukuran, pengunggah_id, dibuat)
     VALUES (?,?, 'uji.pdf','uji.pdf','application/pdf',1024,?,?)`, [id(), pid, pemohon.id, waktu]);
  await alur.ajukan(pid, pemohon, '127.0.0.1');
  return pid;
}

const KOLOM = `u.*, c.kode AS cabang_kode, c.area_id AS cabang_area_id`;
const orang = async email => db.get(
  `SELECT ${KOLOM} FROM pengguna u LEFT JOIN cabang c ON c.id = u.cabang_id WHERE u.email = ?`, [email]);

(async () => {
  await siapkan({ senyap: true });

  const smSmg = await orang('sm.smg@kla.co.id');       // Area Barat
  const smSby = await orang('sm.sbym@kla.co.id');      // Area Timur
  const stafBo = await orang('staf.acc@kla.co.id');    // Kantor Pusat
  const rm = await orang('regional@kla.co.id');
  const amBarat = await orang('am.barat@kla.co.id');
  const acc = await orang('accounting@kla.co.id');
  const ceo = await orang('ceo@kla.co.id');

  const dokSmg = await buatDokumen(smSmg, 'CAPEX', 'CAPEX Semarang');
  const dokSby = await buatDokumen(smSby, 'CAPEX', 'CAPEX Surabaya Merr');
  const dokBo = await buatDokumen(stafBo, 'CAPEX', 'CAPEX Kantor Pusat');

  const judulTerlihat = async (pengguna) => {
    const h = await P.daftar({ pengguna, batas: 200 });
    return (h.baris || h.daftar || h).map ? (h.baris || h.daftar || h).map(x => x.judul) : [];
  };

  console.log('\n\x1b[1mSTORE MANAGER — hanya dokumennya sendiri\x1b[0m\n');
  const lihatSmg = await judulTerlihat(smSmg);
  cek('melihat dokumennya sendiri', lihatSmg.includes('CAPEX Semarang'));
  cek('TIDAK melihat dokumen cabang lain', !lihatSmg.includes('CAPEX Surabaya Merr'));
  cek('TIDAK melihat dokumen Kantor Pusat', !lihatSmg.includes('CAPEX Kantor Pusat'));

  console.log('\n\x1b[1mAREA MANAGER — cabang di areanya\x1b[0m\n');
  const lihatAm = await judulTerlihat(amBarat);
  cek('melihat cabang di areanya (Semarang)', lihatAm.includes('CAPEX Semarang'));
  cek('TIDAK melihat cabang area lain (Surabaya)', !lihatAm.includes('CAPEX Surabaya Merr'));

  console.log('\n\x1b[1mREGIONAL MANAGER — seluruh store, BUKAN Kantor Pusat\x1b[0m\n');
  const lihatRm = await judulTerlihat(rm);
  cek('melihat store Area Barat', lihatRm.includes('CAPEX Semarang'));
  cek('melihat store Area Timur', lihatRm.includes('CAPEX Surabaya Merr'));
  cek('TIDAK melihat dokumen Kantor Pusat', !lihatRm.includes('CAPEX Kantor Pusat'),
    'sebelumnya melihat SEMUANYA');

  console.log('\n\x1b[1mBRAND MANAGER — sama dengan Regional Manager\x1b[0m\n');
  const bm = { ...rm, peran: 'brand_manager', id: rm.id };
  const lihatBm = await judulTerlihat(bm);
  cek('melihat seluruh sisi store', lihatBm.includes('CAPEX Semarang') && lihatBm.includes('CAPEX Surabaya Merr'));
  cek('TIDAK melihat Kantor Pusat', !lihatBm.includes('CAPEX Kantor Pusat'));

  console.log('\n\x1b[1mACCOUNTING & CEO — seluruh perusahaan\x1b[0m\n');
  for (const [nama, u] of [['Accounting', acc], ['CEO', ceo]]) {
    const l = await judulTerlihat(u);
    cek(`${nama} melihat store dan Kantor Pusat`,
      l.includes('CAPEX Semarang') && l.includes('CAPEX Surabaya Merr') && l.includes('CAPEX Kantor Pusat'));
  }

  console.log('\n\x1b[1mDOKUMEN SATUAN — bolehMelihat()\x1b[0m\n');
  const ambilDok = async pid => P.ambil(pid);
  const dSby = await ambilDok(dokSby);
  const dBo = await ambilDok(dokBo);
  cek('SM Semarang ditolak membuka dokumen Surabaya', !P.bolehMelihat(dSby, smSmg));
  cek('Regional Manager boleh membuka dokumen store mana pun', P.bolehMelihat(dSby, rm));
  cek('Regional Manager ditolak membuka dokumen Kantor Pusat', !P.bolehMelihat(dBo, rm));
  cek('CEO boleh membuka semuanya', P.bolehMelihat(dBo, ceo) && P.bolehMelihat(dSby, ceo));

  console.log('\n\x1b[1mDASBOR — angka ikut dibatasi\x1b[0m\n');
  const rSm = await P.ringkasan(smSmg);
  const rCeo = await P.ringkasan(ceo);
  cek('Store Manager tidak melihat nilai berjalan se-perusahaan',
    rSm.nilaiSedangBerjalan < rCeo.nilaiSedangBerjalan,
    `SM=${rSm.nilaiSedangBerjalan} CEO=${rCeo.nilaiSedangBerjalan}`);

  const kSm = await P.rekapKategori(smSmg);
  const kCeo = await P.rekapKategori(ceo);
  const jml = a => a.reduce((n, x) => n + Number(x.n || 0), 0);
  cek('rekap kategori Store Manager lebih sempit dari CEO',
    jml(kSm) < jml(kCeo), `SM=${jml(kSm)} dokumen, CEO=${jml(kCeo)} dokumen`);

  console.log(`\n\x1b[1m  ${lulus} lulus, ${gagal} gagal\x1b[0m\n`);
  await db.tutup();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB + s); } catch (_) { /* mungkin tidak ada */ } }
  process.exit(gagal ? 1 : 0);
})().catch(async e => {
  console.error('\n  Gagal:', e.message, '\n', e.stack, '\n');
  try { await db.tutup(); } catch (_) { /* abaikan */ }
  process.exit(1);
});
