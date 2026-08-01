// ============================================================================
//  Tempat menyimpan isi berkas lampiran
// ============================================================================
// Ada dua pilihan, disetel lewat env `SIMPANAN`:
//
//   disk  (bawaan) — berkas ada di folder data/lampiran. Cocok untuk komputer
//                    sendiri atau server dengan cakram tetap (VPS).
//   db             — isi berkas disimpan di dalam basis data. WAJIB dipakai bila
//                    aplikasi di-hosting di tempat yang cakramnya hilang tiap
//                    penyebaran (Vercel, Cloud Run, dan sejenisnya). Tanpa ini,
//                    lampiran approval bulan lalu menguap tanpa pemberitahuan.
//
// Isi berkas disimpan sebagai TEKS base64, bukan tipe biner. Alasannya kejelasan:
// BLOB (SQLite) dan BYTEA (PostgreSQL) tidak punya nama tipe yang sama dan cara
// pengikatan parameternya berbeda di dua pustaka yang dipakai aplikasi ini.
// Ongkosnya ruang 33% lebih besar; imbalannya satu jalur kode untuk dua mesin.
const fs = require('fs');
const db = require('./db');
const { jalurBerkas, hapusBerkas: hapusDariDisk } = require('./unggah');

const MODE = () => (process.env.SIMPANAN || 'disk').toLowerCase();
const diDb = () => MODE() === 'db';

let siapDipakai = false;

// Tabel dibuat saat pertama kali dibutuhkan, bukan di DDL utama: pemakai mode
// "disk" tidak perlu punya tabel yang tidak akan pernah diisi.
async function siapkan() {
  if (siapDipakai || !diDb()) return;
  await db.run(`CREATE TABLE IF NOT EXISTS lampiran_isi (
    nama_simpan TEXT PRIMARY KEY,
    isi_base64 TEXT NOT NULL,
    dibuat TEXT NOT NULL
  )`);
  siapDipakai = true;
}

// Dipanggil sesudah multer menulis berkas ke cakram. Pada mode "db" isinya
// dipindahkan ke basis data lalu berkas sementaranya dibuang.
// Dijalankan DI DALAM transaksi yang sama dengan penyimpanan dokumen bila ada
// (parameter `ops`), supaya tidak ada lampiran tanpa dokumen atau sebaliknya.
async function pindahkan(namaSimpan, ops) {
  if (!diDb()) return;
  await siapkan();
  const isi = fs.readFileSync(jalurBerkas(namaSimpan));
  const jalankan = ops || db;
  await jalankan.run(
    'INSERT INTO lampiran_isi (nama_simpan, isi_base64, dibuat) VALUES (?,?,?)',
    [namaSimpan, isi.toString('base64'), new Date().toISOString()]);
  hapusDariDisk(namaSimpan);
}

// Mengembalikan Buffer, atau null bila berkasnya memang sudah tidak ada.
async function ambil(namaSimpan) {
  if (diDb()) {
    await siapkan();
    const b = await db.get('SELECT isi_base64 FROM lampiran_isi WHERE nama_simpan = ?', [namaSimpan]);
    return b ? Buffer.from(b.isi_base64, 'base64') : null;
  }
  const jalur = jalurBerkas(namaSimpan);
  if (!fs.existsSync(jalur)) return null;
  return fs.readFileSync(jalur);
}

async function hapus(namaSimpan) {
  if (diDb()) {
    await siapkan();
    await db.run('DELETE FROM lampiran_isi WHERE nama_simpan = ?', [namaSimpan]);
  }
  // Tetap dicoba di cakram: berkas mungkin tertinggal dari masa sebelum pindah mode.
  hapusDariDisk(namaSimpan);
}

// Dipakai halaman kesiapan produksi untuk memberi tahu bahwa mode "disk" pada
// hosting tanpa cakram tetap akan kehilangan lampiran.
function keterangan() {
  return { mode: MODE(), tahanDeploy: diDb() };
}

module.exports = { pindahkan, ambil, hapus, siapkan, keterangan, diDb };
