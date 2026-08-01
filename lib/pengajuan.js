// ============================================================================
//  Pembacaan data pengajuan (query + perakitan objek siap tampil)
// ============================================================================
const db = require('./db');
const { bacaJson, keRupiahBulat } = require('./util');

const PILIH_RINGKAS = `
  p.id, p.nomor, p.judul, p.total, p.status, p.langkah_kini, p.wilayah,
  p.dibuat, p.diajukan, p.ditutup, p.status_anggaran,
  k.nama AS kategori_nama, k.kode AS kategori_kode, k.grup AS kategori_grup,
  k.jenis AS kategori_jenis, k.bentuk AS kategori_bentuk,
  c.nama AS cabang_nama, c.kode AS cabang_kode, c.area_id AS cabang_area_id,
  d.nama AS departemen_nama, d.kode AS departemen_kode,
  u.nama AS pemohon_nama, u.jabatan AS pemohon_jabatan,
  (SELECT COUNT(*) FROM persetujuan s WHERE s.pengajuan_id = p.id) AS jml_tahap,
  (SELECT COUNT(*) FROM persetujuan s WHERE s.pengajuan_id = p.id AND s.status = 'disetujui') AS tahap_selesai,
  (SELECT s.label FROM persetujuan s WHERE s.pengajuan_id = p.id AND s.urut = p.langkah_kini) AS tahap_label,
  (SELECT s.label FROM persetujuan s WHERE s.pengajuan_id = p.id AND s.status = 'ditolak' LIMIT 1) AS tahap_ditolak,
  (SELECT s.label FROM persetujuan s WHERE s.pengajuan_id = p.id AND s.status = 'revisi' LIMIT 1) AS tahap_revisi`;

const DARI = `
  FROM pengajuan p
  JOIN kategori k ON k.id = p.kategori_id
  JOIN pengguna u ON u.id = p.pemohon_id
  LEFT JOIN cabang c ON c.id = p.cabang_id
  LEFT JOIN departemen d ON d.id = p.departemen_id`;

// ---------------------------------------------------------------- total nominal
// Satu tempat untuk semua rumus total, supaya nilai yang dipakai mesin approval
// selalu sama dengan yang tampil di layar dan di cetakan.
function hitungTotal(bentuk, data, items) {
  const d = data || {};
  const jumlahItem = (items || []).reduce((a, b) => a + keRupiahBulat(b.nominal), 0);
  if (bentuk === 'capex') {
    return jumlahItem + keRupiahBulat(d.pengiriman) + keRupiahBulat(d.instalasi) + keRupiahBulat(d.biaya_lain);
  }
  if (bentuk === 'refund') return keRupiahBulat(d.nominal);
  return jumlahItem;
}

// Analisa retail Form CAPEX (Store): profit/bulan, payback, ROI.
function hitungAnalisaRetail(data, total) {
  const sales = keRupiahBulat(data && data.sales_tambahan);
  const margin = Number((data && data.margin_persen) || 0);
  const profit = Math.round(sales * (margin / 100));
  const payback = profit > 0 ? +(total / profit).toFixed(1) : null;
  const roi = total > 0 ? +(((profit * 12) / total) * 100).toFixed(1) : null;
  return { sales, margin, profit, payback, roi };
}

// ---------------------------------------------------------------- satu pengajuan
async function ambil(pengajuanId) {
  const p = await db.get(
    `SELECT p.*,
            k.nama AS kategori_nama, k.kode AS kategori_kode, k.kode_dok AS kategori_kode_dok,
            k.grup AS kategori_grup, k.jenis AS kategori_jenis, k.bentuk AS kategori_bentuk,
            c.nama AS cabang_nama, c.kode AS cabang_kode, c.area_id AS cabang_area_id, c.alamat AS cabang_alamat,
            d.nama AS departemen_nama, d.kode AS departemen_kode,
            u.nama AS pemohon_nama, u.jabatan AS pemohon_jabatan
     ${DARI} WHERE p.id = ?`, [pengajuanId]);
  if (!p) return null;

  p.data = bacaJson(p.data_json, {});
  p.items = await db.all('SELECT * FROM pengajuan_item WHERE pengajuan_id = ? ORDER BY urut', [pengajuanId]);
  p.persetujuan = await db.all('SELECT * FROM persetujuan WHERE pengajuan_id = ? ORDER BY urut', [pengajuanId]);
  p.lampiran = await db.all(
    `SELECT l.*, u.nama AS pengunggah_nama FROM lampiran l
     LEFT JOIN pengguna u ON u.id = l.pengunggah_id
     WHERE l.pengajuan_id = ? ORDER BY l.dibuat`, [pengajuanId]);
  p.jejak = await db.all('SELECT * FROM jejak WHERE pengajuan_id = ? ORDER BY waktu, id', [pengajuanId]);

  // kandidat tiap langkah (untuk menampilkan "menunggu: nama-nama")
  const kandidat = await db.all(
    `SELECT kd.persetujuan_id, u.id, u.nama, u.jabatan
     FROM persetujuan_kandidat kd JOIN pengguna u ON u.id = kd.pengguna_id
     WHERE kd.pengajuan_id = ? ORDER BY u.nama`, [pengajuanId]);
  for (const s of p.persetujuan) s.kandidat = kandidat.filter(k => k.persetujuan_id === s.id);

  p.pemohon = await db.get(
    `SELECT u.id, u.nama, u.email, u.peran, u.jabatan, c.nama AS cabang_nama, d.nama AS departemen_nama
     FROM pengguna u LEFT JOIN cabang c ON c.id = u.cabang_id LEFT JOIN departemen d ON d.id = u.departemen_id
     WHERE u.id = ?`, [p.pemohon_id]);
  p.kategori = await db.get('SELECT * FROM kategori WHERE id = ?', [p.kategori_id]);
  p.analisa = hitungAnalisaRetail(p.data, Number(p.total || 0));
  return p;
}

