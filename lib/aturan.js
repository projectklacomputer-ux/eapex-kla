// ============================================================================
//  Mesin aturan approval
// ============================================================================
// Tugasnya dua:
//   1. Menentukan LANGKAH APA SAJA yang wajib untuk satu pengajuan (tergantung
//      kategori, wilayah, dan total nominal terhadap ambang).
//   2. Menentukan SIAPA saja yang boleh menyetujui tiap langkah (kandidat).
//
// Semuanya dibaca dari tabel `aturan` / `aturan_langkah`, sehingga matriks approval
// bisa diubah dari menu Admin tanpa menyentuh kode.
const db = require('./db');
const { labelPeran, PERAN } = require('./konstanta');
const cuti = require('./cuti');

// ---------------------------------------------------------------- pembacaan aturan
async function kategoriAktif() {
  return db.all('SELECT * FROM kategori WHERE aktif = 1 ORDER BY urutan, nama');
}

async function kategoriById(kategoriId) {
  return db.get('SELECT * FROM kategori WHERE id = ?', [kategoriId]);
}

async function aturanKategori(kategoriId) {
  return db.all('SELECT * FROM aturan WHERE kategori_id = ? AND aktif = 1 ORDER BY wilayah', [kategoriId]);
}

async function aturanById(aturanId) {
  return db.get('SELECT * FROM aturan WHERE id = ?', [aturanId]);
}

async function langkahAturan(aturanId) {
  return db.all('SELECT * FROM aturan_langkah WHERE aturan_id = ? ORDER BY urut', [aturanId]);
}

// Aturan yang boleh dipakai oleh seorang pengguna untuk satu kategori.
// Admin boleh memakai semua aturan (mengajukan atas nama unit lain).
function bolehMengajukan(aturan, peran) {
  if (peran === 'admin') return true;
  const daftar = String(aturan.peran_pemohon || '').split(',').map(s => s.trim()).filter(Boolean);
  return daftar.includes(peran);
}

async function aturanUntukPengguna(kategoriId, pengguna) {
  const semua = await aturanKategori(kategoriId);
  return semua.filter(a => bolehMengajukan(a, pengguna.peran));
}

// ---------------------------------------------------------------- langkah berlaku
// Sebuah langkah ikut dipakai bila total nominal masuk rentang [min, maks].
// min/maks null berarti tanpa batas di sisi itu.
//
// PENTING: batas bawah bersifat INKLUSIF (total >= min). Matriks asli menulis
// "< 1 juta" dan "> 1 juta" sehingga nominal tepat 1 juta tidak masuk keduanya;
// di sini nominal tepat ambang tetap wajib naik ke CEO (pilihan konservatif).
function langkahBerlaku(daftarLangkah, total) {
  const n = Number(total || 0);
  return daftarLangkah.filter(l => {
    const min = l.min_nominal === null || l.min_nominal === undefined ? null : Number(l.min_nominal);
    const maks = l.maks_nominal === null || l.maks_nominal === undefined ? null : Number(l.maks_nominal);
    if (min !== null && n < min) return false;
    if (maks !== null && n > maks) return false;
    return true;
  });
}

// ---------------------------------------------------------------- kandidat approver
const KOLOM_PENGGUNA = `id, nama, email, peran, jabatan, cabang_id, area_id, departemen_id,
  cuti_mulai, cuti_selesai, cuti_alasan, cuti_approve, pengganti_id`;

async function cariPengguna(sql, params) {
  return db.all(`SELECT ${KOLOM_PENGGUNA} FROM pengguna WHERE aktif = 1 AND ${sql} ORDER BY nama`, params);
}

