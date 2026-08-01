// ============================================================================
//  Struktur basis data + data awal (master + matriks approval)
// ============================================================================
// Dijalankan otomatis saat server menyala. Aman dijalankan berulang kali
// (semua CREATE memakai IF NOT EXISTS, penanaman data awal hanya bila tabel kosong).
//
// SQL di sini sengaja memakai irisan tipe yang dipahami SQLite maupun PostgreSQL:
//   TEXT      -> teks, tanggal ISO 8601, dan JSON
//   BIGINT    -> uang (rupiah bulat) & bilangan
//   INTEGER   -> benar/salah (0/1) dan urutan
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { id, sekarang } = require('./util');

const DDL = `
CREATE TABLE IF NOT EXISTS pengaturan (
  kunci TEXT PRIMARY KEY,
  nilai TEXT
);

CREATE TABLE IF NOT EXISTS nomor_urut (
  kunci TEXT PRIMARY KEY,
  nilai BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS area (
  id TEXT PRIMARY KEY,
  kode TEXT NOT NULL,
  nama TEXT NOT NULL,
  urutan INTEGER NOT NULL DEFAULT 0,
  aktif INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS cabang (
  id TEXT PRIMARY KEY,
  kode TEXT NOT NULL,
  nama TEXT NOT NULL,
  tipe TEXT NOT NULL DEFAULT 'store',
  area_id TEXT,
  alamat TEXT,
  aktif INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS departemen (
  id TEXT PRIMARY KEY,
  kode TEXT NOT NULL,
  nama TEXT NOT NULL,
  aktif INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pengguna (
  id TEXT PRIMARY KEY,
  nama TEXT NOT NULL,
  email TEXT NOT NULL,
  sandi_hash TEXT NOT NULL,
  peran TEXT NOT NULL,
  jabatan TEXT,
  cabang_id TEXT,
  area_id TEXT,
  departemen_id TEXT,
  aktif INTEGER NOT NULL DEFAULT 1,
  wajib_ganti_sandi INTEGER NOT NULL DEFAULT 0,
  dibuat TEXT NOT NULL,
  login_terakhir TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pengguna_email ON pengguna (email);
CREATE INDEX IF NOT EXISTS ix_pengguna_peran ON pengguna (peran, aktif);

CREATE TABLE IF NOT EXISTS kategori (
  id TEXT PRIMARY KEY,
  kode TEXT NOT NULL,
  kode_dok TEXT NOT NULL,
  nama TEXT NOT NULL,
  grup TEXT NOT NULL,
  jenis TEXT NOT NULL,
  bentuk TEXT NOT NULL,
  urutan INTEGER NOT NULL DEFAULT 0,
  aktif INTEGER NOT NULL DEFAULT 1,
  keterangan TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_kategori_kode ON kategori (kode);

CREATE TABLE IF NOT EXISTS aturan (
  id TEXT PRIMARY KEY,
  kategori_id TEXT NOT NULL,
  wilayah TEXT NOT NULL,
  peran_pemohon TEXT NOT NULL,
  ambang_ceo BIGINT,
  catatan TEXT,
  aktif INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_aturan_kategori ON aturan (kategori_id, wilayah);

CREATE TABLE IF NOT EXISTS aturan_langkah (
  id TEXT PRIMARY KEY,
  aturan_id TEXT NOT NULL,
  urut INTEGER NOT NULL,
  peran TEXT NOT NULL,
  label TEXT,
  min_nominal BIGINT,
  maks_nominal BIGINT,
  lingkup TEXT NOT NULL DEFAULT 'auto'
);
CREATE INDEX IF NOT EXISTS ix_langkah_aturan ON aturan_langkah (aturan_id, urut);

CREATE TABLE IF NOT EXISTS pengajuan (
  id TEXT PRIMARY KEY,
  nomor TEXT,
  kategori_id TEXT NOT NULL,
  aturan_id TEXT NOT NULL,
  wilayah TEXT NOT NULL,
  pemohon_id TEXT NOT NULL,
  cabang_id TEXT,
  departemen_id TEXT,
  judul TEXT NOT NULL,
  keterangan TEXT,
  status_anggaran TEXT,
  total BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  langkah_kini INTEGER NOT NULL DEFAULT 0,
  data_json TEXT,
  dibuat TEXT NOT NULL,
  diperbarui TEXT,
  diajukan TEXT,
  ditutup TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pengajuan_nomor ON pengajuan (nomor);
CREATE INDEX IF NOT EXISTS ix_pengajuan_status ON pengajuan (status);
CREATE INDEX IF NOT EXISTS ix_pengajuan_pemohon ON pengajuan (pemohon_id, status);
CREATE INDEX IF NOT EXISTS ix_pengajuan_cabang ON pengajuan (cabang_id);
CREATE INDEX IF NOT EXISTS ix_pengajuan_dibuat ON pengajuan (dibuat);

CREATE TABLE IF NOT EXISTS pengajuan_item (
  id TEXT PRIMARY KEY,
  pengajuan_id TEXT NOT NULL,
  urut INTEGER NOT NULL DEFAULT 0,
  nama TEXT NOT NULL,
  qty BIGINT NOT NULL DEFAULT 1,
  satuan TEXT,
  harga BIGINT NOT NULL DEFAULT 0,
  nominal BIGINT NOT NULL DEFAULT 0,
  keterangan TEXT
);
CREATE INDEX IF NOT EXISTS ix_item_pengajuan ON pengajuan_item (pengajuan_id, urut);

CREATE TABLE IF NOT EXISTS persetujuan (
  id TEXT PRIMARY KEY,
  pengajuan_id TEXT NOT NULL,
  urut INTEGER NOT NULL,
  peran TEXT NOT NULL,
  label TEXT,
  lingkup TEXT,
  min_nominal BIGINT,
  maks_nominal BIGINT,
  status TEXT NOT NULL DEFAULT 'menunggu',
  aktor_id TEXT,
  aktor_nama TEXT,
  aktor_jabatan TEXT,
  komentar TEXT,
  waktu TEXT
);
CREATE INDEX IF NOT EXISTS ix_persetujuan_pengajuan ON persetujuan (pengajuan_id, urut);
CREATE INDEX IF NOT EXISTS ix_persetujuan_status ON persetujuan (status);

CREATE TABLE IF NOT EXISTS persetujuan_kandidat (
  id TEXT PRIMARY KEY,
  persetujuan_id TEXT NOT NULL,
  pengajuan_id TEXT NOT NULL,
  pengguna_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_kandidat_pengguna ON persetujuan_kandidat (pengguna_id);
CREATE INDEX IF NOT EXISTS ix_kandidat_persetujuan ON persetujuan_kandidat (persetujuan_id);

CREATE TABLE IF NOT EXISTS lampiran (
  id TEXT PRIMARY KEY,
  pengajuan_id TEXT NOT NULL,
  nama_asli TEXT NOT NULL,
  nama_simpan TEXT NOT NULL,
  mime TEXT,
  ukuran BIGINT,
  pengunggah_id TEXT,
  dibuat TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_lampiran_pengajuan ON lampiran (pengajuan_id);

CREATE TABLE IF NOT EXISTS jejak (
  id TEXT PRIMARY KEY,
  pengajuan_id TEXT,
  pengguna_id TEXT,
  nama TEXT,
  aksi TEXT NOT NULL,
  detail TEXT,
  ip TEXT,
  waktu TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_jejak_pengajuan ON jejak (pengajuan_id, waktu);

CREATE TABLE IF NOT EXISTS notifikasi (
  id TEXT PRIMARY KEY,
  pengguna_id TEXT NOT NULL,
  pengajuan_id TEXT,
  judul TEXT NOT NULL,
  pesan TEXT,
  dibaca INTEGER NOT NULL DEFAULT 0,
  dibuat TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_notifikasi_pengguna ON notifikasi (pengguna_id, dibaca);

CREATE TABLE IF NOT EXISTS langganan_push (
  id TEXT PRIMARY KEY,
  pengguna_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  peramban TEXT,
  dibuat TEXT NOT NULL,
  terakhir_dipakai TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_langganan_endpoint ON langganan_push (endpoint);
CREATE INDEX IF NOT EXISTS ix_langganan_pengguna ON langganan_push (pengguna_id);

CREATE TABLE IF NOT EXISTS sesi (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expire BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sesi_expire ON sesi (expire);
`;

