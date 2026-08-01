#!/usr/bin/env node
// ============================================================================
//  UJI KIRIM NOTIFIKASI HP  —  dijalankan otomatis oleh `npm run cek`
// ============================================================================
// Membuktikan rantai lengkapnya: dokumen diajukan → notifikasi BENAR-BENAR
// dikirim ke layanan push milik penyetuju yang tepat, dengan isi yang benar.
//
// Caranya: sebuah server kecil dijalankan di komputer ini untuk berpura-pura
// menjadi layanan notifikasi Google/Apple. Langganan penyetuju diarahkan ke
// server itu, lalu dilihat apakah permintaannya sungguh datang.
//
// Dijalankan sebagai proses terpisah karena bagian ini perlu kunci VAPID terisi,
// sedangkan pemeriksaan lain justru menguji keadaan tanpa kunci.
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const webpush = require('web-push');

const AKAR = path.join(__dirname, '..');
const kunci = webpush.generateVAPIDKeys();

process.env.SQLITE_PATH = path.join(os.tmpdir(), 'eapex-push-' + process.pid + '.db');
delete process.env.DATABASE_URL;
process.env.SESSION_SECRET = 'uji-push-0123456789abcdefghij';
process.env.NODE_ENV = 'test';
process.env.VAPID_PUBLIC_KEY = kunci.publicKey;
process.env.VAPID_PRIVATE_KEY = kunci.privateKey;
process.env.VAPID_SUBJECT = 'mailto:uji@kla.co.id';

// Pustaka pengirim notifikasi SELALU memakai HTTPS — memang begitu seharusnya,
// karena layanan notifikasi Google/Apple hanya melayani HTTPS. Khusus di dalam
// pengujian ini, panggilan ke 127.0.0.1 dibelokkan ke HTTP biasa supaya server
// tiruan di komputer sendiri bisa menerimanya tanpa perlu sertifikat.
// Pembelokan ini HANYA ada di berkas uji, tidak pernah ikut ke aplikasi.
const https = require('https');
const requestAsli = https.request;
https.request = function (opsi, ...sisa) {
  const inang = typeof opsi === 'string' ? new URL(opsi).hostname : (opsi && (opsi.hostname || opsi.host));
  if (inang === '127.0.0.1') return http.request(opsi, ...sisa);
  return requestAsli.call(this, opsi, ...sisa);
};

const bcrypt = require('bcryptjs');
const SANDI = 'UjiPush12345';

let gagal = 0;
const ok = t => console.log('  \x1b[32m✓\x1b[0m ' + t);
const no = t => { gagal++; console.log('  \x1b[31m✗ ' + t + '\x1b[0m'); };
const cek = (syarat, teks) => (syarat ? ok(teks) : no(teks));