// ---------------------------------------------------------------- ringkasan progres
// Satu kalimat yang menjawab "sudah sampai mana?" untuk satu dokumen, dipakai di
// Daftar Pengajuan dan Dasbor. Ditaruh di sini (bukan di tampilan) supaya kedua
// halaman itu tidak mungkin bercerita berbeda tentang dokumen yang sama.
function ringkasProgres(b) {
  const total = Number(b.jml_tahap || 0);
  const selesai = Number(b.tahap_selesai || 0);
  const persen = total ? Math.round((selesai / total) * 100) : 0;

  if (b.status === 'draft') {
    return { persen: 0, teks: 'Belum diajukan', rinci: 'masih bisa diubah pemohon', warna: 'abu' };
  }
  if (b.status === 'revisi') {
    return {
      persen, warna: 'oranye',
      teks: 'Dikembalikan ke pemohon',
      rinci: b.tahap_revisi ? 'oleh ' + b.tahap_revisi : 'menunggu perbaikan',
    };
  }
  if (b.status === 'ditolak') {
    return {
      persen, warna: 'merah',
      teks: 'Ditolak',
      rinci: b.tahap_ditolak ? 'di tahap ' + b.tahap_ditolak : 'dihentikan',
    };
  }
  if (b.status === 'dibatalkan') {
    return { persen: 0, teks: 'Dibatalkan', rinci: 'dihentikan pemohon', warna: 'abu' };
  }
  if (b.status === 'disetujui') {
    return {
      persen: 100, warna: 'hijau',
      teks: 'Selesai — disetujui',
      rinci: total + ' dari ' + total + ' tahap',
    };
  }
  // menunggu
  return {
    persen, warna: 'kuning',
    teks: 'Tahap ' + Number(b.langkah_kini || 0) + ' dari ' + total,
    rinci: b.tahap_label ? 'menunggu ' + b.tahap_label : 'menunggu penyetuju',
  };
}

// Langkah yang sedang menunggu keputusan.
function langkahAktif(p) {
  return (p.persetujuan || []).find(s => s.urut === p.langkah_kini && s.status === 'menunggu') || null;
}

// Apakah `pengguna` berhak memutuskan langkah yang sedang aktif?
// Sengaja gagal-tertutup: hanya kandidat yang tercatat pada langkah itu yang boleh.
function bolehMemutuskan(p, pengguna) {
  if (p.status !== 'menunggu') return false;
  const s = langkahAktif(p);
  if (!s) return false;
  return (s.kandidat || []).some(k => k.id === pengguna.id);
}

// Peran yang boleh melihat SELURUH dokumen, bukan hanya yang menyangkut dirinya.
// Daftarnya sengaja pendek: tiap nama di sini adalah orang yang bisa membaca
// nominal dan keputusan seluruh perusahaan.
//
// Regional Manager masuk karena kini dialah penyetuju pada semua rantai store
// (menggantikan Brand Manager, 31 Jul 2026). `brand_manager` DIKELUARKAN pada
// tanggal yang sama — peran yang tidak lagi menyetujui apa pun tidak punya
// alasan membaca semuanya.
const PERAN_LIHAT_SEMUA = ['admin', 'accounting', 'ceo'];