// ---------------------------------------------------------------------------
//  Matriks approval — sumber: "List Of Approval KLA.xlsx" (PT KLA Teknologi Indonesia)
// ---------------------------------------------------------------------------
// Cara baca `langkah`: [peran, minNominal]
//   minNominal null  -> langkah SELALU wajib
//   minNominal angka -> langkah hanya wajib bila total pengajuan >= angka tersebut
//
// Catatan penafsiran (didokumentasikan supaya tidak jadi tafsir diam-diam):
// pada matriks asli tertulis "< 1 juta --> Manager" dan "> 1 juta --> CEO", sehingga
// nominal TEPAT 1 juta tidak masuk keduanya. Di sini dipakai aturan konservatif
// "CEO wajib bila total >= ambang". Ambang bisa diubah lewat menu Admin > Kategori.
// Brand Manager sudah TIDAK dipakai pada rantai approval mana pun (keputusan user
// 31 Jul 2026, sejalan dengan catatan pada matriks aslinya: "Brand Manager hanya
// bersifat sementara, ketika sudah ada regional manager --> Regional mengambil alih
// peran brand manager"). Semua tahap yang dulu Brand Manager kini Regional Manager.
// Perannya sendiri masih ada di konstanta, semata supaya dokumen lama yang rantainya
// terlanjur dibekukan tetap terbaca labelnya.
const A = 'accounting', C = 'ceo', AM = 'area_manager', RM = 'regional_manager';

const KATEGORI_AWAL = [
  {
    kode: 'CAPEX', kode_dok: 'CEA', nama: 'CAPEX / Inventaris / Aset',
    grup: 'CAPEX', jenis: 'capex', bentuk: 'capex',
    keterangan: 'Semua nominal melewati verifikasi Accounting lalu persetujuan CEO.',
    aturan: [
      { wilayah: 'store', pemohon: 'store_manager', langkah: [[AM, null], [RM, null], [A, null], [C, null]] },
      { wilayah: 'back_office', pemohon: 'staf', langkah: [['leader_manager', null], [A, null], [C, null]] },
    ],
  },
  {
    kode: 'MKT-ENDORSE', kode_dok: 'MKT', nama: 'Biaya Marketing — Endorse',
    grup: 'Biaya Marketing', jenis: 'biaya', bentuk: 'biaya',
    aturan: [{ wilayah: 'back_office', pemohon: 'marketing_staf,staf', langkah: [['marketing_coordinator', null], [A, null], [C, null]] }],
  },
  {
    kode: 'MKT-ADS', kode_dok: 'MKT', nama: 'Biaya Marketing — Ads',
    grup: 'Biaya Marketing', jenis: 'biaya', bentuk: 'biaya',
    aturan: [{ wilayah: 'back_office', pemohon: 'marketing_staf,staf', langkah: [['marketing_coordinator', null], [A, null], [C, null]] }],
  },
  {
    kode: 'MKT-LAIN', kode_dok: 'MKT', nama: 'Biaya Marketing — Lainnya',
    grup: 'Biaya Marketing', jenis: 'biaya', bentuk: 'biaya',
    aturan: [{ wilayah: 'back_office', pemohon: 'marketing_staf,staf', langkah: [['marketing_coordinator', null], [A, null], [C, null]] }],
  },
  {
    kode: 'UMUM-LOKER', kode_dok: 'EXP', nama: 'Biaya Iklan Lowongan Kerja',
    grup: 'Biaya Umum', jenis: 'biaya', bentuk: 'biaya',
    keterangan: 'Nominal berapa pun tetap melalui Accounting untuk verifikasi.',
    aturan: [{ wilayah: 'back_office', pemohon: 'hc_staf', ambang: 1000000, langkah: [['hc_manager', null], [A, null], [C, 1000000]] }],
  },
  {
    kode: 'UMUM-PARKIR', kode_dok: 'EXP', nama: 'Biaya Langganan Parkir',
    grup: 'Biaya Umum', jenis: 'biaya', bentuk: 'biaya',
    keterangan: 'Nominal berapa pun tetap melalui Accounting untuk verifikasi.',
    aturan: [{ wilayah: 'back_office', pemohon: 'hc_staf', ambang: 2000000, langkah: [['hc_manager', null], [A, null], [C, 2000000]] }],
  },
  {
    kode: 'UMUM-LAIN', kode_dok: 'EXP', nama: 'Biaya Umum — Lainnya',
    grup: 'Biaya Umum', jenis: 'biaya', bentuk: 'biaya',
    aturan: [{ wilayah: 'back_office', pemohon: 'hc_staf', ambang: 1000000, langkah: [['hc_manager', null], [A, null], [C, 1000000]] }],
  },
  {
    kode: 'PERLENGKAPAN', kode_dok: 'INV', nama: 'Biaya Perlengkapan Kantor / Inventaris',
    grup: 'Biaya Umum', jenis: 'biaya', bentuk: 'barang',
    aturan: [
      { wilayah: 'store', pemohon: 'store_manager', ambang: 500000, langkah: [[AM, null], [RM, null], [A, null], [C, 500000]] },
      { wilayah: 'back_office', pemohon: 'staf,hc_staf', ambang: 500000, langkah: [['leader_manager', null], [A, null], [C, 500000]] },
    ],
  },
  {
    kode: 'DINAS', kode_dok: 'SPD', nama: 'Biaya Perjalanan Dinas',
    grup: 'Biaya Perjalanan Dinas', jenis: 'biaya', bentuk: 'perjalanan',
    aturan: [
      { wilayah: 'store', pemohon: 'store_manager', ambang: 2000000, langkah: [[AM, null], [RM, null], [A, null], [C, 2000000]] },
      // Diajukan Area Manager sendiri: tidak ada tahap Area Manager (dia pemohonnya)
      // dan tidak lewat Brand Manager — langsung ke Regional Manager.
      {
        wilayah: 'store', pemohon: 'area_manager', ambang: 2000000,
        catatan: 'Diajukan Area Manager sendiri',
        langkah: [[RM, null], [A, null], [C, 2000000]],
      },
      { wilayah: 'back_office', pemohon: 'staf,hc_staf,marketing_staf', ambang: 2000000, langkah: [['leader_manager', null], [A, null], [C, 2000000]] },
    ],
  },
  {
    kode: 'MTC-RUTIN', kode_dok: 'MTC', nama: 'Maintenance Bangunan — Rutin',
    grup: 'Biaya Maintenance', jenis: 'biaya', bentuk: 'maintenance',
    keterangan: 'Contoh: bocor, penggantian engsel pintu, penggantian gembok, dan sejenisnya.',
    aturan: [
      { wilayah: 'store', pemohon: 'store_manager', ambang: 4000000, langkah: [[AM, null], [RM, null], [A, null], [C, 4000000]] },
      { wilayah: 'back_office', pemohon: 'hc_staf', ambang: 4000000, langkah: [['hc_manager', null], [A, null], [C, 4000000]] },
    ],
  },
  {
    kode: 'MTC-NONRUTIN', kode_dok: 'MTC', nama: 'Maintenance Bangunan — Non Rutin',
    grup: 'Biaya Maintenance', jenis: 'biaya', bentuk: 'maintenance',
    keterangan: 'Contoh: cat ulang, paving ulang, tambah daya, penggantian pintu, perbaikan lantai.',
    aturan: [
      { wilayah: 'store', pemohon: 'store_manager', langkah: [[AM, null], [RM, null], [A, null], [C, null]] },
      { wilayah: 'back_office', pemohon: 'hc_staf', langkah: [['hc_manager', null], [A, null], [C, null]] },
    ],
  },
  {
    kode: 'REFUND-UM', kode_dok: 'RFD', nama: 'Refund Dana — Uang Muka Penjualan',
    grup: 'Refund Dana', jenis: 'biaya', bentuk: 'refund',
    aturan: [{ wilayah: 'store', pemohon: 'store_manager', langkah: [[AM, null], [A, null]] }],
  },
  {
    kode: 'REFUND-TRF', kode_dok: 'RFD', nama: 'Refund Dana — Salah Transfer',
    grup: 'Refund Dana', jenis: 'biaya', bentuk: 'refund',
    aturan: [{ wilayah: 'store', pemohon: 'store_manager', langkah: [[AM, null], [A, null]] }],
  },
  {
    kode: 'REFUND-LAIN', kode_dok: 'RFD', nama: 'Refund Dana — Alasan Lain',
    grup: 'Refund Dana', jenis: 'biaya', bentuk: 'refund',
    aturan: [{ wilayah: 'store', pemohon: 'store_manager', langkah: [[AM, null], [A, null]] }],
  },
  {
    kode: 'PINDAH-AREA', kode_dok: 'MOV', nama: 'Biaya Perpindahan Area Sales / Store Manager',
    grup: 'Biaya Lain', jenis: 'biaya', bentuk: 'pindah_area',
    keterangan: 'Diajukan Area Manager asal; persetujuan pertama oleh Area Manager tujuan.',
    aturan: [{
      wilayah: 'store', pemohon: 'area_manager',
      langkah: [[AM, null, 'area_tujuan', 'Area Manager Tujuan'], [RM, null], [A, null], [C, null]],
    }],
  },
  {
    kode: 'NONRUTIN', kode_dok: 'EXP', nama: 'Biaya Non Rutin (Training, Seminar, MCU)',
    grup: 'Biaya Lain', jenis: 'biaya', bentuk: 'biaya',
    aturan: [
      { wilayah: 'store', pemohon: 'hc_staf', langkah: [['hc_manager', null], [A, null], [C, null]] },
      { wilayah: 'back_office', pemohon: 'hc_staf', langkah: [['hc_manager', null], [A, null], [C, null]] },
    ],
  },
];

