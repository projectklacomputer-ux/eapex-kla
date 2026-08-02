// ============================================================================
//  Perkakas umum: uang, tanggal, id, angka-ke-kata, pengaman keluaran
// ============================================================================
const crypto = require('crypto');

const id = () => crypto.randomUUID();

// Semua uang di aplikasi ini disimpan sebagai INTEGER rupiah (tanpa sen), supaya
// tidak pernah ada galat pembulatan pecahan pada perhitungan ambang approval.
function keRupiahBulat(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Math.round(v);
  // terima "1.500.000", "1500000", "1,500,000", "Rp 1.500.000"
  const bersih = String(v).replace(/[^\d,.-]/g, '');
  if (!bersih) return 0;
  let s = bersih;
  const koma = s.lastIndexOf(',');
  const titik = s.lastIndexOf('.');
  const pemisahDesimal = Math.max(koma, titik);
  // Anggap desimal hanya bila setelah pemisah terakhir ada 1-2 angka DAN pemisah itu satu-satunya jenisnya
  if (pemisahDesimal > -1 && s.length - pemisahDesimal - 1 <= 2 && s.slice(pemisahDesimal + 1).length > 0) {
    const kiri = s.slice(0, pemisahDesimal).replace(/[.,]/g, '');
    const kanan = s.slice(pemisahDesimal + 1);
    s = kiri + '.' + kanan;
  } else {
    s = s.replace(/[.,]/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

const rp = v => 'Rp ' + Number(keRupiahBulat(v)).toLocaleString('id-ID');
const angka = v => Number(v || 0).toLocaleString('id-ID');

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

// Menerjemahkan nilai <input type="date"> ("2026-08-15") ke label Bahasa
// Indonesia ("15 Agustus 2026") untuk kolom Jadwal Dibutuhkan & Periode.
//
// Dua format lama ikut didukung, bukan cuma format tanggal penuh:
//   YYYY-MM       sempat berlaku singkat saat kolom ini masih kalender BULAN
//                 (sebelum diperjelas jadi tanggal harian)
//   teks bebas    sebelum kolom ini dikunci ke kalender sama sekali,
//                 mis. "Minggu kedua Agustus 2026"
// Keduanya dikembalikan apa adanya — bukan dibuang — supaya dokumen lama
// tetap terbaca persis seperti saat diajukan.
function tanggalKegiatan(v) {
  if (!v) return '-';
  const teks = String(v).trim();

  const tgl = /^(\d{4})-(\d{2})-(\d{2})$/.exec(teks);
  if (tgl) {
    const [, sTahun, sBulan, sHari] = tgl;
    const tahun = Number(sTahun), bulan = Number(sBulan), hari = Number(sHari);
    // Divalidasi lewat round-trip Date, bukan sekadar rentang 1-31: JS Date
    // MEMBULATKAN tanggal yang tidak ada (2026-02-30 diam-diam jadi 2 Maret),
    // jadi pemeriksaan rentang kasar akan meloloskan tanggal yang sebenarnya
    // tidak pernah ada di kalender.
    const d = new Date(Date.UTC(tahun, bulan - 1, hari));
    const sahih = bulan >= 1 && bulan <= 12
      && d.getUTCFullYear() === tahun && d.getUTCMonth() === bulan - 1 && d.getUTCDate() === hari;
    if (sahih) return `${hari} ${BULAN[bulan - 1]} ${tahun}`;
    return teks;
  }

  const bln = /^(\d{4})-(\d{2})$/.exec(teks);
  if (bln) {
    const bulan = Number(bln[2]);
    if (bulan >= 1 && bulan <= 12) return `${BULAN[bulan - 1]} ${bln[1]}`;
    return teks;
  }

  return teks;
}

const sekarang = () => new Date().toISOString();

// ---------------------------------------------------------------- zona waktu
// Waktu disimpan sebagai ISO UTC, tetapi SELALU ditampilkan dalam waktu Indonesia
// Barat — bukan mengikuti zona waktu server. Ini bukan sekadar soal label: begitu
// aplikasi dipasang di server sewaan (hampir selalu berzona UTC), cara lama yang
// memakai jam lokal server akan menampilkan seluruh jam persetujuan MUNDUR 7 JAM
// tanpa ada yang menyadarinya.
const ZONA = process.env.ZONA_WAKTU || 'Asia/Jakarta';
const LABEL_ZONA = process.env.LABEL_ZONA || 'WIB';

// Pembentuk tanggal/jam dibuat sekali saja — membuat Intl.DateTimeFormat baru
// pada setiap baris tabel jauh lebih mahal daripada memakai ulang yang sudah ada.
const fmtTanggal = new Intl.DateTimeFormat('id-ID', {
  timeZone: ZONA, day: 'numeric', month: 'long', year: 'numeric',
});
const fmtJam = new Intl.DateTimeFormat('id-ID', {
  timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false,
});
const fmtSingkat = new Intl.DateTimeFormat('id-ID', {
  timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric',
});

function tglIndo(iso, denganJam) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d)) return '-';
  const tanggal = fmtTanggal.format(d);
  if (!denganJam) return tanggal;
  return `${tanggal}, ${fmtJam.format(d).replace(':', '.')} ${LABEL_ZONA}`;
}