// Regional Manager & Brand Manager: seluruh dokumen SISI STORE, bukan seluruh
// perusahaan. Urusan mereka Store Manager dan Area Manager; belanja Kantor
// Pusat (HC, Marketing, Accounting) bukan wilayahnya. Brand Manager tidak lagi
// menyetujui apa pun sejak 31 Jul 2026, tapi tetap perlu melihat sisi store.
const PERAN_LIHAT_STORE = ['regional_manager', 'brand_manager'];

// SATU sumber aturan siapa boleh melihat apa. Dipakai daftar, ringkasan dasbor,
// dan rekap kategori sekaligus - kalau ditulis ulang di tiap tempat, cepat atau
// lambat salah satunya ketinggalan dan bocor tanpa ada yang sadar.
// Tabel pengajuan HARUS dialiaskan sebagai `p`.
function syaratLihat(pengguna) {
  if (!pengguna || PERAN_LIHAT_SEMUA.includes(pengguna.peran)) return null;

  const kandidat = `EXISTS (SELECT 1 FROM persetujuan_kandidat kd
                            WHERE kd.pengajuan_id = p.id AND kd.pengguna_id = ?)`;

  if (PERAN_LIHAT_STORE.includes(pengguna.peran)) {
    return { sql: `(p.wilayah = 'store' OR p.pemohon_id = ? OR ${kandidat})`,
      params: [pengguna.id, pengguna.id] };
  }
  if (pengguna.peran === 'area_manager' && pengguna.area_id) {
    return { sql: `(p.pemohon_id = ? OR p.cabang_id IN (SELECT id FROM cabang WHERE area_id = ?) OR ${kandidat})`,
      params: [pengguna.id, pengguna.area_id, pengguna.id] };
  }
  // Gagal-tertutup: siapa pun yang tidak disebut di atas hanya melihat dokumen
  // miliknya sendiri, plus dokumen yang ia memang calon penyetujunya.
  return { sql: `(p.pemohon_id = ? OR ${kandidat})`, params: [pengguna.id, pengguna.id] };
}

function bolehMelihat(p, pengguna) {
  if (PERAN_LIHAT_SEMUA.includes(pengguna.peran)) return true;
  if (PERAN_LIHAT_STORE.includes(pengguna.peran) && p.wilayah === 'store') return true;
  if (p.pemohon_id === pengguna.id) return true;
  // siapa pun yang pernah/akan jadi penyetuju dokumen ini
  const semuaKandidat = (p.persetujuan || []).flatMap(s => s.kandidat || []);
  if (semuaKandidat.some(k => k.id === pengguna.id)) return true;
  if ((p.persetujuan || []).some(s => s.aktor_id === pengguna.id)) return true;
  // Area Manager boleh melihat dokumen cabang di areanya
  if (pengguna.peran === 'area_manager' && pengguna.area_id && p.cabang_area_id === pengguna.area_id) return true;
  return false;
}

// Keterangan tahap SESUDAH tahap yang sedang berjalan — dipakai layar keputusan
// untuk menawarkan pilihan "lewati tahap berikutnya", lengkap dengan alasan
// kenapa boleh atau tidak boleh dilewati.
async function tahapBerikutnya(p) {
  const s = langkahAktif(p);
  if (!s) return null;
  const semua = p.persetujuan || [];
  const berikut = semua
    .filter(x => x.urut > s.urut && x.status === 'menunggu')
    .sort((a, b) => a.urut - b.urut)[0];
  if (!berikut) return null;

  const alur = require('./alur');
  const halangan = alur.alasanTakBolehLewat(berikut, semua);

  // Keadaan orangnya hanya KETERANGAN untuk penyetuju — keputusannya tetap di
  // tangan dia. Dibedakan dua hal, karena bobotnya berbeda:
  //
  //   sedangCuti     — dia cuti, tapi menyatakan masih bisa menyetujui.
  //   menyatakanTakBisa — dia sendiri menyatakan tidak sanggup. Inilah yang
  //                    dimaksud "orang sebelumnya memastikan": pernyataan itu
  //                    ditampilkan di sini, dan penyetuju inilah yang mengesahkan.
  const cuti = require('./cuti');
  const hariIni = cuti.tanggalWib();
  const idKandidat = (berikut.kandidat || []).map(k => k.id);
  let sedangCuti = [], menyatakanTakBisa = [];
  if (idKandidat.length) {
    const tanda = idKandidat.map(() => '?').join(',');
    const orang = await db.all(
      `SELECT nama, cuti_mulai, cuti_selesai, cuti_alasan, cuti_approve
       FROM pengguna WHERE id IN (${tanda})`, idKandidat);
    for (const u of orang) {
      if (!cuti.sedangCuti(u, hariIni)) continue;
      const teks = `${u.nama} — ${cuti.keteranganCuti(u)}`;
      if (cuti.menyatakanTakBisa(u, hariIni)) menyatakanTakBisa.push(teks);
      else sedangCuti.push(teks);
    }
  }

  return {
    urut: berikut.urut,
    label: berikut.label,
    peran: berikut.peran,
    orang: (berikut.kandidat || []).map(k => k.nama).join(', '),
    bolehDilewati: !halangan,
    alasanTakBoleh: halangan,
    sedangCuti,
    menyatakanTakBisa,
  };
}