// ---------------------------------------------------------------------------
//  Master contoh — WAJIB disesuaikan lewat menu Admin sebelum dipakai sungguhan
// ---------------------------------------------------------------------------
// DUA area, bukan menurut provinsi (dikonfirmasi user 31 Jul 2026). Pembagiannya
// bukan geografi murni — Yogyakarta masuk Timur meski satu provinsi dengan
// Semarang yang masuk Barat. Jangan "dibetulkan" berdasarkan letak kota.
const AREA_AWAL = [
  { kode: 'BRT', nama: 'Area Barat' },
  { kode: 'TMR', nama: 'Area Timur' },
];

// 15 cabang KLA + kantor pusat. Pembagian AREA di bawah ini adalah dugaan
// berdasarkan letak kota — sesuaikan lewat Admin > Master Unit bila berbeda.
// Cabang baru bisa ditambah kapan saja lewat menu yang sama; kode cabang dipakai
// pada nomor dokumen, jadi pilih singkatan yang tidak berubah-ubah.
const CABANG_AWAL = [
  { kode: 'HO', nama: 'Kantor Pusat (Back Office)', tipe: 'back_office', area: null },
  // --- Area Barat (8 cabang)
  { kode: 'SMG', nama: 'Semarang', tipe: 'store', area: 'BRT' },
  { kode: 'NGL', nama: 'Ngaliyan', tipe: 'store', area: 'BRT' },
  { kode: 'SLW', nama: 'Slawi', tipe: 'store', area: 'BRT' },
  { kode: 'TGL', nama: 'Tegal', tipe: 'store', area: 'BRT' },
  { kode: 'CRB', nama: 'Cirebon', tipe: 'store', area: 'BRT' },
  { kode: 'TSK', nama: 'Tasikmalaya', tipe: 'store', area: 'BRT' },
  { kode: 'PWT', nama: 'Purwokerto', tipe: 'store', area: 'BRT' },
  { kode: 'PKL', nama: 'Pekalongan', tipe: 'store', area: 'BRT' },
  // --- Area Timur (7 cabang)
  { kode: 'YGY', nama: 'Yogyakarta', tipe: 'store', area: 'TMR' },
  { kode: 'SKH', nama: 'Sukoharjo', tipe: 'store', area: 'TMR' },
  { kode: 'SLO', nama: 'Solo', tipe: 'store', area: 'TMR' },
  { kode: 'KDR', nama: 'Kediri', tipe: 'store', area: 'TMR' },
  { kode: 'MJK', nama: 'Mojokerto', tipe: 'store', area: 'TMR' },
  { kode: 'SBYB', nama: 'Surabaya Babatan', tipe: 'store', area: 'TMR' },
  { kode: 'SBYM', nama: 'Surabaya Merr', tipe: 'store', area: 'TMR' },
];

