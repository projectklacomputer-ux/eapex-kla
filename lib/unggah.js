// ============================================================================
//  Unggahan lampiran
// ============================================================================
// Berkas disimpan di data/lampiran dengan NAMA ACAK (bukan nama asli), dan hanya
// bisa diunduh lewat rute yang memeriksa wewenang. Nama asli disimpan di basis data.
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');

// Folder berkas bisa dialihkan lewat env — pengujian memakai folder sementara
// supaya lampiran sungguhan tidak pernah tersentuh (pelajaran dari AKUN-AWAL.txt).
//
// Di hosting tanpa cakram tetap (Vercel dan sejenisnya) satu-satunya folder yang
// boleh ditulisi adalah folder sementara sistem. Berkas di sana memang hilang,
// dan itu tidak apa-apa: pada mode SIMPANAN=db isinya langsung dipindahkan ke
// basis data begitu selesai diterima. Folder ini hanya tempat singgah multer.
const DIR = process.env.LAMPIRAN_DIR
  || (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
    ? path.join(require('os').tmpdir(), 'eapex-lampiran')
    : path.join(__dirname, '..', 'data', 'lampiran'));
fs.mkdirSync(DIR, { recursive: true });

const MIME_BOLEH = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/csv', 'text/plain',
]);
const EKST_BOLEH = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.xlsx', '.xls', '.docx', '.doc', '.csv', '.txt']);

const maksMB = Number(process.env.MAKS_LAMPIRAN_MB || 10);

const unggah = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase().slice(0, 8);
      cb(null, crypto.randomBytes(16).toString('hex') + (EKST_BOLEH.has(ext) ? ext : '.bin'));
    },
  }),
  limits: { fileSize: maksMB * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!EKST_BOLEH.has(ext) || !MIME_BOLEH.has(file.mimetype)) {
      return cb(Object.assign(new Error('Jenis berkas tidak diizinkan: ' + (file.originalname || '')), {
        publik: true, kode: 400,
      }));
    }
    cb(null, true);
  },
});

function jalurBerkas(namaSimpan) {
  // Cegah lompat folder: hanya nama dasar yang diterima.
  const aman = path.basename(String(namaSimpan || ''));
  return path.join(DIR, aman);
}

function hapusBerkas(namaSimpan) {
  try { fs.unlinkSync(jalurBerkas(namaSimpan)); } catch (e) { /* mungkin sudah hilang */ }
}

// Berkas ditulis ke cakram oleh multer SEBELUM rute sempat memutuskan apakah
// kiriman ini sah. Penjaga ini membuang berkas yang akhirnya tidak jadi dipakai
// — token CSRF salah, wewenang kurang, isian tidak lengkap, atau galat apa pun —
// sehingga tidak ada berkas yatim yang menumpuk di data/lampiran.
function bersihkanSisaBerkas(req, res, next) {
  res.on('close', () => {
    if (req.berkasDipakai) return;
    (req.files || []).forEach(f => hapusBerkas(f.filename));
  });
  next();
}

// Satu-satunya cara memasang penerima berkas. Pemeriksaan CSRF yang ditunda oleh
// lib/auth.js SELALU ikut terpasang di sini, jadi rute baru tidak bisa lupa.
function terimaBerkas(medan, maks) {
  const { csrfSetelahUnggah } = require('./auth');
  return [unggah.array(medan || 'berkas', maks || 10), csrfSetelahUnggah, bersihkanSisaBerkas];
}

module.exports = {
  unggah, terimaBerkas, bersihkanSisaBerkas,
  DIR, jalurBerkas, hapusBerkas, maksMB, EKST_BOLEH,
};
