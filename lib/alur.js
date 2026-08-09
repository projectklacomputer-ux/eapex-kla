// ============================================================================
//  Mesin alur dokumen (submit → approve berjenjang → selesai)
// ============================================================================
// Semua perubahan status dokumen HANYA lewat berkas ini, supaya tidak ada jalan
// pintas yang melompati pencatatan jejak, notifikasi, atau pemeriksaan wewenang.
const db = require('./db');
const aturanMesin = require('./aturan');
const formulir = require('./formulir');
const notif = require('./notifikasi');
const simpanan = require('./simpanan');
const { buatNomor } = require('./nomor');
const { id, sekarang, rp, bacaJson, namaBerkasAman } = require('./util');
const P = require('./pengajuan');

class GalatAlur extends Error {
  constructor(pesan, kode = 400) { super(pesan); this.kode = kode; this.publik = true; }
}

async function catatJejak(ops, { pengajuan_id, pengguna, aksi, detail, ip }) {
  await (ops || db).run(
    'INSERT INTO jejak (id, pengajuan_id, pengguna_id, nama, aksi, detail, ip, waktu) VALUES (?,?,?,?,?,?,?,?)',
    [id(), pengajuan_id || null, pengguna ? pengguna.id : null, pengguna ? pengguna.nama : 'sistem',
      aksi, detail || null, ip || null, sekarang()]);
}

async function pengaturan(kunci, bawaan) {
  const b = await db.get('SELECT nilai FROM pengaturan WHERE kunci = ?', [kunci]);
  return b ? b.nilai : bawaan;
}

// --------------------------------------------------------------- konteks approver
async function konteksPengajuan(p) {
  const cabang = p.cabang_id ? await db.get('SELECT * FROM cabang WHERE id = ?', [p.cabang_id]) : null;
  const data = p.data || bacaJson(p.data_json, {});
  return {
    pemohon_id: p.pemohon_id,
    cabang_id: p.cabang_id || null,
    area_id: cabang ? cabang.area_id : null,
    departemen_id: p.departemen_id || null,
    area_tujuan_id: data.area_tujuan_id || null,
    cabang,
  };
}

// Pratinjau alur sebelum dikirim (dipakai di halaman detail draft).
async function pratinjauRantai(p) {
  const konteks = await konteksPengajuan(p);
  return aturanMesin.bangunRantai(p.aturan_id, Number(p.total || 0), konteks);
}

