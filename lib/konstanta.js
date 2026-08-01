// ============================================================================
//  Kamus tetap aplikasi: peran, status, wilayah, lingkup pencarian approver
// ============================================================================

// Peran (role). Kunci dipakai di basis data, label dipakai di layar & cetakan.
const PERAN = {
  admin:                { label: 'Administrator Sistem', global: true,  bisaMengajukan: true },
  ceo:                  { label: 'Director / CEO',        global: true,  bisaMengajukan: false },
  accounting:           { label: 'Finance / Accounting',  global: true,  bisaMengajukan: false },
  // Regional Manager memegang SEMUA tahap supervisi area & store (31 Jul 2026).
  regional_manager:     { label: 'Regional Manager',      global: true,  bisaMengajukan: false },
  // Brand Manager RIWAYAT SAJA: tidak dipakai pada rantai approval mana pun sejak
  // 31 Jul 2026 — Regional Manager mengambil alih. Tetap didaftarkan supaya dokumen
  // lama yang rantainya terlanjur dibekukan tetap terbaca labelnya di layar dan
  // cetakan. JANGAN dipakai pada matriks baru.
  brand_manager:        { label: 'Brand Manager (riwayat)', global: true, bisaMengajukan: false, riwayat: true },
  area_manager:         { label: 'Area Manager',          global: false, bisaMengajukan: true },
  store_manager:        { label: 'Store Manager',         global: false, bisaMengajukan: true },
  leader_manager:       { label: 'Leader / Manager',      global: false, bisaMengajukan: false },
  staf:                 { label: 'Staf Back Office',      global: false, bisaMengajukan: true },
  marketing_staf:       { label: 'Marketing Staf / Content Creator', global: false, bisaMengajukan: true },
  marketing_coordinator:{ label: 'Marketing Coordinator', global: false, bisaMengajukan: false },
  hc_staf:              { label: 'HC Staf',               global: false, bisaMengajukan: true },
  hc_manager:           { label: 'HC Manager',            global: false, bisaMengajukan: false },
  purchasing:           { label: 'Purchasing',            global: true,  bisaMengajukan: false },
};

const labelPeran = p => (PERAN[p] ? PERAN[p].label : p);

// Status pengajuan. `warna` dipakai sebagai kelas CSS lencana.
const STATUS = {
  draft:      { label: 'Draft',            warna: 'abu'   },
  menunggu:   { label: 'Menunggu Approval', warna: 'kuning' },
  revisi:     { label: 'Perlu Revisi',     warna: 'oranye' },
  disetujui:  { label: 'Disetujui',        warna: 'hijau' },
  ditolak:    { label: 'Ditolak',          warna: 'merah' },
  dibatalkan: { label: 'Dibatalkan',       warna: 'abu'   },
};

const labelStatus = s => (STATUS[s] ? STATUS[s].label : s);
const warnaStatus = s => (STATUS[s] ? STATUS[s].warna : 'abu');

const WILAYAH = { store: 'Store', back_office: 'Back Office' };

// Bentuk formulir. Menentukan bagian mana yang tampil saat mengisi & mencetak.
const BENTUK = {
  capex:       'CAPEX / Aset',
  barang:      'Daftar Barang',
  biaya:       'Biaya Umum',
  perjalanan:  'Perjalanan Dinas',
  maintenance: 'Maintenance Bangunan',
  refund:      'Refund Dana',
  pindah_area: 'Perpindahan Area',
};

// Lingkup pencarian calon approver untuk sebuah langkah.
//   auto        : cabang -> area cabang -> departemen -> global -> peran apa saja
//   area_tujuan : khusus perpindahan area, dicari di area tujuan
//   global      : hanya pengguna tanpa cabang/area/departemen (mis. CEO, Accounting)
const LINGKUP = { auto: 'Otomatis', area_tujuan: 'Area Tujuan', global: 'Kantor Pusat' };

// Tujuan pengadaan pada Form CAPEX (kotak centang, boleh lebih dari satu).
const TUJUAN_CAPEX = [
  { kode: 'penjualan',  teks: 'Meningkatkan penjualan' },
  { kode: 'pengalaman', teks: 'Meningkatkan customer experience' },
  { kode: 'efisiensi',  teks: 'Efisiensi operasional' },
  { kode: 'penggantian', teks: 'Penggantian aset' },
  { kode: 'renovasi',   teks: 'Renovasi / pembukaan store' },
];

const KATEGORI_ASET = ['Bangunan', 'Inventaris', 'Kendaraan', 'Peralatan IT', 'Lainnya'];

// Lambang kecil tiap kelompok kategori di halaman Pengajuan Baru. Dicocokkan
// dengan kolom `grup` pada tabel kategori; kelompok baru yang belum terdaftar
// memakai lambang cadangan, jadi menambah kelompok tidak akan merusak tampilan.
const IKON_GRUP = {
  'CAPEX': '🏗',
  'Biaya Marketing': '📣',
  'Biaya Umum': '🧾',
  'Biaya Perjalanan Dinas': '✈',
  'Biaya Maintenance': '🔧',
  'Refund Dana': '↩',
  'Biaya Lain': '📦',
};
const ikonGrup = nama => IKON_GRUP[nama] || '•';

module.exports = {
  PERAN, labelPeran, STATUS, labelStatus, warnaStatus, WILAYAH, BENTUK, LINGKUP,
  TUJUAN_CAPEX, KATEGORI_ASET, IKON_GRUP, ikonGrup,
};