// Departemen Back Office — daftar resmi dari pengguna (31 Jul 2026).
// Kode dipakai pada nomor dokumen Back Office: 0001/EXP/KLA/HO-ACC/07/2026
const DEPARTEMEN_AWAL = [
  { kode: 'ACC', nama: 'Accounting' },
  { kode: 'HC', nama: 'Human Capital' },
  { kode: 'PUR', nama: 'Purchasing' },
  { kode: 'MKT', nama: 'Marketing' },
  { kode: 'SLS', nama: 'Sales (Regional & Area)' },
  { kode: 'BDE', nama: 'Business Development Ekspansi' },
  { kode: 'BDS', nama: 'Business Development SOP' },
  { kode: 'CS', nama: 'Customer Service' },
  { kode: 'IA', nama: 'Internal Audit' },
  { kode: 'BRD', nama: 'Brand' },
];

// Akun contoh. Sandi TIDAK ditulis di kode: dibuat acak saat basis data pertama kali
// dibentuk, lalu dicatat sekali ke data/AKUN-AWAL.txt dan wajib diganti saat login.
const PENGGUNA_AWAL = [
  { nama: 'Administrator', email: 'admin@kla.co.id', peran: 'admin', jabatan: 'Administrator Sistem' },
  { nama: 'Director / CEO', email: 'ceo@kla.co.id', peran: 'ceo', jabatan: 'Director / CEO' },
  { nama: 'Finance & Accounting Manager', email: 'accounting@kla.co.id', peran: 'accounting', jabatan: 'FAM' },
  { nama: 'Regional Manager', email: 'regional@kla.co.id', peran: 'regional_manager', jabatan: 'Regional Manager' },
  { nama: 'Area Manager Barat', email: 'am.barat@kla.co.id', peran: 'area_manager', jabatan: 'Area Manager Barat', area: 'BRT' },
  { nama: 'Area Manager Timur', email: 'am.timur@kla.co.id', peran: 'area_manager', jabatan: 'Area Manager Timur', area: 'TMR' },
  // Store Manager tiap cabang ditambahkan otomatis di bawah — lihat PENGGUNA_AWAL.
  { nama: 'HC Staf', email: 'hc.staf@kla.co.id', peran: 'hc_staf', jabatan: 'HC Staf', cabang: 'HO', departemen: 'HC' },
  { nama: 'HC Manager', email: 'hc.manager@kla.co.id', peran: 'hc_manager', jabatan: 'HC Manager', cabang: 'HO', departemen: 'HC' },
  { nama: 'Marketing Staf', email: 'mkt.staf@kla.co.id', peran: 'marketing_staf', jabatan: 'Content Creator', cabang: 'HO', departemen: 'MKT' },
  { nama: 'Marketing Coordinator', email: 'mkt.koordinator@kla.co.id', peran: 'marketing_coordinator', jabatan: 'Marketing Coordinator', cabang: 'HO', departemen: 'MKT' },
  { nama: 'Staf Accounting', email: 'staf.acc@kla.co.id', peran: 'staf', jabatan: 'Staf Accounting', cabang: 'HO', departemen: 'ACC' },
  { nama: 'Manager Accounting', email: 'manager.acc@kla.co.id', peran: 'leader_manager', jabatan: 'Manager Accounting', cabang: 'HO', departemen: 'ACC' },
  // SETIAP cabang store wajib punya Store Manager — tanpa itu cabang tersebut
  // tidak bisa mengajukan apa pun. Dibangkitkan dari daftar cabang di atas
  // supaya menambah cabang di CABANG_AWAL otomatis ikut membuat akunnya.
  ...CABANG_AWAL.filter(c => c.tipe === 'store').map(c => ({
    nama: 'Store Manager ' + c.nama,
    email: 'sm.' + c.kode.toLowerCase() + '@kla.co.id',
    peran: 'store_manager',
    jabatan: 'Store Manager ' + c.nama,
    cabang: c.kode,
  })),
];

const PENGATURAN_AWAL = {
  nama_perusahaan: 'PT KLA TEKNOLOGI INDONESIA',
  alamat_perusahaan: 'Ruko Mataram Plaza D8-9, Jagalan, Kec. Semarang Tengah, Kota Semarang, Jawa Tengah',
  nama_aplikasi: 'EAPEX',
  subjudul_aplikasi: 'Aplikasi Electronic Approval & Capex',
  reset_nomor: 'tahun',            // tahun | bulan
};

// Pembersihan data lama. Dijalankan setiap kali server menyala, aman diulang.
// Diperlukan karena basis data yang sudah terlanjur dibuat tidak ikut berubah
// hanya dengan mengubah daftar data awal di atas.
async function bersihkanDataLama() {
  // Pakta Integritas Vendor dikeluarkan dari lingkup aplikasi (31 Jul 2026).
  const kat = await db.get("SELECT id FROM kategori WHERE kode = 'PAKTA-RENOVASI'");
  if (kat) {
    const dipakai = Number(await db.nilai('SELECT COUNT(*) AS n FROM pengajuan WHERE kategori_id = ?', [kat.id]));
    if (dipakai) {
      // Masih ada dokumennya: cukup dinonaktifkan supaya riwayat tidak hilang.
      await db.run('UPDATE kategori SET aktif = 0 WHERE id = ?', [kat.id]);
    } else {
      const aturan = await db.all('SELECT id FROM aturan WHERE kategori_id = ?', [kat.id]);
      for (const a of aturan) await db.run('DELETE FROM aturan_langkah WHERE aturan_id = ?', [a.id]);
      await db.run('DELETE FROM aturan WHERE kategori_id = ?', [kat.id]);
      await db.run('DELETE FROM kategori WHERE id = ?', [kat.id]);
    }
  }
  for (const k of ['denda_persen_bawaan', 'garansi_bulan_bawaan', 'kanal_pelaporan']) {
    await db.run('DELETE FROM pengaturan WHERE kunci = ?', [k]);
  }

  await sesuaikanDepartemen();
  await sesuaikanPeranRegional();
  await hapusPeranBrandManager();
  await jadikanDuaArea();
  await lengkapiStoreManager();
}

// Setiap cabang store wajib punya Store Manager. Tanpa akun itu, cabang tersebut
// sama sekali tidak bisa mengajukan — dan itu tidak kelihatan sampai ada orang
// yang mencoba. Dijalankan SEKALI; cabang yang ditambah kemudian lewat menu Admin
// akunnya dibuat sendiri oleh Administrator (nama orangnya memang harus diisi manual).
const TANDA_MIGRASI_SM = 'migrasi_store_manager_v1';

async function lengkapiStoreManager() {
  const sudah = await db.get('SELECT nilai FROM pengaturan WHERE kunci = ?', [TANDA_MIGRASI_SM]);
  if (sudah) return;

  const cabang = await db.all("SELECT id, kode, nama FROM cabang WHERE tipe = 'store' AND aktif = 1 ORDER BY nama");
  for (const c of cabang) {
    const ada = await db.get(
      "SELECT id FROM pengguna WHERE peran = 'store_manager' AND cabang_id = ? AND aktif = 1", [c.id]);
    if (ada) continue;
    const email = 'sm.' + String(c.kode).toLowerCase() + '@kla.co.id';
    const kembar = await db.get('SELECT id FROM pengguna WHERE LOWER(email) = ?', [email]);
    if (kembar) continue;
    const sandi = sandiAcak();
    await db.run(
      `INSERT INTO pengguna (id, nama, email, sandi_hash, peran, jabatan, cabang_id, aktif, wajib_ganti_sandi, dibuat)
       VALUES (?,?,?,?, 'store_manager', ?, ?, 1, 1, ?)`,
      [id(), 'Store Manager ' + c.nama, email, bcrypt.hashSync(sandi, 10),
        'Store Manager ' + c.nama, c.id, sekarang()]);
    tambahBarisAkun(`${email.padEnd(28)} ${sandi.padEnd(14)} ${'store_manager'.padEnd(22)} Store Manager ${c.nama}`);
  }

  await db.run(
    `INSERT INTO pengaturan (kunci, nilai) VALUES (?, ?)
     ON CONFLICT (kunci) DO UPDATE SET nilai = excluded.nilai`, [TANDA_MIGRASI_SM, sekarang()]);
}

