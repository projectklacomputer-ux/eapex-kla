// ============================================================================
//  Pembacaan & pemeriksaan isi formulir
// ============================================================================
// Semua data yang masuk dari peramban lewat berkas ini. Hanya kolom yang terdaftar
// di sini yang disimpan (daftar putih), sehingga kiriman berlebihan tidak pernah
// menyusup ke data_json.
const { keRupiahBulat, potong } = require('./util');
const { KATEGORI_ASET } = require('./konstanta');

const KOLOM = {
  capex: ['nama_proyek', 'tujuan', 'penjelasan', 'kategori_aset', 'deskripsi', 'lokasi', 'vendor',
    'pengiriman', 'instalasi', 'biaya_lain', 'sales_tambahan', 'margin_persen',
    'jadwal_kebutuhan', 'referensi_disposal', 'justifikasi'],
  barang: ['jalur_pengadaan', 'justifikasi', 'penjelasan'],
  biaya: ['penjelasan', 'vendor', 'periode', 'justifikasi'],
  perjalanan: ['tujuan_kota', 'keperluan', 'tgl_mulai', 'tgl_selesai', 'peserta', 'moda', 'justifikasi'],
  maintenance: ['lokasi', 'jenis_pekerjaan', 'vendor', 'penjelasan', 'tgl_rencana', 'justifikasi'],
  refund: ['nominal', 'nama_penerima', 'bank', 'no_rekening', 'no_nota', 'alasan'],
  pindah_area: ['area_tujuan_id', 'nama_karyawan', 'jabatan_karyawan', 'tgl_pindah', 'penjelasan'],
};

// Kolom yang isinya uang -> selalu dibulatkan ke rupiah utuh.
const KOLOM_UANG = new Set(['pengiriman', 'instalasi', 'biaya_lain', 'sales_tambahan', 'nominal']);
const KOLOM_PANJANG = new Set(['penjelasan', 'justifikasi', 'deskripsi', 'alasan',
  'keperluan', 'jenis_pekerjaan', 'peserta']);

function bacaData(bentuk, body) {
  const izin = KOLOM[bentuk] || [];
  const data = {};
  for (const k of izin) {
    let v = body[k];
    if (v === undefined) continue;
    if (k === 'tujuan') {
      data[k] = (Array.isArray(v) ? v : [v]).map(x => potong(x, 40));
      continue;
    }
    if (KOLOM_UANG.has(k)) { data[k] = keRupiahBulat(v); continue; }
    if (k === 'margin_persen') {
      const n = Number(String(v).replace(',', '.'));
      data[k] = Number.isFinite(n) ? n : 0;
      continue;
    }
    data[k] = potong(String(v).trim(), KOLOM_PANJANG.has(k) ? 4000 : 300);
  }
  if (bentuk === 'capex' && data.kategori_aset && !KATEGORI_ASET.includes(data.kategori_aset)) {
    data.kategori_aset = 'Lainnya';
  }
  return data;
}

// Baris rincian biaya. Baris yang namanya kosong DIBUANG (bukan disimpan nol),
// supaya tabel cetakan tidak berisi baris hampa.
function bacaItems(body) {
  const nama = ambilArray(body.item_nama);
  const qty = ambilArray(body.item_qty);
  const satuan = ambilArray(body.item_satuan);
  const harga = ambilArray(body.item_harga);
  const ket = ambilArray(body.item_ket);
  const items = [];
  for (let i = 0; i < nama.length; i++) {
    const n = String(nama[i] || '').trim();
    if (!n) continue;
    const q = Math.max(0, Math.round(Number(String(qty[i] || '1').replace(/[^\d.-]/g, '')) || 0));
    const h = keRupiahBulat(harga[i]);
    items.push({
      urut: items.length + 1,
      nama: potong(n, 300),
      qty: q || 1,
      satuan: potong(satuan[i] || 'unit', 40),
      harga: h,
      nominal: (q || 1) * h,
      keterangan: potong(ket[i] || '', 300) || null,
    });
  }
  return items;
}

function ambilArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