// Hanya jam, untuk tampilan yang tanggalnya sudah tertulis di kolom lain.
function jamIndo(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d)) return '-';
  return `${fmtJam.format(d).replace(':', '.')} ${LABEL_ZONA}`;
}

function tglSingkat(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d)) return '-';
  return fmtSingkat.format(d).replace(/\//g, '/');
}

// Selisih hari kalender antara dua ISO (untuk "umur" pengajuan)
function selisihHari(iso, sampai) {
  if (!iso) return 0;
  const a = new Date(iso).getTime();
  const b = sampai ? new Date(sampai).getTime() : Date.now();
  return Math.max(0, Math.floor((b - a) / 86400000));
}

const fmtTanggalIso = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit',
});

// Tanggal (YYYY-MM-DD) menurut WIB, bukan menurut jam server.
function tanggalZona(iso) {
  const d = iso ? new Date(iso) : new Date();
  return isNaN(d) ? null : fmtTanggalIso.format(d);
}

// Selisih HARI KALENDER menurut WIB — berbeda dari selisihHari() yang menghitung
// selang 24 jam.
//
// Bedanya menentukan untuk aturan yang berbunyi "didiamkan 2 hari": dengan
// hitungan 24 jam, draft yang disimpan pukul 09.00 terhapus pada hari ke-2,
// sedangkan yang disimpan pukul 11.00 baru terhapus pada hari ke-3 — karena
// pemeriksaannya berjalan pukul 10.00. Aturan yang sama menghasilkan tenggat
// berbeda hanya karena selisih dua jam saat menyimpan, dan tidak ada yang bisa
// menjelaskan kenapa. Dengan hari kalender, tenggatnya sama untuk semua orang.
function selisihHariZona(iso, sampai) {
  if (!iso) return 0;
  const keAngka = s => {
    const t = tanggalZona(s);
    if (!t) return null;
    const [y, m, d] = t.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const a = keAngka(iso);
  const b = keAngka(sampai || undefined);
  if (a === null || b === null) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

// ---------------------------------------------------------------- angka -> kata
const SATUAN = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan',
  'sepuluh', 'sebelas'];

function terbilangDasar(n) {
  n = Math.floor(Math.abs(n));
  if (n < 12) return SATUAN[n];
  if (n < 20) return terbilangDasar(n - 10) + ' belas';
  if (n < 100) return terbilangDasar(Math.floor(n / 10)) + ' puluh' + (n % 10 ? ' ' + terbilangDasar(n % 10) : '');
  if (n < 200) return 'seratus' + (n % 100 ? ' ' + terbilangDasar(n % 100) : '');
  if (n < 1000) return terbilangDasar(Math.floor(n / 100)) + ' ratus' + (n % 100 ? ' ' + terbilangDasar(n % 100) : '');
  if (n < 2000) return 'seribu' + (n % 1000 ? ' ' + terbilangDasar(n % 1000) : '');
  if (n < 1e6) return terbilangDasar(Math.floor(n / 1000)) + ' ribu' + (n % 1000 ? ' ' + terbilangDasar(n % 1000) : '');
  if (n < 1e9) return terbilangDasar(Math.floor(n / 1e6)) + ' juta' + (n % 1e6 ? ' ' + terbilangDasar(n % 1e6) : '');
  if (n < 1e12) return terbilangDasar(Math.floor(n / 1e9)) + ' miliar' + (n % 1e9 ? ' ' + terbilangDasar(n % 1e9) : '');
  return terbilangDasar(Math.floor(n / 1e12)) + ' triliun' + (n % 1e12 ? ' ' + terbilangDasar(n % 1e12) : '');
}

function terbilangRupiah(n) {
  const v = keRupiahBulat(n);
  if (!v) return 'NOL RUPIAH';
  const kata = (v < 0 ? 'minus ' : '') + terbilangDasar(v) + ' rupiah';
  return kata.replace(/\s+/g, ' ').trim().toUpperCase();
}

// Bilangan biasa dalam huruf (untuk "3 (tiga) bulan" pada dokumen resmi)
function terbilangAngka(n) {
  const v = Math.floor(Math.abs(Number(n) || 0));
  return v === 0 ? 'nol' : terbilangDasar(v).replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------- lain-lain
const potong = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) : s; };

function bacaJson(teks, bawaan) {
  if (teks === null || teks === undefined || teks === '') return bawaan;
  if (typeof teks === 'object') return teks;           // pg jsonb / sudah objek
  try { return JSON.parse(teks); } catch (e) { return bawaan; }
}

// Bersihkan nama berkas unggahan supaya tidak bisa keluar dari folder tujuan.
function namaBerkasAman(nama) {
  return String(nama || 'berkas')
    .replace(/[\\/]/g, '_')
    .replace(/[^\w.\- ()]/g, '_')
    .replace(/\.{2,}/g, '.')
    .slice(-120) || 'berkas';
}

// Bandingkan dua token rahasia tanpa membocorkan waktu (untuk CSRF)
function samaAman(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (x.length !== y.length || !x.length) return false;
  return crypto.timingSafeEqual(x, y);
}

module.exports = {
  id, rp, angka, keRupiahBulat, sekarang, tglIndo, jamIndo, tglSingkat, selisihHari,
  tanggalZona, selisihHariZona, ZONA, LABEL_ZONA,
  terbilangRupiah, terbilangAngka, potong, bacaJson, namaBerkasAman, samaAman, BULAN, tanggalKegiatan,
};
