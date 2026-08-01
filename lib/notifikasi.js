// ============================================================================
//  Notifikasi
// ============================================================================
// Selalu tercatat di dalam aplikasi (lonceng di kanan atas). Kalau env Telegram
// diisi, pesan yang sama dikirim juga ke Telegram — kegagalan pengiriman TIDAK
// boleh menggagalkan alur approval, jadi dibungkus try/catch dan hanya dicatat.
const db = require('./db');
const { id, sekarang } = require('./util');

async function simpan(ops, { pengguna_id, pengajuan_id, judul, pesan }) {
  await (ops || db).run(
    'INSERT INTO notifikasi (id, pengguna_id, pengajuan_id, judul, pesan, dibaca, dibuat) VALUES (?,?,?,?,?,0,?)',
    [id(), pengguna_id, pengajuan_id || null, judul, pesan || null, sekarang()]);
}

async function simpanBanyak(ops, penggunaIds, isi) {
  for (const uid of new Set(penggunaIds.filter(Boolean))) {
    await simpan(ops, { ...isi, pengguna_id: uid });
  }
}

async function daftar(penggunaId, batas = 15) {
  return db.all(
    'SELECT * FROM notifikasi WHERE pengguna_id = ? ORDER BY dibuat DESC LIMIT ' + Number(batas), [penggunaId]);
}

async function jumlahBelumDibaca(penggunaId) {
  const n = await db.nilai('SELECT COUNT(*) AS n FROM notifikasi WHERE pengguna_id = ? AND dibaca = 0', [penggunaId]);
  return Number(n || 0);
}

async function tandaiDibaca(penggunaId, notifId) {
  if (notifId) await db.run('UPDATE notifikasi SET dibaca = 1 WHERE id = ? AND pengguna_id = ?', [notifId, penggunaId]);
  else await db.run('UPDATE notifikasi SET dibaca = 1 WHERE pengguna_id = ?', [penggunaId]);
}

// --------------------------------------------------------------- Telegram (opsional)
async function keTelegram(teks) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: teks, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!r.ok) console.warn('[notifikasi] Telegram menolak:', r.status);
    return r.ok;
  } catch (e) {
    console.warn('[notifikasi] Telegram gagal:', e.message);
    return false;
  }
}

// --------------------------------------------------------------- kirim ke luar
// Satu pintu untuk semua saluran keluar: notifikasi HP dan email. Pemanggilnya
// cukup tahu SIAPA yang perlu diberi tahu; saluran mana yang hidup ditentukan
// oleh env, dan yang mati sekadar dilewati.
//
// WAJIB dipanggil SETELAH transaksi basis data selesai. Jaringan yang lambat
// tidak boleh menahan kunci basis data, dan gagal kirim tidak boleh membatalkan
// approval yang sudah sah tersimpan — karena itu kegagalannya hanya dicatat.
function keLuar(penggunaIds, isi) {
  const push = require('./push');
  const email = require('./email');
  push.kirimKe(penggunaIds, isi).catch(e => console.warn('[kabar] notifikasi HP gagal:', e.message));
  email.kirimKe(penggunaIds, isi).catch(e => console.warn('[kabar] email gagal:', e.message));
}

module.exports = {
  simpan, simpanBanyak, daftar, jumlahBelumDibaca, tandaiDibaca, keTelegram, keLuar,
};