function bolehMengubah(p, pengguna) {
  const miliknya = p.pemohon_id === pengguna.id || pengguna.peran === 'admin';
  return miliknya && ['draft', 'revisi'].includes(p.status);
}

// ---------------------------------------------------------------- daftar & saringan
async function daftar(f = {}) {
  const syarat = [];
  const params = [];
  if (f.status) { syarat.push('p.status = ?'); params.push(f.status); }
  if (f.kategori_id) { syarat.push('p.kategori_id = ?'); params.push(f.kategori_id); }
  if (f.cabang_id) { syarat.push('p.cabang_id = ?'); params.push(f.cabang_id); }
  if (f.pemohon_id) { syarat.push('p.pemohon_id = ?'); params.push(f.pemohon_id); }
  if (f.jenis) { syarat.push('k.jenis = ?'); params.push(f.jenis); }
  if (f.dari) { syarat.push('p.dibuat >= ?'); params.push(f.dari); }
  if (f.sampai) { syarat.push('p.dibuat <= ?'); params.push(f.sampai); }
  // Batas atas eksklusif — dipakai saringan bulan/tahun supaya dokumen yang dibuat
  // tepat pada detik pertama bulan berikutnya tidak ikut terhitung dua kali.
  if (f.sebelum) { syarat.push('p.dibuat < ?'); params.push(f.sebelum); }
  if (f.cari) {
    syarat.push('(LOWER(p.judul) LIKE ? OR LOWER(p.nomor) LIKE ? OR LOWER(u.nama) LIKE ?)');
    const q = '%' + String(f.cari).toLowerCase() + '%';
    params.push(q, q, q);
  }
  // Pembatasan tampilan menurut peran — aturannya di syaratLihat(), satu tempat
  // untuk daftar, dasbor, dan rekap sekaligus.
  const batasLihat = syaratLihat(f.pengguna);
  if (batasLihat) { syarat.push(batasLihat.sql); params.push(...batasLihat.params); }
  const where = syarat.length ? 'WHERE ' + syarat.join(' AND ') : '';
  // Dijaga supaya SELALU bilangan bulat wajar. Nilainya disisipkan langsung ke
  // SQL (LIMIT/OFFSET tidak menerima placeholder di semua mesin), jadi angka
  // yang bukan angka harus dibuang di sini. '?mulai=abc' sebelumnya menghasilkan
  // OFFSET NaN dan menggagalkan seluruh halaman.
  const bulat = (v, bawaan, maks) => {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n < 0) return bawaan;
    return maks === undefined ? n : Math.min(n, maks);
  };
  const batas = bulat(f.batas, 100, 2000);
  const mulai = bulat(f.mulai, 0);

  const baris = await db.all(
    `SELECT ${PILIH_RINGKAS} ${DARI} ${where} ORDER BY p.dibuat DESC LIMIT ${batas} OFFSET ${mulai}`, params);
  const jml = await db.nilai(`SELECT COUNT(*) AS n ${DARI} ${where}`, params);
  return { baris, jumlah: Number(jml || 0), batas, mulai };
}

// Kotak masuk approval: dokumen yang MENUNGGU keputusan pengguna ini sekarang.
async function kotakMasuk(penggunaId) {
  return db.all(
    `SELECT ${PILIH_RINGKAS}, s.urut AS langkah_urut, s.label AS langkah_label, s.peran AS langkah_peran
     ${DARI}
     JOIN persetujuan s ON s.pengajuan_id = p.id AND s.urut = p.langkah_kini AND s.status = 'menunggu'
     JOIN persetujuan_kandidat kd ON kd.persetujuan_id = s.id AND kd.pengguna_id = ?
     WHERE p.status = 'menunggu'
     ORDER BY p.diajukan`, [penggunaId]);
}

async function jumlahKotakMasuk(penggunaId) {
  const n = await db.nilai(
    `SELECT COUNT(*) AS n FROM pengajuan p
     JOIN persetujuan s ON s.pengajuan_id = p.id AND s.urut = p.langkah_kini AND s.status = 'menunggu'
     JOIN persetujuan_kandidat kd ON kd.persetujuan_id = s.id AND kd.pengguna_id = ?
     WHERE p.status = 'menunggu'`, [penggunaId]);
  return Number(n || 0);
}