// Pemisahan Brand Manager dan Regional Manager (31 Jul 2026) — SEKALI SAJA.
// Sebelumnya keduanya satu peran `brand_manager` berlabel "Brand / Regional Manager".
const TANDA_MIGRASI_RM = 'migrasi_peran_regional_v1';

async function sesuaikanPeranRegional() {
  const sudah = await db.get('SELECT nilai FROM pengaturan WHERE kunci = ?', [TANDA_MIGRASI_RM]);
  if (sudah) return;

  // 1. Pemegang jabatan Regional dipindah ke peran barunya.
  const kandidatRm = await db.all(
    `SELECT id, nama, jabatan FROM pengguna
     WHERE peran = 'brand_manager' AND (LOWER(nama) LIKE '%regional%' OR LOWER(jabatan) LIKE '%regional%')`);
  for (const u of kandidatRm) {
    await db.run('UPDATE pengguna SET peran = ?, jabatan = ? WHERE id = ?',
      ['regional_manager', 'Regional Manager', u.id]);
  }

  // 2. Tahap Brand Manager pada Perpindahan Area diganti Regional Manager
  //    (pemohonnya Area Manager sendiri, jadi tidak lewat Brand Manager).
  const katPindah = await db.get("SELECT id FROM kategori WHERE kode = 'PINDAH-AREA'");
  if (katPindah) {
    const aturanPindah = await db.all('SELECT id FROM aturan WHERE kategori_id = ?', [katPindah.id]);
    for (const a of aturanPindah) {
      await db.run(
        "UPDATE aturan_langkah SET peran = 'regional_manager' WHERE aturan_id = ? AND peran = 'brand_manager'",
        [a.id]);
    }
  }

  // 3. Perjalanan Dinas: aturan store dipecah dua — Store Manager (lewat Area &
  //    Brand Manager) dan Area Manager yang mengajukan sendiri (langsung Regional).
  const katDinas = await db.get("SELECT id, kode_dok FROM kategori WHERE kode = 'DINAS'");
  if (katDinas) {
    const aturanStore = await db.get(
      "SELECT * FROM aturan WHERE kategori_id = ? AND wilayah = 'store' AND catatan IS NULL", [katDinas.id]);
    if (aturanStore) {
      const pemohon = String(aturanStore.peran_pemohon || '').split(',').map(s => s.trim()).filter(Boolean);
      if (pemohon.includes('area_manager')) {
        await db.run('UPDATE aturan SET peran_pemohon = ? WHERE id = ?',
          [pemohon.filter(p => p !== 'area_manager').join(',') || 'store_manager', aturanStore.id]);
      }
    }
    const sudahAda = await db.get(
      "SELECT id FROM aturan WHERE kategori_id = ? AND peran_pemohon = 'area_manager'", [katDinas.id]);
    if (!sudahAda) {
      const aid = id();
      await db.run(
        `INSERT INTO aturan (id, kategori_id, wilayah, peran_pemohon, ambang_ceo, catatan, aktif)
         VALUES (?,?, 'store', 'area_manager', 2000000, 'Diajukan Area Manager sendiri', 1)`,
        [aid, katDinas.id]);
      const langkahBaru = [['regional_manager', null], ['accounting', null], ['ceo', 2000000]];
      for (let i = 0; i < langkahBaru.length; i++) {
        await db.run(
          `INSERT INTO aturan_langkah (id, aturan_id, urut, peran, label, min_nominal, maks_nominal, lingkup)
           VALUES (?,?,?,?,NULL,?,NULL,'auto')`,
          [id(), aid, i + 1, langkahBaru[i][0], langkahBaru[i][1]]);
      }
    }
  }

  await db.run(
    `INSERT INTO pengaturan (kunci, nilai) VALUES (?, ?)
     ON CONFLICT (kunci) DO UPDATE SET nilai = excluded.nilai`, [TANDA_MIGRASI_RM, sekarang()]);
}

// ---------------------------------------------------------------------------
// DUA area, bukan tiga (dikonfirmasi user 31 Jul 2026).
//
// Sebelumnya cabang dibagi menurut provinsi — Jawa Tengah / Timur / Barat — yang
// merupakan DUGAAN saya dari letak kota, bukan struktur organisasi sungguhan.
// Yang benar cuma dua wilayah, dan pembagiannya memang tidak mengikuti provinsi:
// Yogyakarta masuk Timur meski satu provinsi dengan Semarang yang masuk Barat.
//
// SEKALI JALAN. Setelah ini, pemindahan cabang antar area dilakukan lewat menu
// Admin — bukan dengan mengubah kode di sini.
const TANDA_MIGRASI_AREA = 'migrasi_dua_area_v2';

