#!/usr/bin/env node
// ============================================================================
//  Membuat ulang SANDI AWAL untuk akun yang belum pernah dipakai login
// ============================================================================
//   node scripts/akun-awal.js            -> hanya akun yang belum pernah login
//   node scripts/akun-awal.js --semua    -> SELURUH akun (sandi lama hangus)
//
// Sandi baru acak, wajib diganti saat login pertama, dan dicatat ke
// data/AKUN-AWAL.txt untuk dibagikan. Akun yang sudah pernah login TIDAK
// disentuh kecuali diminta dengan --semua, supaya sandi pilihan orang tidak
// ikut hangus hanya karena daftar akun perlu dicetak ulang.
require('../lib/env')();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../lib/db');
const { labelPeran } = require('../lib/konstanta');

const semua = process.argv.includes('--semua');

function sandiAcak() {
  const abjad = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const buf = crypto.randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) s += abjad[buf[i] % abjad.length];
  return s;
}

(async () => {
  const syarat = semua ? '' : 'WHERE login_terakhir IS NULL';
  const pengguna = await db.all(
    `SELECT id, nama, email, peran FROM pengguna ${syarat} ORDER BY nama`);

  if (!pengguna.length) {
    console.log('\n  Tidak ada akun yang perlu disetel ulang.');
    console.log('  (semua akun sudah pernah dipakai login — pakai --semua bila memang mau dipaksa)\n');
    await db.tutup();
    return;
  }

  const hasil = [];
  for (const u of pengguna) {
    const sandi = sandiAcak();
    await db.run('UPDATE pengguna SET sandi_hash = ?, wajib_ganti_sandi = 1 WHERE id = ?',
      [bcrypt.hashSync(sandi, 10), u.id]);
    hasil.push({ ...u, sandi });
  }
  await db.run('DELETE FROM sesi');    // sesi lama tidak boleh tetap hidup

  const berkas = path.join(__dirname, '..', 'data', 'AKUN-AWAL.txt');
  const isi = [
    '============================================================',
    ' EAPEX — DAFTAR AKUN AWAL',
    ' Dibuat: ' + new Date().toLocaleString('id-ID'),
    '',
    ' PENTING:',
    '  1. Semua akun ini WAJIB ganti sandi saat login pertama.',
    '  2. Hapus berkas ini setelah sandi dibagikan ke pemiliknya.',
    '  3. Berkas ini sudah masuk .gitignore — jangan pernah di-commit.',
    '============================================================',
    '',
    ...hasil.map(u => `${u.email.padEnd(28)} ${u.sandi.padEnd(14)} ${u.peran.padEnd(22)} ${u.nama}`),
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(berkas), { recursive: true });
  fs.writeFileSync(berkas, isi, 'utf8');

  console.log('\n  ' + hasil.length + ' akun disetel ulang sandinya' + (semua ? ' (SEMUA akun)' : ' (yang belum pernah login)'));
  console.log('  Tercatat di: ' + berkas);
  console.log('  Semua sesi login yang sedang berjalan diakhiri.\n');
  for (const u of hasil) console.log('   ' + u.email.padEnd(28) + u.sandi.padEnd(14) + labelPeran(u.peran));
  console.log('');
  await db.tutup();
})();