// Tahun yang benar-benar ada isinya, untuk mengisi pilihan saringan.
// Tahun berjalan selalu ikut walau belum ada dokumennya.
async function tahunTersedia() {
  const baris = await db.all(
    'SELECT DISTINCT substr(dibuat, 1, 4) AS tahun FROM pengajuan ORDER BY tahun DESC');
  const daftarTahun = baris.map(b => String(b.tahun)).filter(t => /^\d{4}$/.test(t));
  const ini = String(new Date().getFullYear());
  if (!daftarTahun.includes(ini)) daftarTahun.unshift(ini);
  return daftarTahun.sort().reverse();
}

// Rentang tanggal untuk satu bulan/tahun, dihitung dari waktu SETEMPAT lalu
// diubah ke UTC — kolom `dibuat` menyimpan ISO UTC, jadi kalau dibandingkan
// mentah-mentah dokumen sore hari bisa terhitung masuk bulan sebelumnya.
function rentangPeriode(tahun, bulan) {
  const t = Number(tahun);
  if (!t) return null;
  const b = Number(bulan) || null;
  const mulai = b ? new Date(t, b - 1, 1) : new Date(t, 0, 1);
  const akhir = b ? new Date(t, b, 1) : new Date(t + 1, 0, 1);
  return { dari: mulai.toISOString(), sebelum: akhir.toISOString() };
}

// ---------------------------------------------------------------- angka ringkasan
async function ringkasan(pengguna) {
  const awalBulan = new Date();
  awalBulan.setDate(1); awalBulan.setHours(0, 0, 0, 0);
  const sejak = awalBulan.toISOString();

  const punyaSaya = await db.get(
    `SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS jml FROM pengajuan WHERE pemohon_id = ?`, [pengguna.id]);
  const menungguSaya = await jumlahKotakMasuk(pengguna.id);

  // Angka di bawah ini DIBATASI menurut peran. Sebelumnya tidak: setiap orang,
  // termasuk Store Manager satu cabang, melihat total belanja disetujui dan
  // yang sedang berjalan SE-PERUSAHAAN. Dasbor bocor lebih halus daripada
  // daftar dokumen - tidak ada nama yang tampak, hanya nominal, jadi tidak ada
  // yang merasa ada yang salah.
  const batas = syaratLihat(pengguna);
  const dan = batas ? ' AND ' + batas.sql : '';
  const pb = batas ? batas.params : [];

  const bulanIni = await db.get(
    `SELECT COUNT(*) AS n, COALESCE(SUM(p.total),0) AS jml FROM pengajuan p
     WHERE p.status = 'disetujui' AND p.ditutup >= ?${dan}`, [sejak, ...pb]);
  const berjalan = await db.get(
    `SELECT COUNT(*) AS n, COALESCE(SUM(p.total),0) AS jml FROM pengajuan p
     WHERE p.status = 'menunggu'${dan}`, pb);
  return {
    punyaSaya: Number(punyaSaya.n || 0),
    nilaiPunyaSaya: Number(punyaSaya.jml || 0),
    menungguSaya,
    disetujuiBulanIni: Number(bulanIni.n || 0),
    nilaiDisetujuiBulanIni: Number(bulanIni.jml || 0),
    sedangBerjalan: Number(berjalan.n || 0),
    nilaiSedangBerjalan: Number(berjalan.jml || 0),
  };
}

// Rekap per kategori untuk grafik batang sederhana di dasbor.
async function rekapKategori(pengguna) {
  const sejak = new Date(Date.now() - 180 * 86400000).toISOString();
  const batas = syaratLihat(pengguna);
  const dan = batas ? ' AND ' + batas.sql : '';
  return db.all(
    `SELECT k.nama, k.grup, COUNT(*) AS n, COALESCE(SUM(p.total),0) AS jml
     FROM pengajuan p JOIN kategori k ON k.id = p.kategori_id
     WHERE p.status <> 'draft' AND p.dibuat >= ?${dan}
     GROUP BY k.nama, k.grup ORDER BY jml DESC`, [sejak, ...(batas ? batas.params : [])]);
}

module.exports = {
  ambil, daftar, kotakMasuk, jumlahKotakMasuk, ringkasan, rekapKategori,
  tahunTersedia, rentangPeriode, ringkasProgres,
  hitungTotal, hitungAnalisaRetail, langkahAktif, tahapBerikutnya, bolehMemutuskan, bolehMelihat, bolehMengubah,
};