// --------------------------------------------------------------- pemeriksaan
// Mengembalikan daftar pesan galat. Kosong berarti isi formulir sudah sah.
// Dokumen approval yang setengah terisi memaksa penyetuju menebak. Semua kolom
// yang menentukan KEPUTUSAN karena itu wajib diisi.
//
// Yang SENGAJA dibiarkan tidak wajib, beserta alasannya — supaya pilihan ini bisa
// diperdebatkan, bukan tersembunyi:
//
//   pengiriman / instalasi / biaya_lain  Nol itu jawaban yang sah: barang diambil
//                                        sendiri, atau tidak perlu dipasang. Kalau
//                                        dipaksa berisi, orang akan mengarang angka.
//   sales_tambahan / margin_persen       Hanya berlaku untuk capex yang memang
//                                        menambah penjualan. AC ruang kasir tidak
//                                        menambah omzet, dan memaksa mengisinya
//                                        justru membuat analisanya bohong.
//   referensi_disposal                   Hanya ada bila memang ada aset lama yang dilepas.
//   keterangan tiap baris                Catatan tambahan, bukan penentu keputusan.
const WAJIB = {
  capex: {
    nama_proyek: 'Nama proyek', tujuan: 'Tujuan pengadaan', kategori_aset: 'Kategori aset',
    deskripsi: 'Deskripsi barang/pekerjaan', lokasi: 'Lokasi penempatan', vendor: 'Vendor',
    jadwal_kebutuhan: 'Jadwal kebutuhan', penjelasan: 'Penjelasan kebutuhan',
    justifikasi: 'Justifikasi',
  },
  barang: { jalur_pengadaan: 'Jalur pengadaan', penjelasan: 'Penjelasan', justifikasi: 'Justifikasi' },
  biaya: { penjelasan: 'Penjelasan', vendor: 'Vendor', periode: 'Periode', justifikasi: 'Justifikasi' },
  perjalanan: {
    tujuan_kota: 'Kota tujuan', keperluan: 'Keperluan', tgl_mulai: 'Tanggal mulai',
    tgl_selesai: 'Tanggal selesai', peserta: 'Peserta', moda: 'Moda transportasi',
    justifikasi: 'Justifikasi',
  },
  maintenance: {
    lokasi: 'Lokasi', jenis_pekerjaan: 'Jenis pekerjaan', vendor: 'Vendor',
    penjelasan: 'Penjelasan', tgl_rencana: 'Tanggal rencana', justifikasi: 'Justifikasi',
  },
  refund: {
    nominal: 'Nominal refund', nama_penerima: 'Nama penerima dana', bank: 'Bank',
    no_rekening: 'Nomor rekening tujuan', no_nota: 'Nomor nota', alasan: 'Alasan refund',
  },
  pindah_area: {
    area_tujuan_id: 'Area tujuan', nama_karyawan: 'Nama karyawan', jabatan_karyawan: 'Jabatan karyawan',
    tgl_pindah: 'Tanggal pindah', penjelasan: 'Penjelasan',
  },
};

function medanWajib(bentuk) { return WAJIB[bentuk] || {}; }

function kosong(nilai) {
  if (Array.isArray(nilai)) return nilai.length === 0;
  return nilai === undefined || nilai === null || String(nilai).trim() === '';
}

function periksa(bentuk, { judul, data, items, wilayah, cabang_id, departemen_id }) {
  const g = [];
  if (!String(judul || '').trim()) g.push('Perihal pengajuan wajib diisi');
  if (wilayah === 'store' && !cabang_id) g.push('Cabang/store wajib dipilih');
  if (wilayah === 'back_office' && !departemen_id) g.push('Departemen wajib dipilih');

  for (const [kolom, label] of Object.entries(medanWajib(bentuk))) {
    if (kolom === 'nominal') continue;                 // diperiksa terpisah sebagai angka
    if (kosong(data[kolom])) g.push(`${label} wajib diisi`);
  }

  const perluItem = bentuk !== 'refund';
  if (perluItem) {
    if (!items.length) g.push('Rincian biaya minimal satu baris');
    items.forEach((it, i) => {
      const sebut = `Baris ${i + 1}${it.nama ? ' (' + it.nama + ')' : ''}`;
      if (it.harga < 0) g.push(`${sebut}: harga tidak boleh negatif`);
      // Baris berharga nol membuat total dokumen tidak mencerminkan isinya.
      else if (it.harga === 0) g.push(`${sebut}: harga wajib diisi`);
      if (it.qty <= 0) g.push(`${sebut}: jumlah wajib lebih dari nol`);
      if (!String(it.satuan || '').trim()) g.push(`${sebut}: satuan wajib diisi`);
    });
  }

  if (bentuk === 'refund' && keRupiahBulat(data.nominal) <= 0) {
    g.push('Nominal refund wajib lebih dari nol');
  }

  if (bentuk === 'perjalanan' && data.tgl_mulai && data.tgl_selesai && data.tgl_selesai < data.tgl_mulai) {
    g.push('Tanggal selesai tidak boleh lebih awal dari tanggal mulai');
  }
  return g;
}

module.exports = { bacaData, bacaItems, periksa, medanWajib, KOLOM, WAJIB };