// --------------------------------------------------------------- AJUKAN / TERBITKAN
async function ajukan(pengajuanId, pengguna, ip) {
  const p = await P.ambil(pengajuanId);
  if (!p) throw new GalatAlur('Pengajuan tidak ditemukan', 404);
  if (!P.bolehMengubah(p, pengguna)) throw new GalatAlur('Pengajuan ini tidak bisa diajukan lagi', 403);

  // Pemeriksaan isi dijalankan di sini juga — bukan hanya di halaman formulir —
  // supaya draft yang belum lengkap tidak bisa lolos lewat tombol "Ajukan".
  const kurang = formulir.periksa(p.kategori_bentuk, {
    judul: p.judul, data: p.data, items: p.items,
    wilayah: p.wilayah, cabang_id: p.cabang_id, departemen_id: p.departemen_id,
  });
  // Lampiran diperiksa DI SINI, bukan di halaman formulir: draft boleh disimpan
  // apa adanya, yang dikunci hanya saat dokumennya benar-benar diajukan.
  if (Number(p.kategori.lampiran_wajib) === 1 && !(p.lampiran || []).length) {
    kurang.push('Lampiran penawaran/bukti wajib dilampirkan — tanpa itu penyetuju tidak punya apa pun untuk mencocokkan angkanya');
  }

  if (kurang.length) throw new GalatAlur('Dokumen belum lengkap: ' + kurang.join('; '));

  const total = P.hitungTotal(p.kategori_bentuk, p.data, p.items);
  if (total <= 0) throw new GalatAlur('Nominal masih nol — periksa kembali rincian biaya');

  const kategori = p.kategori;
  const departemen = p.departemen_id ? await db.get('SELECT * FROM departemen WHERE id = ?', [p.departemen_id]) : null;
  const resetPer = await pengaturan('reset_nomor', 'tahun');
  const konteks = await konteksPengajuan(p);
  const rantai = await aturanMesin.bangunRantai(p.aturan_id, total, konteks);
  if (!rantai.length) throw new GalatAlur('Aturan approval untuk kategori ini belum diisi. Hubungi Administrator.');

  const macet = aturanMesin.langkahTanpaKandidat(rantai);
  if (macet.length) {
    throw new GalatAlur(
      'Belum ada pengguna aktif untuk peran: ' + macet.map(m => m.label).join(', ') +
      '. Minta Administrator melengkapi data pengguna dulu supaya dokumen tidak menggantung.');
  }

  // Tahap yang penyetujunya sedang cuti dilewati — KECUALI tahap yang memang
  // tidak boleh dilewati (Accounting dan tahap terakhir). Aturannya sama persis
  // dengan pelewatan manual oleh penyetuju sebelumnya.
  const ditahan = batalkanLewatYangTerlarang(rantai);

  // Yang TIDAK boleh terjadi: seluruh tahap dilewati sehingga dokumen langsung
  // sah tanpa satu pun tanda tangan.
  const dilewati = aturanMesin.langkahDilewati(rantai);
  const adaYangMenyetujui = rantai.some(s => !s.dilewatiCuti);
  if (!adaYangMenyetujui) {
    throw new GalatAlur(
      'Seluruh penyetuju pada alur ini sedang cuti, jadi dokumen tidak bisa diajukan sekarang — ' +
      'kalau diteruskan, dokumen ini akan lolos tanpa satu pun persetujuan. ' +
      'Minta Administrator menunjuk pengganti dulu.');
  }

  const nomor = p.nomor || await buatNomor({
    kodeDok: kategori.kode_dok, cabang: konteks.cabang, departemen, resetPer,
  });

  let macetAwal = null;

  await db.tx(async ops => {
    // Rantai selalu dibangun ulang saat submit: nominal bisa berubah setelah revisi,
    // sehingga langkah bersyarat (mis. CEO) harus dihitung ulang dari awal.
    await ops.run('DELETE FROM persetujuan_kandidat WHERE pengajuan_id = ?', [pengajuanId]);
    await ops.run('DELETE FROM persetujuan WHERE pengajuan_id = ?', [pengajuanId]);

    for (const s of rantai) {
      const sid = id();
      await ops.run(
        `INSERT INTO persetujuan (id, pengajuan_id, urut, peran, label, lingkup, min_nominal, maks_nominal,
         status, komentar, waktu)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [sid, pengajuanId, s.urut, s.peran, s.label, s.lingkup, s.min_nominal, s.maks_nominal,
          s.dilewatiCuti ? 'dilewati' : 'menunggu',
          s.dilewatiCuti ? 'Dilewati — penyetuju berhalangan. ' + s.alasanLewat : null,
          s.dilewatiCuti ? sekarang() : null]);
      for (const k of s.kandidat) {
        await ops.run(
          'INSERT INTO persetujuan_kandidat (id, persetujuan_id, pengajuan_id, pengguna_id) VALUES (?,?,?,?)',
          [id(), sid, pengajuanId, k.id]);
      }
    }

    // Dokumen mulai dari tahap PERTAMA YANG BENAR-BENAR PERLU DIPUTUSKAN — bukan
    // selalu tahap 1, karena tahap awal bisa saja dilewati.
    const tahapMulai = rantai.find(s => !s.dilewatiCuti);

    await ops.run(
      `UPDATE pengajuan SET nomor = ?, total = ?, status = 'menunggu', langkah_kini = ?,
       diajukan = ?, diperbarui = ?, ditutup = NULL WHERE id = ?`,
      [nomor, total, tahapMulai.urut, sekarang(), sekarang(), pengajuanId]);

    await catatJejak(ops, {
      pengajuan_id: pengajuanId, pengguna, aksi: 'ajukan', ip,
      detail: `Diajukan. Nomor ${nomor}. Total ${rp(total)}. Alur: ${aturanMesin.ringkasRantai(rantai)}`
        + (dilewati.length
          ? `. DILEWATI: ${dilewati.map(d => d.label + ' (' + d.alasanLewat + ')').join('; ')}`
          : '')
        + (ditahan.length
          ? `. TETAP DIJALANKAN meski penyetujunya berhalangan: ${ditahan.map(d => d.label).join('; ')}`
          : ''),
    });

    // Yang tahapnya dilewati karena cuti WAJIB diberi tahu — sama seperti kalau
    // dilewati oleh keputusan penyetuju sebelumnya. Kalau tidak, dia baru sadar
    // dokumen itu lewat setelah uangnya keluar.
    for (const d of dilewati) {
      await notif.simpanBanyak(ops, (d.kandidatSemua || []).map(k => k.id), {
        pengajuan_id: pengajuanId,
        judul: 'Tahap approval Anda dilewati',
        pesan: `${nomor} — ${p.judul} (${rp(total)}). Dilewati karena Anda tercatat berhalangan: ${d.alasanLewat}`,
      });
    }

    await notif.simpanBanyak(ops, tahapMulai.kandidat.map(k => k.id), {
      pengajuan_id: pengajuanId,
      judul: 'Approval baru menunggu Anda',
      pesan: `${nomor} — ${p.judul} (${rp(total)}) dari ${p.pemohon_nama}`,
    });

    // Tahap pertamanya pun bisa langsung macet — penyetujunya sudah menyatakan
    // tidak bisa sebelum dokumen ini dibuat.
    const barisTahapMulai = await ops.get(
      'SELECT * FROM persetujuan WHERE pengajuan_id = ? AND urut = ?', [pengajuanId, tahapMulai.urut]);
    if (barisTahapMulai) {
      macetAwal = await kabariTahapMacet(ops, {
        pengajuan: { id: pengajuanId, nomor, judul: p.judul },
        tahap: barisTahapMulai,
      });
    }
  });

  const mulai = rantai.find(s => !s.dilewatiCuti);

  // Pengiriman ke luar dilakukan SETELAH transaksi selesai — jaringan yang lambat
  // tidak boleh menahan kunci basis data, dan gagal kirim tidak boleh membatalkan
  // pengajuan yang sudah sah tersimpan.
  notif.keTelegram(
    `<b>EAPEX — approval baru</b>\n${nomor}\n${p.judul}\n${rp(total)}\nPemohon: ${p.pemohon_nama}\n` +
    `Menunggu: ${mulai.label}`).catch(() => {});

  notif.keLuar(mulai.kandidat.map(k => k.id), {
    judul: 'Approval baru menunggu Anda',
    pesan: `${nomor} — ${p.judul} (${rp(total)}) dari ${p.pemohon_nama}`,
    url: '/pengajuan/' + pengajuanId,
    tag: 'approval-' + pengajuanId,
  });

  for (const d of dilewati) {
    notif.keLuar((d.kandidatSemua || []).map(k => k.id), {
      judul: 'Tahap approval Anda dilewati',
      pesan: `${nomor} — ${p.judul} (${rp(total)}). Dilewati karena Anda tercatat berhalangan.`,
      url: '/pengajuan/' + pengajuanId,
      tag: 'lewat-' + pengajuanId,
    });
  }

  // Tahap pertamanya langsung macet: yang harus bertindak diberi tahu SEKARANG,
  // bukan menunggu pengingat besok pagi.
  if (macetAwal) {
    notif.keLuar(macetAwal.orang.map(u => u.id), {
      judul: 'Dokumen menunggu Anda, padahal Anda menyatakan tidak bisa',
      pesan: `${nomor} — ${p.judul}. Tunjuk pengganti lewat menu "Cuti Saya", `
        + 'atau setujui sendiri kalau ternyata sempat.',
      url: '/cuti-saya',
      tag: 'macet-' + pengajuanId,
    });
    notif.keLuar(macetAwal.admin, {
      judul: 'Dokumen tertahan — penyetujunya menyatakan tidak bisa',
      pesan: `${nomor} — ${p.judul}, tertahan di ${macetAwal.tahap.label}. `
        + 'Tunjuk pengganti supaya dokumen ini jalan lagi.',
      url: '/pengajuan/' + pengajuanId,
      tag: 'macet-' + pengajuanId,
    });
  }

  return { nomor, total, rantai, dilewati, macet: macetAwal };
}

// ------------------------------------------------- dokumen mendarat di tahap macet
// Dokumen yang masuk ke tahap yang penyetujunya sudah menyatakan tidak bisa
// menyetujui akan diam di situ. Menunggu pengingat harian besok pagi berarti
// dokumen itu hilang sehari tanpa ada yang tahu.
//
// Yang diberi tahu SEKARANG JUGA, masing-masing dengan hal yang bisa dilakukan:
//
//   - orang yang menyatakan tidak bisa  → "tunjuk pengganti di menu Cuti Saya"
//   - Administrator                     → "tunjuk pengganti untuk dia"
//
// Penyetuju sebelumnya sengaja TIDAK diminta bertindak di sini: dia sudah
// memutuskan dan dokumennya sudah lewat. Kalau dia memang tahu orangnya tidak
// bisa, tempatnya memutuskan tadi — saat menekan setuju.
async function kabariTahapMacet(ops, { pengajuan, tahap }) {
  const cuti = require('./cuti');
  const hariIni = cuti.tanggalWib();
  const kandidat = await (ops || db).all(
    `SELECT u.id, u.nama, u.cuti_mulai, u.cuti_selesai, u.cuti_alasan, u.cuti_approve, u.pengganti_id
     FROM persetujuan_kandidat k JOIN pengguna u ON u.id = k.pengguna_id
     WHERE k.persetujuan_id = ? AND u.aktif = 1`, [tahap.id]);
  if (!kandidat.length) return null;

  // Macet hanya bila SEMUA calonnya menyatakan tidak bisa. Satu orang yang masih
  // sanggup sudah cukup membuat dokumennya jalan.
  const takBisa = kandidat.filter(u => cuti.menyatakanTakBisa(u, hariIni));
  if (takBisa.length !== kandidat.length) return null;

  const sebut = `${pengajuan.nomor} — ${pengajuan.judul}`;
  for (const u of takBisa) {
    await notif.simpan(ops, {
      pengguna_id: u.id, pengajuan_id: pengajuan.id,
      judul: 'Dokumen menunggu Anda, padahal Anda menyatakan tidak bisa',
      pesan: `${sebut}. Tunjuk pengganti lewat menu "Cuti Saya" supaya dokumen ini jalan, `
        + 'atau setujui sendiri kalau ternyata sempat.',
    });
  }
  const admin = await (ops || db).all("SELECT id FROM pengguna WHERE peran = 'admin' AND aktif = 1");
  for (const a of admin) {
    await notif.simpan(ops, {
      pengguna_id: a.id, pengajuan_id: pengajuan.id,
      judul: 'Dokumen tertahan — penyetujunya menyatakan tidak bisa',
      pesan: `${sebut}. Tertahan di ${tahap.label} (${takBisa.map(u => u.nama).join(', ')}). `
        + 'Tunjuk pengganti supaya dokumen ini jalan lagi.',
    });
  }
  return { tahap, orang: takBisa, admin: admin.map(a => a.id) };
}

// --------------------------------------------------------------- KEPUTUSAN
const AKSI = { setuju: 'disetujui', tolak: 'ditolak', revisi: 'revisi' };

// --------------------------------------------------- melewati tahap berikutnya
// Yang paling tahu apakah penyetuju berikutnya bisa dihubungi HARI INI adalah
// orang di tahap sebelumnya — bukan sistem, dan bukan catatan cuti yang mungkin
// belum sempat diisi. Karena itu keputusannya ada di tangan dia, per dokumen.
//
// Tapi ini wewenang menghapus satu lapis pemeriksaan, jadi dibatasi:
//
//   1. Hanya SATU tahap, yaitu tahap tepat berikutnya. Tidak bisa melompat dua.
//   2. Accounting TIDAK bisa dilewati. Matriks aslinya menegaskan berulang kali
//      "nominal berapa pun tetap melalui Accounting untuk verifikasi" — itu bukan
//      tahap persetujuan, itu pemeriksaan.
//   3. Tahap TERAKHIR tidak bisa dilewati. Kalau boleh, sebuah dokumen bisa
//      dinyatakan disetujui penuh tanpa pernah sampai ke pemegang wewenang akhir.
//   4. Alasan WAJIB, tercatat di dokumen dan di jejak audit.
//   5. Yang dilewati tetap diberi tahu bahwa tahapnya dilewati dan oleh siapa.
const PERAN_TAK_BOLEH_DILEWATI = ['accounting'];

// Sebuah tahap masih akan diputuskan orang? Dipakai untuk dua bentuk data yang
// berbeda: baris `persetujuan` yang sudah tersimpan (punya `status`), dan rantai
// yang baru dirakit saat pengajuan (punya `dilewatiCuti`).
function masihDijalankan(x) {
  return x.status ? x.status === 'menunggu' : !x.dilewatiCuti;
}

// SATU sumber aturan untuk kedua jalur pelewatan — lewat cuti maupun lewat
// keputusan penyetuju sebelumnya. Kalau dipisah, cepat atau lambat salah satunya
// akan lebih longgar dari yang lain tanpa ada yang menyadari.
function alasanTakBolehLewat(berikut, semua) {
  if (!berikut) return 'Tidak ada tahap berikutnya yang bisa dilewati';
  if (PERAN_TAK_BOLEH_DILEWATI.includes(berikut.peran)) {
    return `${berikut.label} tidak bisa dilewati — semua nominal wajib melalui verifikasi Accounting`;
  }
  const setelahnya = semua
    .filter(x => x.urut > berikut.urut && masihDijalankan(x))
    .sort((a, b) => a.urut - b.urut)[0];
  if (!setelahnya) {
    return `${berikut.label} adalah tahap terakhir — kalau dilewati, dokumen ini disetujui penuh tanpa pernah sampai ke pemegang wewenang akhir`;
  }
  return null;
}

// Tahap yang ditandai akan dilewati karena penyetujunya cuti, TAPI termasuk tahap
// yang tidak boleh dilewati, dikembalikan jadi tahap berjalan biasa.
//
// Akibatnya dokumen menunggu di situ sampai orangnya kembali atau Administrator
// menunjuk pengganti — dan itu memang yang benar. Dokumen tertahan dan kelihatan
// jauh lebih baik daripada dokumen yang lolos tanpa verifikasi Accounting.
// Pengingat harian melaporkannya ke Administrator sebagai dokumen tersendat.
//
// Ditelusuri dari BELAKANG: apakah sebuah tahap boleh dilewati bergantung pada
// ada-tidaknya tahap sesudahnya, jadi tahap terakhir harus diputuskan lebih dulu.
function batalkanLewatYangTerlarang(rantai) {
  const dibatalkan = [];
  for (let i = rantai.length - 1; i >= 0; i--) {
    const s = rantai[i];
    if (!s.dilewatiCuti) continue;
    const halangan = alasanTakBolehLewat(s, rantai);
    if (!halangan) continue;
    s.dilewatiCuti = false;
    s.tetapJalanMeskiCuti = halangan;
    // Calon yang tadi disaring karena cuti dikembalikan — kalau tidak, tahapnya
    // berjalan tanpa satu pun penyetuju dan dokumen benar-benar buntu.
    if (s.kandidatSemua && s.kandidatSemua.length) s.kandidat = s.kandidatSemua;
    dibatalkan.push(s);
  }
  return dibatalkan;
}

async function putuskan(pengajuanId, pengguna, aksi, komentar, ip, opsi = {}) {
  if (!AKSI[aksi]) throw new GalatAlur('Aksi tidak dikenal');
  const p = await P.ambil(pengajuanId);
  if (!p) throw new GalatAlur('Pengajuan tidak ditemukan', 404);
  if (!P.bolehMemutuskan(p, pengguna)) {
    throw new GalatAlur('Anda bukan penyetuju untuk tahap yang sedang berjalan', 403);
  }
  if ((aksi === 'tolak' || aksi === 'revisi') && !String(komentar || '').trim()) {
    throw new GalatAlur('Alasan wajib diisi saat menolak atau meminta revisi');
  }

  const s = P.langkahAktif(p);
  // Tahap berikutnya = tahap terdekat yang masih MENUNGGU keputusan. Tahap yang
  // sudah ditandai 'dilewati' (penyetujunya cuti) dilompati, bukan ditunggu —
  // kalau tidak, dokumen berhenti di tahap yang memang sengaja dikosongkan.
  let berikut = (p.persetujuan || [])
    .filter(x => x.urut > s.urut && x.status === 'menunggu')
    .sort((a, b) => a.urut - b.urut)[0] || null;
  const waktu = sekarang();
  const catatan = String(komentar || '').trim().slice(0, 2000) || null;

  // --- permintaan melewati tahap berikutnya
  const mintaLewat = aksi === 'setuju' && !!opsi.lewatiBerikut;
  const alasanLewat = String(opsi.alasanLewat || '').trim().slice(0, 500);
  let dilewati = null;
  if (mintaLewat) {
    const halangan = alasanTakBolehLewat(berikut, p.persetujuan || []);
    if (halangan) throw new GalatAlur(halangan);
    if (!alasanLewat) {
      throw new GalatAlur(`Tulis dulu kenapa ${berikut.label} dilewati — alasannya ikut tercatat di dokumen ini`);
    }
    dilewati = berikut;
    berikut = (p.persetujuan || [])
      .filter(x => x.urut > dilewati.urut && x.status === 'menunggu')
      .sort((a, b) => a.urut - b.urut)[0];
  }

  let tujuanPush = [];      // diisi di dalam transaksi, dikirim setelah transaksi selesai
  let tujuanDilewati = [];
  let macet = null;             // tahap berikutnya ternyata tidak ada yang bisa menyetujui

  await db.tx(async ops => {
    await ops.run(
      `UPDATE persetujuan SET status = ?, aktor_id = ?, aktor_nama = ?, aktor_jabatan = ?, komentar = ?, waktu = ?
       WHERE id = ?`,
      [AKSI[aksi], pengguna.id, pengguna.nama, pengguna.jabatan || null, catatan, waktu, s.id]);

    // Tahap yang dilewati ditandai lengkap dengan SIAPA yang memutuskan dan
    // kenapa. Tanpa itu, setahun lagi tidak ada yang bisa menjelaskan mengapa
    // dokumen ini hanya punya tiga tanda tangan.
    if (dilewati) {
      await ops.run(
        `UPDATE persetujuan SET status = 'dilewati', aktor_id = ?, aktor_nama = ?, aktor_jabatan = ?,
         komentar = ?, waktu = ? WHERE id = ?`,
        [pengguna.id, pengguna.nama, pengguna.jabatan || null,
          `Dilewati atas keputusan ${pengguna.nama} (${s.label}): ${alasanLewat}`,
          waktu, dilewati.id]);

      const kandidatLewat = await ops.all(
        'SELECT pengguna_id FROM persetujuan_kandidat WHERE persetujuan_id = ?', [dilewati.id]);
      tujuanDilewati = kandidatLewat.map(k => k.pengguna_id);
      await notif.simpanBanyak(ops, tujuanDilewati, {
        pengajuan_id: pengajuanId,
        judul: 'Tahap approval Anda dilewati',
        pesan: `${p.nomor} — ${p.judul}. Dilewati oleh ${pengguna.nama}: ${alasanLewat}`,
      });
    }

    if (aksi === 'setuju') {
      if (berikut) {
        await ops.run('UPDATE pengajuan SET langkah_kini = ?, diperbarui = ? WHERE id = ?',
          [berikut.urut, waktu, pengajuanId]);
        const kandidatBerikut = await ops.all(
          'SELECT pengguna_id FROM persetujuan_kandidat WHERE persetujuan_id = ?', [berikut.id]);
        tujuanPush = kandidatBerikut.map(k => k.pengguna_id);
        await notif.simpanBanyak(ops, kandidatBerikut.map(k => k.pengguna_id), {
          pengajuan_id: pengajuanId,
          judul: 'Approval menunggu Anda',
          pesan: `${p.nomor} — ${p.judul} (${rp(p.total)}) sudah disetujui ${s.label}`,
        });
        macet = await kabariTahapMacet(ops, { pengajuan: p, tahap: berikut });
      } else {
        await ops.run(
          `UPDATE pengajuan SET status = 'disetujui', diperbarui = ?, ditutup = ? WHERE id = ?`,
          [waktu, waktu, pengajuanId]);
        await notif.simpan(ops, {
          pengguna_id: p.pemohon_id, pengajuan_id: pengajuanId,
          judul: 'Pengajuan Anda DISETUJUI',
          pesan: `${p.nomor} — ${p.judul} (${rp(p.total)}) sudah disetujui seluruh tahap`,
        });
        // Uang muka perjalanan dinas: rantai approval berhenti di sini. Penyelesaian
        // (isi realisasi lalu verifikasi Accounting) BUKAN tahap approval baru —
        // lihat rute /:id/realisasi & /:id/verifikasi-realisasi di routes/pengajuan.js.
        if (p.perlu_realisasi) {
          await ops.run(`UPDATE pengajuan SET status_realisasi = 'menunggu' WHERE id = ?`, [pengajuanId]);
          await notif.simpan(ops, {
            pengguna_id: p.pemohon_id, pengajuan_id: pengajuanId,
            judul: 'Jangan lupa selesaikan uang muka',
            pesan: `${p.nomor} — ${p.judul}. Uang muka sudah disetujui penuh. `
              + 'Selesaikan (isi realisasi) setelah perjalanan dinas selesai.',
          });
        }
      }
    } else if (aksi === 'tolak') {
      // Tahap yang belum dilewati ditandai 'dilewati' supaya riwayat tetap jelas.
      await ops.run(
        `UPDATE persetujuan SET status = 'dilewati' WHERE pengajuan_id = ? AND urut > ? AND status = 'menunggu'`,
        [pengajuanId, s.urut]);
      await ops.run(`UPDATE pengajuan SET status = 'ditolak', diperbarui = ?, ditutup = ? WHERE id = ?`,
        [waktu, waktu, pengajuanId]);
      await notif.simpan(ops, {
        pengguna_id: p.pemohon_id, pengajuan_id: pengajuanId,
        judul: 'Pengajuan Anda DITOLAK',
        pesan: `${p.nomor} — ${p.judul}. Alasan: ${catatan}`,
      });
    } else { // revisi
      await ops.run(
        `UPDATE persetujuan SET status = 'dilewati' WHERE pengajuan_id = ? AND urut > ? AND status = 'menunggu'`,
        [pengajuanId, s.urut]);
      await ops.run(`UPDATE pengajuan SET status = 'revisi', langkah_kini = 0, diperbarui = ? WHERE id = ?`,
        [waktu, pengajuanId]);
      await notif.simpan(ops, {
        pengguna_id: p.pemohon_id, pengajuan_id: pengajuanId,
        judul: 'Pengajuan Anda diminta REVISI',
        pesan: `${p.nomor} — ${p.judul}. Catatan: ${catatan}`,
      });
    }

    await catatJejak(ops, {
      pengajuan_id: pengajuanId, pengguna, ip,
      aksi: aksi === 'setuju' ? 'setuju' : (aksi === 'tolak' ? 'tolak' : 'minta-revisi'),
      detail: `Tahap ${s.urut} (${s.label})${catatan ? ' — ' + catatan : ''}`,
    });

    if (dilewati) {
      await catatJejak(ops, {
        pengajuan_id: pengajuanId, pengguna, ip, aksi: 'lewati-tahap',
        detail: `Tahap ${dilewati.urut} (${dilewati.label}) dilewati: ${alasanLewat}`,
      });
    }
  });

  const judulTg = aksi === 'setuju'
    ? (berikut ? 'disetujui, lanjut ke ' + berikut.label : 'DISETUJUI FINAL')
    : (aksi === 'tolak' ? 'DITOLAK' : 'diminta REVISI');
  notif.keTelegram(`<b>EAPEX</b>\n${p.nomor} — ${p.judul}\n${judulTg}\noleh ${pengguna.nama} (${s.label})`).catch(() => {});

  // Notifikasi ke HP: penyetuju berikutnya bila alur berlanjut, atau pemohon
  // bila dokumennya selesai/ditolak/dikembalikan.
  const isiPush = (aksi === 'setuju' && berikut)
    ? {
      penerima: tujuanPush,
      judul: 'Approval menunggu Anda',
      pesan: `${p.nomor} — ${p.judul} (${rp(p.total)}) sudah disetujui ${s.label}`,
    }
    : {
      penerima: [p.pemohon_id],
      judul: aksi === 'setuju' ? 'Pengajuan Anda DISETUJUI'
        : (aksi === 'tolak' ? 'Pengajuan Anda DITOLAK' : 'Pengajuan Anda diminta REVISI'),
      pesan: aksi === 'setuju'
        ? `${p.nomor} — ${p.judul} (${rp(p.total)}) sudah disetujui seluruh tahap`
        : `${p.nomor} — ${p.judul}. ${aksi === 'tolak' ? 'Alasan' : 'Catatan'}: ${catatan}`,
    };
  notif.keLuar(isiPush.penerima, {
    judul: isiPush.judul,
    pesan: isiPush.pesan,
    url: '/pengajuan/' + pengajuanId,
    tag: 'approval-' + pengajuanId,
  });

  if (aksi === 'setuju' && !berikut && p.perlu_realisasi) {
    notif.keLuar([p.pemohon_id], {
      judul: 'Jangan lupa selesaikan uang muka',
      pesan: `${p.nomor} — ${p.judul}. Uang muka disetujui penuh — selesaikan setelah perjalanan dinas selesai.`,
      url: '/pengajuan/' + pengajuanId,
      tag: 'realisasi-menunggu-' + pengajuanId,
    });
  }

  // Yang dilewati WAJIB tahu. Kalau tidak, satu-satunya orang yang bisa protes
  // kalau keputusan melewatinya keliru justru tidak pernah mendengarnya.
  if (tujuanDilewati.length) {
    notif.keLuar(tujuanDilewati, {
      judul: 'Tahap approval Anda dilewati',
      pesan: `${p.nomor} — ${p.judul}. Dilewati oleh ${pengguna.nama}: ${alasanLewat}`,
      url: '/pengajuan/' + pengajuanId,
      tag: 'lewat-' + pengajuanId,
    });
  }

  // Dokumen mendarat di tahap yang seluruh penyetujunya menyatakan tidak bisa.
  // Dikabarkan SEKARANG, bukan menunggu pengingat besok pagi.
  if (macet) {
    notif.keLuar(macet.orang.map(u => u.id), {
      judul: 'Dokumen menunggu Anda, padahal Anda menyatakan tidak bisa',
      pesan: `${p.nomor} — ${p.judul}. Tunjuk pengganti lewat menu "Cuti Saya", `
        + 'atau setujui sendiri kalau ternyata sempat.',
      url: '/cuti-saya',
      tag: 'macet-' + pengajuanId,
    });
    notif.keLuar(macet.admin, {
      judul: 'Dokumen tertahan — penyetujunya menyatakan tidak bisa',
      pesan: `${p.nomor} — ${p.judul}, tertahan di ${macet.tahap.label}. Tunjuk pengganti supaya jalan lagi.`,
      url: '/pengajuan/' + pengajuanId,
      tag: 'macet-' + pengajuanId,
    });
  }

  return { status: aksi, berikut: berikut || null, dilewati: dilewati || null };
}

// --------------------------------------------------------------- BATAL
async function batalkan(pengajuanId, pengguna, alasan, ip) {
  const p = await P.ambil(pengajuanId);
  if (!p) throw new GalatAlur('Pengajuan tidak ditemukan', 404);
  const miliknya = p.pemohon_id === pengguna.id || pengguna.peran === 'admin';
  if (!miliknya) throw new GalatAlur('Hanya pemohon atau Administrator yang bisa membatalkan', 403);
  if (['disetujui', 'ditolak', 'dibatalkan'].includes(p.status)) {
    throw new GalatAlur('Pengajuan sudah selesai, tidak bisa dibatalkan');
  }
  const waktu = sekarang();
  await db.tx(async ops => {
    await ops.run(
      `UPDATE persetujuan SET status = 'dilewati' WHERE pengajuan_id = ? AND status = 'menunggu'`, [pengajuanId]);
    await ops.run(
      `UPDATE pengajuan SET status = 'dibatalkan', langkah_kini = 0, diperbarui = ?, ditutup = ? WHERE id = ?`,
      [waktu, waktu, pengajuanId]);
    await catatJejak(ops, {
      pengajuan_id: pengajuanId, pengguna, aksi: 'batalkan', ip,
      detail: String(alasan || '').trim().slice(0, 500) || 'Dibatalkan oleh pemohon',
    });
  });
}

// --------------------------------------------------------------- KOMENTAR
async function komentari(pengajuanId, pengguna, teks, ip) {
  const isi = String(teks || '').trim();
  if (!isi) throw new GalatAlur('Komentar masih kosong');
  const p = await P.ambil(pengajuanId);
  if (!p) throw new GalatAlur('Pengajuan tidak ditemukan', 404);
  if (!P.bolehMelihat(p, pengguna)) throw new GalatAlur('Tidak berhak', 403);
  await catatJejak(null, {
    pengajuan_id: pengajuanId, pengguna, aksi: 'komentar', ip, detail: isi.slice(0, 2000),
  });
  // beri tahu pemohon dan penyetuju tahap aktif
  const s = P.langkahAktif(p);
  const tujuan = [p.pemohon_id, ...((s && s.kandidat) || []).map(k => k.id)].filter(x => x !== pengguna.id);
  await notif.simpanBanyak(null, tujuan, {
    pengajuan_id: pengajuanId,
    judul: 'Komentar baru',
    pesan: `${p.nomor || 'Draft'} — ${pengguna.nama}: ${isi.slice(0, 120)}`,
  });
}

// ============================================================================
//  REALISASI (pertanggungjawaban uang muka perjalanan dinas)
// ============================================================================
// Rantai approval yang SAMA (peran & total yang sama, lewat aturanMesin.bangunRantai)
// diulang dari awal — bukan sekadar diverifikasi Accounting sendirian. Disimpan
// di tabel TERPISAH (persetujuan_realisasi) supaya rantai uang muka yang asli,
// yang sudah sah dan tercetak, tidak pernah tersentuh oleh proses ini.
async function ajukanRealisasi(pengajuanId, pengguna, { nominal, tanggal, keterangan, berkas = [] }, ip) {
  const p = await P.ambil(pengajuanId);
  if (!p) throw new GalatAlur('Pengajuan tidak ditemukan', 404);
  if (p.pemohon_id !== pengguna.id && pengguna.peran !== 'admin') {
    throw new GalatAlur('Hanya pemohon yang bisa menyelesaikan pengajuan ini', 403);
  }
  if (!p.perlu_realisasi) throw new GalatAlur('Pengajuan ini tidak memakai alur uang muka');
  if (p.status !== 'disetujui') throw new GalatAlur('Uang muka belum disetujui penuh');
  if (!['menunggu', 'revisi'].includes(p.status_realisasi)) {
    throw new GalatAlur('Realisasi sudah diajukan atau sudah selesai diverifikasi');
  }
  if (!(Number(nominal) > 0)) throw new GalatAlur('Nominal realisasi wajib diisi lebih dari nol');
  if (!tanggal) throw new GalatAlur('Tanggal realisasi wajib diisi');
  // Bukti wajib DIVALIDASI di sini (bukan hanya di rute) supaya berkas yang
  // sudah terunggah tidak pernah tersimpan sebelum sisa pemeriksaan lolos —
  // insert-nya sendiri terjadi di dalam transaksi di bawah.
  const adaBuktiLama = (p.lampiran || []).some(l => l.jenis === 'realisasi');
  if (!berkas.length && !adaBuktiLama) throw new GalatAlur('Bukti/kwitansi realisasi wajib diunggah');

  const konteks = await konteksPengajuan(p);
  // Rantai yang SAMA seperti uang muka: peran & total tidak berubah (bukan
  // ambang dihitung ulang dari nominal realisasi) — hanya diulang keputusannya.
  const rantai = await aturanMesin.bangunRantai(p.aturan_id, Number(p.total || 0), konteks);
  if (!rantai.length) throw new GalatAlur('Aturan approval untuk kategori ini belum diisi. Hubungi Administrator.');
  const macet = aturanMesin.langkahTanpaKandidat(rantai);
  if (macet.length) {
    throw new GalatAlur(
      'Belum ada pengguna aktif untuk peran: ' + macet.map(m => m.label).join(', ') +
      '. Minta Administrator melengkapi data pengguna dulu.');
  }
  batalkanLewatYangTerlarang(rantai);
  const dilewati = aturanMesin.langkahDilewati(rantai);
  const adaYangMenyetujui = rantai.some(s => !s.dilewatiCuti);
  if (!adaYangMenyetujui) {
    throw new GalatAlur('Seluruh penyetuju pada alur ini sedang cuti, jadi realisasi tidak bisa diajukan sekarang.');
  }

  const waktu = sekarang();
  let tahapMulai;
  await db.tx(async ops => {
    // Dibangun ulang dari nol tiap kali diajukan — sama seperti persetujuan asli
    // dibangun ulang tiap dokumen diajukan/diajukan-ulang sesudah revisi.
    await ops.run('DELETE FROM persetujuan_realisasi_kandidat WHERE pengajuan_id = ?', [pengajuanId]);
    await ops.run('DELETE FROM persetujuan_realisasi WHERE pengajuan_id = ?', [pengajuanId]);
    for (const s of rantai) {
      const sid = id();
      await ops.run(
        `INSERT INTO persetujuan_realisasi (id, pengajuan_id, urut, peran, label, lingkup, min_nominal, maks_nominal,
         status, komentar, waktu)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [sid, pengajuanId, s.urut, s.peran, s.label, s.lingkup, s.min_nominal, s.maks_nominal,
          s.dilewatiCuti ? 'dilewati' : 'menunggu',
          s.dilewatiCuti ? 'Dilewati — penyetuju berhalangan. ' + s.alasanLewat : null,
          s.dilewatiCuti ? waktu : null]);
      for (const k of s.kandidat) {
        await ops.run(
          `INSERT INTO persetujuan_realisasi_kandidat (id, persetujuan_realisasi_id, pengajuan_id, pengguna_id)
           VALUES (?,?,?,?)`,
          [id(), sid, pengajuanId, k.id]);
      }
    }
    tahapMulai = rantai.find(s => !s.dilewatiCuti);
    await ops.run(
      `UPDATE pengajuan SET status_realisasi = 'diajukan', realisasi_json = ?, realisasi_diajukan = ?,
       realisasi_catatan = NULL WHERE id = ?`,
      [JSON.stringify({ nominal: Number(nominal), tanggal, keterangan: keterangan || '' }), waktu, pengajuanId]);
    for (const f of berkas) {
      await ops.run(
        `INSERT INTO lampiran (id, pengajuan_id, nama_asli, nama_simpan, mime, ukuran, pengunggah_id, dibuat, jenis)
         VALUES (?,?,?,?,?,?,?,?,'realisasi')`,
        [id(), pengajuanId, namaBerkasAman(f.originalname), f.filename, f.mimetype, f.size, pengguna.id, waktu]);
      await simpanan.pindahkan(f.filename, ops);
    }
    await catatJejak(ops, {
      pengajuan_id: pengajuanId, pengguna, ip, aksi: 'realisasi',
      detail: `Realisasi diajukan: ${rp(nominal)} pada ${tanggal}${keterangan ? ' — ' + keterangan : ''}. `
        + `Alur approval ulang: ${aturanMesin.ringkasRantai(rantai)}`,
    });
    for (const d of dilewati) {
      await notif.simpanBanyak(ops, (d.kandidatSemua || []).map(k => k.id), {
        pengajuan_id: pengajuanId,
        judul: 'Tahap approval realisasi Anda dilewati',
        pesan: `${p.nomor} — ${p.judul}. Dilewati karena Anda tercatat berhalangan: ${d.alasanLewat}`,
      });
    }
    await notif.simpanBanyak(ops, tahapMulai.kandidat.map(k => k.id), {
      pengajuan_id: pengajuanId,
      judul: 'Verifikasi realisasi menunggu Anda',
      pesan: `${p.nomor} — ${p.judul}. Realisasi ${rp(nominal)} diajukan ${pengguna.nama}, menunggu ${tahapMulai.label}.`,
    });
  });

  notif.keLuar(tahapMulai.kandidat.map(k => k.id), {
    judul: 'Verifikasi realisasi menunggu Anda',
    pesan: `${p.nomor} — ${p.judul}. Realisasi ${rp(nominal)} diajukan ${pengguna.nama}, menunggu ${tahapMulai.label}.`,
    url: '/pengajuan/' + pengajuanId,
    tag: 'realisasi-diajukan-' + pengajuanId,
  });
  for (const d of dilewati) {
    notif.keLuar((d.kandidatSemua || []).map(k => k.id), {
      judul: 'Tahap approval realisasi Anda dilewati',
      pesan: `${p.nomor} — ${p.judul}. Dilewati karena Anda tercatat berhalangan.`,
      url: '/pengajuan/' + pengajuanId,
      tag: 'realisasi-lewat-' + pengajuanId,
    });
  }
  return { rantai, dilewati, mulai: tahapMulai };
}

