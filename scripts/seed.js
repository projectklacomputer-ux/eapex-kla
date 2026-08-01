#!/usr/bin/env node
// Membentuk struktur tabel + data awal tanpa menyalakan server.
// Aman dijalankan berulang: tabel yang sudah ada tidak dibuat ulang,
// data awal hanya ditanam bila tabelnya masih kosong.
require('../lib/env')();
const { siapkan } = require('../lib/skema');
const db = require('../lib/db');

(async () => {
  try {
    await siapkan();
    const n = await db.nilai('SELECT COUNT(*) AS n FROM pengguna');
    const k = await db.nilai('SELECT COUNT(*) AS n FROM kategori');
    console.log(`\n  Selesai. Basis data: ${db.jenis}. Pengguna: ${n}. Kategori: ${k}.\n`);
    await db.tutup();
  } catch (e) {
    console.error('\n  Gagal:', e.message, '\n');
    process.exit(1);
  }
})();
