// ============================================================================
//  Cuti penyetuju
// ============================================================================
// Masalah yang diselesaikan: satu Regional Manager memegang tahap kedua SEMUA
// rantai store. Kalau dia cuti seminggu, pengajuan 15 cabang berhenti dan tidak
// ada yang menyadarinya sampai ada yang bertanya.
//
// Tiga keputusan yang perlu diketahui:
//
//  1. CUTI DITANDAI MANUSIA, TIDAK PERNAH DITEBAK SISTEM. Sistem TIDAK boleh
//     menyimpulkan "sudah tiga hari tidak dibuka, berarti cuti" — diam bisa
//     berarti sibuk, ragu, atau sengaja menahan. Melewati penyetuju karena ia
//     lambat sama saja menghapus kontrol tanpa ada yang memutuskan.
//  2. WAJIB ADA TANGGAL SELESAI. Cuti tanpa ujung akan terlupakan dan berubah
//     jadi penyetuju yang dilewati selamanya.
//  3. DILEWATI ITU TERCATAT DI DOKUMEN. Kalau sebuah tahap hilang, alasannya
//     harus terbaca pada dokumennya sendiri — kalau tidak, setahun lagi tidak
//     ada yang bisa memastikan dokumen ini pernah disetujui dengan benar.
const db = require('./db');
const { sekarang, tglSingkat } = require('./util');

// Tanggal disimpan sebagai 'YYYY-MM-DD' (tanggal kalender, bukan momen), jadi
// perbandingannya cukup perbandingan teks — dan tidak bergeser karena zona waktu.
function tanggalWib(saat) {
  const d = saat ? new Date(saat) : new Date();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.ZONA_WAKTU || 'Asia/Jakarta',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

// Cuti dihitung INKLUSIF di kedua ujung: orang yang cuti 1–7 Agustus memang
// tidak masuk pada tanggal 1 maupun tanggal 7.
function sedangCuti(u, hariIni) {
  if (!u || !u.cuti_mulai || !u.cuti_selesai) return false;
  const h = hariIni || tanggalWib();
  return u.cuti_mulai <= h && h <= u.cuti_selesai;
}

// Cuti TIDAK otomatis berarti tahapnya dilewati. Orang cuti sering masih membuka
// HP dan masih bisa menekan tombol setuju; yang menentukan bukan "sedang cuti"
// tapi "sanggup atau tidak menangani pekerjaannya minggu ini".
//
//   tetap     — masih bisa approve seperti biasa (BAWAAN).
//   pengganti — DIALIHKAN ke orang yang ditunjuk. Berlaku otomatis, karena
//               kontrolnya tidak hilang: tetap ada manusia yang memutuskan.
//   lewati    — dia MENYATAKAN tidak bisa menyetujui. Ini BUKAN perintah melewati:
//               tahapnya tidak hilang dengan sendirinya. Pernyataan ini muncul di
//               layar penyetuju SEBELUMNYA, dan dialah yang memastikan lalu
//               memutuskan melewatinya — lengkap dengan alasan tertulis.
//
// Kenapa `lewati` tidak berlaku otomatis: menghapus satu lapis pemeriksaan tidak
// boleh bisa dilakukan sendiri oleh orang yang justru sedang tidak di tempat.
// Harus ada manusia lain yang memastikannya. Hanya ada dua jalan yang sah —
// menunjuk pengganti, atau dipastikan oleh penyetuju sebelumnya.
const MODE_CUTI = {
  tetap: 'Tetap dia yang menyetujui',
  pengganti: 'Dialihkan ke pengganti',
  lewati: 'Menyatakan tidak bisa menyetujui',
};

function modeCuti(u) {
  const m = u && u.cuti_approve;
  return MODE_CUTI[m] ? m : 'tetap';
}

// Approval-nya BENAR-BENAR berpindah tangan — hanya berlaku untuk pengalihan ke
// pengganti. Inilah satu-satunya keadaan yang boleh mengubah rantai dengan
// sendirinya, karena penggantinya tetap manusia yang memutuskan.
function dialihkan(u, hariIni) {
  return sedangCuti(u, hariIni) && modeCuti(u) === 'pengganti';
}

// Dia MENYATAKAN tidak bisa menyetujui. Tidak mengubah apa pun dengan sendirinya;
// hanya ditampilkan kepada penyetuju sebelumnya sebagai bahan pertimbangan.
function menyatakanTakBisa(u, hariIni) {
  return sedangCuti(u, hariIni) && modeCuti(u) === 'lewati';
}

function keteranganCuti(u) {
  if (!u || !u.cuti_mulai) return '';
  const rentang = `${tglSingkat(u.cuti_mulai)}–${tglSingkat(u.cuti_selesai)}`;
  return u.cuti_alasan ? `${u.cuti_alasan} (${rentang})` : `cuti ${rentang}`;
}

// Aturan penulisan yang diperiksa sebelum disimpan.
function periksa({ mulai, selesai }) {
  if (!mulai && !selesai) return null;                    // menghapus cuti
  if (!mulai || !selesai) return 'Tanggal mulai dan selesai harus diisi keduanya';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mulai) || !/^\d{4}-\d{2}-\d{2}$/.test(selesai)) {
    return 'Tanggal tidak sah';
  }
  if (selesai < mulai) return 'Tanggal selesai tidak boleh mendahului tanggal mulai';
  // Batas kewajaran, supaya salah ketik tahun tidak menghilangkan penyetuju bertahun-tahun.
  const hari = (new Date(selesai) - new Date(mulai)) / 86400000;
  if (hari > 180) return 'Cuti lebih dari 180 hari — pakai penonaktifan akun, bukan cuti';
  return null;
}

