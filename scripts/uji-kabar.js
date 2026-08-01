#!/usr/bin/env node
// ============================================================================
//  UJI EMAIL, PENGINGAT HARIAN, DAN CUTI PENYETUJU
// ============================================================================
// Dijalankan otomatis oleh `npm run cek`. Berdiri sendiri karena butuh SMTP
// terisi, sedangkan pemeriksaan lain justru menguji keadaan saat SMTP kosong.
//
// Server SMTP TIRUAN dijalankan di localhost, jadi tidak ada email sungguhan
// yang terkirim ke siapa pun — tapi jalur kirimnya diuji sungguhan, sampai isi
// pesannya bisa dibaca ulang di sisi penerima.
const path = require('path');
const os = require('os');
const net = require('net');

const AKAR = path.join(__dirname, '..');
const tmp = path.join(os.tmpdir(), 'eapex-kabar-' + process.pid);
process.env.SQLITE_PATH = tmp + '.db';
process.env.LAMPIRAN_DIR = tmp + '-lampiran';
process.env.SESSION_SECRET = 'rahasia-untuk-pengujian-saja-0123456789';
process.env.NODE_ENV = 'test';
process.env.BATAS_LOGIN_UJI = '400';
process.env.PENGINGAT_SECRET = 'rahasia-pengingat-uji';
process.env.ALAMAT_APLIKASI = 'https://eapex.contoh.test';
delete process.env.DATABASE_URL;
delete process.env.TELEGRAM_BOT_TOKEN;

let gagal = 0, lulus = 0;
const ok = t => { lulus++; console.log('  \x1b[32m✓\x1b[0m ' + t); };
const no = t => { gagal++; console.log('  \x1b[31m✗ ' + t + '\x1b[0m'); };
const cek = (syarat, teks) => (syarat ? ok(teks) : no(teks));
const tunggu = ms => new Promise(r => setTimeout(r, ms));
const BERKAS_UJI = [{ nama: 'Penawaran.pdf', mime: 'application/pdf', isi: '%PDF uji' }];

// ---------------------------------------------------------------- SMTP tiruan
const suratMasuk = [];
let tolakSemua = false;

const smtp = net.createServer(sock => {
  let tahapData = false;
  let surat = { ke: [], isi: '' };
  sock.setEncoding('utf8');
  sock.write('220 uji.local ESMTP siap\r\n');

  let sisa = '';
  sock.on('data', potongan => {
    sisa += potongan;
    let i;
    while ((i = sisa.indexOf('\r\n')) >= 0) {
      const baris = sisa.slice(0, i);
      sisa = sisa.slice(i + 2);

      if (tahapData) {
        if (baris === '.') {
          tahapData = false;
          if (tolakSemua) { sock.write('554 ditolak untuk pengujian\r\n'); }
          else { suratMasuk.push({ ...surat }); sock.write('250 diterima\r\n'); }
          surat = { ke: [], isi: '' };
        } else {
          surat.isi += baris + '\n';
        }
        continue;
      }

      const perintah = baris.toUpperCase();
      if (perintah.startsWith('EHLO') || perintah.startsWith('HELO')) {
        sock.write('250-uji.local\r\n250 AUTH PLAIN LOGIN\r\n');
      } else if (perintah.startsWith('AUTH')) {
        sock.write('235 masuk\r\n');
      } else if (perintah.startsWith('MAIL FROM')) {
        surat.dari = baris; sock.write('250 ok\r\n');
      } else if (perintah.startsWith('RCPT TO')) {
        const m = /<([^>]+)>/.exec(baris);
        if (m) surat.ke.push(m[1]);
        sock.write('250 ok\r\n');
      } else if (perintah === 'DATA') {
        tahapData = true; sock.write('354 kirim isinya\r\n');
      } else if (perintah === 'QUIT') {
        sock.write('221 selamat tinggal\r\n'); sock.end();
      } else {
        sock.write('250 ok\r\n');
      }
    }
  });
  sock.on('error', () => {});
});

