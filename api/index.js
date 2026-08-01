// ============================================================================
//  Titik masuk untuk hosting tanpa server tetap (Vercel dan sejenisnya)
// ============================================================================
// Bedanya dengan server.js: di sini aplikasi TIDAK memanggil app.listen().
// Hosting-lah yang memanggil fungsi ini untuk setiap permintaan.
//
// Penyiapan basis data dijalankan sekali lalu diingat dalam satu Promise —
// beberapa permintaan bisa datang bersamaan pada contoh yang baru menyala, dan
// menjalankan penyiapan berkali-kali sekaligus akan saling tunggu.
require('../lib/env')();

const app = require('../app');
const { siapkan } = require('../lib/skema');

let penyiapan = null;

module.exports = async (req, res) => {
  try {
    if (!penyiapan) penyiapan = siapkan({ senyap: true });
    await penyiapan;
  } catch (e) {
    // Percobaan berikutnya harus menyiapkan ulang, bukan memakai kegagalan lama.
    penyiapan = null;
    console.error('[api] gagal menyiapkan basis data', e);
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ ok: false, pesan: 'Basis data belum siap. Coba lagi sebentar lagi.' }));
  }
  return app(req, res);
};