async function setel(penggunaId, { mulai, selesai, alasan, penggantiId, mode, oleh }) {
  // Tanpa tanggal mulai, catatan cuti dihapus seluruhnya — tombol "Hapus cuti"
  // hanya mengosongkan tanggal mulai, dan sisa isian lama tidak boleh membuat
  // penghapusan itu ditolak sebagai "tanggal tidak lengkap".
  if (!mulai) { mulai = ''; selesai = ''; alasan = ''; penggantiId = null; mode = 'tetap'; }

  const galat = periksa({ mulai, selesai });
  if (galat) throw Object.assign(new Error(galat), { publik: true, kode: 400 });

  const modeDipakai = MODE_CUTI[mode] ? mode : 'tetap';
  if (modeDipakai === 'pengganti' && !penggantiId) {
    throw Object.assign(new Error('Pilih dulu siapa penggantinya, atau ubah menjadi "Tetap dia yang menyetujui".'),
      { publik: true, kode: 400 });
  }
  // Pengganti tidak ada artinya kalau approval-nya tetap dia yang pegang.
  if (modeDipakai !== 'pengganti') penggantiId = null;

  // Pengganti tidak boleh dirinya sendiri, dan harus orang yang aktif.
  let pengganti = null;
  if (penggantiId) {
    if (penggantiId === penggunaId) {
      throw Object.assign(new Error('Pengganti tidak boleh orang yang sama'), { publik: true, kode: 400 });
    }
    pengganti = await db.get('SELECT id FROM pengguna WHERE id = ? AND aktif = 1', [penggantiId]);
    if (!pengganti) throw Object.assign(new Error('Pengganti tidak ditemukan'), { publik: true, kode: 400 });
  }

  await db.run(
    `UPDATE pengguna SET cuti_mulai = ?, cuti_selesai = ?, cuti_alasan = ?, pengganti_id = ?, cuti_approve = ?
     WHERE id = ?`,
    [mulai || null, selesai || null, (alasan || '').slice(0, 200) || null,
      pengganti ? pengganti.id : null, modeDipakai, penggunaId]);

  // Orang yang ditandai cuti WAJIB tahu — apalagi kalau yang menandai orang lain.
  // Ditandai berhalangan berarti tahap approval-nya bisa dilewati; itu tidak boleh
  // terjadi tanpa sepengetahuannya.
  const olehOrangLain = oleh && oleh.id && oleh.id !== penggunaId;
  const notif = require('./notifikasi');
  const isi = mulai
    ? {
      judul: olehOrangLain ? 'Anda ditandai sedang cuti' : 'Cuti Anda tercatat',
      pesan: `${tglSingkat(mulai)} sampai ${tglSingkat(selesai)}`
        + (alasan ? ` — ${alasan}` : '')
        + `. Selama itu: ${MODE_CUTI[modeDipakai]}.`
        + (olehOrangLain ? ` Dicatat oleh ${oleh.nama}.` : '')
        + (modeDipakai === 'lewati'
          ? ' Tahap approval Anda TIDAK otomatis hilang: pernyataan ini ditampilkan kepada penyetuju'
            + ' sebelum Anda, dan dia yang memutuskan melewatinya atau menunggu Anda.'
          : ''),
    }
    : {
      judul: 'Catatan cuti Anda dihapus',
      pesan: 'Approval kembali berjalan seperti biasa.'
        + (olehOrangLain ? ` Dihapus oleh ${oleh.nama}.` : ''),
    };

  try {
    await notif.simpan(null, { pengguna_id: penggunaId, judul: isi.judul, pesan: isi.pesan });
    notif.keLuar([penggunaId], { ...isi, url: '/cuti-saya', tag: 'cuti' });
    if (pengganti) {
      const nama = (await db.get('SELECT nama FROM pengguna WHERE id = ?', [penggunaId])) || {};
      const pesanGanti = `Anda ditunjuk menggantikan ${nama.nama || 'rekan Anda'} `
        + `pada ${tglSingkat(mulai)}–${tglSingkat(selesai)}. Approval yang jatuh ke dia akan masuk ke Anda.`;
      await notif.simpan(null, { pengguna_id: pengganti.id, judul: 'Anda ditunjuk sebagai pengganti', pesan: pesanGanti });
      notif.keLuar([pengganti.id], { judul: 'Anda ditunjuk sebagai pengganti', pesan: pesanGanti, url: '/approval', tag: 'cuti' });
    }
  } catch (e) {
    // Gagal memberi tahu tidak boleh membatalkan pencatatan cutinya.
    console.warn('[cuti] gagal mengirim pemberitahuan:', e.message);
  }
}

