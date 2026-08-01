#!/usr/bin/env node
// ============================================================================
//  Membuat sepasang kunci VAPID untuk notifikasi push
// ============================================================================
//   npm run kunci-push
//
// Salin hasilnya ke berkas .env. Kunci ini menandai server Anda ke layanan
// notifikasi Google/Apple/Mozilla — cukup dibuat SEKALI. Kalau kunci diganti,
// semua HP yang sudah berlangganan harus mengaktifkan notifikasi ulang.
const webpush = require('web-push');

const kunci = webpush.generateVAPIDKeys();

console.log('\n  Salin dua baris ini ke berkas .env:\n');
console.log('VAPID_PUBLIC_KEY=' + kunci.publicKey);
console.log('VAPID_PRIVATE_KEY=' + kunci.privateKey);
console.log('VAPID_SUBJECT=mailto:admin@kla.co.id');
console.log('\n  Simpan baik-baik. Kunci rahasia jangan pernah dibagikan atau di-commit.\n');
