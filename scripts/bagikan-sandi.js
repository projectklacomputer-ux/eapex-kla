#!/usr/bin/env node
// ============================================================================
//  Memecah daftar akun awal menjadi satu berkas per orang.
// ============================================================================
//  Berkas AKUN-AWAL-*.txt memuat SELURUH sandi dalam satu daftar. Kalau
//  diteruskan apa adanya, satu orang memegang kunci 26 akun lain - termasuk
//  CEO dan Accounting, di sistem yang menyetujui pengeluaran.
//
//  Skrip ini membuat satu berkas per orang berisi hanya kredensialnya sendiri,
//  siap disalin ke WhatsApp atau email satu per satu.
//
//  Jalankan:  node scripts/bagikan-sandi.js [berkas-sumber]
//  Bawaan sumber: data/AKUN-AWAL-SUPABASE.txt
// ============================================================================

const fs = require('fs');
const path = require('path');

const AKAR = path.join(__dirname, '..');
const sumber = process.argv[2] || path.join(AKAR, 'data', 'AKUN-AWAL-SUPABASE.txt');
const tujuan = path.join(AKAR, 'data', 'bagikan');

if (!fs.existsSync(sumber)) {
  console.error(`\n  Berkas sumber tidak ada: ${sumber}\n`);
  process.exit(1);
}

// Baris akun berbentuk: email  sandi  peran  nama (dipisah >=2 spasi)
const akun = [];
for (const baris of fs.readFileSync(sumber, 'utf8').split(/\r?\n/)) {
  if (!baris.includes('@') || /^\s*[-=]/.test(baris)) continue;
  const p = baris.trim().split(/\s{2,}/).filter(Boolean);
  if (p.length < 3 || !/^\S+@\S+$/.test(p[0])) continue;
  akun.push({ email: p[0], sandi: p[1], peran: p[2], nama: p.slice(3).join(' ') || p[2] });
}

if (!akun.length) {
  console.error('\n  Tidak ada baris akun yang terbaca. Bentuk berkasnya mungkin berbeda.\n');
  process.exit(1);
}

const ALAMAT = process.env.ALAMAT_APLIKASI || 'https://eapex-kla.vercel.app';

fs.rmSync(tujuan, { recursive: true, force: true });
fs.mkdirSync(tujuan, { recursive: true });

for (const a of akun) {
  const isi = [
    'EAPEX - Aplikasi Persetujuan Biaya & CAPEX',
    'PT KLA Teknologi Indonesia',
    '',
    `Berikut akun Anda${a.nama ? ' sebagai ' + a.nama : ''}:`,
    '',
    `  Alamat : ${ALAMAT}`,
    `  Email  : ${a.email}`,
    `  Sandi  : ${a.sandi}`,
    '',
    'Sandi di atas sandi sementara. Saat masuk pertama kali, sistem akan',
    'meminta Anda menggantinya - pilih sandi yang hanya Anda yang tahu.',
    '',
    'Aplikasi ini bisa dibuka dari HP maupun komputer. Di HP, buka alamatnya',
    'lewat peramban lalu pilih "Tambahkan ke layar utama" supaya bisa menerima',
    'pemberitahuan saat ada dokumen yang menunggu persetujuan Anda.',
    '',
    'Jangan meneruskan pesan ini ke orang lain.',
    '',
  ].join('\n');

  const namaBerkas = a.email.replace(/[^a-zA-Z0-9.\-_]/g, '_') + '.txt';
  fs.writeFileSync(path.join(tujuan, namaBerkas), isi, 'utf8');
}

console.log(`\n  ${akun.length} berkas dibuat di: ${tujuan}`);
console.log('  Satu berkas per orang, masing-masing hanya memuat kredensialnya sendiri.');
console.log('\n  Folder ini ada di dalam data/ sehingga tidak akan pernah ikut ter-push.');
console.log('  Hapus setelah semua sandi dibagikan:  Remove-Item -Recurse data\\bagikan\n');
