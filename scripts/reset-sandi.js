#!/usr/bin/env node
// Menyetel ulang sandi satu pengguna dari terminal — dipakai bila Administrator
// sendiri terkunci di luar aplikasi.
//
//   node scripts/reset-sandi.js admin@kla.co.id
//
// Sandi baru dibuat acak dan hanya ditampilkan sekali di layar (tidak ditulis ke
// berkas mana pun). Pengguna wajib menggantinya saat login berikutnya.
require('../lib/env')();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../lib/db');

const email = String(process.argv[2] || '').toLowerCase().trim();

(async () => {
  if (!email) {
    console.error('\n  Cara pakai: node scripts/reset-sandi.js <email>\n');
    process.exit(1);
  }
  const u = await db.get('SELECT id, nama, email FROM pengguna WHERE LOWER(email) = ?', [email]);
  if (!u) {
    console.error('\n  Pengguna dengan email tersebut tidak ditemukan.\n');
    process.exit(1);
  }
  const abjad = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const buf = crypto.randomBytes(12);
  let sandi = '';
  for (let i = 0; i < 12; i++) sandi += abjad[buf[i] % abjad.length];

  await db.run('UPDATE pengguna SET sandi_hash = ?, wajib_ganti_sandi = 1 WHERE id = ?',
    [bcrypt.hashSync(sandi, 10), u.id]);
  await db.run('DELETE FROM sesi');

  console.log('\n  Sandi ' + u.nama + ' (' + u.email + ') disetel ulang.');
  console.log('  Sandi sementara : ' + sandi);
  console.log('  Wajib diganti saat login pertama. Semua sesi login diakhiri.\n');
  await db.tutup();
})();