async function jadikanDuaArea() {
  const sudah = await db.get('SELECT nilai FROM pengaturan WHERE kunci = ?', [TANDA_MIGRASI_AREA]);
  if (sudah) return;

  // 1. Pastikan kedua area ada.
  const petaArea = {};
  for (let i = 0; i < AREA_AWAL.length; i++) {
    const a = AREA_AWAL[i];
    let baris = await db.get('SELECT id FROM area WHERE kode = ?', [a.kode]);
    if (!baris) {
      const aid = id();
      await db.run('INSERT INTO area (id, kode, nama, urutan, aktif) VALUES (?,?,?,?,1)', [aid, a.kode, a.nama, i]);
      petaArea[a.kode] = aid;
    } else {
      await db.run('UPDATE area SET nama = ?, urutan = ?, aktif = 1 WHERE id = ?', [a.nama, i, baris.id]);
      petaArea[a.kode] = baris.id;
    }
  }

  // 2. Pindahkan tiap cabang ke areanya yang benar.
  for (const c of CABANG_AWAL) {
    if (!c.area) continue;
    await db.run('UPDATE cabang SET area_id = ? WHERE kode = ?', [petaArea[c.area], c.kode]);
  }

  // 3. Area Manager. Yang sudah dipakai orang TIDAK disentuh selain dipindah
  //    areanya — akun yang pernah dipakai berarti ada orang di baliknya.
  const amLama = await db.all(
    `SELECT u.id, u.email, u.nama, u.login_terakhir, a.kode AS area_kode
     FROM pengguna u LEFT JOIN area a ON a.id = u.area_id
     WHERE u.peran = 'area_manager' AND u.aktif = 1`);

  // Wilayah lama yang paling dekat: Jawa Barat & Jawa Tengah -> Barat, Jawa Timur -> Timur.
  const tujuan = { JBR: 'BRT', JTG: 'BRT', JTM: 'TMR', BRT: 'BRT', TMR: 'TMR' };
  const sudahIsi = {};
  for (const u of amLama) {
    const ke = tujuan[u.area_kode] || null;
    if (ke && !sudahIsi[ke]) {
      await db.run('UPDATE pengguna SET area_id = ? WHERE id = ?', [petaArea[ke], u.id]);
      sudahIsi[ke] = u;
      continue;
    }
    // Kelebihan Area Manager. Akun contoh yang belum pernah dipakai dimatikan;
    // yang sudah pernah dipakai DIBIARKAN AKTIF — memutus akses orang tanpa
    // sepengetahuannya jauh lebih buruk daripada ada satu akun tanpa wilayah.
    if (!u.login_terakhir) await db.run('UPDATE pengguna SET aktif = 0 WHERE id = ?', [u.id]);
    else await db.run('UPDATE pengguna SET area_id = NULL WHERE id = ?', [u.id]);
  }

  // 4. Kedua area WAJIB ada penanggung jawabnya. Tanpa itu, seluruh cabang di
  //    area kosong berhenti di tahap pertama dan tidak ada yang menyadarinya.
  for (const [kode, email, nama] of [
    ['BRT', 'am.barat@kla.co.id', 'Area Manager Barat'],
    ['TMR', 'am.timur@kla.co.id', 'Area Manager Timur'],
  ]) {
    if (sudahIsi[kode]) continue;
    const kembar = await db.get('SELECT id FROM pengguna WHERE LOWER(email) = ?', [email]);
    if (kembar) {
      await db.run(
        "UPDATE pengguna SET peran = 'area_manager', area_id = ?, aktif = 1 WHERE id = ?",
        [petaArea[kode], kembar.id]);
    } else {
      const sandi = sandiAcak();
      await db.run(
        `INSERT INTO pengguna (id, nama, email, sandi_hash, peran, jabatan, area_id, aktif, wajib_ganti_sandi, dibuat)
         VALUES (?,?,?,?, 'area_manager', ?, ?, 1, 1, ?)`,
        [id(), nama, email, bcrypt.hashSync(sandi, 10), nama, petaArea[kode], sekarang()]);
      tambahBarisAkun(`${email.padEnd(28)} ${sandi.padEnd(14)} ${'area_manager'.padEnd(22)} ${nama}`);
    }
  }

  // 5. Akun CONTOH yang masih bernama menurut provinsi dirapikan namanya supaya
  //    tidak menyesatkan — "Area Manager Jawa Tengah" yang ternyata memegang Area
  //    Barat akan membingungkan siapa pun yang membaca dokumen cetakannya.
  //    HANYA akun yang belum pernah dipakai login: begitu ada orang di baliknya,
  //    nama dan alamat emailnya bukan lagi urusan migrasi.
  for (const [kodeArea, email, nama] of [
    ['BRT', 'am.barat@kla.co.id', 'Area Manager Barat'],
    ['TMR', 'am.timur@kla.co.id', 'Area Manager Timur'],
  ]) {
    const bentrok = await db.get('SELECT id FROM pengguna WHERE LOWER(email) = ?', [email]);
    await db.run(
      `UPDATE pengguna SET nama = ?, jabatan = ?${bentrok ? '' : ', email = ?'}
       WHERE peran = 'area_manager' AND aktif = 1 AND area_id = ? AND login_terakhir IS NULL`,
      bentrok ? [nama, nama, petaArea[kodeArea]] : [nama, nama, email, petaArea[kodeArea]]);
  }

  // 6. Area lama dimatikan, TIDAK dihapus: dokumen perpindahan area yang sudah
  //    terlanjur menunjuk ke sana harus tetap bisa dibaca riwayatnya.
  await db.run("UPDATE area SET aktif = 0 WHERE kode IN ('JTG', 'JTM', 'JBR')");

  await db.run(
    `INSERT INTO pengaturan (kunci, nilai) VALUES (?, ?)
     ON CONFLICT (kunci) DO UPDATE SET nilai = excluded.nilai`, [TANDA_MIGRASI_AREA, sekarang()]);
}

// ---------------------------------------------------------------------------
// Regional Manager mengambil alih SELURUH peran Brand Manager (31 Jul 2026).
//
// Keputusan user, dan memang sejalan dengan catatan pada matriks aslinya:
// "Brand Manager hanya bersifat sementara, ketika sudah ada regional manager -->
// Regional mengambil alih peran brand manager untuk tugas advisor dan supervisi".
//
// SEKALI JALAN, ditandai di tabel pengaturan — supaya perubahan matriks yang
// nanti dibuat sendiri lewat menu Admin tidak ditimpa tiap server menyala.
const TANDA_MIGRASI_BM = 'migrasi_regional_gantikan_brand_v1';

async function hapusPeranBrandManager() {
  const sudah = await db.get('SELECT nilai FROM pengaturan WHERE kunci = ?', [TANDA_MIGRASI_BM]);
  if (sudah) return;

  // 1. Semua tahap approval yang masih Brand Manager jadi Regional Manager.
  //    Hanya menyentuh MATRIKS (aturan_langkah), bukan dokumen yang sedang
  //    berjalan: rantai dokumen dibekukan saat diajukan, jadi yang sudah masuk
  //    alur tetap ditandatangani orang yang sama seperti saat diajukan.
  await db.run("UPDATE aturan_langkah SET peran = 'regional_manager' WHERE peran = 'brand_manager'");
  await db.run(`UPDATE aturan_langkah SET label = 'Regional Manager'
                WHERE peran = 'regional_manager' AND label LIKE '%Brand%'`);

  // 2. Pemegang peran Brand Manager dialihkan jadi Regional Manager — bukan
  //    dinonaktifkan. Orangnya masih bekerja; yang berubah namanya peran.
  //    Akun contoh bawaan (brand@kla.co.id) tidak dipakai siapa pun, jadi
  //    dinonaktifkan saja supaya tidak ada akun menganggur yang bisa dipakai masuk.
  await db.run(`UPDATE pengguna SET aktif = 0
                WHERE peran = 'brand_manager' AND LOWER(email) = 'brand@kla.co.id'
                  AND login_terakhir IS NULL`);
  await db.run(`UPDATE pengguna SET peran = 'regional_manager', jabatan = 'Regional Manager'
                WHERE peran = 'brand_manager' AND aktif = 1`);

  // 3. Harus ada yang memegangnya. Tanpa Regional Manager aktif, seluruh rantai
  //    store berhenti di tahap dua dan tidak ada yang menyadarinya sampai ada
  //    yang mencoba mengajukan.
  const adaRm = Number(await db.nilai(
    "SELECT COUNT(*) AS n FROM pengguna WHERE peran = 'regional_manager' AND aktif = 1"));
  if (!adaRm) {
    const email = 'regional@kla.co.id';
    const kembar = await db.get('SELECT id FROM pengguna WHERE LOWER(email) = ?', [email]);
    if (kembar) {
      await db.run("UPDATE pengguna SET peran = 'regional_manager', aktif = 1 WHERE id = ?", [kembar.id]);
    } else {
      const sandi = sandiAcak();
      await db.run(
        `INSERT INTO pengguna (id, nama, email, sandi_hash, peran, jabatan, aktif, wajib_ganti_sandi, dibuat)
         VALUES (?,?,?,?, 'regional_manager', 'Regional Manager', 1, 1, ?)`,
        [id(), 'Regional Manager', email, bcrypt.hashSync(sandi, 10), sekarang()]);
      tambahBarisAkun(`${email.padEnd(28)} ${sandi.padEnd(14)} ${'regional_manager'.padEnd(22)} Regional Manager`);
    }
  }

  await db.run(
    `INSERT INTO pengaturan (kunci, nilai) VALUES (?, ?)
     ON CONFLICT (kunci) DO UPDATE SET nilai = excluded.nilai`, [TANDA_MIGRASI_BM, sekarang()]);
}

