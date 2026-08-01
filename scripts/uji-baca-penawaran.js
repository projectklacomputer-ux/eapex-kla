#!/usr/bin/env node
// ============================================================================
//  UJI BACA PENAWARAN — dijalankan otomatis oleh `npm run cek`
// ============================================================================
// Bagian ini berdiri sendiri karena butuh OPENAI_API_KEY terisi, sedangkan
// pemeriksaan lain justru menguji keadaan saat kuncinya kosong (tombolnya redup).
//
// Layanan OpenAI TIRUAN dijalankan di localhost, jadi:
//   - tidak ada permintaan yang benar-benar keluar ke internet,
//   - tidak ada biaya,
//   - isi permintaan yang dikirim aplikasi bisa diperiksa sungguhan.
const path = require('path');
const os = require('os');
const http = require('http');
const zlib = require('zlib');

const AKAR = path.join(__dirname, '..');
const tmp = path.join(os.tmpdir(), 'eapex-baca-' + process.pid);
process.env.SQLITE_PATH = tmp + '.db';
process.env.LAMPIRAN_DIR = tmp + '-lampiran';
process.env.SESSION_SECRET = 'rahasia-untuk-pengujian-saja-0123456789';
process.env.NODE_ENV = 'test';
process.env.OPENAI_API_KEY = 'kunci-uji';
process.env.OPENAI_MODEL = 'model-uji';
delete process.env.DATABASE_URL;

let gagal = 0, lulus = 0;
const ok = t => { lulus++; console.log('  \x1b[32m✓\x1b[0m ' + t); };
const no = t => { gagal++; console.log('  \x1b[31m✗ ' + t + '\x1b[0m'); };
const cek = (syarat, teks) => (syarat ? ok(teks) : no(teks));

