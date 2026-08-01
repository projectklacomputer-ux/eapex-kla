#!/usr/bin/env node
// ============================================================================
//  Membuat PDF tutorial EAPEX - satu untuk Cabang, satu untuk Back Office
// ============================================================================
//  Matriks approval TIDAK ditulis tangan di sini. Ia dibaca dari tabel
//  kategori/aturan/aturan_langkah saat PDF dibuat, sehingga tutorial dan
//  aplikasi tidak bisa berbeda. Kalau ambang CEO diubah lewat menu Admin,
//  jalankan ulang skrip ini dan PDF-nya ikut benar.
//
//  Gambar diambil dari docs/tangkapan/. Yang belum ada digantikan kotak
//  bertanda supaya ketahuan mana yang masih kurang - PDF tetap jadi, dan
//  kekurangannya kelihatan, bukan tersembunyi.
//
//  Jalankan:  node scripts/buat-tutorial.js
//  Hasil   :  docs/Tutorial-EAPEX-Cabang.pdf
//             docs/Tutorial-EAPEX-Back-Office.pdf
// ============================================================================

require('../lib/env')();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const db = require('../lib/db');
const { CABANG, BACKOFFICE, BENTUK, LANGKAH_MASUK, rupiah } = require('./tutorial-isi');

const AKAR = path.join(__dirname, '..');
const DIR_KELUAR = path.join(AKAR, 'docs');
const DIR_GAMBAR = path.join(AKAR, 'docs', 'tangkapan');
const ALAMAT = process.env.ALAMAT_APLIKASI || 'https://eapex-kla.vercel.app';

const LABEL_PERAN = {
  store_manager: 'Store Manager', area_manager: 'Area Manager',
  regional_manager: 'Regional Manager', accounting: 'Accounting', ceo: 'CEO',
  leader_manager: 'Leader / Manager', hc_manager: 'HC Manager', hc_staf: 'HC Staf',
  marketing_coordinator: 'Marketing Coordinator', marketing_staf: 'Marketing Staf',
  staf: 'Staf', brand_manager: 'Brand Manager',
};
const peranLabel = p => LABEL_PERAN[p] || p;

// ------------------------------------------------------------------ gambar
function gambar(track, nama, keterangan) {
  for (const kandidat of [`${track}-${nama}.png`, `${nama}.png`]) {
    const jalur = path.join(DIR_GAMBAR, kandidat);
    if (fs.existsSync(jalur)) {
      const b64 = fs.readFileSync(jalur).toString('base64');
      return `<figure><img src="data:image/png;base64,${b64}" alt="${keterangan || nama}">
              ${keterangan ? `<figcaption>${keterangan}</figcaption>` : ''}</figure>`;
    }
  }
  return `<figure class="kosong"><div class="tanda">
            <b>[ gambar belum diambil ]</b><br><span>${track}-${nama}.png</span>
          </div>${keterangan ? `<figcaption>${keterangan}</figcaption>` : ''}</figure>`;
}

// ------------------------------------------------------- baca aturan dari DB
async function bacaKategori(wilayah) {
  const kat = await db.all(
    `SELECT k.*, a.id AS aturan_id, a.peran_pemohon, a.ambang_ceo, a.catatan
       FROM kategori k
       JOIN aturan a ON a.kategori_id = k.id AND a.wilayah = ? AND a.aktif = 1
      WHERE k.aktif = 1
      ORDER BY k.urutan, k.grup, k.nama`, [wilayah]);

  for (const k of kat) {
    k.langkah = await db.all(
      'SELECT * FROM aturan_langkah WHERE aturan_id = ? ORDER BY urut', [k.aturan_id]);
  }
  return kat;
}

function rantaiTeks(k) {
  return k.langkah.map(l => {
    const nama = l.label || peranLabel(l.peran);
    return l.min_nominal ? `${nama} <span class="syarat">(bila &ge; ${rupiah(l.min_nominal)})</span>` : nama;
  });
}

