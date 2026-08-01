// ============================================================================
//  Notifikasi push ke HP (Web Push / VAPID)
// ============================================================================
// Menyala hanya bila VAPID_PUBLIC_KEY & VAPID_PRIVATE_KEY diisi. Tanpa itu
// aplikasi tetap berjalan normal — notifikasi cukup muncul di dalam aplikasi.
//
// Syarat dari peramban (bukan dari aplikasi ini):
//   - Alamat harus HTTPS. Pengecualian hanya http://localhost untuk uji coba.
//   - iPhone/iPad: aplikasi WAJIB dipasang dulu lewat Bagikan > Add to Home Screen,
//     baru izin notifikasi bisa diminta (aturan Apple sejak iOS 16.4).
const webpush = require('web-push');
const db = require('./db');
const { id, sekarang, potong } = require('./util');

const KUNCI_PUBLIK = process.env.VAPID_PUBLIC_KEY || '';
const KUNCI_RAHASIA = process.env.VAPID_PRIVATE_KEY || '';
const SURAT = process.env.VAPID_SUBJECT || 'mailto:admin@kla.co.id';

let siap = false;
if (KUNCI_PUBLIK && KUNCI_RAHASIA) {
  try {
    webpush.setVapidDetails(SURAT, KUNCI_PUBLIK, KUNCI_RAHASIA);
    siap = true;
  } catch (e) {
    console.warn('[push] kunci VAPID tidak sah, notifikasi HP dimatikan: ' + e.message);
  }
}

const aktif = () => siap;
const kunciPublik = () => (siap ? KUNCI_PUBLIK : '');

// --------------------------------------------------------------- langganan
async function simpanLangganan(penggunaId, langganan, peramban) {
  if (!langganan || !langganan.endpoint || !langganan.keys || !langganan.keys.p256dh || !langganan.keys.auth) {
    throw Object.assign(new Error('Data langganan notifikasi tidak lengkap'), { publik: true, kode: 400 });
  }
  const endpoint = String(langganan.endpoint);
  if (!/^https:\/\//.test(endpoint)) {
    throw Object.assign(new Error('Alamat layanan notifikasi tidak sah'), { publik: true, kode: 400 });
  }
  // Satu endpoint = satu peramban di satu HP. Kalau HP itu dipakai orang lain
  // (login berganti), kepemilikannya ikut berpindah supaya notifikasi tidak
  // nyasar ke pemilik akun sebelumnya.
  await db.run(
    `INSERT INTO langganan_push (id, pengguna_id, endpoint, p256dh, auth, peramban, dibuat)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT (endpoint) DO UPDATE SET pengguna_id = excluded.pengguna_id,
       p256dh = excluded.p256dh, auth = excluded.auth, peramban = excluded.peramban`,
    [id(), penggunaId, endpoint, String(langganan.keys.p256dh), String(langganan.keys.auth),
      potong(peramban || '', 200), sekarang()]);
}

async function hapusLangganan(endpoint) {
  if (!endpoint) return;
  await db.run('DELETE FROM langganan_push WHERE endpoint = ?', [String(endpoint)]);
}

async function jumlahLangganan(penggunaId) {
  const n = await db.nilai('SELECT COUNT(*) AS n FROM langganan_push WHERE pengguna_id = ?', [penggunaId]);
  return Number(n || 0);
}

// --------------------------------------------------------------- pengiriman
// Tidak pernah melempar galat: notifikasi adalah kemudahan, bukan syarat sah
// approval. Kegagalan kirim hanya dicatat, alur dokumen jalan terus.
async function kirimKe(penggunaIds, isi) {
  if (!siap) return { terkirim: 0, gagal: 0, mati: 0 };
  const daftarId = [...new Set((penggunaIds || []).filter(Boolean))];
  if (!daftarId.length) return { terkirim: 0, gagal: 0, mati: 0 };

  const tanda = daftarId.map(() => '?').join(',');
  let langganan = [];
  try {
    langganan = await db.all(`SELECT * FROM langganan_push WHERE pengguna_id IN (${tanda})`, daftarId);
  } catch (e) {
    console.warn('[push] gagal membaca langganan: ' + e.message);
    return { terkirim: 0, gagal: 1, mati: 0 };
  }

  const muatan = JSON.stringify({
    judul: potong(isi.judul || 'EAPEX', 120),
    pesan: potong(isi.pesan || '', 300),
    url: isi.url || '/approval',
    tag: isi.tag || 'eapex',
  });

  let terkirim = 0, gagal = 0, mati = 0;
  for (const l of langganan) {
    const tujuan = { endpoint: l.endpoint, keys: { p256dh: l.p256dh, auth: l.auth } };
    try {
      await webpush.sendNotification(tujuan, muatan, { TTL: 12 * 3600 });
      terkirim++;
      await db.run('UPDATE langganan_push SET terakhir_dipakai = ? WHERE id = ?', [sekarang(), l.id]);
    } catch (e) {
      // 404/410 = langganan sudah tidak berlaku (aplikasi dicopot / izin dicabut).
      if (e && (e.statusCode === 404 || e.statusCode === 410)) {
        mati++;
        try { await db.run('DELETE FROM langganan_push WHERE id = ?', [l.id]); } catch (x) { /* abaikan */ }
      } else {
        gagal++;
        console.warn('[push] gagal kirim: ' + (e && e.message ? e.message : e));
      }
    }
  }
  return { terkirim, gagal, mati };
}

module.exports = { aktif, kunciPublik, simpanLangganan, hapusLangganan, jumlahLangganan, kirimKe };