// --------------------------------------------------------------- klien HTTP
function buatKlien(dasar) {
  const kue = new Map();
  const kepala = () => {
    const c = [...kue.entries()].map(([k, v]) => k + '=' + v).join('; ');
    return c ? { cookie: c } : {};
  };
  const simpan = r => {
    for (const b of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) {
      const [p] = b.split(';');
      const i = p.indexOf('=');
      if (i > 0) kue.set(p.slice(0, i).trim(), p.slice(i + 1).trim());
    }
  };
  return {
    async get(j) {
      const r = await fetch(dasar + j, { headers: kepala(), redirect: 'manual' });
      simpan(r);
      return r.status === 302 ? '' : r.text();
    },
    async post(j, medan, token) {
      const body = new URLSearchParams();
      body.append('_csrf', token);
      for (const [k, v] of medan) body.append(k, String(v));
      const r = await fetch(dasar + j, {
        method: 'POST', redirect: 'manual',
        headers: { ...kepala(), 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      simpan(r);
      return r;
    },
    async postBerkas(j, medan, berkas, token) {
      const fd = new FormData();
      fd.append('_csrf', token);
      for (const [k, v] of medan) fd.append(k, String(v));
      for (const b of berkas) fd.append('berkas', new Blob([b.isi], { type: b.mime }), b.nama);
      const r = await fetch(dasar + j, { method: 'POST', redirect: 'manual', headers: kepala(), body: fd });
      simpan(r);
      return r;
    },
    async csrf(j) { return /name="_csrf" value="([^"]+)"/.exec(await this.get(j))[1]; },
    async masuk(email) {
      const t = await this.csrf('/login');
      return this.post('/login', [['email', email], ['sandi', SANDI], ['tujuan', '/']], t);
    },
  };
}

(async () => {
  console.log('\n\x1b[1mUJI KIRIM NOTIFIKASI HP\x1b[0m');

  // --- layanan notifikasi tiruan
  const diterima = [];
  const layanan = http.createServer((req, res) => {
    const potongan = [];
    req.on('data', c => potongan.push(c));
    req.on('end', () => {
      diterima.push({
        jalur: req.url,
        metode: req.method,
        kepala: req.headers,
        panjangIsi: Buffer.concat(potongan).length,
        isiMentah: Buffer.concat(potongan),
      });
      res.writeHead(201).end();
    });
  });
  await new Promise(r => layanan.listen(0, '127.0.0.1', r));
  const alamatLayanan = 'http://127.0.0.1:' + layanan.address().port;

  const db = require(AKAR + '/lib/db');
  await require(AKAR + '/lib/skema').siapkan({ senyap: true });
  await db.run('UPDATE pengguna SET sandi_hash = ?, wajib_ganti_sandi = 0', [bcrypt.hashSync(SANDI, 10)]);

  const push = require(AKAR + '/lib/push');
  cek(push.aktif() === true, 'modul notifikasi hidup saat kunci VAPID terisi');

  const app = require(AKAR + '/app');
  const server = await new Promise(res => { const s = app.listen(0, () => res(s)); });
  const dasar = 'http://127.0.0.1:' + server.address().port;

  const { id, sekarang } = require(AKAR + '/lib/util');
  const idDari = async email => db.nilai('SELECT id FROM pengguna WHERE email = ?', [email]);

  // Kunci langganan harus kunci ECDH P-256 SUNGGUHAN (65 byte), bukan teks asal —
  // isi notifikasi dienkripsi memakai kunci ini. Memakai kunci palsu membuat
  // pengujian lolos di penyimpanan tapi gagal saat benar-benar dikirim.
  const crypto = require('crypto');
  function kunciLangganan() {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    return {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: crypto.randomBytes(16).toString('base64url'),
    };
  }

  // Langganan disisipkan langsung ke basis data supaya bisa diarahkan ke layanan
  // tiruan (rute biasa menolak alamat non-HTTPS — itu memang disengaja).
  const daftarLangganan = async (email, jalur) => {
    const kk = kunciLangganan();
    await db.run(
      `INSERT INTO langganan_push (id, pengguna_id, endpoint, p256dh, auth, peramban, dibuat)
       VALUES (?,?,?,?,?,?,?)`,
      [id(), await idDari(email), alamatLayanan + jalur,
        kk.p256dh, kk.auth, 'Uji/1.0', sekarang()]);
  };
  await daftarLangganan('am.barat@kla.co.id', '/hp-area-manager');
  await daftarLangganan('regional@kla.co.id', '/hp-regional-manager');
  await daftarLangganan('ceo@kla.co.id', '/hp-ceo');

  // --- ajukan satu dokumen CAPEX
  const sm = buatKlien(dasar);
  await sm.masuk('sm.smg@kla.co.id');
  const kat = await db.get("SELECT * FROM kategori WHERE kode = 'CAPEX'");
  const atur = await db.get("SELECT * FROM aturan WHERE kategori_id = ? AND wilayah = 'store'", [kat.id]);
  const cab = await db.get("SELECT * FROM cabang WHERE kode = 'SMG'");
  const t = await sm.csrf('/pengajuan/baru/CAPEX');
  await sm.postBerkas('/pengajuan', [
    ['kategori_id', kat.id], ['aturan_id', atur.id], ['cabang_id', cab.id],
    ['judul', 'Pengadaan AC area kasir'], ['nama_proyek', 'Peremajaan pendingin'],
    ['justifikasi', 'AC lama sering bocor.'],
    ['tujuan[]', 'efisiensi'], ['kategori_aset', 'Inventaris'],
    ['deskripsi', 'AC 2 PK inverter'], ['lokasi', 'Area kasir'], ['vendor', 'PT Sumber Elektronik'],
    ['jadwal_kebutuhan', 'Agustus 2026'], ['penjelasan', 'AC lama sering bocor.'],
    ['item_nama', 'AC 2 PK'], ['item_qty', '2'], ['item_satuan', 'unit'], ['item_harga', '6.500.000'],
    ['aksi', 'ajukan'],
  ], [{ nama: 'Penawaran.pdf', mime: 'application/pdf', isi: '%PDF uji' }], t);

  await new Promise(r => setTimeout(r, 900));   // pengiriman berjalan setelah transaksi

  const keAm = diterima.filter(d => d.jalur === '/hp-area-manager');
  cek(keAm.length === 1, 'dokumen diajukan → 1 notifikasi terkirim ke HP Area Manager');
  cek(diterima.filter(d => d.jalur === '/hp-regional-manager').length === 0,
    'penyetuju tahap berikutnya BELUM diberi notifikasi (belum gilirannya)');
  cek(diterima.filter(d => d.jalur === '/hp-ceo').length === 0, 'CEO belum diberi notifikasi');

  if (keAm.length) {
    const k = keAm[0].kepala;
    cek(keAm[0].metode === 'POST', 'notifikasi dikirim sebagai POST ke layanan push');
    cek(/vapid/i.test(k.authorization || ''), 'memakai tanda tangan VAPID (server terverifikasi)');
    cek(k['content-encoding'] === 'aes128gcm', 'isi pesan terenkripsi (aes128gcm)');
    cek(Number(k.ttl) > 0, 'punya masa berlaku TTL ' + k.ttl + ' detik');
    cek(keAm[0].panjangIsi > 0 && !keAm[0].isiMentah.toString('utf8').includes('Pengadaan AC'),
      'isi pesan tidak terbaca sebagai teks biasa — terenkripsi sungguhan (' + keAm[0].panjangIsi + ' byte)');
  }

  // --- Area Manager menyetujui → giliran Regional Manager
  const dok = await db.get('SELECT id, nomor FROM pengajuan ORDER BY dibuat DESC LIMIT 1');
  const am = buatKlien(dasar);
  await am.masuk('am.barat@kla.co.id');
  const t2 = await am.csrf('/pengajuan/' + dok.id);
  await am.post('/pengajuan/' + dok.id + '/putuskan', [['aksi', 'setuju'], ['komentar', 'Setuju.']], t2);
  await new Promise(r => setTimeout(r, 900));

  cek(diterima.filter(d => d.jalur === '/hp-regional-manager').length === 1,
    'setelah disetujui → notifikasi berpindah ke HP penyetuju berikutnya');
  cek(diterima.filter(d => d.jalur === '/hp-area-manager').length === 1,
    'penyetuju yang sudah memutuskan tidak diberi notifikasi ulang');

  // --- langganan mati dibersihkan sendiri
  const layananMati = http.createServer((req, res) => { res.writeHead(410).end(); });
  await new Promise(r => layananMati.listen(0, '127.0.0.1', r));
  const alamatMati = 'http://127.0.0.1:' + layananMati.address().port + '/hp-dicopot';
  const kk2 = kunciLangganan();
  await db.run(
    `INSERT INTO langganan_push (id, pengguna_id, endpoint, p256dh, auth, peramban, dibuat)
     VALUES (?,?,?,?,?,?,?)`,
    [id(), await idDari('accounting@kla.co.id'), alamatMati,
      kk2.p256dh, kk2.auth, 'Uji/1.0', sekarang()]);
  const idAcc = await idDari('accounting@kla.co.id');
  await push.kirimKe([idAcc], { judul: 'Uji', pesan: 'Uji', url: '/approval' });
  const sisa = await db.nilai('SELECT COUNT(*) AS n FROM langganan_push WHERE endpoint = ?', [alamatMati]);
  cek(Number(sisa) === 0, 'langganan dari HP yang aplikasinya dicopot dibuang sendiri (jawaban 410)');
  layananMati.close();

  // --- kegagalan kirim tidak boleh menggagalkan approval
  await db.run(
    `INSERT INTO langganan_push (id, pengguna_id, endpoint, p256dh, auth, peramban, dibuat)
     VALUES (?,?,?,?,?,?,?)`,
    [id(), await idDari('ceo@kla.co.id'), 'http://127.0.0.1:1/hp-tidak-nyambung',
      kunciLangganan().p256dh, kunciLangganan().auth, 'Uji/1.0', sekarang()]);
  const bm = buatKlien(dasar);
  await bm.masuk('regional@kla.co.id');
  const t3 = await bm.csrf('/pengajuan/' + dok.id);
  await bm.post('/pengajuan/' + dok.id + '/putuskan', [['aksi', 'setuju'], ['komentar', 'Setuju.']], t3);
  await new Promise(r => setTimeout(r, 1200));
  const setelah = await db.get('SELECT status, langkah_kini FROM pengajuan WHERE id = ?', [dok.id]);
  cek(setelah.status === 'menunggu' && Number(setelah.langkah_kini) === 3,
    'HP yang tidak bisa dihubungi tidak menggagalkan approval (dokumen tetap lanjut ke tahap 3)');

  // --- notifikasi dalam aplikasi tetap tercatat, apa pun keadaan HP-nya
  const dalamApl = await db.nilai(
    'SELECT COUNT(*) AS n FROM notifikasi WHERE pengguna_id = ?', [await idDari('am.barat@kla.co.id')]);
  cek(Number(dalamApl) > 0, 'notifikasi di dalam aplikasi tetap tercatat (' + dalamApl + ' pesan)');

  server.close();
  layanan.close();
  await db.tutup();
  try { fs.unlinkSync(process.env.SQLITE_PATH); } catch (e) { /* biarkan */ }
  for (const a of ['-wal', '-shm']) { try { fs.unlinkSync(process.env.SQLITE_PATH + a); } catch (e) { /* biarkan */ } }

  process.exit(gagal ? 1 : 0);
})().catch(e => {
  console.error('  \x1b[31m✗ uji notifikasi berhenti: ' + e.message + '\x1b[0m');
  console.error(e.stack);
  process.exit(1);
});