// Urutan pencarian dari yang paling spesifik ke paling umum. Yang pertama berisi dipakai.
async function kandidatLangkah(langkah, konteks) {
  const peran = langkah.peran;
  const lingkup = langkah.lingkup || 'auto';
  const buang = new Set([konteks.pemohon_id].filter(Boolean));
  const bersih = daftar => daftar.filter(u => !buang.has(u.id));

  if (lingkup === 'area_tujuan') {
    if (!konteks.area_tujuan_id) return [];
    return bersih(await cariPengguna('peran = ? AND area_id = ?', [peran, konteks.area_tujuan_id]));
  }

  if (lingkup === 'global') {
    const g = bersih(await cariPengguna(
      'peran = ? AND cabang_id IS NULL AND area_id IS NULL AND departemen_id IS NULL', [peran]));
    if (g.length) return g;
    return bersih(await cariPengguna('peran = ?', [peran]));
  }

  const percobaan = [];
  if (konteks.departemen_id && konteks.cabang_id) {
    percobaan.push(['peran = ? AND departemen_id = ? AND cabang_id = ?', [peran, konteks.departemen_id, konteks.cabang_id]]);
  }
  if (konteks.departemen_id) percobaan.push(['peran = ? AND departemen_id = ?', [peran, konteks.departemen_id]]);
  if (konteks.cabang_id) percobaan.push(['peran = ? AND cabang_id = ?', [peran, konteks.cabang_id]]);
  if (konteks.area_id) percobaan.push(['peran = ? AND area_id = ?', [peran, konteks.area_id]]);
  percobaan.push(['peran = ? AND cabang_id IS NULL AND area_id IS NULL AND departemen_id IS NULL', [peran]]);

  // Jaring terakhir "siapa pun yang berperan itu" HANYA untuk peran kantor pusat
  // (CEO, Accounting, Brand/Regional Manager, Purchasing) yang memang melayani
  // seluruh unit. Untuk peran berwilayah — Area Manager, Store Manager, manajer
  // departemen — jaring itu berbahaya: bila calon di wilayahnya kosong (misalnya
  // karena Area Manager itu sendiri yang mengajukan), dokumen bisa nyasar ke
  // Area Manager wilayah lain. Lebih baik gagal terang-terangan dengan pesan
  // "belum ada pengguna untuk peran ini" daripada disetujui orang yang keliru.
  if (PERAN[peran] && PERAN[peran].global) percobaan.push(['peran = ?', [peran]]);

  for (const [sql, params] of percobaan) {
    const hasil = bersih(await cariPengguna(sql, params));
    if (hasil.length) return hasil;
  }
  return [];
}

// ------------------------------------------------------------- saringan cuti
// Penyetuju yang sedang cuti dikeluarkan dari daftar. Dua kemungkinan hasilnya
// dibedakan tegas, karena akibatnya jauh berbeda:
//
//   peranKosong  — memang tidak ada seorang pun yang memegang peran itu.
//                  Dokumen HARUS ditolak: kalau diteruskan, ia akan menggantung
//                  tanpa penyetuju dan tidak ada yang tahu.
//   semuaCuti    — pemegangnya ada, tapi hari ini semua berhalangan. Tahapnya
//                  dilewati (atau diambil alih pengganti) dan alasannya dicatat
//                  di dokumen.
//
// Pengganti hanya dipakai kalau TIDAK ADA calon lain yang tersedia. Selama masih
// ada satu Area Manager yang masuk, tidak perlu ada yang mengambil alih.
async function kandidatLangkahRinci(langkah, konteks) {
  const semua = await kandidatLangkah(langkah, konteks);
  const hariIni = cuti.tanggalWib();

  // HANYA pengalihan ke pengganti yang mengubah siapa penyetujunya. Pernyataan
  // "saya tidak bisa menyetujui" TIDAK mengeluarkan orangnya dari daftar — tahap
  // itu tetap miliknya sampai ada manusia lain (penyetuju sebelumnya) yang
  // memastikan dan memutuskan melewatinya.
  const tersedia = [], berhalangan = [];
  for (const u of semua) (cuti.dialihkan(u, hariIni) ? berhalangan : tersedia).push(u);

  let pengganti = [];
  if (!tersedia.length && berhalangan.length) {
    for (const u of berhalangan) {
      if (!u.pengganti_id || u.pengganti_id === konteks.pemohon_id) continue;
      const g = await db.get(
        `SELECT ${KOLOM_PENGGUNA} FROM pengguna WHERE id = ? AND aktif = 1`, [u.pengganti_id]);
      if (g && !cuti.dialihkan(g, hariIni) && !pengganti.some(x => x.id === g.id)) pengganti.push(g);
    }
  }

  // Kalau penggantinya pun tidak tersedia, tahapnya dikembalikan kepada pemilik
  // aslinya — BUKAN dibiarkan kosong lalu dilewati diam-diam. Dokumennya menunggu,
  // dan pengingat harian melaporkannya ke Administrator.
  const dipakai = tersedia.length ? tersedia : (pengganti.length ? pengganti : semua);
  return {
    kandidat: dipakai,
    // Seluruh pemegang peran ini TANPA saringan cuti. Dipakai lib/alur.js untuk
    // mengembalikan calon pada tahap yang ternyata tidak boleh dilewati.
    kandidatSemua: semua,
    berhalangan,
    peranKosong: semua.length === 0,
    pakaiPengganti: !tersedia.length && pengganti.length > 0,
    alasanLewat: berhalangan.length
      ? berhalangan.map(u => `${u.nama}: ${cuti.keteranganCuti(u)}`).join('; ')
      : '',
  };
}