// ---------------------------------------------------------------- klien uji
class Klien {
  constructor(dasar) { this.dasar = dasar; this.kue = new Map(); }
  get header() {
    const c = [...this.kue].map(([k, v]) => k + '=' + v).join('; ');
    return c ? { cookie: c } : {};
  }
  simpan(res) {
    for (const b of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
      const [p] = b.split(';'); const i = p.indexOf('=');
      if (i > 0) this.kue.set(p.slice(0, i).trim(), p.slice(i + 1).trim());
    }
  }
  async get(jalur) {
    const r = await fetch(this.dasar + jalur, { headers: this.header, redirect: 'manual' });
    this.simpan(r);
    return { status: r.status, teks: (r.status === 302 || r.status === 303) ? '' : await r.text() };
  }
  async csrf(jalur) {
    const m = /name="_csrf" value="([^"]+)"/.exec((await this.get(jalur)).teks);
    return m ? m[1] : null;
  }
  async post(jalur, medan, token) {
    const body = new URLSearchParams();
    if (token !== null) body.append('_csrf', token === undefined ? '' : token);
    for (const [k, v] of medan) body.append(k, String(v));
    const r = await fetch(this.dasar + jalur, {
      method: 'POST', redirect: 'manual',
      headers: { ...this.header, 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    this.simpan(r);
    return { status: r.status, lokasi: r.headers.get('location'), teks: (r.status === 302 || r.status === 303) ? '' : await r.text() };
  }
  async postBerkas(jalur, medan, berkas, token) {
    const fd = new FormData();
    if (token !== null) fd.append('_csrf', token === undefined ? '' : token);
    for (const [k, v] of medan) fd.append(k, String(v));
    for (const b of berkas) fd.append('berkas', new Blob([b.isi], { type: b.mime }), b.nama);
    const r = await fetch(this.dasar + jalur, { method: 'POST', redirect: 'manual', headers: this.header, body: fd });
    this.simpan(r);
    return { status: r.status, lokasi: r.headers.get('location'), teks: (r.status === 302 || r.status === 303) ? '' : await r.text() };
  }
  async masuk(email, sandi) {
    const t = await this.csrf('/login');
    return this.post('/login', [['email', email], ['sandi', sandi], ['tujuan', '/']], t);
  }
  // Sama seperti masuk(), tapi ikut mengembalikan header Set-Cookie apa adanya —
  // dipakai memeriksa masa berlaku cookie sesi.
  async masukMentah(email, sandi) {
    const t = await this.csrf('/login');
    const body = new URLSearchParams({ _csrf: t, email, sandi, tujuan: '/' });
    const r = await fetch(this.dasar + '/login', {
      method: 'POST', redirect: 'manual',
      headers: { ...this.header, 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const kue = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    this.simpan(r);
    return { status: r.status, kue };
  }
}

// ---------------------------------------------------------------- jalankan
(async () => {
  await new Promise(r => smtp.listen(0, '127.0.0.1', r));
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(smtp.address().port);
  process.env.SMTP_SECURE = '0';
  process.env.SMTP_USER = 'eapex-uji';
  process.env.SMTP_PASS = 'rahasia';
  process.env.SMTP_FROM = 'EAPEX <no-reply@kla.co.id>';

  const db = require(path.join(AKAR, 'lib/db'));
  const { siapkan } = require(path.join(AKAR, 'lib/skema'));
  const bcrypt = require(path.join(AKAR, 'node_modules/bcryptjs'));
  await siapkan({ senyap: true });
  const SANDI = 'UjiEapex123';
  await db.run('UPDATE pengguna SET sandi_hash = ?, wajib_ganti_sandi = 0', [bcrypt.hashSync(SANDI, 10)]);

  const app = require(path.join(AKAR, 'app'));
  const srv = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const dasar = 'http://127.0.0.1:' + srv.address().port;

  const emailMod = require(path.join(AKAR, 'lib/email'));
  const pengingat = require(path.join(AKAR, 'lib/pengingat'));
  const cuti = require(path.join(AKAR, 'lib/cuti'));

  const idDari = async e => db.nilai('SELECT id FROM pengguna WHERE email = ?', [e]);

  // Dihitung dari tanggal WIB, BUKAN dari tanggal UTC mesin. Antara pukul 00.00
  // dan 07.00 WIB keduanya berbeda hari, dan uji yang memakai tanggal UTC akan
  // lulus di pagi hari lalu gagal di malam hari tanpa ada kode yang berubah.
  const hari = n => {
    const d = new Date(cuti.tanggalWib() + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  try {
    // ============================================================ A. EMAIL
    console.log('\n\x1b[1mEMAIL\x1b[0m');
    cek(emailMod.aktif(), 'pengiriman email menyala saat SMTP terisi');

    const idAm = await idDari('am.barat@kla.co.id');
    const idAcc = await idDari('accounting@kla.co.id');

    // Alamat notifikasi sengaja BERBEDA dari alamat login, untuk membuktikan
    // yang dipakai memang alamat notifikasi.
    await db.run("UPDATE pengguna SET email_notifikasi = 'kotak.am@contoh.test' WHERE id = ?", [idAm]);

    suratMasuk.length = 0;
    let hasil = await emailMod.kirimKe([idAm, idAcc], {
      judul: 'Approval baru menunggu Anda', pesan: 'CEA/001 — Pengadaan AC (Rp 13.000.000)', url: '/pengajuan/abc',
    });
    await tunggu(150);

    cek(hasil.terkirim === 1 && hasil.dilewati === 1,
      'yang punya alamat dikirimi, yang tidak punya DILEWATI tanpa galat');
    cek(suratMasuk.length === 1 && suratMasuk[0].ke[0] === 'kotak.am@contoh.test',
      'email masuk ke alamat notifikasi, bukan ke alamat login');
    // Isi email dipatah tiap 76 karakter oleh pengkodean quoted-printable
    // (tanda '=' di ujung baris). Sambung dulu sebelum dicocokkan — kalau tidak,
    // hasil uji berubah-ubah hanya karena panjang nama penerimanya berbeda.
    const sambung = t => String(t).split('=\n').join('').split('=3D').join('=');
    const surat = suratMasuk[0] ? { isi: sambung(suratMasuk[0].isi), ke: suratMasuk[0].ke } : { isi: '' };
    cek(/Subject:.*EAPEX/i.test(surat.isi), 'subjek ditandai [EAPEX] supaya mudah disaring');
    cek(surat.isi.includes('Approval baru menunggu Anda'), 'judul pesan terbawa ke isi email');
    cek(surat.isi.includes('https://eapex.contoh.test/pengajuan/abc'),
      'tautan memakai alamat aplikasi sungguhan, bukan localhost');

    // Tanpa ALAMAT_APLIKASI, emailnya tetap terkirim — hanya tanpa tautan.
    const alamatAsli = process.env.ALAMAT_APLIKASI;
    delete process.env.ALAMAT_APLIKASI;
    suratMasuk.length = 0;
    await emailMod.kirimKe([idAm], { judul: 'Uji', pesan: 'Uji', url: '/x' });
    await tunggu(150);
    cek(suratMasuk.length === 1 && !suratMasuk[0].isi.includes('localhost'),
      'tanpa alamat aplikasi: email tetap terkirim, tanpa tautan ke localhost');
    process.env.ALAMAT_APLIKASI = alamatAsli;

    // Server SMTP menolak → dilaporkan sebagai gagal, tidak melempar galat.
    tolakSemua = true;
    suratMasuk.length = 0;
    let galatKirim = null;
    let hasilTolak = null;
    try { hasilTolak = await emailMod.kirimKe([idAm], { judul: 'Uji', pesan: 'Uji' }); }
    catch (e) { galatKirim = e; }
    cek(!galatKirim && hasilTolak && hasilTolak.gagal === 1,
      'SMTP menolak: dihitung gagal, TIDAK melempar galat ke pemanggilnya');
    tolakSemua = false;

    // ============================================================ B. CUTI
    console.log('\n\x1b[1mCUTI PENYETUJU\x1b[0m');

    cek(cuti.sedangCuti({ cuti_mulai: hari(-1), cuti_selesai: hari(1) }), 'cuti yang sedang berjalan terbaca');
    cek(cuti.sedangCuti({ cuti_mulai: hari(0), cuti_selesai: hari(0) }), 'cuti sehari: hari itu tetap terhitung');
    cek(!cuti.sedangCuti({ cuti_mulai: hari(2), cuti_selesai: hari(5) }), 'cuti yang belum mulai tidak terhitung');
    cek(!cuti.sedangCuti({ cuti_mulai: hari(-5), cuti_selesai: hari(-2) }), 'cuti yang sudah lewat tidak terhitung');
    cek(!cuti.sedangCuti({}), 'tanpa tanggal cuti = tidak sedang cuti');

    cek(!!cuti.periksa({ mulai: hari(3), selesai: hari(1) }), 'tanggal selesai mendahului mulai ditolak');
    cek(!!cuti.periksa({ mulai: hari(0), selesai: hari(400) }), 'cuti lebih dari 180 hari ditolak');
    cek(!!cuti.periksa({ mulai: hari(0), selesai: '' }), 'cuti tanpa tanggal selesai ditolak');
    cek(cuti.periksa({ mulai: '', selesai: '' }) === null, 'mengosongkan keduanya sah (menghapus cuti)');

    let tolakSendiri = false;
    try { await cuti.setel(idAm, { mulai: hari(0), selesai: hari(1), mode: 'pengganti', penggantiId: idAm }); }
    catch (e) { tolakSendiri = !!e.publik; }
    cek(tolakSendiri, 'orang tidak bisa menunjuk dirinya sendiri sebagai pengganti');

    // --- CUTI TIDAK OTOMATIS BERARTI DILEWATI
    // Ini keadaan yang paling sering terjadi: orang cuti tapi masih sanggup
    // menekan tombol setuju. Perilaku bawaan harus TIDAK mengubah apa pun.
    const idRmA = await idDari('regional@kla.co.id');
    await cuti.setel(idRmA, { mulai: hari(-1), selesai: hari(3), alasan: 'cuti tapi masih pegang HP' });
    const uRmA = await db.get('SELECT * FROM pengguna WHERE id = ?', [idRmA]);
    cek(cuti.modeCuti(uRmA) === 'tetap', 'bawaannya: cuti = "tetap dia yang menyetujui"');
    cek(cuti.sedangCuti(uRmA), 'dia memang tercatat sedang cuti');
    cek(!cuti.menyatakanTakBisa(uRmA), 'tapi TIDAK dianggap berhalangan — approval-nya tidak berubah');

    const aturanMesinA = require(path.join(AKAR, 'lib/aturan'));
    const katCapexA = await db.get("SELECT * FROM kategori WHERE kode = 'CAPEX'");
    const aturCapexA = await db.get("SELECT * FROM aturan WHERE kategori_id = ? AND wilayah = 'store'", [katCapexA.id]);
    const smgA = await db.get("SELECT * FROM cabang WHERE kode = 'SMG'");
    const langkahRmA = await db.get(
      "SELECT * FROM aturan_langkah WHERE aturan_id = ? AND peran = 'regional_manager'", [aturCapexA.id]);
    const rinciTetap = await aturanMesinA.kandidatLangkahRinci(langkahRmA,
      { pemohon_id: 'x', cabang_id: smgA.id, area_id: smgA.area_id });
    cek(rinciTetap.kandidat.some(k => k.id === idRmA) && rinciTetap.kandidat.length > 0,
      'orang yang cuti tapi masih bisa handle TETAP jadi penyetuju');

    // "tidak bisa handle" harus dipilih sadar, bukan efek samping mengisi tanggal
    await cuti.setel(idRmA, { mulai: hari(-1), selesai: hari(3), alasan: 'sakit', mode: 'lewati' });
    const uRmB = await db.get('SELECT * FROM pengguna WHERE id = ?', [idRmA]);
    cek(cuti.menyatakanTakBisa(uRmB), 'setelah dipilih "tidak bisa handle", barulah dianggap berhalangan');
    await cuti.setel(idRmA, { mulai: '', selesai: '' });

    let tolakTanpaPengganti = false;
    try { await cuti.setel(idRmA, { mulai: hari(0), selesai: hari(1), mode: 'pengganti' }); }
    catch (e) { tolakTanpaPengganti = !!e.publik; }
    cek(tolakTanpaPengganti, 'memilih "dialihkan" tanpa menunjuk penggantinya ditolak');

    // --- Regional Manager cuti → tahapnya dilewati
    const idRm = await idDari('regional@kla.co.id');
    await cuti.setel(idRm, { mulai: hari(-1), selesai: hari(3), alasan: 'cuti tahunan', mode: 'lewati' });

    const sm = new Klien(dasar);
    await sm.masuk('sm.smg@kla.co.id', SANDI);
    const katCapex = await db.get("SELECT * FROM kategori WHERE kode = 'CAPEX'");
    const aturCapex = await db.get("SELECT * FROM aturan WHERE kategori_id = ? AND wilayah = 'store'", [katCapex.id]);
    const smg = await db.get("SELECT * FROM cabang WHERE kode = 'SMG'");
    const medan = [
      ['kategori_id', katCapex.id], ['aturan_id', aturCapex.id], ['cabang_id', smg.id],
      ['judul', 'Pengadaan AC saat RM cuti'], ['nama_proyek', 'AC'], ['justifikasi', 'AC lama bocor.'],
      ['status_anggaran', 'budgeted'], ['kategori_aset', 'Inventaris'],
      ['tujuan[]', 'efisiensi'], ['kategori_aset', 'Inventaris'],
      ['deskripsi', 'AC 2 PK inverter'], ['lokasi', 'Area kasir'], ['vendor', 'PT Sumber Elektronik'],
      ['jadwal_kebutuhan', 'Agustus 2026'], ['penjelasan', 'AC lama sering bocor.'],
      ['item_nama', 'AC 2 PK'], ['item_qty', '2'], ['item_satuan', 'unit'], ['item_harga', '6.500.000'],
      ['aksi', 'ajukan'],
    ];
    const rBuat = await sm.postBerkas('/pengajuan', medan, BERKAS_UJI, await sm.csrf('/pengajuan/baru/CAPEX'));
    cek(rBuat.status === 303, 'dokumen tetap bisa diajukan walau Regional Manager cuti');

    const dok = await db.get("SELECT * FROM pengajuan WHERE judul = 'Pengadaan AC saat RM cuti'");
    const tahap = await db.all('SELECT * FROM persetujuan WHERE pengajuan_id = ? ORDER BY urut', [dok.id]);
    const tRm = tahap.find(t => t.peran === 'regional_manager');

    // INTI aturannya: pernyataan "saya tidak bisa menyetujui" TIDAK melewati
    // tahapnya dengan sendirinya. Hanya ada dua jalan yang sah — pengganti,
    // atau dipastikan penyetuju sebelumnya.
    cek(!!tRm && tRm.status === 'menunggu',
      'menyatakan tidak bisa menyetujui TIDAK melewati tahapnya sendiri');
    const kandRm = await db.all('SELECT * FROM persetujuan_kandidat WHERE persetujuan_id = ?', [tRm.id]);
    cek(kandRm.length > 0, 'tahapnya tetap miliknya — dia masih bisa menyetujui kalau ternyata sempat');
    cek(tahap.filter(t => t.status === 'menunggu').map(t => t.peran).join(',')
      === 'area_manager,regional_manager,accounting,ceo',
      'seluruh rantai tetap utuh: Area → Regional → Accounting → CEO');
    cek(Number(dok.langkah_kini) === 1, 'dokumen mulai dari tahap pertama');

    // --- pernyataan itu MUNCUL di layar penyetuju sebelumnya
    const am = new Klien(dasar);
    await am.masuk('am.barat@kla.co.id', SANDI);
    const halPutusRm = await am.get('/pengajuan/' + dok.id);
    cek(/Menyatakan tidak bisa menyetujui/.test(halPutusRm.teks),
      'penyetuju sebelumnya MELIHAT pernyataan itu di layar keputusannya');
    cek(/cuti tahunan/.test(halPutusRm.teks), 'lengkap dengan keterangan dan tanggalnya');
    cek(/name="lewati_berikut"/.test(halPutusRm.teks),
      'dan diberi pilihan untuk memastikan lalu melewatinya');

    // --- dia yang memastikan, lalu melewatinya
    await am.post('/pengajuan/' + dok.id + '/putuskan',
      [['aksi', 'setuju'], ['komentar', 'Setuju.'], ['lewati_berikut', '1'],
        ['alasan_lewat', 'Sudah dikonfirmasi lewat telepon, memang tidak bisa']],
      await am.csrf('/pengajuan/' + dok.id));
    const setelahAm = await db.get('SELECT langkah_kini FROM pengajuan WHERE id = ?', [dok.id]);
    const tahapAcc = tahap.find(t => t.peran === 'accounting');
    const tRmAkhir = await db.get('SELECT * FROM persetujuan WHERE id = ?', [tRm.id]);
    cek(tRmAkhir.status === 'dilewati', 'setelah dipastikan penyetuju sebelumnya, barulah tahapnya dilewati');
    cek(Number(setelahAm.langkah_kini) === Number(tahapAcc.urut), 'dokumen lompat ke Accounting');

    // --- pengganti dipakai kalau diisi
    await cuti.setel(idRm, { mulai: hari(-1), selesai: hari(3), alasan: 'cuti', mode: 'pengganti', penggantiId: idAcc });
    const aturanMesin = require(path.join(AKAR, 'lib/aturan'));
    const langkahRm = await db.get(
      "SELECT * FROM aturan_langkah WHERE aturan_id = ? AND peran = 'regional_manager'", [aturCapex.id]);
    const rinci = await aturanMesin.kandidatLangkahRinci(langkahRm, { pemohon_id: 'x', cabang_id: smg.id, area_id: smg.area_id });
    cek(rinci.pakaiPengganti && rinci.kandidat.some(k => k.id === idAcc),
      'pengganti mengambil alih tahap penyetuju yang cuti');

    // --- masih ada calon lain yang tidak cuti → TIDAK dilewati
    await cuti.setel(idRm, { mulai: '', selesai: '' });
    const rinci2 = await aturanMesin.kandidatLangkahRinci(langkahRm, { pemohon_id: 'x', cabang_id: smg.id, area_id: smg.area_id });
    cek(!rinci2.pakaiPengganti && rinci2.kandidat.length > 0 && !rinci2.peranKosong,
      'setelah cuti dihapus, penyetuju aslinya dipakai lagi');

    // --- semua penyetuju cuti → pengajuan DITOLAK, bukan lolos tanpa tanda tangan
    for (const e of ['am.barat@kla.co.id', 'regional@kla.co.id', 'accounting@kla.co.id', 'ceo@kla.co.id']) {
      await cuti.setel(await idDari(e), { mulai: hari(-1), selesai: hari(3), alasan: 'cuti massal', mode: 'lewati' });
    }
    const sm2 = new Klien(dasar);
    await sm2.masuk('sm.ygy@kla.co.id', SANDI);
    const ygy = await db.get("SELECT * FROM cabang WHERE kode = 'YGY'");
    const rSemuaCuti = await sm2.postBerkas('/pengajuan',
      medan.map(m => (m[0] === 'cabang_id' ? ['cabang_id', ygy.id] : m[0] === 'judul' ? ['judul', 'Uji semua cuti'] : m)),
      await sm2.csrf('/pengajuan/baru/CAPEX'));
    const dokSemua = await db.get("SELECT status FROM pengajuan WHERE judul = 'Uji semua cuti'");
    cek(!dokSemua || dokSemua.status !== 'disetujui',
      'saat SEMUA penyetuju cuti, dokumen TIDAK lolos jadi disetujui tanpa tanda tangan');
    cek(!dokSemua || dokSemua.status === 'draft',
      'dokumen ditahan sebagai draft, pemohon diberi tahu alasannya');
    for (const e of ['am.barat@kla.co.id', 'regional@kla.co.id', 'accounting@kla.co.id', 'ceo@kla.co.id']) {
      await cuti.setel(await idDari(e), { mulai: '', selesai: '' });
    }

    // ============================================================ C. PENGINGAT
    console.log('\n\x1b[1mPENGINGAT HARIAN\x1b[0m');
    cek(pengingat.JAM_KIRIM() === 10, 'pengingat dijadwalkan pukul 10.00');

    await db.run("UPDATE pengguna SET email_notifikasi = 'kotak.acc@contoh.test' WHERE id = ?", [idAcc]);
    const tunggak = await pengingat.tunggakan();
    cek(tunggak.some(t => t.pengguna_id === idAcc && t.pengajuan_id === dok.id),
      'Accounting terdaftar punya tunggakan atas dokumen yang menunggunya');
    const idPemohon = await idDari('sm.smg@kla.co.id');
    cek(!tunggak.some(t => t.pengguna_id === idPemohon),
      'pemohon TIDAK ikut diingatkan — bukan dia yang perlu memutuskan');

    suratMasuk.length = 0;
    const r1 = await pengingat.jalankan({ paksa: true });
    await tunggu(400);
    cek(r1.dijalankan && r1.penerima >= 1, `pengingat terkirim ke ${r1.penerima} penyetuju`);
    const suratPengingat = suratMasuk.find(s => s.ke.includes('kotak.acc@contoh.test'));
    cek(!!suratPengingat, 'pengingat sampai ke email Accounting');
    cek(!!suratPengingat && /approval menunggu keputusan Anda/i.test(suratPengingat.isi),
      'isi pengingat menyebut jumlah yang menunggu');

    // sekali sehari
    const r2 = await pengingat.jalankan();
    const r3 = await pengingat.jalankan();
    cek(r2.dijalankan === true, 'panggilan pertama hari ini berjalan');
    cek(r3.dijalankan === false, 'panggilan kedua di hari yang sama TIDAK mengirim ulang');

    // dokumen tersendat dilaporkan ke Admin
    await cuti.setel(idAcc, { mulai: hari(-1), selesai: hari(3), alasan: 'cuti', mode: 'lewati' });
    const tersendat = await cuti.dokumenTersendat();
    cek(tersendat.some(t => t.id === dok.id),
      'dokumen yang tahapnya tidak punya penyetuju tersedia terdeteksi tersendat');
    await cuti.setel(idAcc, { mulai: '', selesai: '' });

    // --- endpoint pemicu
    console.log('\n\x1b[1mPEMICU PENGINGAT DARI LUAR\x1b[0m');
    const panggil = async (kepala) => {
      const r = await fetch(dasar + '/api/pengingat', { method: 'POST', headers: kepala || {}, redirect: 'manual' });
      return { status: r.status, teks: await r.text() };
    };
    cek((await panggil()).status === 401, 'tanpa rahasia: ditolak 401');
    cek((await panggil({ authorization: 'Bearer salah' })).status === 401, 'rahasia salah: ditolak 401');
    const rSah = await panggil({ authorization: 'Bearer rahasia-pengingat-uji' });
    cek(rSah.status === 200 && rSah.teks.includes('"ok":true'), 'rahasia benar: pengingat dijalankan');

    const rahasiaAsli = process.env.PENGINGAT_SECRET;
    delete process.env.PENGINGAT_SECRET;
    cek((await panggil({ authorization: 'Bearer apa pun' })).status === 503,
      'tanpa PENGINGAT_SECRET tersetel, pemicunya MATI — bukan terbuka untuk siapa saja');
    process.env.PENGINGAT_SECRET = rahasiaAsli;

    // ============================================================ D. LEWATI TAHAP
    console.log('\n\x1b[1mPENYETUJU SEBELUMNYA MELEWATI TAHAP BERIKUTNYA\x1b[0m');
    {
      const smL = new Klien(dasar);
      await smL.masuk('sm.smg@kla.co.id', SANDI);
      const buatDokumen = async (judulDok) => {
        const m = medan.map(x => (x[0] === 'judul' ? ['judul', judulDok] : x));
        await smL.postBerkas('/pengajuan', m, BERKAS_UJI, await smL.csrf('/pengajuan/baru/CAPEX'));
        return db.get('SELECT * FROM pengajuan WHERE judul = ?', [judulDok]);
      };
      const tahapDari = async d => db.all(
        'SELECT * FROM persetujuan WHERE pengajuan_id = ? ORDER BY urut', [d.id]);

      const amL = new Klien(dasar);
      await amL.masuk('am.barat@kla.co.id', SANDI);

      // 1) alasan wajib
      const d1 = await buatDokumen('Lewat tanpa alasan');
      const r1 = await amL.post('/pengajuan/' + d1.id + '/putuskan',
        [['aksi', 'setuju'], ['lewati_berikut', '1'], ['alasan_lewat', '']],
        await amL.csrf('/pengajuan/' + d1.id));
      const t1 = await tahapDari(d1);
      cek(t1.find(t => t.peran === 'regional_manager').status === 'menunggu',
        'melewati tahap tanpa menulis alasan DITOLAK — tahapnya tetap berjalan');

      // 2) dengan alasan → dilewati, tercatat, lompat ke Accounting
      const r2 = await amL.post('/pengajuan/' + d1.id + '/putuskan',
        [['aksi', 'setuju'], ['lewati_berikut', '1'],
          ['alasan_lewat', 'Sedang cuti, sudah dikonfirmasi lewat telepon']],
        await amL.csrf('/pengajuan/' + d1.id));
      cek(r2.status === 303, 'melewati tahap dengan alasan diterima');
      const t2 = await tahapDari(d1);
      const tRm = t2.find(t => t.peran === 'regional_manager');
      const tAcc = t2.find(t => t.peran === 'accounting');
      const dok2 = await db.get('SELECT langkah_kini FROM pengajuan WHERE id = ?', [d1.id]);
      cek(tRm.status === 'dilewati', 'tahap Regional Manager ditandai dilewati');
      cek(/Dilewati atas keputusan/.test(tRm.komentar || '') && /telepon/.test(tRm.komentar || ''),
        'alasan DAN nama yang memutuskan tercatat di dokumen');
      cek(tRm.aktor_nama && tRm.aktor_nama.length > 0, 'siapa yang melewati ikut tersimpan: ' + tRm.aktor_nama);
      cek(Number(dok2.langkah_kini) === Number(tAcc.urut), 'dokumen lompat ke Accounting');

      const jejakLewat = await db.all(
        "SELECT * FROM jejak WHERE pengajuan_id = ? AND aksi = 'lewati-tahap'", [d1.id]);
      cek(jejakLewat.length === 1, 'tercatat sebagai baris tersendiri di jejak audit');

      const idRmN = await idDari('regional@kla.co.id');
      const notifLewat = await db.all(
        "SELECT * FROM notifikasi WHERE pengguna_id = ? AND judul LIKE '%dilewati%'", [idRmN]);
      cek(notifLewat.length >= 1, 'yang dilewati DIBERI TAHU bahwa tahapnya dilewati');

      // 3) Accounting TIDAK bisa dilewati
      const accL = new Klien(dasar);
      await accL.masuk('accounting@kla.co.id', SANDI);
      await accL.post('/pengajuan/' + d1.id + '/putuskan',
        [['aksi', 'setuju'], ['lewati_berikut', '1'], ['alasan_lewat', 'coba lewati CEO']],
        await accL.csrf('/pengajuan/' + d1.id));
      const t3 = await tahapDari(d1);
      const tCeo = t3.find(t => t.peran === 'ceo');
      cek(tCeo.status === 'menunggu',
        'tahap TERAKHIR (CEO) tidak bisa dilewati — dokumen tidak bisa sah tanpa wewenang akhir');

      // 4) Accounting sebagai tahap berikutnya juga tidak bisa dilewati
      const d2 = await buatDokumen('Lewati Accounting');
      const tD2 = await tahapDari(d2);
      const alur = require(path.join(AKAR, 'lib/alur'));
      const halangan = alur.alasanTakBolehLewat(tD2.find(t => t.peran === 'accounting'), tD2);
      cek(!!halangan && /Accounting/i.test(halangan),
        'Accounting tidak boleh dilewati: ' + String(halangan).slice(0, 60));

      // 5) layar menawarkan pilihannya saat memang boleh
      const halPutus = await amL.get('/pengajuan/' + d2.id);
      cek(/name="lewati_berikut"/.test(halPutus.teks),
        'penyetuju melihat pilihan "lewati tahap berikutnya" di layar keputusan');
      cek(/name="alasan_lewat"/.test(halPutus.teks), 'kotak alasan tersedia di layar yang sama');
    }

    // ==================================== E. PAGAR YANG SAMA UNTUK JALUR CUTI
    console.log('\n\x1b[1mPAGAR PELEWATAN BERLAKU JUGA UNTUK CUTI\x1b[0m');
    {
      const smP = new Klien(dasar);
      await smP.masuk('sm.smg@kla.co.id', SANDI);
      const idAccP = await idDari('accounting@kla.co.id');
      const idCeoP = await idDari('ceo@kla.co.id');

      // Accounting cuti + minta dilewati → tahapnya HARUS tetap jalan
      await cuti.setel(idAccP, { mulai: hari(-1), selesai: hari(3), alasan: 'cuti', mode: 'lewati' });
      const judulA = 'Accounting cuti tetap jalan';
      await smP.postBerkas('/pengajuan', medan.map(m => (m[0] === 'judul' ? ['judul', judulA] : m)),
        BERKAS_UJI, await smP.csrf('/pengajuan/baru/CAPEX'));
      const dokA = await db.get('SELECT * FROM pengajuan WHERE judul = ?', [judulA]);
      const tA = await db.all('SELECT * FROM persetujuan WHERE pengajuan_id = ? ORDER BY urut', [dokA.id]);
      const accA = tA.find(t => t.peran === 'accounting');
      cek(accA.status === 'menunggu',
        'Accounting cuti + mode "lewati" → tahapnya TETAP DIJALANKAN, tidak dilewati');
      const kandA = await db.all(
        'SELECT * FROM persetujuan_kandidat WHERE persetujuan_id = ?', [accA.id]);
      cek(kandA.length > 0, 'calon penyetujunya dikembalikan — tahapnya tidak jadi buntu tanpa siapa pun');
      await cuti.setel(idAccP, { mulai: '', selesai: '' });

      // CEO (tahap terakhir) cuti + minta dilewati → juga tetap jalan
      await cuti.setel(idCeoP, { mulai: hari(-1), selesai: hari(3), alasan: 'cuti', mode: 'lewati' });
      const judulC = 'CEO cuti tetap jalan';
      await smP.postBerkas('/pengajuan', medan.map(m => (m[0] === 'judul' ? ['judul', judulC] : m)),
        BERKAS_UJI, await smP.csrf('/pengajuan/baru/CAPEX'));
      const dokC = await db.get('SELECT * FROM pengajuan WHERE judul = ?', [judulC]);
      const tC = await db.all('SELECT * FROM persetujuan WHERE pengajuan_id = ? ORDER BY urut', [dokC.id]);
      cek(tC.find(t => t.peran === 'ceo').status === 'menunggu',
        'CEO cuti + mode "lewati" → tahap terakhir TETAP DIJALANKAN');
      await cuti.setel(idCeoP, { mulai: '', selesai: '' });

      // Regional Manager (boleh dilewati) cuti → dilewati DAN dia diberi tahu
      const idRmP = await idDari('regional@kla.co.id');
      await db.run("DELETE FROM notifikasi WHERE pengguna_id = ?", [idRmP]);
      await cuti.setel(idRmP, { mulai: hari(-1), selesai: hari(3), alasan: 'cuti', mode: 'lewati' });
      const judulR = 'Regional cuti dilewati';
      await smP.postBerkas('/pengajuan', medan.map(m => (m[0] === 'judul' ? ['judul', judulR] : m)),
        BERKAS_UJI, await smP.csrf('/pengajuan/baru/CAPEX'));
      const dokR = await db.get('SELECT * FROM pengajuan WHERE judul = ?', [judulR]);
      const tR = await db.all('SELECT * FROM persetujuan WHERE pengajuan_id = ? ORDER BY urut', [dokR.id]);
      cek(tR.find(t => t.peran === 'regional_manager').status === 'menunggu',
        'walau boleh dilewati, tahapnya TETAP menunggu sampai ada yang memastikan');
      const notifPernyataan = await db.all(
        "SELECT * FROM notifikasi WHERE pengguna_id = ?", [idRmP]);
      cek(notifPernyataan.length >= 1, 'yang menyatakan tak bisa menyetujui tetap menerima pemberitahuan cutinya');
      await cuti.setel(idRmP, { mulai: '', selesai: '' });
    }

    // ==================================== F. CUTI DIISI SENDIRI + PEMBERITAHUAN
    console.log('\n\x1b[1mCUTI DIISI SENDIRI & PEMBERITAHUANNYA\x1b[0m');
    {
      const orang = new Klien(dasar);
      await orang.masuk('am.timur@kla.co.id', SANDI);
      const idOrang = await idDari('am.timur@kla.co.id');

      const halCuti = await orang.get('/cuti-saya');
      cek(halCuti.status === 200 && /name="cuti_mulai"/.test(halCuti.teks),
        'setiap pengguna punya halaman "Cuti Saya" untuk mengisi sendiri');
      cek(/name="cuti_approve"/.test(halCuti.teks),
        'pilihan perlakuan approval ikut ada di halaman itu');

      await db.run('DELETE FROM notifikasi WHERE pengguna_id = ?', [idOrang]);
      const rCuti = await orang.post('/cuti-saya', [
        ['cuti_mulai', hari(1)], ['cuti_selesai', hari(4)],
        ['cuti_alasan', 'cuti tahunan'], ['cuti_approve', 'lewati'],
      ], await orang.csrf('/cuti-saya'));
      cek(rCuti.status === 303, 'cuti tersimpan lewat halaman sendiri');
      const uOrang = await db.get('SELECT cuti_mulai, cuti_approve FROM pengguna WHERE id = ?', [idOrang]);
      cek(uOrang.cuti_mulai === hari(1) && uOrang.cuti_approve === 'lewati',
        'tanggal dan pilihannya tersimpan apa adanya');
      const notifSendiri = await db.all(
        "SELECT * FROM notifikasi WHERE pengguna_id = ? AND judul LIKE '%uti%'", [idOrang]);
      cek(notifSendiri.length >= 1, 'mengisi sendiri pun tetap tercatat sebagai pemberitahuan');

      // Ditandai oleh Admin → orangnya diberi tahu, lengkap dengan siapa yang menandai
      await db.run('DELETE FROM notifikasi WHERE pengguna_id = ?', [idOrang]);
      const admC = new Klien(dasar);
      await admC.masuk('admin@kla.co.id', SANDI);
      await admC.post('/admin/pengguna/' + idOrang + '/cuti', [
        ['cuti_mulai', hari(2)], ['cuti_selesai', hari(5)],
        ['cuti_alasan', 'dinas luar'], ['cuti_approve', 'lewati'],
      ], await admC.csrf('/admin/pengguna?ubah=' + idOrang));
      const notifAdmin = await db.all(
        'SELECT * FROM notifikasi WHERE pengguna_id = ? ORDER BY dibuat DESC', [idOrang]);
      cek(notifAdmin.length >= 1, 'ditandai cuti oleh Administrator → orangnya DIBERI TAHU');
      cek(notifAdmin.length > 0 && /Dicatat oleh/.test(notifAdmin[0].pesan || ''),
        'pemberitahuannya menyebut siapa yang menandai: ' + String(notifAdmin[0] && notifAdmin[0].pesan).slice(0, 60));
      cek(notifAdmin.length > 0 && /TIDAK otomatis hilang/.test(notifAdmin[0].pesan || ''),
        'diberi tahu bahwa tahapnya TIDAK otomatis hilang — harus dipastikan orang lain');

      // Pengganti ikut diberi tahu
      const idPeng = await idDari('am.barat@kla.co.id');
      await db.run('DELETE FROM notifikasi WHERE pengguna_id = ?', [idPeng]);
      await orang.post('/cuti-saya', [
        ['cuti_mulai', hari(1)], ['cuti_selesai', hari(4)],
        ['cuti_alasan', 'cuti'], ['cuti_approve', 'pengganti'], ['pengganti_id', idPeng],
      ], await orang.csrf('/cuti-saya'));
      const notifPeng = await db.all(
        "SELECT * FROM notifikasi WHERE pengguna_id = ? AND judul LIKE '%pengganti%'", [idPeng]);
      cek(notifPeng.length >= 1, 'orang yang ditunjuk sebagai pengganti ikut diberi tahu');

      await orang.post('/cuti-saya', [['cuti_mulai', ''], ['cuti_selesai', '']],
        await orang.csrf('/cuti-saya'));
      cek((await db.nilai('SELECT cuti_mulai FROM pengguna WHERE id = ?', [idOrang])) === null,
        'bisa dihapus sendiri kembali');
    }

    // ============================= G. NOTIF DOKUMEN TERTAHAN (LANGSUNG, BUKAN BESOK)
    console.log('\n\x1b[1mNOTIFIKASI DOKUMEN TERTAHAN\x1b[0m');
    {
      const smM = new Klien(dasar);
      await smM.masuk('sm.smg@kla.co.id', SANDI);
      const idRmM = await idDari('regional@kla.co.id');
      const idAdmM = await idDari('admin@kla.co.id');

      // Regional Manager menyatakan tidak bisa; dokumen diajukan lalu Area Manager
      // menyetujui tanpa melewati — dokumen mendarat di tahap yang macet.
      await cuti.setel(idRmM, { mulai: hari(-1), selesai: hari(3), alasan: 'sakit', mode: 'lewati' });
      await db.run('DELETE FROM notifikasi WHERE pengguna_id IN (?, ?)', [idRmM, idAdmM]);

      const judulM = 'Dokumen mendarat di tahap macet';
      await smM.postBerkas('/pengajuan', medan.map(m => (m[0] === 'judul' ? ['judul', judulM] : m)),
        BERKAS_UJI, await smM.csrf('/pengajuan/baru/CAPEX'));
      const dokM = await db.get('SELECT * FROM pengajuan WHERE judul = ?', [judulM]);

      const amM = new Klien(dasar);
      await amM.masuk('am.barat@kla.co.id', SANDI);
      await amM.post('/pengajuan/' + dokM.id + '/putuskan',
        [['aksi', 'setuju'], ['komentar', 'Setuju.']], await amM.csrf('/pengajuan/' + dokM.id));

      const notifRmM = await db.all(
        "SELECT * FROM notifikasi WHERE pengguna_id = ? AND judul LIKE '%menyatakan tidak bisa%'", [idRmM]);
      cek(notifRmM.length >= 1,
        'yang menyatakan tidak bisa DIBERI TAHU begitu dokumen mendarat di tahapnya');
      cek(notifRmM.length > 0 && /Cuti Saya/.test(notifRmM[0].pesan || ''),
        'pesannya menyebut apa yang bisa dia lakukan: tunjuk pengganti');

      const notifAdmM = await db.all(
        "SELECT * FROM notifikasi WHERE pengguna_id = ? AND judul LIKE '%tertahan%'", [idAdmM]);
      cek(notifAdmM.length >= 1, 'Administrator ikut diberi tahu SEKARANG, bukan menunggu pengingat besok');
      cek(notifAdmM.length > 0 && new RegExp(dokM.nomor).test(notifAdmM[0].pesan || ''),
        'pesannya menyebut nomor dokumennya: ' + String(notifAdmM[0] && notifAdmM[0].pesan).slice(0, 55));

      // Kalau MASIH ADA satu calon yang sanggup, itu bukan macet — tidak perlu ribut.
      await cuti.setel(idRmM, { mulai: '', selesai: '' });
      await db.run('DELETE FROM notifikasi WHERE pengguna_id = ?', [idAdmM]);
      const judulN = 'Dokumen normal tanpa macet';
      await smM.postBerkas('/pengajuan', medan.map(m => (m[0] === 'judul' ? ['judul', judulN] : m)),
        BERKAS_UJI, await smM.csrf('/pengajuan/baru/CAPEX'));
      const dokN = await db.get('SELECT * FROM pengajuan WHERE judul = ?', [judulN]);
      await amM.post('/pengajuan/' + dokN.id + '/putuskan',
        [['aksi', 'setuju'], ['komentar', 'Setuju.']], await amM.csrf('/pengajuan/' + dokN.id));
      const notifAdmN = await db.all(
        "SELECT * FROM notifikasi WHERE pengguna_id = ? AND judul LIKE '%tertahan%'", [idAdmM]);
      cek(notifAdmN.length === 0, 'dokumen yang jalan normal TIDAK memicu peringatan tertahan');
    }

    // ============================================= H. UNDUHAN EXCEL
    console.log('\n\x1b[1mUNDUHAN EXCEL\x1b[0m');
    {
      const tulis = require(path.join(AKAR, 'lib/xlsx-tulis'));
      const baca = require(path.join(AKAR, 'lib/xlsx-ringkas'));

      // Isi yang biasanya merusak XML kalau lolos tanpa disaring.
      const buf = tulis.buat({
        namaLembar: 'Uji: berkas/lembar?',
        kolom: [{ judul: 'Teks', lebar: 30 }, { judul: 'Nilai', lebar: 14, uang: true }],
        baris: [['AC & rak <display> "khusus"', 14000000], ['Baris kosong', 0], ['', null]],
      });
      cek(buf.slice(0, 2).toString() === 'PK', 'berkas Excel terbentuk sebagai arsip ZIP');
      const teks = baca.keTeks(buf);
      cek(teks.includes('AC & rak <display> "khusus"'),
        'tanda & < > dan kutip terbaca kembali apa adanya, tidak merusak berkasnya');
      cek(/\t14000000(\t|$)/m.test(teks), 'angka disimpan sebagai angka');
      cek(tulis.namaLembarAman('Uji: berkas/lembar?') === 'Uji  berkas lembar ',
        'nama lembar dibersihkan dari karakter yang ditolak Excel');
      cek(tulis.namaLembarAman('x'.repeat(60)).length === 31, 'nama lembar dipotong ke batas 31 karakter');
      cek(tulis.hurufKolom(0) === 'A' && tulis.hurufKolom(25) === 'Z' && tulis.hurufKolom(26) === 'AA',
        'penomoran kolom benar sampai melewati Z');
    }

    // ================================================ I. SESI BERAKHIR SENDIRI
    console.log('\n\x1b[1mKELUAR SENDIRI SETELAH DIAM\x1b[0m');
    {
      const halLogin = await new Klien(dasar).get('/login');
      const maxAgeDetik = 60 * 60;   // 60 menit

      // Masa berlakunya dibaca dari cookie yang benar-benar dikirim server, bukan
      // dari kode — supaya yang diuji perilakunya, bukan niatnya.
      const kSesi = new Klien(dasar);
      const rMasuk = await kSesi.masukMentah('sm.smg@kla.co.id', SANDI);
      const kueSesi = (rMasuk.kue || []).find(c => c.startsWith('eapex.sid=')) || '';
      const habisPada = (/Expires=([^;]+)/i.exec(kueSesi) || [])[1];
      const menit = habisPada ? Math.round((new Date(habisPada) - Date.now()) / 60000) : -1;
      cek(menit >= 59 && menit <= 61,
        'cookie sesi berlaku ' + menit + ' menit, bukan berjam-jam');
      cek(/HttpOnly/i.test(kueSesi), 'cookie sesi tidak bisa dibaca skrip halaman (HttpOnly)');

      // Rolling: masa berlakunya disetel ULANG tiap permintaan, jadi yang dihitung
      // memang diamnya — bukan lama sejak masuk.
      const isiApp = require('fs').readFileSync(path.join(AKAR, 'app.js'), 'utf8');
      cek(/rolling:\s*true/.test(isiApp),
        'masa berlaku disetel ulang tiap permintaan — orang yang bekerja terus tidak terlempar keluar');

      // Batas MUTLAK: sesi yang dipakai terus pun tidak boleh abadi.
      const authMod = require(path.join(AKAR, 'lib/auth'));
      cek(authMod.SESI_MAKS_JAM() === 12, 'ada batas mutlak 12 jam, seaktif apa pun pemakainya');

      // Sesi yang umurnya sudah lewat batas mutlak ditolak walau cookienya sah.
      const idSm = await idDari('sm.smg@kla.co.id');
      const sidBaris = await db.all('SELECT sid, sess FROM sesi');
      let diubah = 0;
      for (const s of sidBaris) {
        const isi = JSON.parse(s.sess);
        if (isi.penggunaId !== idSm) continue;
        isi.mulai = Date.now() - 13 * 3600 * 1000;      // seolah masuk 13 jam lalu
        await db.run('UPDATE sesi SET sess = ? WHERE sid = ?', [JSON.stringify(isi), s.sid]);
        diubah++;
      }
      cek(diubah > 0, 'sesi uji ditemukan untuk dituakan');
      const rTua = await kSesi.get('/');
      cek(rTua.status === 302, 'sesi berumur 13 jam ditolak walau cookienya masih sah');

      // Pesannya tepat: orang yang sesinya habis tidak disuruh menebak.
      const rPesan = await fetch(dasar + '/pengajuan', {
        headers: { cookie: 'eapex.pernah=1' }, redirect: 'manual',
      });
      const tujuanBalik = rPesan.headers.get('location') || '';
      cek(/habis=1/.test(tujuanBalik), 'peramban yang pernah dipakai masuk diarahkan dengan tanda "sesi habis"');
      const halHabis = await (await fetch(dasar + '/login?habis=1')).text();
      cek(/Sesi Anda berakhir/.test(halHabis) && /60 menit/.test(halHabis),
        'layar masuk menjelaskan sebabnya, bukan sekadar melempar balik');
      cek(!/Sesi Anda berakhir/.test(halLogin.teks),
        'yang belum pernah masuk TIDAK diberi pesan yang membingungkan');

      // Keluar sendiri membuang penandanya, supaya tidak disambut pesan palsu.
      const isiRute = require('fs').readFileSync(path.join(AKAR, 'routes/auth.js'), 'utf8');
      cek(/auth\.buangPenanda\(res\)/.test(isiRute),
        'keluar atas kemauan sendiri membuang penandanya');
    }

    // --- isi email massal
    console.log('\n\x1b[1mISI EMAIL NOTIFIKASI MASSAL\x1b[0m');
    const adm = new Klien(dasar);
    await adm.masuk('admin@kla.co.id', SANDI);
    const halMassal = await adm.get('/admin/email-notifikasi');
    const jmlKotak = (halMassal.teks.match(/name="email_[0-9a-f-]+"/g) || []).length;
    const jmlAktif = Number(await db.nilai('SELECT COUNT(*) FROM pengguna WHERE aktif = 1'));
    cek(jmlKotak === jmlAktif, `satu kotak isian untuk tiap akun aktif (${jmlKotak}/${jmlAktif})`);

    const idCeo = await idDari('ceo@kla.co.id');
    const tokM = await adm.csrf('/admin/email-notifikasi');
    const rM = await adm.post('/admin/email-notifikasi', [
      ['email_' + idCeo, 'ceo.pribadi@contoh.test'],
      ['email_' + idAm, 'salah-format'],
    ], tokM);
    cek(rM.status === 303, 'simpan massal diterima');
    const ceoBaru = await db.nilai('SELECT email_notifikasi FROM pengguna WHERE id = ?', [idCeo]);
    cek(ceoBaru === 'ceo.pribadi@contoh.test', 'alamat yang sah tersimpan');
    const amTetap = await db.nilai('SELECT email_notifikasi FROM pengguna WHERE id = ?', [idAm]);
    cek(amTetap === 'kotak.am@contoh.test',
      'alamat berformat salah DILEWATI — alamat lama tidak ikut rusak');

    // Mengosongkan memang boleh: alamat email tidak wajib.
    await adm.post('/admin/email-notifikasi', [['email_' + idCeo, '']], await adm.csrf('/admin/email-notifikasi'));
    cek((await db.nilai('SELECT email_notifikasi FROM pengguna WHERE id = ?', [idCeo])) === null,
      'alamat bisa dikosongkan kembali — memang tidak wajib');

    const smBiasa = new Klien(dasar);
    await smBiasa.masuk('sm.smg@kla.co.id', SANDI);
    const rBukanAdmin = await smBiasa.get('/admin/email-notifikasi');
    cek(rBukanAdmin.status === 403, 'halaman email massal hanya untuk Administrator');

    const tamu = new Klien(dasar);
    const rTamu = await tamu.get('/admin/pengguna');
    cek(rTamu.status === 302, 'halaman pengguna tetap tertutup untuk yang belum masuk');
  } finally {
    srv.close();
    smtp.close();
    await require(path.join(AKAR, 'lib/db')).tutup();
    try { require('fs').rmSync(process.env.LAMPIRAN_DIR, { recursive: true, force: true }); } catch (e) { /* biarkan */ }
    try { require('fs').unlinkSync(process.env.SQLITE_PATH); } catch (e) { /* biarkan */ }
  }

  console.log('\n  ' + lulus + ' lulus, ' + gagal + ' gagal');
  process.exit(gagal ? 1 : 0);
})().catch(e => { console.error('GAGAL TOTAL', e); process.exit(1); });