// ---------------------------------------------------------------- pembuat .xlsx
// Berkas Excel sungguhan dibuat di sini (arsip ZIP tanpa pemampatan) supaya
// pembaca Excel diuji dengan berkas asli, bukan dengan tiruan XML-nya saja.
function crc32(buf) {
  let c, tabel = crc32.tabel;
  if (!tabel) {
    tabel = crc32.tabel = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      tabel[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = tabel[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function buatZip(berkas) {
  const lokal = [], pusat = [];
  let posisi = 0;
  for (const { nama, isi } of berkas) {
    const namaBuf = Buffer.from(nama, 'utf8');
    const crc = crc32(isi);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(isi.length, 18); h.writeUInt32LE(isi.length, 22);
    h.writeUInt16LE(namaBuf.length, 26);
    lokal.push(h, namaBuf, isi);

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(isi.length, 20); c.writeUInt32LE(isi.length, 24);
    c.writeUInt16LE(namaBuf.length, 28); c.writeUInt32LE(posisi, 42);
    pusat.push(c, namaBuf);

    posisi += 30 + namaBuf.length + isi.length;
  }
  const isiPusat = Buffer.concat(pusat);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(berkas.length, 8); eocd.writeUInt16LE(berkas.length, 10);
  eocd.writeUInt32LE(isiPusat.length, 12); eocd.writeUInt32LE(posisi, 16);
  return Buffer.concat([...lokal, isiPusat, eocd]);
}

function buatXlsx(baris) {
  const teks = [];
  const nomorTeks = s => { let i = teks.indexOf(s); if (i < 0) { i = teks.length; teks.push(s); } return i; };
  const huruf = n => String.fromCharCode(65 + n);

  const barisXml = baris.map((r, ir) => {
    const sel = r.map((nilai, ic) => {
      const alamat = huruf(ic) + (ir + 1);
      if (typeof nilai === 'number') return `<c r="${alamat}"><v>${nilai}</v></c>`;
      return `<c r="${alamat}" t="s"><v>${nomorTeks(String(nilai))}</v></c>`;
    }).join('');
    return `<row r="${ir + 1}">${sel}</row>`;
  }).join('');

  const sheet = `<?xml version="1.0"?><worksheet><sheetData>${barisXml}</sheetData></worksheet>`;
  const bersama = `<?xml version="1.0"?><sst count="${teks.length}" uniqueCount="${teks.length}">`
    + teks.map(t => `<si><t>${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`).join('') + '</sst>';

  return buatZip([
    { nama: '[Content_Types].xml', isi: Buffer.from('<?xml version="1.0"?><Types/>', 'utf8') },
    { nama: 'xl/sharedStrings.xml', isi: Buffer.from(bersama, 'utf8') },
    { nama: 'xl/worksheets/sheet1.xml', isi: Buffer.from(sheet, 'utf8') },
  ]);
}

// ---------------------------------------------------------------- layanan tiruan
const JAWABAN = {
  vendor: 'PT Sumber Elektronik Jaya',
  nama_proyek: 'Pengadaan AC dan rak display',
  items: [
    { nama: 'AC 2 PK Daikin', qty: 2, satuan: 'unit', harga: 6500000, keterangan: 'garansi 1 tahun' },
    { nama: 'Rak display kaca', qty: 3, satuan: 'unit', harga: 1250000, keterangan: '' },
  ],
  pengiriman: 250000, instalasi: 750000, biaya_lain: 0,
  mata_uang: 'IDR', sudah_termasuk_ppn: false, keyakinan: 'tinggi', catatan: '',
};

let permintaanTerakhir = null;
let jumlahPanggilan = 0;
let balasan = { status: 200, isi: null };

const palsu = http.createServer((req, res) => {
  let badan = '';
  req.on('data', d => { badan += d; });
  req.on('end', () => {
    jumlahPanggilan++;
    permintaanTerakhir = { url: req.url, otorisasi: req.headers.authorization, badan: JSON.parse(badan || '{}') };
    if (balasan.status !== 200) {
      res.writeHead(balasan.status, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'rahasia-internal-layanan' } }));
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(balasan.isi || JAWABAN) } }],
      usage: { total_tokens: 1234 },
    }));
  });
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
    const r = await this.get(jalur);
    const m = /name="_csrf" value="([^"]+)"/.exec(r.teks);
    return m ? m[1] : null;
  }
  async masuk(email, sandi) {
    const tok = await this.csrf('/login');
    const r = await fetch(this.dasar + '/login', {
      method: 'POST', redirect: 'manual',
      headers: { ...this.header, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: tok, email, sandi, tujuan: '/' }).toString(),
    });
    this.simpan(r);
  }
  async bacaPenawaran(berkas, token) {
    const fd = new FormData();
    if (token !== null) fd.append('_csrf', token === undefined ? '' : token);
    for (const b of berkas) fd.append('berkas', new Blob([b.isi], { type: b.mime }), b.nama);
    const r = await fetch(this.dasar + '/pengajuan/baca-penawaran', {
      method: 'POST', redirect: 'manual', headers: this.header, body: fd,
    });
    this.simpan(r);
    const teks = await r.text();
    let j = null; try { j = JSON.parse(teks); } catch (e) { /* bukan JSON */ }
    return { status: r.status, j, teks };
  }
}