// ---------------------------------------------------------------- rantai lengkap
// Menghasilkan daftar langkah siap simpan, termasuk kandidat penyetujunya.
// `konteks` = { pemohon_id, cabang_id, area_id, departemen_id, area_tujuan_id }
async function bangunRantai(aturanId, total, konteks) {
  const semua = await langkahAturan(aturanId);
  const dipakai = langkahBerlaku(semua, total);
  const rantai = [];
  let urut = 0;
  for (const l of dipakai) {
    urut += 1;
    const r = await kandidatLangkahRinci(l, konteks);
    rantai.push({
      urut,
      peran: l.peran,
      label: l.label || labelPeran(l.peran),
      lingkup: l.lingkup || 'auto',
      min_nominal: l.min_nominal ?? null,
      maks_nominal: l.maks_nominal ?? null,
      kandidat: r.kandidat,
      kandidatSemua: r.kandidatSemua,
      // Nomor urut TIDAK dirapatkan saat ada tahap yang dilewati: tahapnya tetap
      // tampil di tempatnya dengan keterangan alasannya, supaya setahun kemudian
      // masih bisa dibaca kenapa dokumen ini hanya melewati tiga tanda tangan.
      dilewatiCuti: !r.peranKosong && r.kandidat.length === 0,
      pakaiPengganti: r.pakaiPengganti,
      alasanLewat: r.alasanLewat,
      peranKosong: r.peranKosong,
    });
  }
  return rantai;
}

// Penjelasan rantai untuk ditampilkan sebelum submit (pratinjau alur).
function ringkasRantai(rantai) {
  return rantai.map(r => r.label).join(' → ');
}

// Langkah tanpa kandidat = alur macet. Harus dicegah SEBELUM pengajuan tersimpan
// sebagai "menunggu", supaya tidak ada dokumen yang menggantung tanpa penyetuju.
//
// Tahap yang kosong KARENA CUTI tidak termasuk: itu memang sengaja dilewati dan
// alasannya tercatat. Yang dicegah hanya peran yang benar-benar tidak ada
// pemegangnya — misalnya departemen yang belum punya Leader/Manager.
function langkahTanpaKandidat(rantai) {
  return rantai.filter(r => !r.kandidat.length && r.peranKosong !== false);
}

// Tahap yang dilewati karena penyetujunya cuti. Dipakai untuk memberi tahu
// pemohon apa adanya sebelum dan sesudah dokumen diajukan.
function langkahDilewati(rantai) {
  return rantai.filter(r => r.dilewatiCuti);
}

module.exports = {
  kategoriAktif, kategoriById, aturanKategori, aturanById, langkahAturan,
  bolehMengajukan, aturanUntukPengguna, langkahBerlaku, kandidatLangkah,
  bangunRantai, ringkasRantai, langkahTanpaKandidat, langkahDilewati, kandidatLangkahRinci,
};
