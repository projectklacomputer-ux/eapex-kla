// ============================================================================
//  Penomoran dokumen
// ============================================================================
// Bentuk: 0001/CEA/KLA/SBYM/07/2026
//         ^urut ^jenis dok    ^unit ^bulan ^tahun
// Nomor hanya diberikan saat pengajuan DISUBMIT (draft belum punya nomor), supaya
// tidak ada lubang nomor akibat draft yang dibatalkan.
const db = require('./db');

// Ambil nomor urut berikutnya secara atomis (satu pernyataan, tanpa balapan
// antar-permintaan). RETURNING didukung SQLite >= 3.35 dan PostgreSQL.
async function urutBerikutnya(kunci) {
  const baris = await db.get(
    `INSERT INTO nomor_urut (kunci, nilai) VALUES (?, 1)
     ON CONFLICT (kunci) DO UPDATE SET nilai = nomor_urut.nilai + 1
     RETURNING nilai`, [kunci]);
  return Number(baris.nilai);
}

function kodeUnit(cabang, departemen) {
  if (cabang && cabang.tipe === 'store') return cabang.kode;
  if (departemen) return 'HO-' + departemen.kode;
  if (cabang) return cabang.kode;
  return 'HO';
}

// resetPer: 'tahun' (bawaan) atau 'bulan'
async function buatNomor({ kodeDok, cabang, departemen, tanggal, resetPer }) {
  const d = tanggal ? new Date(tanggal) : new Date();
  const bulan = String(d.getMonth() + 1).padStart(2, '0');
  const tahun = String(d.getFullYear());
  const unit = kodeUnit(cabang, departemen);
  const kunci = (resetPer === 'bulan')
    ? `${kodeDok}|${tahun}|${bulan}`
    : `${kodeDok}|${tahun}`;
  const urut = await urutBerikutnya(kunci);
  return `${String(urut).padStart(4, '0')}/${kodeDok}/KLA/${unit}/${bulan}/${tahun}`;
}

module.exports = { buatNomor, urutBerikutnya, kodeUnit };
