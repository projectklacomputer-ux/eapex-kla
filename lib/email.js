// ============================================================================
//  Notifikasi lewat email (opsional)
// ============================================================================
// Kenapa ada: notifikasi HP baru sampai kalau orangnya memasang aplikasi,
// mengizinkan notifikasi, dan alamatnya HTTPS. Sebagian penyetuju tidak akan
// melakukannya. Email tidak menuntut apa pun dari penerimanya.
//
// Dua hal yang dipegang:
//
//  1. ALAMAT EMAIL TIDAK WAJIB. Alamat login (`pengguna.email`) dipakai untuk
//     masuk dan boleh berupa alamat yang tidak punya kotak surat sungguhan.
//     Alamat kiriman disimpan terpisah di `pengguna.email_notifikasi`; kalau
//     kosong, orangnya sekadar tidak dapat email — tanpa galat, tanpa menahan
//     siapa pun.
//  2. GAGAL KIRIM TIDAK PERNAH MENGGAGALKAN APPROVAL. Pola yang sama dengan
//     notifikasi HP: dikirim setelah transaksi selesai, kegagalan hanya dicatat.
const db = require('./db');
const { potong } = require('./util');

let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (e) { /* paket opsional */ }

const HOST = () => process.env.SMTP_HOST || '';
const DARI = () => process.env.SMTP_FROM || process.env.SMTP_USER || '';

function aktif() { return !!(nodemailer && HOST() && DARI()); }

let pengangkut = null;
function angkutan() {
  if (pengangkut) return pengangkut;
  const port = Number(process.env.SMTP_PORT || 587);
  pengangkut = nodemailer.createTransport({
    host: HOST(),
    port,
    // Port 465 memakai TLS sejak awal; 587 mulai polos lalu naik ke TLS (STARTTLS).
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === '1' : port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });
  return pengangkut;
}

// Alamat aplikasi dipakai untuk membuat tautan yang bisa diklik dari kotak surat.
// Tanpa itu emailnya tetap terkirim, hanya tanpa tautan — bukan tautan ke localhost
// yang tidak bisa dibuka siapa pun.
function alamatPenuh(jalur) {
  const dasar = String(process.env.ALAMAT_APLIKASI || '').replace(/\/+$/, '');
  if (!dasar) return null;
  return dasar + (jalur || '/');
}

function lolosHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function badanHtml({ judul, pesan, tautan, sapaan }) {
  const tombol = tautan
    ? `<p style="margin:24px 0"><a href="${lolosHtml(tautan)}"
         style="background:#461866;color:#f7bf0a;padding:11px 22px;border-radius:8px;
                text-decoration:none;font-weight:700;display:inline-block">Buka dokumen</a></p>`
    : '';
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#222;line-height:1.6">
  <div style="background:#461866;color:#f7bf0a;padding:14px 20px;font-weight:700;letter-spacing:.5px">EAPEX</div>
  <div style="padding:20px">
    ${sapaan ? `<p style="margin:0 0 12px">Halo ${lolosHtml(sapaan)},</p>` : ''}
    <p style="margin:0 0 8px;font-size:16px;font-weight:700">${lolosHtml(judul)}</p>
    <p style="margin:0;white-space:pre-line">${lolosHtml(pesan)}</p>
    ${tombol}
    <p style="margin:22px 0 0;color:#777;font-size:12px">
      Pesan otomatis dari EAPEX — Electronic Approval &amp; Capex, PT KLA Teknologi Indonesia.
      Mohon tidak membalas email ini.
    </p>
  </div>
</div>`;
}

// Mengirim ke DAFTAR PENGGUNA, bukan ke alamat mentah: pemanggilnya cukup tahu
// siapa yang perlu diberi tahu, tidak perlu tahu siapa yang punya alamat email.
async function kirimKe(penggunaIds, isi) {
  if (!aktif()) return { terkirim: 0, dilewati: 0, gagal: 0 };
  const daftarId = [...new Set((penggunaIds || []).filter(Boolean))];
  if (!daftarId.length) return { terkirim: 0, dilewati: 0, gagal: 0 };

  const tanda = daftarId.map(() => '?').join(',');
  let orang = [];
  try {
    orang = await db.all(
      `SELECT id, nama, email_notifikasi FROM pengguna
       WHERE aktif = 1 AND id IN (${tanda})`, daftarId);
  } catch (e) {
    console.warn('[email] gagal membaca penerima:', e.message);
    return { terkirim: 0, dilewati: 0, gagal: 1 };
  }

  const tautan = isi.url ? alamatPenuh(isi.url) : null;
  let terkirim = 0, dilewati = 0, gagal = 0;

  for (const u of orang) {
    const ke = String(u.email_notifikasi || '').trim();
    if (!ke) { dilewati++; continue; }         // memang tidak diisi — bukan galat
    try {
      await angkutan().sendMail({
        from: DARI(),
        to: ke,
        subject: '[EAPEX] ' + potong(isi.judul || 'Pemberitahuan', 120),
        text: (u.nama ? 'Halo ' + u.nama + ',\n\n' : '')
          + (isi.judul || '') + '\n\n' + (isi.pesan || '')
          + (tautan ? '\n\nBuka: ' + tautan : '')
          + '\n\n--\nEAPEX — PT KLA Teknologi Indonesia. Mohon tidak membalas email ini.',
        html: badanHtml({ judul: isi.judul || '', pesan: isi.pesan || '', tautan, sapaan: u.nama }),
      });
      terkirim++;
    } catch (e) {
      gagal++;
      console.warn('[email] gagal kirim ke', ke, '-', e.message);
    }
  }
  return { terkirim, dilewati, gagal };
}

// Dipakai halaman Admin untuk memberi tahu keadaan sebenarnya, bukan menebak.
function keterangan() {
  return {
    aktif: aktif(),
    host: HOST() || null,
    dari: DARI() || null,
    adaAlamatAplikasi: !!process.env.ALAMAT_APLIKASI,
    paketAda: !!nodemailer,
  };
}

module.exports = { aktif, kirimKe, keterangan, alamatPenuh };