// -------------------------------------------------------------- bab dinamis
function babPengajuan(track, kategori) {
  const grup = {};
  for (const k of kategori) (grup[k.grup] = grup[k.grup] || []).push(k);

  const bentukDipakai = [...new Set(kategori.map(k => k.bentuk))];

  let h = `
  <p>Setiap pengajuan berawal dari memilih <b>kategori</b>. Kategori menentukan
  dua hal sekaligus: kolom apa yang harus diisi, dan siapa saja yang harus
  menyetujuinya. Jadi memilih kategori yang tepat bukan soal kerapian - salah
  kategori berarti dokumen berjalan ke orang yang salah.</p>`;

  h += `<h3>Langkah 1 &mdash; Pilih kategori</h3>
  <p>Menu <b>Pengajuan Baru</b> menampilkan kategori yang boleh Anda ajukan.
  Kategori yang bukan wewenang Anda tidak akan muncul.</p>
  ${gambar(track, 'pilih-kategori', 'Daftar kategori pengajuan')}`;

  h += `<h3>Langkah 2 &mdash; Isi formulirnya</h3>
  <p>Bentuk formulirnya menyesuaikan kategori. Kolom bertanda wajib harus
  terisi - dokumen yang setengah terisi memaksa penyetuju menebak, dan sistem
  menolaknya sejak awal.</p>
  ${gambar(track, 'form', 'Formulir pengajuan')}`;

  for (const b of bentukDipakai) {
    const def = BENTUK[b];
    if (!def) continue;
    h += `<div class="kotak">
      <h4>Formulir ${def.nama}</h4>
      <p><b>Wajib diisi:</b></p>
      <ul>${def.wajib.map(w => `<li>${w}</li>`).join('')}</ul>
      ${def.opsional ? `<p class="kecil"><b>Catatan:</b> ${def.opsional}</p>` : ''}
    </div>`;
  }

  h += `<h3>Langkah 3 &mdash; Lampirkan penawaran</h3>
  <p>Lampiran <b>wajib</b> untuk hampir semua kategori. Penyetuju tidak bisa
  menilai kewajaran harga tanpa melihat penawarannya.</p>
  <ul>
    <li>Format: PDF, Excel, JPG, atau PNG</li>
    <li>Foto dari HP dikecilkan otomatis di peramban sebelum dikirim, tapi
        tetap terbaca - pastikan angka pada penawaran masih jelas sebelum mengirim</li>
  </ul>
  ${gambar(track, 'lampiran', 'Melampirkan berkas penawaran')}`;

  h += `<div class="sorot">
    <h4>Tombol &ldquo;Isi dengan AI&rdquo;</h4>
    <p>Setelah penawaran dilampirkan, tombol ini membaca isinya dan mengisikan
    nama barang, jumlah, dan harga ke formulir. Anda tinggal memeriksa dan
    menulis justifikasinya.</p>
    <p class="kecil"><b>Periksa ulang hasilnya.</b> Pembacaan otomatis bisa
    salah membaca angka, dan yang bertanggung jawab atas isi dokumen tetap
    Anda. Tombol ini hanya aktif bila Administrator sudah memasang kunci
    OpenAI; kalau belum, isi formulirnya seperti biasa.</p>
    <p class="kecil"><b>Sadari:</b> memakai tombol ini mengirimkan isi berkas
    penawaran ke layanan OpenAI - termasuk harga dari vendor.</p>
  </div>`;

  h += `<h3>Langkah 4 &mdash; Kirim, lalu pantau</h3>
  <p>Setelah dikirim, dokumen mendapat <b>nomor</b> dan mulai berjalan. Rantai
  persetujuannya <b>dibekukan saat itu juga</b> - perubahan aturan sesudahnya
  tidak mengubah dokumen yang sudah berjalan.</p>
  <p>Pantau posisinya di <b>Daftar Pengajuan</b>. Bagian bawah tiap dokumen
  menunjukkan sudah sampai siapa dan siapa yang berikutnya.</p>
  ${gambar(track, 'detail', 'Posisi dokumen dan riwayat persetujuannya')}`;

  h += `<h2 class="pisah">Kategori dan rantai persetujuannya</h2>
  <p>Daftar berikut dibaca langsung dari aturan yang sedang berlaku di sistem.</p>`;

  for (const [namaGrup, isi] of Object.entries(grup)) {
    h += `<h3>${namaGrup}</h3>`;
    for (const k of isi) {
      h += `<div class="kategori">
        <div class="knama">${k.nama} <span class="kode">${k.kode_dok}</span></div>
        ${k.keterangan ? `<div class="kket">${k.keterangan}</div>` : ''}
        ${k.catatan ? `<div class="kket"><i>${k.catatan}</i></div>` : ''}
        <div class="rantai">
          <span class="anda">Anda</span>${rantaiTeks(k).map(t => `<span class="panah">&rarr;</span><span class="tahap">${t}</span>`).join('')}
        </div>
        ${k.ambang_ceo ? `<div class="ambang">CEO ikut menyetujui bila total <b>&ge; ${rupiah(k.ambang_ceo)}</b></div>` : ''}
      </div>`;
    }
  }
  return h;
}

