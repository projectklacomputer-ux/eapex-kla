// ============================================================================
//  Pengingat harian approval — setiap hari pukul 10.00 WIB
// ============================================================================
// Approval jarang mati karena ditolak. Matinya karena dilupakan: dokumen masuk
// hari Jumat, penyetujunya tidak membuka aplikasi, dan tidak ada apa pun yang
// mengingatkan. Modul ini yang mengingatkan.
//
// Empat hal yang dipegang:
//
//  1. SEKALI SEHARI, TITIK. Tanggal jalan terakhir dicatat di tabel `pengaturan`,
//     jadi server yang menyala-mati berkali-kali atau dua contoh yang berjalan
//     bersamaan tidak membuat orang menerima pengingat berulang.
//  2. HANYA KE ORANG YANG PUNYA TUNGGAKAN. Pengingat yang dikirim ke semua orang
//     akan diabaikan semua orang.
//  3. TIDAK MENAMBAH LONCENG DI DALAM APLIKASI. Notifikasi dokumennya sudah ada
//     sejak dokumen diajukan; pengingat ini menyusulnya lewat HP dan email.
//  4. DOKUMEN TERSENDAT DILAPORKAN KE ADMIN. Kalau sebuah tahap tidak punya satu
//     pun penyetuju yang bisa bertindak (semua cuti, atau perannya kosong),
//     tidak ada gunanya mengingatkan siapa-siapa — yang perlu tahu justru
//     Administrator, supaya ada manusia yang membereskannya.
const db = require('./db');
const notif = require('./notifikasi');
const cuti = require('./cuti');
const { rp, sekarang, selisihHari } = require('./util');

const KUNCI_TERAKHIR = 'pengingat_harian_terakhir';
const JAM_KIRIM = () => {
  const j = Number(process.env.JAM_PENGINGAT);
  return Number.isInteger(j) && j >= 0 && j <= 23 ? j : 10;
};

// --------------------------------------------------------------- kumpulkan
// Siapa menunggak apa. Satu baris per (penyetuju, dokumen) pada tahap yang
// sedang berjalan — bukan seluruh dokumen yang pernah menyentuh dirinya.
async function tunggakan() {
  const hariIni = cuti.tanggalWib();
  return db.all(
    `SELECT u.id AS pengguna_id, u.nama AS pengguna_nama,
            p.id AS pengajuan_id, p.nomor, p.judul, p.total, p.diajukan,
            s.label AS tahap_label
     FROM pengajuan p
     JOIN persetujuan s ON s.pengajuan_id = p.id AND s.urut = p.langkah_kini AND s.status = 'menunggu'
     JOIN persetujuan_kandidat k ON k.persetujuan_id = s.id
     JOIN pengguna u ON u.id = k.pengguna_id AND u.aktif = 1
     WHERE p.status = 'menunggu'
       AND (u.cuti_mulai IS NULL OR u.cuti_selesai IS NULL
            OR ? < u.cuti_mulai OR ? > u.cuti_selesai
            OR COALESCE(u.cuti_approve, 'tetap') = 'tetap')
     ORDER BY u.nama, p.diajukan`, [hariIni, hariIni]);
}

// Draft yang ditinggalkan. Bukan sekadar berantakan - draft menyandera hal yang
// mahal: lampirannya ikut tersimpan DI DALAM basis data (SIMPANAN=db, wajib di
// hosting yang cakramnya hilang tiap penyebaran), dalam bentuk base64 yang
// membengkak sekitar sepertiga. Satu draft berisi beberapa foto penawaran bisa
// memakan puluhan megabyte, dan tidak ada apa pun yang membebaskannya kembali.
//
// Draft juga TIDAK punya nomor dokumen - nomor baru diberikan saat diajukan -
// jadi meninggalkannya tidak membuat lubang pada urutan nomor. Yang terbuang
// hanya ruang dan perhatian.
const HARI_DRAFT = () => {
  const n = Number(process.env.DRAFT_HARI_INGAT);
  return Number.isInteger(n) && n >= 1 ? n : 2;
};