// Keputusan satu tahap pada rantai realisasi. Vokabulernya sengaja lebih sempit
// dari putuskan() biasa — hanya 'setuju' dan 'revisi'. "Tolak" tidak punya arti
// yang jelas di sini: uang mukanya sudah sah cair dan dipakai untuk perjalanan
// yang sudah terjadi; yang bisa diminta hanyalah perbaikan laporannya (revisi),
// bukan membatalkan sesuatu yang sudah selesai.
async function putuskanRealisasi(pengajuanId, pengguna, aksi, komentar, ip) {
  if (aksi !== 'setuju' && aksi !== 'revisi') throw new GalatAlur('Aksi tidak dikenal');
  const p = await P.ambil(pengajuanId);
  if (!p) throw new GalatAlur('Pengajuan tidak ditemukan', 404);
  if (p.status_realisasi !== 'diajukan') throw new GalatAlur('Tidak ada realisasi yang menunggu keputusan', 400);

  const semua = p.persetujuan_realisasi || [];
  const s = semua.find(x => x.status === 'menunggu');
  if (!s) throw new GalatAlur('Tidak ada tahap yang menunggu keputusan', 400);
  if (!(s.kandidat || []).some(k => k.id === pengguna.id)) {
    throw new GalatAlur('Anda bukan penyetuju tahap ini', 403);
  }
  const catatan = String(komentar || '').trim();
  if (aksi === 'revisi' && !catatan) throw new GalatAlur('Catatan wajib diisi bila meminta revisi');

  const waktu = sekarang();
  const berikut = aksi === 'setuju'
    ? semua.filter(x => x.urut > s.urut && x.status === 'menunggu').sort((a, b) => a.urut - b.urut)[0]
    : null;

  await db.tx(async ops => {
    await ops.run(
      `UPDATE persetujuan_realisasi SET status = ?, aktor_id = ?, aktor_nama = ?, aktor_jabatan = ?,
       komentar = ?, waktu = ? WHERE id = ?`,
      [aksi === 'setuju' ? 'disetujui' : 'revisi', pengguna.id, pengguna.nama, pengguna.jabatan || null,
        catatan || null, waktu, s.id]);

    if (aksi === 'setuju') {
      if (berikut) {
        await notif.simpanBanyak(ops, (berikut.kandidat || []).map(k => k.id), {
          pengajuan_id: pengajuanId,
          judul: 'Verifikasi realisasi menunggu Anda',
          pesan: `${p.nomor} — ${p.judul}. Sudah disetujui ${s.label}, lanjut ke ${berikut.label}.`,
        });
      } else {
        await ops.run(
          `UPDATE pengajuan SET status_realisasi = 'selesai', realisasi_selesai = ?, realisasi_verif_id = ?
           WHERE id = ?`,
          [waktu, pengguna.id, pengajuanId]);
        await notif.simpan(ops, {
          pengguna_id: p.pemohon_id, pengajuan_id: pengajuanId,
          judul: 'Realisasi Anda selesai diverifikasi',
          pesan: `${p.nomor} — ${p.judul}. Realisasi sudah disetujui seluruh tahap `
            + `(${semua.map(x => x.label).join(' → ')}).`,
        });
      }
    } else {
      await ops.run(
        `UPDATE persetujuan_realisasi SET status = 'dilewati' WHERE pengajuan_id = ? AND urut > ? AND status = 'menunggu'`,
        [pengajuanId, s.urut]);
      await ops.run(`UPDATE pengajuan SET status_realisasi = 'revisi', realisasi_catatan = ? WHERE id = ?`,
        [catatan, pengajuanId]);
      await notif.simpan(ops, {
        pengguna_id: p.pemohon_id, pengajuan_id: pengajuanId,
        judul: 'Realisasi Anda diminta revisi',
        pesan: `${p.nomor} — ${p.judul}. Diminta revisi oleh ${s.label} (${pengguna.nama}): ${catatan}`,
      });
    }

    await catatJejak(ops, {
      pengajuan_id: pengajuanId, pengguna, ip,
      aksi: aksi === 'setuju' ? 'setuju-realisasi' : 'revisi-realisasi',
      detail: `Realisasi tahap ${s.urut} (${s.label})${catatan ? ' — ' + catatan : ''}`,
    });
  });

  if (aksi === 'setuju' && berikut) {
    notif.keLuar((berikut.kandidat || []).map(k => k.id), {
      judul: 'Verifikasi realisasi menunggu Anda',
      pesan: `${p.nomor} — ${p.judul}. Sudah disetujui ${s.label}, lanjut ke ${berikut.label}.`,
      url: '/pengajuan/' + pengajuanId, tag: 'realisasi-diajukan-' + pengajuanId,
    });
  } else if (aksi === 'setuju') {
    notif.keLuar([p.pemohon_id], {
      judul: 'Realisasi Anda selesai diverifikasi',
      pesan: `${p.nomor} — ${p.judul}. Realisasi sudah disetujui seluruh tahap.`,
      url: '/pengajuan/' + pengajuanId, tag: 'realisasi-selesai-' + pengajuanId,
    });
  } else {
    notif.keLuar([p.pemohon_id], {
      judul: 'Realisasi Anda diminta revisi',
      pesan: `${p.nomor} — ${p.judul}. Catatan: ${catatan}`,
      url: '/pengajuan/' + pengajuanId, tag: 'realisasi-revisi-' + pengajuanId,
    });
  }

  return { status: aksi, berikut: berikut || null };
}

module.exports = {
  ajukan, putuskan, batalkan, komentari, catatJejak, pratinjauRantai, konteksPengajuan,
  alasanTakBolehLewat, GalatAlur, pengaturan,
  ajukanRealisasi, putuskanRealisasi,
};