// Menambah SATU baris ke catatan akun tanpa menyentuh baris yang sudah ada —
// sandi yang terlanjur dibagikan tidak boleh ikut berubah.
function tambahBarisAkun(baris) {
  const berkas = jalurBerkasAkun();
  try {
    let isi = '';
    try { isi = fs.readFileSync(berkas, 'utf8'); } catch (e) { isi = ''; }
    if (isi.includes(baris.trim().split(/\s+/)[0])) return;      // email sudah tercatat
    fs.mkdirSync(path.dirname(berkas), { recursive: true });
    fs.appendFileSync(berkas, (isi.endsWith('\n') || !isi ? '' : '\n') + baris + '\n', 'utf8');
  } catch (e) {
    console.warn('[skema] gagal mencatat akun baru ke berkas: ' + e.message);
  }
}

// Menyelaraskan daftar departemen dengan DEPARTEMEN_AWAL — SEKALI SAJA.
// Ditandai lewat baris `pengaturan`, supaya perubahan yang nanti dilakukan
// Administrator lewat menu tidak dikembalikan paksa setiap server menyala.
const TANDA_MIGRASI_DEPT = 'migrasi_departemen_v2';

async function sesuaikanDepartemen() {
  const sudah = await db.get('SELECT nilai FROM pengaturan WHERE kunci = ?', [TANDA_MIGRASI_DEPT]);
  if (sudah) return;

  for (const d of DEPARTEMEN_AWAL) {
    const ada = await db.get('SELECT id FROM departemen WHERE kode = ?', [d.kode]);
    if (ada) await db.run('UPDATE departemen SET nama = ?, aktif = 1 WHERE id = ?', [d.nama, ada.id]);
    else await db.run('INSERT INTO departemen (id, kode, nama, aktif) VALUES (?,?,?,1)', [id(), d.kode, d.nama]);
  }

  // Departemen di luar daftar resmi: dihapus bila belum pernah dipakai, kalau
  // sudah dipakai cukup dinonaktifkan supaya dokumen lamanya tetap terbaca.
  const kodeResmi = DEPARTEMEN_AWAL.map(d => d.kode);
  const semua = await db.all('SELECT id, kode FROM departemen');
  for (const d of semua) {
    if (kodeResmi.includes(d.kode)) continue;
    const dipakaiPengguna = Number(await db.nilai('SELECT COUNT(*) AS n FROM pengguna WHERE departemen_id = ?', [d.id]));
    const dipakaiDokumen = Number(await db.nilai('SELECT COUNT(*) AS n FROM pengajuan WHERE departemen_id = ?', [d.id]));
    if (dipakaiPengguna || dipakaiDokumen) await db.run('UPDATE departemen SET aktif = 0 WHERE id = ?', [d.id]);
    else await db.run('DELETE FROM departemen WHERE id = ?', [d.id]);
  }

  await db.run(
    `INSERT INTO pengaturan (kunci, nilai) VALUES (?, ?)
     ON CONFLICT (kunci) DO UPDATE SET nilai = excluded.nilai`, [TANDA_MIGRASI_DEPT, sekarang()]);
}

// ---------------------------------------------------------------------------
// Menambah kolom yang belum ada. PostgreSQL punya ADD COLUMN IF NOT EXISTS,
// SQLite tidak — jadi kegagalan "kolom sudah ada" sengaja ditelan. Kegagalan
// lain tetap dilaporkan supaya kesalahan sungguhan tidak lewat diam-diam.
async function tambahKolom(tabel, kolom, tipe) {
  try {
    await db.run(`ALTER TABLE ${tabel} ADD COLUMN ${kolom} ${tipe}`);
  } catch (e) {
    const pesan = String(e && e.message || '').toLowerCase();
    const sudahAda = pesan.includes('duplicate column') || pesan.includes('already exists');
    if (!sudahAda) throw e;
  }
}

