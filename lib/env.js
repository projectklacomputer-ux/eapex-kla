// ============================================================================
//  Pembaca berkas .env sederhana (tanpa dependency tambahan)
// ============================================================================
// Hanya mengisi variabel yang BELUM ada di process.env, sehingga variabel dari
// sistem/hosting (Vercel) selalu menang atas berkas .env lokal.
const fs = require('fs');
const path = require('path');

module.exports = function muatEnv(berkas) {
  const target = berkas || path.join(__dirname, '..', '.env');
  let isi;
  try { isi = fs.readFileSync(target, 'utf8'); } catch (e) { return {}; }
  const hasil = {};
  for (const barisMentah of isi.split(/\r?\n/)) {
    const baris = barisMentah.trim();
    if (!baris || baris.startsWith('#')) continue;
    const pisah = baris.indexOf('=');
    if (pisah < 1) continue;
    const kunci = baris.slice(0, pisah).trim();
    let nilai = baris.slice(pisah + 1).trim();
    if ((nilai.startsWith('"') && nilai.endsWith('"')) || (nilai.startsWith("'") && nilai.endsWith("'"))) {
      nilai = nilai.slice(1, -1);
    }
    hasil[kunci] = nilai;
    if (process.env[kunci] === undefined) process.env[kunci] = nilai;
  }
  return hasil;
};