// Siapa saja yang sedang cuti hari ini — dipakai halaman Admin dan pengingat harian.
async function yangSedangCuti() {
  const h = tanggalWib();
  return db.all(
    `SELECT u.id, u.nama, u.peran, u.cuti_mulai, u.cuti_selesai, u.cuti_alasan, u.cuti_approve,
            g.nama AS pengganti_nama
     FROM pengguna u
     LEFT JOIN pengguna g ON g.id = u.pengganti_id
     WHERE u.aktif = 1 AND u.cuti_mulai <= ? AND u.cuti_selesai >= ?
     ORDER BY u.nama`, [h, h]);
}

// Dokumen yang tahap berjalannya TIDAK punya satu pun penyetuju yang bisa
// bertindak hari ini. Ini yang harus dilaporkan ke manusia — bukan dilewati
// diam-diam oleh sistem.
async function dokumenTersendat() {
  const h = tanggalWib();
  return db.all(
    `SELECT p.id, p.nomor, p.judul, p.total, p.diajukan, s.label AS tahap_label, s.urut
     FROM pengajuan p
     JOIN persetujuan s ON s.pengajuan_id = p.id AND s.urut = p.langkah_kini AND s.status = 'menunggu'
     WHERE p.status = 'menunggu'
       AND NOT EXISTS (
         SELECT 1 FROM persetujuan_kandidat k
         JOIN pengguna u ON u.id = k.pengguna_id
         WHERE k.persetujuan_id = s.id AND u.aktif = 1
           AND (u.cuti_mulai IS NULL OR u.cuti_selesai IS NULL
                OR ? < u.cuti_mulai OR ? > u.cuti_selesai
            OR COALESCE(u.cuti_approve, 'tetap') = 'tetap'))
     ORDER BY p.diajukan`, [h, h]);
}

module.exports = {
  sedangCuti, dialihkan, menyatakanTakBisa, modeCuti, MODE_CUTI,
  keteranganCuti, periksa, setel, yangSedangCuti, dokumenTersendat, tanggalWib,
};
