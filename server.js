// ============================================================================
//  Titik masuk EAPEX
// ============================================================================
require('./lib/env')();                 // muat .env sebelum modul lain membaca konfigurasi

const { siapkan } = require('./lib/skema');
const app = require('./app');

const PORT = Number(process.env.PORT || 4700);

(async () => {
  try {
    await siapkan();
  } catch (e) {
    console.error('\n  Gagal menyiapkan basis data:', e.message);
    console.error('  Aplikasi dihentikan supaya tidak berjalan dengan data setengah jadi.\n');
    process.exit(1);
  }

  // Pengingat harian hanya dinyalakan di sini, bukan di app.js: app.js juga
  // dimuat oleh pengujian dan oleh titik masuk hosting tanpa server tetap, dan
  // keduanya tidak boleh diam-diam menjalankan penjadwal.
  require('./lib/pengingat').mulaiPenjadwal();

  app.listen(PORT, () => {
    const jenis = require('./lib/db').jenis;
    console.log('\n  ============================================');
    console.log('   EAPEX — Electronic Approval & Capex');
    console.log('   PT KLA TEKNOLOGI INDONESIA');
    console.log('  ============================================');
    console.log('   Basis data : ' + (jenis === 'pg' ? 'PostgreSQL' : 'SQLite lokal (data/eapex.db)'));
    console.log('   Alamat     : http://localhost:' + PORT);
    console.log('  ============================================\n');
  });
})();
