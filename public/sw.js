/* ==========================================================================
   EAPEX — Service Worker
   Dua tugas: (1) membuat aplikasi bisa dipasang & tetap membuka layar yang
   sopan saat jaringan mati, (2) menerima notifikasi push approval.

   PENTING — halaman ISI dokumen sengaja TIDAK pernah disimpan di cache.
   Isi pengajuan memuat nominal, rekening, dan keputusan approval; kalau
   disimpan di HP, orang lain yang memegang HP itu bisa membacanya walau
   sudah logout. Yang disimpan hanya kerangka aplikasi (CSS, JS, ikon) dan
   satu halaman "sedang luring".
   ========================================================================== */
'use strict';

// Naikkan angka ini setiap kali berkas kerangka (CSS/JS/ikon) berubah — cache
// lama otomatis dibuang saat service worker versi baru aktif.
const VERSI = 'eapex-v3';
// CSS & JS TIDAK didaftarkan di sini: alamatnya bercap versi (mis. app.css?v=8f2a1c)
// yang hanya diketahui halaman. Keduanya tetap tersimpan otomatis saat pertama diambil
// lewat penangan fetch di bawah, dan versi barunya pasti terambil karena alamatnya berubah.
const KERANGKA = [
  '/gambar/ikon-192.png',
  '/gambar/ikon-512.png',
  '/gambar/favicon.svg',
  '/manifest.webmanifest',
  '/luring',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSI)
      .then(cache => cache.addAll(KERANGKA))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())      // gagal isi cache tidak boleh membatalkan pemasangan
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(nama => Promise.all(nama.filter(n => n !== VERSI).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;                       // kiriman data selalu ke jaringan

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;           // jangan pernah cache jawaban API

  // Kerangka aplikasi: pakai cache dulu supaya membuka aplikasi terasa seketika.
  const kerangka = /^\/(css|js|gambar)\//.test(url.pathname) || url.pathname === '/manifest.webmanifest';
  if (kerangka) {
    event.respondWith(
      caches.match(req).then(tersimpan => tersimpan || fetch(req).then(jawab => {
        if (jawab && jawab.ok) {
          const salinan = jawab.clone();
          caches.open(VERSI).then(c => c.put(req, salinan));
        }
        return jawab;
      }))
    );
    return;
  }

  // Halaman: SELALU dari jaringan. Kalau jaringan mati, tampilkan layar luring.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/luring').then(l => l || new Response(
        '<h1>Tidak ada jaringan</h1>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })))
    );
  }
});

/* ---------------------------------------------------------------- notifikasi */
self.addEventListener('push', event => {
  let isi = {};
  try { isi = event.data ? event.data.json() : {}; } catch (e) { isi = {}; }

  const judul = isi.judul || 'EAPEX';
  const opsi = {
    body: isi.pesan || 'Ada dokumen yang perlu Anda periksa.',
    icon: '/gambar/ikon-192.png',
    badge: '/gambar/ikon-192.png',
    tag: isi.tag || 'eapex-approval',
    renotify: true,
    requireInteraction: false,
    data: { url: isi.url || '/approval' },
    actions: [{ action: 'buka', title: 'Buka dokumen' }],
  };
  event.waitUntil(self.registration.showNotification(judul, opsi));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const tujuan = (event.notification.data && event.notification.data.url) || '/approval';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(jendela => {
      for (const j of jendela) {
        if (j.url.indexOf(self.location.origin) === 0 && 'focus' in j) {
          j.navigate(tujuan);
          return j.focus();
        }
      }
      return self.clients.openWindow(tujuan);
    })
  );
});