// ------------------------------------------------------------------- render
function render(doc, kategori) {
  const track = doc.kode;
  const bab = doc.bab.map(b => {
    if (b.judul === 'Masuk pertama kali') return { ...b, langkah: LANGKAH_MASUK(ALAMAT) };
    if (b.judul === 'Membuat pengajuan') return { ...b, html: babPengajuan(track, kategori) };
    return b;
  });

  const daftarIsi = bab.map((b, i) => `<li><span>${i + 1}</span> ${b.judul}</li>`).join('');

  const isiBab = bab.map((b, i) => {
    let h = `<section class="bab"><h2><span class="no">${i + 1}</span> ${b.judul}</h2>`;
    if (b.catatanBab) h += `<p class="catatan-bab">${b.catatanBab}</p>`;
    if (b.html) h += b.html;
    if (b.langkah) {
      h += '<ol class="langkah">';
      for (const l of b.langkah) {
        h += `<li><h3>${l.judul}</h3><p>${l.isi}</p>`;
        if (l.catatan) h += `<p class="catatan">${l.catatan}</p>`;
        if (l.gambar) h += gambar(track, l.gambar, l.ketGambar);
        h += '</li>';
      }
      h += '</ol>';
    }
    return h + '</section>';
  }).join('');

  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8">
<title>${doc.judul}</title>
<style>
  @page { size: A4; margin: 18mm 16mm 20mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: 10.5pt; line-height: 1.6;
         color: #1a1a1a; margin: 0; }
  h1,h2,h3,h4 { color: #461866; line-height: 1.3; }

  .sampul { height: 245mm; display: flex; flex-direction: column; justify-content: center;
            page-break-after: always; border-left: 8px solid #461866; padding-left: 14mm; }
  .sampul .merek { font-size: 11pt; letter-spacing: 3px; color: #8b6bb1; margin-bottom: 6mm; }
  .sampul h1 { font-size: 30pt; margin: 0 0 3mm; }
  .sampul .sub { font-size: 14pt; color: #555; margin-bottom: 10mm; }
  .sampul .ring { font-size: 11pt; max-width: 120mm; color: #333; }
  .sampul .kaki { margin-top: 14mm; font-size: 9pt; color: #777; }

  .isi { page-break-after: always; }
  .isi h2 { border-bottom: 2px solid #eee; padding-bottom: 3mm; }
  .isi ol { list-style: none; padding: 0; }
  .isi li { padding: 2.5mm 0; border-bottom: 1px dotted #ddd; font-size: 11pt; }
  .isi li span { display: inline-block; width: 9mm; color: #8b6bb1; font-weight: bold; }

  .bab { page-break-before: always; }
  .bab > h2 { font-size: 17pt; border-bottom: 2px solid #461866; padding-bottom: 2.5mm; }
  .bab > h2 .no { display: inline-block; background: #461866; color: #fff; width: 9mm;
                  height: 9mm; line-height: 9mm; text-align: center; border-radius: 2mm;
                  font-size: 12pt; margin-right: 3mm; }
  h3 { font-size: 12pt; margin: 6mm 0 2mm; }
  h4 { font-size: 11pt; margin: 0 0 2mm; }

  ol.langkah { counter-reset: l; list-style: none; padding: 0; }
  ol.langkah > li { counter-increment: l; position: relative; padding-left: 12mm;
                    margin-bottom: 7mm; page-break-inside: avoid; }
  ol.langkah > li::before { content: counter(l); position: absolute; left: 0; top: 0;
    width: 8mm; height: 8mm; line-height: 8mm; text-align: center; border-radius: 50%;
    background: #f0e9f7; color: #461866; font-weight: bold; font-size: 10pt; }
  ol.langkah > li > h3 { margin-top: 0; }

  p { margin: 0 0 2.5mm; }
  ul { margin: 0 0 3mm; padding-left: 6mm; }
  li { margin-bottom: 1mm; }
  .kecil { font-size: 9.5pt; color: #555; }

  .catatan { background: #fff8e6; border-left: 3px solid #e0a800; padding: 2.5mm 3mm;
             font-size: 9.5pt; }
  .catatan-bab { background: #eef4ff; border-left: 3px solid #3b6fd4; padding: 2.5mm 3mm;
                 font-size: 10pt; }
  .kotak { border: 1px solid #e2e2e2; border-radius: 2mm; padding: 3mm 4mm; margin: 3mm 0;
           page-break-inside: avoid; }
  .sorot { background: #f7f2fb; border: 1px solid #d9c8ec; border-radius: 2mm;
           padding: 3mm 4mm; margin: 4mm 0; page-break-inside: avoid; }

  figure { margin: 3mm 0; page-break-inside: avoid; }
  figure img { max-width: 100%; border: 1px solid #ddd; border-radius: 1.5mm; }
  figcaption { font-size: 9pt; color: #777; margin-top: 1.5mm; font-style: italic; }
  figure.kosong .tanda { border: 2px dashed #c9c9c9; background: #fafafa; color: #999;
    padding: 14mm 4mm; text-align: center; border-radius: 1.5mm; font-size: 9.5pt; }

  .kategori { border: 1px solid #e6e6e6; border-left: 3px solid #461866; border-radius: 1.5mm;
              padding: 3mm 4mm; margin-bottom: 3mm; page-break-inside: avoid; }
  .knama { font-weight: bold; color: #461866; }
  .knama .kode { background: #f0e9f7; color: #6a3f95; font-size: 8.5pt; padding: 0.5mm 2mm;
                 border-radius: 1mm; margin-left: 2mm; font-weight: normal; }
  .kket { font-size: 9.5pt; color: #666; margin-top: 1mm; }
  .rantai { margin-top: 2.5mm; font-size: 9.5pt; }
  .rantai .anda { background: #461866; color: #fff; padding: 0.8mm 2.5mm; border-radius: 1mm; }
  .rantai .tahap { background: #f2f2f2; padding: 0.8mm 2.5mm; border-radius: 1mm; }
  .rantai .panah { color: #aaa; margin: 0 1.5mm; }
  .rantai .syarat { color: #888; font-size: 8.5pt; }
  .ambang { margin-top: 2mm; font-size: 9.5pt; color: #a05a00; background: #fff8e6;
            padding: 1.5mm 2.5mm; border-radius: 1mm; }
  .pisah { page-break-before: always; }
</style></head><body>

<div class="sampul">
  <div class="merek">PT KLA TEKNOLOGI INDONESIA</div>
  <h1>${doc.judul}</h1>
  <div class="sub">${doc.subjudul}</div>
  <div class="ring">${doc.ringkas}</div>
  <div class="kaki">
    EAPEX &mdash; Electronic Approval &amp; Capex<br>
    ${ALAMAT}<br>
    Disusun ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'Asia/Jakarta' }).format(new Date())}
  </div>
</div>

<div class="isi"><h2>Daftar Isi</h2><ol>${daftarIsi}</ol></div>
${isiBab}
</body></html>`;
}

// ---------------------------------------------------------------- cetak PDF
function cariChrome() {
  const kandidat = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean);
  return kandidat.find(p => fs.existsSync(p)) || null;
}

function cetak(chrome, htmlPath, pdfPath) {
  execFileSync(chrome, [
    '--headless', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer',
    `--print-to-pdf=${pdfPath}`, 'file:///' + htmlPath.replace(/\\/g, '/'),
  ], { stdio: 'pipe', timeout: 120000 });
}

// --------------------------------------------------------------------- main
(async () => {
  fs.mkdirSync(DIR_KELUAR, { recursive: true });
  fs.mkdirSync(DIR_GAMBAR, { recursive: true });

  const chrome = cariChrome();
  if (!chrome) {
    console.error('\n  Chrome/Edge tidak ditemukan - PDF tidak bisa dicetak.');
    console.error('  Setel CHROME_PATH ke lokasi chrome.exe lalu ulangi.\n');
    process.exit(1);
  }

  let kurang = 0;
  for (const doc of [CABANG, BACKOFFICE]) {
    const kategori = await bacaKategori(doc.wilayah);
    if (!kategori.length) {
      console.error(`\n  Tidak ada kategori untuk wilayah '${doc.wilayah}'. Basis data belum terisi?\n`);
      process.exit(1);
    }

    const html = render(doc, kategori);
    kurang += (html.match(/gambar belum diambil/g) || []).length;

    const namaBerkas = doc.kode === 'cabang' ? 'Tutorial-EAPEX-Cabang' : 'Tutorial-EAPEX-Back-Office';
    const htmlPath = path.join(DIR_KELUAR, namaBerkas + '.html');
    const pdfPath = path.join(DIR_KELUAR, namaBerkas + '.pdf');

    fs.writeFileSync(htmlPath, html, 'utf8');
    cetak(chrome, htmlPath, pdfPath);

    const kb = Math.round(fs.statSync(pdfPath).size / 1024);
    console.log(`  ${namaBerkas}.pdf  (${kb} KB, ${kategori.length} kategori)`);
  }

  if (kurang) {
    console.log(`\n  ${kurang} gambar belum ada - tempatnya ditandai kotak putus-putus di PDF.`);
    console.log(`  Taruh berkas PNG di: docs/tangkapan/  lalu jalankan ulang skrip ini.`);
  }
  console.log('');
  await db.tutup();
})().catch(async e => {
  console.error('\n  Gagal:', e.message, '\n');
  try { await db.tutup(); } catch (_) { /* abaikan */ }
  process.exit(1);
});