// ---------------------------------------------------------------- jalankan
(async () => {
  // ---- pembaca Excel diuji lebih dulu, tanpa server sama sekali
  const xlsx = require(path.join(AKAR, 'lib/xlsx-ringkas'));
  const berkasXlsx = buatXlsx([
    ['PENAWARAN HARGA', '', '', ''],
    ['No', 'Uraian', 'Qty', 'Harga'],
    ['1', 'AC 2 PK Daikin', 2, 6500000],
    ['2', 'Rak display kaca', 3, 1250000],
    ['', '', '', ''],
    ['', 'Ongkos kirim', '', 250000],
  ]);
  const teksXlsx = xlsx.keTeks(berkasXlsx);
  cek(teksXlsx.includes('AC 2 PK Daikin'), 'Excel: teks sel terbaca');
  cek(teksXlsx.includes('6500000'), 'Excel: angka terbaca apa adanya (tidak diformat ulang)');
  cek(teksXlsx.includes('Rak display kaca\t3\t1250000'), 'Excel: satu baris tetap satu baris, kolom berurutan');
  cek(!/^\s*$/m.test(teksXlsx.split('\n').slice(1).join('\n')) || !teksXlsx.includes('\n\n'),
    'Excel: baris kosong dibuang supaya tidak boros token');

  // ---- nyalakan layanan tiruan lalu server aplikasi
  await new Promise(r => palsu.listen(0, r));
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:' + palsu.address().port + '/v1';

  const db = require(path.join(AKAR, 'lib/db'));
  const { siapkan } = require(path.join(AKAR, 'lib/skema'));
  const bcrypt = require(path.join(AKAR, 'node_modules/bcryptjs'));
  await siapkan({ senyap: true });
  const SANDI = 'UjiEapex123';
  await db.run('UPDATE pengguna SET sandi_hash = ?, wajib_ganti_sandi = 0', [bcrypt.hashSync(SANDI, 10)]);

  const app = require(path.join(AKAR, 'app'));
  const srv = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const dasar = 'http://127.0.0.1:' + srv.address().port;

  try {
    const sm = new Klien(dasar);
    await sm.masuk('sm.smg@kla.co.id', SANDI);
    const tok = await sm.csrf('/pengajuan/baru/CAPEX');

    // ---- tombolnya muncul saat kunci terisi
    const hal = await sm.get('/pengajuan/baru/CAPEX');
    cek(hal.teks.includes('id="tombol-baca"'), 'tombol "Baca penawaran ini" muncul saat OPENAI_API_KEY terisi');
    cek(/id="hasil-baca"[^>]*hidden/.test(hal.teks), 'panel hasil tersembunyi sebelum ada yang dibaca');

    // ---- pembacaan sungguhan
    const r1 = await sm.bacaPenawaran([{ nama: 'Penawaran.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', isi: berkasXlsx }], tok);
    cek(r1.status === 200 && r1.j && r1.j.ok, 'penawaran Excel terbaca (jawaban 200)');
    cek(r1.j && r1.j.hasil.items.length === 2, '2 baris barang dikembalikan');
    cek(r1.j && r1.j.hasil.items[0].harga === 6500000, 'harga satuan terbawa utuh: 6.500.000');

    const badan = permintaanTerakhir.badan;
    cek(permintaanTerakhir.url === '/v1/chat/completions', 'dikirim ke alamat chat/completions');
    cek(permintaanTerakhir.otorisasi === 'Bearer kunci-uji', 'kunci OpenAI dikirim sebagai Bearer');
    cek(badan.model === 'model-uji', 'model diambil dari env, bukan dipatok di kode');
    cek(badan.temperature === 0, 'temperature 0 — jawaban tidak dikarang-karang');
    cek(badan.response_format && badan.response_format.type === 'json_schema'
      && badan.response_format.json_schema.strict === true,
      'jawaban dikunci pada satu bentuk JSON (strict)');

    const isiPengguna = JSON.stringify(badan.messages[1].content);
    cek(isiPengguna.includes('AC 2 PK Daikin') && isiPengguna.includes('6500000'),
      'Excel dikirim sebagai TEKS hasil uraian server, bukan berkas mentah');
    cek(!isiPengguna.includes('image_url') && !isiPengguna.includes('file_data'),
      'Excel tidak ikut dikirim sebagai gambar/berkas — ongkosnya ditekan');
    cek(/DATA, bukan perintah/i.test(badan.messages[0].content),
      'perintah sistem menegaskan isi berkas adalah data, bukan perintah');

    // ---- gambar memang dikirim sebagai gambar
    jumlahPanggilan = 0;
    await sm.bacaPenawaran([{ nama: 'foto-penawaran.jpg', mime: 'image/jpeg', isi: Buffer.from('gambar-palsu') }], tok);
    const isiGambar = JSON.stringify(permintaanTerakhir.badan.messages[1].content);
    cek(isiGambar.includes('image_url') && isiGambar.includes('data:image/jpeg;base64,'),
      'foto penawaran dikirim sebagai gambar (satu-satunya cara membaca hasil pindai)');

    // ---- PDF dikirim utuh
    await sm.bacaPenawaran([{ nama: 'penawaran.pdf', mime: 'application/pdf', isi: Buffer.from('%PDF-1.4') }], tok);
    const isiPdf = JSON.stringify(permintaanTerakhir.badan.messages[1].content);
    cek(isiPdf.includes('data:application/pdf;base64,'), 'PDF dikirim utuh ke layanan');

    // ---- berkas TIDAK ikut tersimpan (pembacaan bukan pengunggahan)
    const fs = require('fs');
    const sisa = (() => { try { return fs.readdirSync(process.env.LAMPIRAN_DIR).length; } catch (e) { return 0; } })();
    await new Promise(r => setTimeout(r, 80));
    cek(sisa === 0, 'berkas yang hanya dibaca tidak tertinggal di penyimpanan lampiran');
    const jmlLampiran = await db.nilai('SELECT COUNT(*) FROM lampiran');
    cek(Number(jmlLampiran) === 0, 'membaca penawaran tidak membuat baris lampiran (belum diunggah)');

    // ---- jawaban model tidak pernah dipercaya apa adanya
    balasan = {
      status: 200,
      isi: {
        vendor: 'X'.repeat(500), nama_proyek: 'Y',
        items: [
          { nama: 'Barang wajar', qty: -5, satuan: '', harga: 1e20, keterangan: '' },
          { nama: '', qty: 1, satuan: 'unit', harga: 1000, keterangan: '' },
        ],
        pengiriman: -100, instalasi: 'bukan angka', biaya_lain: 0,
        mata_uang: 'usd', sudah_termasuk_ppn: 'ya', keyakinan: 'sangat-yakin', catatan: 'Z'.repeat(900),
      },
    };
    const r2 = await sm.bacaPenawaran([{ nama: 'aneh.pdf', mime: 'application/pdf', isi: Buffer.from('%PDF') }], tok);
    const h = r2.j.hasil;
    cek(h.vendor.length <= 150, 'nama vendor kepanjangan dipangkas');
    cek(h.items.length === 1, 'baris tanpa uraian dibuang');
    cek(h.items[0].qty === 1, 'qty negatif diperbaiki jadi 1');
    cek(h.items[0].harga <= 1e13, 'harga di luar akal dibatasi');
    cek(h.items[0].satuan === 'unit', 'satuan kosong diisi "unit"');
    cek(h.pengiriman === 0, 'nominal negatif jadi 0');
    cek(h.instalasi === 0, 'nominal bukan angka jadi 0');
    cek(h.sudah_termasuk_ppn === false, 'nilai benar/salah yang bukan boolean dianggap salah');
    cek(h.keyakinan === 'sedang', 'tingkat keyakinan di luar daftar dikembalikan ke "sedang"');
    cek(h.catatan.length <= 400, 'catatan kepanjangan dipangkas');
    cek(r2.j.peringatan.some(p => /USD/.test(p)),
      'mata uang selain Rupiah diperingatkan, angkanya TIDAK dikurskan diam-diam');

    // ---- peringatan PPN
    balasan = { status: 200, isi: { ...JAWABAN, sudah_termasuk_ppn: true } };
    const r3 = await sm.bacaPenawaran([{ nama: 'a.pdf', mime: 'application/pdf', isi: Buffer.from('%PDF') }], tok);
    cek(r3.j.peringatan.some(p => /PPN/.test(p)), 'penawaran sudah termasuk PPN diperingatkan');

    // ---- galat layanan tidak membocorkan isi jawaban layanan
    balasan = { status: 500, isi: null };
    const r4 = await sm.bacaPenawaran([{ nama: 'a.pdf', mime: 'application/pdf', isi: Buffer.from('%PDF') }], tok);
    cek(r4.status >= 400 && !r4.teks.includes('rahasia-internal-layanan'),
      'pesan galat dari layanan luar tidak diteruskan mentah ke layar');
    cek(/isi manual/i.test(r4.j.pesan || ''), 'pengguna diberi jalan keluar: isi manual');
    balasan = { status: 200, isi: null };

    // ---- keamanan
    const rTokPalsu = await sm.bacaPenawaran([{ nama: 'a.pdf', mime: 'application/pdf', isi: Buffer.from('%PDF') }], 'palsu');
    cek(rTokPalsu.status === 403, 'membaca penawaran tanpa token CSRF sah ditolak 403');

    jumlahPanggilan = 0;
    const tamu = new Klien(dasar);
    const rTamu = await tamu.bacaPenawaran([{ nama: 'a.pdf', mime: 'application/pdf', isi: Buffer.from('%PDF') }], 'x');
    cek(rTamu.status === 401 || rTamu.status === 303 || rTamu.status === 302, 'tanpa login tidak bisa memakai pembaca penawaran');
    cek(jumlahPanggilan === 0, 'permintaan yang ditolak TIDAK sempat memanggil layanan berbayar');

    const rJenis = await sm.bacaPenawaran([{ nama: 'jahat.exe', mime: 'application/octet-stream', isi: Buffer.from('MZ') }], tok);
    cek(rJenis.status >= 400, 'jenis berkas yang tidak diizinkan ditolak sebelum dikirim ke layanan');

    // ---- tanpa kunci: tombolnya TETAP TERLIHAT, tapi mati
    // Fitur yang tidak kelihatan sama saja tidak ada. Orang perlu tahu bahwa
    // nanti isian ini tidak perlu diketik satu per satu — jadi tombolnya tetap
    // dipajang, redup, dengan keterangan kenapa belum bisa dipakai.
    const kunciAsli = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = '';
    const halTanpa = await sm.get('/pengajuan/baru/CAPEX');
    cek(halTanpa.teks.includes('id="tombol-baca"'),
      'tanpa kunci OpenAI pun tombolnya TETAP TAMPIL — supaya orang tahu fiturnya ada');
    cek(/id="tombol-baca"[^>]*disabled/.test(halTanpa.teks), 'tapi tidak bisa ditekan');
    cek(/data-aktif="0"/.test(halTanpa.teks), 'ditandai belum aktif untuk skrip peramban');
    cek(/Belum dinyalakan/.test(halTanpa.teks) && /Administrator/.test(halTanpa.teks),
      'keterangannya menjelaskan kenapa dan siapa yang bisa menyalakannya');
    cek(!halTanpa.teks.includes('id="hasil-baca"'),
      'panel hasilnya tidak ikut dipasang selama fiturnya mati');

    jumlahPanggilan = 0;
    const rTanpa = await sm.bacaPenawaran([{ nama: 'a.pdf', mime: 'application/pdf', isi: Buffer.from('%PDF') }], tok);
    cek(rTanpa.status === 503 && jumlahPanggilan === 0,
      'kalau tetap dipaksa lewat alamatnya, ditolak rapi tanpa memanggil siapa pun');
    process.env.OPENAI_API_KEY = kunciAsli;

    // ---- dengan kunci: tombolnya hidup dan keterangannya berubah
    const halAda = await sm.get('/pengajuan/baru/CAPEX');
    cek(/data-aktif="1"/.test(halAda.teks), 'begitu kuncinya terisi, tombolnya ditandai aktif');
    cek(/Lampirkan penawarannya dulu/.test(halAda.teks),
      'keterangannya berganti jadi petunjuk pemakaian');
    cek(halAda.teks.includes('id="hasil-baca"'), 'panel hasil ikut dipasang saat fiturnya hidup');

    // Tombolnya tetap dikirim dalam keadaan mati; skrip peramban yang
    // menghidupkannya setelah ada berkas dipilih. Kalau dikirim hidup, orang
    // bisa menekannya tanpa berkas dan mendapat galat tanpa sebab yang jelas.
    cek(/id="tombol-baca"[^>]*disabled/.test(halAda.teks),
      'tombol dikirim dalam keadaan mati sampai ada berkas yang dipilih');
    const skrip = require('fs').readFileSync(path.join(AKAR, 'public/js/app.js'), 'utf8');
    cek(/tombol\.disabled = !aktif \|\| !adaBerkas\(\)/.test(skrip),
      'skrip peramban menghidupkannya hanya bila fiturnya aktif DAN ada berkas');
  } finally {
    srv.close();
    palsu.close();
    await require(path.join(AKAR, 'lib/db')).tutup();
    try { require('fs').rmSync(process.env.LAMPIRAN_DIR, { recursive: true, force: true }); } catch (e) { /* biarkan */ }
    try { require('fs').unlinkSync(process.env.SQLITE_PATH); } catch (e) { /* biarkan */ }
  }

  console.log('\n  ' + lulus + ' lulus, ' + gagal + ' gagal');
  process.exit(gagal ? 1 : 0);
})().catch(e => { console.error('GAGAL TOTAL', e); process.exit(1); });
