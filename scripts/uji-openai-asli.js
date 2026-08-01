#!/usr/bin/env node
// ============================================================================
//  Menguji pembacaan penawaran ke OpenAI SUNGGUHAN - tanpa menyentuh produksi
// ============================================================================
//  Bedanya dengan `npm run uji-baca`: yang itu memakai server OpenAI tiruan
//  dan menguji pengamanannya. Yang ini benar-benar memanggil OpenAI, untuk
//  membuktikan kuncinya dipakai dan hasil bacanya masuk akal.
//
//  Yang TIDAK disentuh sama sekali:
//    - basis data mana pun (Supabase maupun data/eapex.db) - skrip ini tidak
//      pernah me-require lib/db
//    - aplikasi yang hidup di Vercel
//    - berkas .env
//
//  Kunci dibaca dari data/openai.txt, dipakai hanya di dalam proses ini, lalu
//  berkasnya dihapus. Kunci tidak pernah ditampilkan.
//
//  Biayanya sekitar seperseribu dolar sekali jalan.
//
//  Jalankan:  node scripts/uji-openai-asli.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const os = require('os');

const AKAR = path.join(__dirname, '..');
const BERKAS_KUNCI = path.join(AKAR, 'data', 'openai.txt');

// Kunci dipasang SEBELUM lib/ai-penawaran dimuat, dan hanya di proses ini.
if (!fs.existsSync(BERKAS_KUNCI)) {
  console.error('\n  Berkas data\\openai.txt belum ada.\n');
  console.error('  Kunci yang sudah terpasang di Vercel tidak bisa ditarik kembali');
  console.error('  (disimpan terenkripsi), jadi untuk menguji ia perlu ditempel sekali lagi.\n');
  console.error('  Jalankan:  notepad data\\openai.txt');
  console.error('  Tempel kuncinya, Ctrl+S, tutup, lalu ulangi perintah ini.\n');
  process.exit(1);
}
const kunci = fs.readFileSync(BERKAS_KUNCI, 'utf8').replace(/^﻿/, '').trim();
if (!/^sk-/.test(kunci)) { console.error('\n  Isi data\\openai.txt bukan kunci OpenAI.\n'); process.exit(1); }
process.env.OPENAI_API_KEY = kunci;
process.env.OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const ai = require('../lib/ai-penawaran');
const xlsx = require('../lib/xlsx-tulis');

const rupiah = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');

// --- penawaran contoh --------------------------------------------------------
// Sengaja dibuat seperti penawaran vendor sungguhan: ada kop, ada baris yang
// bukan barang, harga bertitik, dan PPN terpisah. Penawaran yang rapi tidak
// membuktikan apa-apa.
const KOLOM = [
  { judul: 'Nama Barang', lebar: 34 },
  { judul: 'Qty', lebar: 8 },
  { judul: 'Satuan', lebar: 10 },
  { judul: 'Harga Satuan', lebar: 18, uang: true },
];

const BARIS = [
  ['PT SUMBER JAYA TEKNIK', '', '', ''],
  ['Jl. Contoh No. 12, Semarang', '', '', ''],
  ['PENAWARAN HARGA No. 0451/PH/VIII/2026', '', '', ''],
  ['', '', '', ''],
  ['AC Split 2 PK Inverter', 3, 'unit', 7450000],
  ['Bracket outdoor + pipa 5m', 3, 'set', 685000],
  ['Jasa pasang + vakum', 3, 'titik', 450000],
  ['', '', '', ''],
  ['Subtotal', '', '', 25755000],
  ['PPN 11%', '', '', 2833050],
  ['Total', '', '', 28588050],
  ['', '', '', ''],
  ['Harga sudah termasuk PPN 11%', '', '', ''],
  ['Berlaku 14 hari', '', '', ''],
];

(async () => {
  console.log('\n  ===============================================');
  console.log('   Uji baca penawaran -> OpenAI sungguhan');
  console.log('  ===============================================\n');
  console.log(`  Model      : ${ai.MODEL()}`);
  console.log(`  Kunci      : ${kunci.length} huruf, berakhiran ...${kunci.slice(-4)}`);
  console.log(`  Aktif      : ${ai.aktif()}`);
  console.log('  Produksi   : TIDAK disentuh (skrip ini tidak memuat lib/db)\n');

  const jalur = path.join(os.tmpdir(), 'penawaran-contoh.xlsx');
  fs.writeFileSync(jalur, xlsx.buat({ namaLembar: 'Penawaran', kolom: KOLOM, baris: BARIS }));
  console.log(`  Penawaran contoh dibuat: ${Math.round(fs.statSync(jalur).size / 1024)} KB\n`);

  const t0 = Date.now();
  const r = await ai.baca([{ nama: 'Penawaran-Contoh.xlsx', isi: fs.readFileSync(jalur), mime: '' }]);
  const detik = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`  Dibaca dalam ${detik} detik.\n`);
  console.log('  --- HASIL BACA ---');
  const h = r.hasil || {};
  if (h.vendor) console.log(`  Vendor    : ${h.vendor}`);
  if (h.nomor)  console.log(`  Nomor     : ${h.nomor}`);
  if (h.mata_uang) console.log(`  Mata uang : ${h.mata_uang}`);
  console.log('');
  for (const it of (h.items || [])) {
    console.log(`   ${String(it.qty).padStart(3)} ${(it.satuan || '').padEnd(7)} ${(it.nama || '').slice(0, 40).padEnd(42)} ${rupiah(it.harga).padStart(16)}`);
  }
  console.log('');
  if (h.total != null) console.log(`  Total menurut model : ${rupiah(h.total)}`);

  const jumlahBaris = (h.items || []).reduce((a, it) => a + (it.qty || 0) * (it.harga || 0), 0);
  console.log(`  Jumlah baris        : ${rupiah(jumlahBaris)}`);
  console.log(`  Seharusnya (DPP)    : ${rupiah(25755000)}`);
  console.log(`  Seharusnya (+PPN)   : ${rupiah(28588050)}`);

  if (r.peringatan && r.peringatan.length) {
    console.log('\n  --- PERINGATAN ---');
    for (const p of r.peringatan) console.log('   - ' + p);
  }

  if (r.pemakaian) {
    const t = r.pemakaian;
    // Harga gpt-4o-mini per 1 juta token (Agustus 2026): masuk $0,15 / keluar $0,60
    const biaya = ((t.prompt_tokens || 0) / 1e6) * 0.15 + ((t.completion_tokens || 0) / 1e6) * 0.60;
    console.log('\n  --- PEMAKAIAN ---');
    console.log(`   token masuk  : ${t.prompt_tokens}`);
    console.log(`   token keluar : ${t.completion_tokens}`);
    console.log(`   perkiraan biaya sekali baca: US$ ${biaya.toFixed(5)}`);
  }

  fs.unlinkSync(jalur);
  fs.unlinkSync(BERKAS_KUNCI);
  console.log('\n  data\\openai.txt dihapus. Penawaran contoh dihapus.');
  console.log('  Tidak ada satu pun data produksi yang tersentuh.\n');
})().catch(e => {
  console.error('\n  GAGAL:', e.message);
  if (e.kode) console.error('  kode:', e.kode);
  console.error('');
  console.error('  Berkas kunci TIDAK dihapus supaya bisa diperiksa dan dicoba lagi.\n');
  process.exit(1);
});