async function draftTerbengkalai() {
  const batas = new Date(Date.now() - HARI_DRAFT() * 24 * 3600 * 1000).toISOString();
  return db.all(
    `SELECT u.id AS pengguna_id, u.nama AS pengguna_nama,
            p.id AS pengajuan_id, p.judul, p.total, p.diperbarui,
            (SELECT COUNT(*) FROM lampiran l WHERE l.pengajuan_id = p.id) AS jml_lampiran
     FROM pengajuan p
     JOIN pengguna u ON u.id = p.pemohon_id AND u.aktif = 1
     WHERE p.status = 'draft' AND p.diperbarui < ?
     ORDER BY u.nama, p.diperbarui`, [batas]);
}

function susunPesanDraft(dokumen) {
  const baris = dokumen.slice(0, 10).map(d => {
    const umur = selisihHari(d.diperbarui, sekarang());
    const berkas = Number(d.jml_lampiran) ? `, ${d.jml_lampiran} lampiran` : '';
    return `• ${d.judul || '(tanpa perihal)'} (${rp(d.total)}) — didiamkan ${umur} hari${berkas}`;
  });
  if (dokumen.length > 10) baris.push(`• …dan ${dokumen.length - 10} draft lain`);
  baris.push('');
  baris.push('Draft belum sampai ke siapa pun dan belum punya nomor dokumen.');
  baris.push('Selesaikan lalu ajukan, atau hapus supaya tidak menumpuk.');
  return baris.join('\n');
}

function kelompokkan(baris) {
  const peta = new Map();
  for (const b of baris) {
    if (!peta.has(b.pengguna_id)) peta.set(b.pengguna_id, { nama: b.pengguna_nama, dokumen: [] });
    peta.get(b.pengguna_id).dokumen.push(b);
  }
  return peta;
}

function susunPesan(dokumen) {
  const baris = dokumen.slice(0, 10).map(d => {
    const umur = selisihHari(d.diajukan, sekarang());
    const lama = umur >= 1 ? ` — sudah ${umur} hari` : '';
    return `• ${d.nomor} — ${d.judul} (${rp(d.total)})${lama}`;
  });
  if (dokumen.length > 10) baris.push(`• …dan ${dokumen.length - 10} dokumen lain`);
  return baris.join('\n');
}