async function siapkan(opsi = {}) {
  const senyap = !!opsi.senyap;
  const catat = (...a) => { if (!senyap) console.log(...a); };

  // exec() SQLite menerima banyak pernyataan sekaligus; pg juga (simple query).
  await db.exec(DDL);

  // Tabel isi lampiran dibuat SEKARANG, bukan saat berkas pertama masuk: kalau
  // dibuat di tengah transaksi penyimpanan dokumen, pembuatan tabelnya berjalan
  // lewat sambungan lain dan bisa saling tunggu dengan transaksi itu.
  await require('./simpanan').siapkan();

  await tambahKolom('pengguna', 'email_notifikasi', 'TEXT');
  await tambahKolom('pengguna', 'cuti_mulai', 'TEXT');
  await tambahKolom('pengguna', 'cuti_selesai', 'TEXT');
  await tambahKolom('pengguna', 'cuti_alasan', 'TEXT');
  await tambahKolom('pengguna', 'pengganti_id', 'TEXT');
  await tambahKolom('pengguna', 'cuti_approve', 'TEXT');

  // Lampiran wajib saat diajukan. Bawaannya WAJIB untuk semua kategori: dokumen
  // approval tanpa penawaran memaksa penyetuju memutuskan berdasarkan angka yang
  // diketik sendiri oleh pemohon, tanpa apa pun untuk dicocokkan. Bisa dimatikan
  // per kategori dari menu Admin bila memang ada kategori yang tidak punya berkas.
  // DEFAULT 1 wajib ada di definisi kolomnya, bukan hanya lewat UPDATE di bawah:
  // kategori awal ditanam SESUDAH baris ini, jadi tanpa default, kategori pada
  // basis data yang baru dibuat akan lahir dengan nilai kosong dan kewajiban
  // lampirannya diam-diam tidak berlaku.
  await tambahKolom('kategori', 'lampiran_wajib', 'INTEGER NOT NULL DEFAULT 1');
  await db.run('UPDATE kategori SET lampiran_wajib = 1 WHERE lampiran_wajib IS NULL');

  // --- pengaturan
  for (const [k, v] of Object.entries(PENGATURAN_AWAL)) {
    const ada = await db.get('SELECT kunci FROM pengaturan WHERE kunci = ?', [k]);
    if (!ada) await db.run('INSERT INTO pengaturan (kunci, nilai) VALUES (?, ?)', [k, v]);
  }

  // --- master area / cabang / departemen
  const petaArea = {};
  for (let i = 0; i < AREA_AWAL.length; i++) {
    const a = AREA_AWAL[i];
    let baris = await db.get('SELECT id FROM area WHERE kode = ?', [a.kode]);
    if (!baris) {
      const aid = id();
      await db.run('INSERT INTO area (id, kode, nama, urutan, aktif) VALUES (?,?,?,?,1)', [aid, a.kode, a.nama, i]);
      baris = { id: aid };
    }
    petaArea[a.kode] = baris.id;
  }

  const petaCabang = {};
  for (const c of CABANG_AWAL) {
    let baris = await db.get('SELECT id FROM cabang WHERE kode = ?', [c.kode]);
    if (!baris) {
      const cid = id();
      await db.run('INSERT INTO cabang (id, kode, nama, tipe, area_id, aktif) VALUES (?,?,?,?,?,1)',
        [cid, c.kode, c.nama, c.tipe, c.area ? petaArea[c.area] : null]);
      baris = { id: cid };
    }
    petaCabang[c.kode] = baris.id;
  }

  const petaDept = {};
  for (const d of DEPARTEMEN_AWAL) {
    let baris = await db.get('SELECT id FROM departemen WHERE kode = ?', [d.kode]);
    if (!baris) {
      const did = id();
      await db.run('INSERT INTO departemen (id, kode, nama, aktif) VALUES (?,?,?,1)', [did, d.kode, d.nama]);
      baris = { id: did };
    }
    petaDept[d.kode] = baris.id;
  }

  // --- kategori + aturan + langkah
  for (let i = 0; i < KATEGORI_AWAL.length; i++) {
    const k = KATEGORI_AWAL[i];
    let kat = await db.get('SELECT id FROM kategori WHERE kode = ?', [k.kode]);
    if (!kat) {
      const kid = id();
      await db.run(
        `INSERT INTO kategori (id, kode, kode_dok, nama, grup, jenis, bentuk, urutan, aktif, keterangan)
         VALUES (?,?,?,?,?,?,?,?,1,?)`,
        [kid, k.kode, k.kode_dok, k.nama, k.grup, k.jenis, k.bentuk, i, k.keterangan || null]);
      kat = { id: kid };
      for (const at of k.aturan) {
        const aid = id();
        await db.run(
          'INSERT INTO aturan (id, kategori_id, wilayah, peran_pemohon, ambang_ceo, catatan, aktif) VALUES (?,?,?,?,?,?,1)',
          [aid, kid, at.wilayah, at.pemohon, at.ambang || null, at.catatan || null]);
        for (let s = 0; s < at.langkah.length; s++) {
          const [peran, minNominal, lingkup, label] = at.langkah[s];
          await db.run(
            'INSERT INTO aturan_langkah (id, aturan_id, urut, peran, label, min_nominal, maks_nominal, lingkup) VALUES (?,?,?,?,?,?,?,?)',
            [id(), aid, s + 1, peran, label || null, minNominal || null, null, lingkup || 'auto']);
        }
      }
    }
  }

  // --- pengguna awal (hanya bila tabel benar-benar kosong)
  const jml = await db.nilai('SELECT COUNT(*) AS n FROM pengguna');
  if (Number(jml) === 0) {
    const sandiAdmin = process.env.ADMIN_PASSWORD || null;
    const emailAdmin = (process.env.ADMIN_EMAIL || 'admin@kla.co.id').toLowerCase();
    const daftar = [];
    for (const u of PENGGUNA_AWAL) {
      const email = u.peran === 'admin' ? emailAdmin : u.email;
      const sandi = (u.peran === 'admin' && sandiAdmin) ? sandiAdmin : sandiAcak();
      await db.run(
        `INSERT INTO pengguna (id, nama, email, sandi_hash, peran, jabatan, cabang_id, area_id, departemen_id, aktif, wajib_ganti_sandi, dibuat)
         VALUES (?,?,?,?,?,?,?,?,?,1,1,?)`,
        [id(), u.nama, email, bcrypt.hashSync(sandi, 10), u.peran, u.jabatan || null,
          u.cabang ? petaCabang[u.cabang] : null, u.area ? petaArea[u.area] : null,
          u.departemen ? petaDept[u.departemen] : null, sekarang()]);
      daftar.push({ nama: u.nama, email, peran: u.peran, sandi });
    }
    // Pengujian memakai basis data sementara; jangan sampai catatan akun ASLI tertimpa.
    if (!senyap) tulisBerkasAkun(daftar, catat);
  }

  await bersihkanDataLama();

  return { ok: true };
}

function sandiAcak() {
  // Sandi awal acak yang masih mudah dibaca ulang dari berkas catatan.
  const abjad = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let s = '';
  const buf = crypto.randomBytes(12);
  for (let i = 0; i < 12; i++) s += abjad[buf[i] % abjad.length];
  return s;
}

// Catatan akun selalu ditulis DI SAMPING berkas basis datanya. Kalau dipatok ke
// data/AKUN-AWAL.txt, basis data sementara (pengujian) akan menimpa catatan akun
// asli — pernah terjadi 31 Jul 2026 dan membuat seluruh sandi yang sudah dibagikan
// tidak lagi cocok dengan isi basis data.
function jalurBerkasAkun() {
  const dbLokal = process.env.SQLITE_PATH;
  const dir = dbLokal ? path.dirname(path.resolve(dbLokal)) : path.join(__dirname, '..', 'data');
  return path.join(dir, 'AKUN-AWAL.txt');
}

function tulisBerkasAkun(daftar, catat) {
  const berkas = jalurBerkasAkun();
  const isi = [
    '============================================================',
    ' EAPEX — DAFTAR AKUN AWAL',
    ' Dibuat: ' + new Date().toLocaleString('id-ID'),
    '',
    ' PENTING:',
    '  1. Semua akun ini WAJIB ganti sandi saat login pertama.',
    '  2. Hapus berkas ini setelah sandi dibagikan ke pemiliknya.',
    '  3. Berkas ini sudah masuk .gitignore — jangan pernah di-commit.',
    '============================================================',
    '',
    ...daftar.map(u => `${u.email.padEnd(28)} ${u.sandi.padEnd(14)} ${u.peran.padEnd(22)} ${u.nama}`),
    '',
  ].join('\n');
  try {
    fs.mkdirSync(path.dirname(berkas), { recursive: true });
    fs.writeFileSync(berkas, isi, 'utf8');
    catat('\n  Akun awal dibuat. Sandi tercatat di: ' + berkas);
    catat('  (semua akun wajib ganti sandi saat login pertama)\n');
  } catch (e) {
    // Kalau berkas gagal ditulis, sandi harus tetap sampai ke operator.
    catat('\n  Akun awal dibuat (gagal menulis berkas: ' + e.message + '):');
    for (const u of daftar) catat(`   ${u.email}  ${u.sandi}  ${u.peran}`);
    catat('');
  }
}

module.exports = { siapkan, DDL, KATEGORI_AWAL, PENGATURAN_AWAL };