// --------------------------------------------------------------- jalankan
// `paksa` melewati penjaga sekali-sehari — dipakai tombol uji di menu Admin dan
// oleh pengujian, TIDAK oleh penjadwal.
async function jalankan({ paksa = false } = {}) {
  const hariIni = cuti.tanggalWib();

  if (!paksa) {
    const terakhir = await db.get('SELECT nilai FROM pengaturan WHERE kunci = ?', [KUNCI_TERAKHIR]);
    if (terakhir && terakhir.nilai === hariIni) {
      return { dijalankan: false, alasan: 'sudah dikirim hari ini', tanggal: hariIni };
    }
    // Ditandai LEBIH DULU, sebelum satu pun pesan dikirim. Kalau ditandai
    // belakangan, penjadwal yang terpicu dua kali berbarengan akan mengirim dua
    // kali sebelum tanda sempat tertulis.
    await db.run(
      `INSERT INTO pengaturan (kunci, nilai) VALUES (?, ?)
       ON CONFLICT (kunci) DO UPDATE SET nilai = excluded.nilai`, [KUNCI_TERAKHIR, hariIni]);
  }

  const peta = kelompokkan(await tunggakan());
  for (const [penggunaId, isi] of peta) {
    const n = isi.dokumen.length;
    notif.keLuar([penggunaId], {
      judul: `${n} approval menunggu keputusan Anda`,
      pesan: susunPesan(isi.dokumen),
      url: '/approval',
      tag: 'pengingat-harian',
    });
  }

  // --- draft yang didiamkan: ingatkan pemiliknya sendiri, bukan penyetuju.
  // Tidak ada orang lain yang bisa berbuat apa-apa atas draft orang.
  const petaDraft = kelompokkan(await draftTerbengkalai());
  for (const [penggunaId, isi] of petaDraft) {
    const n = isi.dokumen.length;
    const kabar = {
      judul: n === 1 ? 'Ada draft yang belum Anda ajukan' : `${n} draft belum Anda ajukan`,
      pesan: susunPesanDraft(isi.dokumen),
      url: '/pengajuan?status=draft',
      tag: 'pengingat-draft',
    };
    // Draft DIBERI lonceng di dalam aplikasi juga - berbeda dari pengingat
    // approval di atas. Alasannya: dokumen yang sudah diajukan sudah punya
    // notifikasi sejak awal, sedangkan draft tidak pernah memberitahu siapa pun.
    // Kalau hanya lewat HP dan email, orang yang belum memasang aplikasi dan
    // belum mengisi alamat email tidak akan pernah tahu - dan justru merekalah
    // yang paling mungkin meninggalkan draft.
    await notif.simpan(null, { pengguna_id: penggunaId, judul: kabar.judul, pesan: kabar.pesan });
    notif.keLuar([penggunaId], kabar);
  }

  // --- dokumen yang tidak bisa maju: laporkan ke Administrator
  const tersendat = await cuti.dokumenTersendat();
  if (tersendat.length) {
    const admin = await db.all("SELECT id FROM pengguna WHERE peran = 'admin' AND aktif = 1");
    if (admin.length) {
      const pesan = tersendat.slice(0, 10)
        .map(d => `• ${d.nomor} — ${d.judul}, tertahan di ${d.tahap_label}`).join('\n');
      notif.keLuar(admin.map(a => a.id), {
        judul: `${tersendat.length} dokumen tertahan tanpa penyetuju`,
        pesan: pesan + '\n\nPenyetujunya sedang berhalangan atau perannya belum ada pemegangnya. '
          + 'Tunjuk pengganti supaya dokumen ini bisa jalan lagi.',
        url: '/pengajuan?status=menunggu',
        tag: 'pengingat-tersendat',
      });
    }
  }

  const ringkas = {
    dijalankan: true,
    tanggal: hariIni,
    penerima: peta.size,
    dokumen: [...peta.values()].reduce((n, x) => n + x.dokumen.length, 0),
    draftPenerima: petaDraft.size,
    draft: [...petaDraft.values()].reduce((n, x) => n + x.dokumen.length, 0),
    tersendat: tersendat.length,
  };
  console.log('[pengingat]', JSON.stringify(ringkas));
  return ringkas;
}

// --------------------------------------------------------------- penjadwal
// Untuk server yang hidup terus (VPS / komputer sendiri). Di hosting tanpa server
// tetap tidak ada proses yang bertahan — pakai penjadwal bawaan platformnya yang
// memanggil POST /api/pengingat (lihat vercel.json).
//
// Sengaja TIDAK memakai "setTimeout sampai jam 10 lalu ulang tiap 24 jam": jam
// yang dihitung sekali akan meleset setelah komputer tidur atau jam sistem digeser.
// Diperiksa tiap menit, dan penjaga sekali-sehari yang memastikan tidak dobel.
function mulaiPenjadwal() {
  const jam = JAM_KIRIM();
  const zona = process.env.ZONA_WAKTU || 'Asia/Jakarta';
  const jamSetempat = () => Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: zona, hour: '2-digit', hour12: false,
  }).format(new Date()));

  const periksa = async () => {
    try {
      if (jamSetempat() !== jam) return;
      await jalankan();
    } catch (e) {
      console.warn('[pengingat] gagal:', e.message);
    }
  };

  const timer = setInterval(periksa, 60 * 1000);
  if (timer.unref) timer.unref();
  periksa();          // kalau server dinyalakan tepat pada jamnya
  return timer;
}

module.exports = { jalankan, tunggakan, mulaiPenjadwal, KUNCI_TERAKHIR, JAM_KIRIM };
