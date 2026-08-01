// ============================================================================
//  Pembaca Excel seadanya — hanya untuk mengubah penawaran jadi teks
// ============================================================================
// Berkas .xlsx sebenarnya arsip ZIP berisi XML. Isinya dibaca sendiri di sini
// supaya tidak perlu menambah pustaka baru, dan supaya angka penawaran dari
// Excel dibaca APA ADANYA (bukan ditebak model AI) — lebih murah dan lebih tepat.
//
// Sengaja sederhana: yang dibutuhkan hanya nilai sel apa adanya, bukan rumus,
// format, gambar, atau tanggal.
const zlib = require('zlib');

// ------------------------------------------------------------------ ZIP
// Membaca daftar isi arsip lewat "central directory" di ekor berkas.
function bacaZip(buf) {
  const TANDA_EOCD = 0x06054b50;
  let akhir = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === TANDA_EOCD) { akhir = i; break; }
  }
  if (akhir < 0) throw Object.assign(new Error('Berkas Excel tidak terbaca (bukan arsip yang sah)'), { publik: true, kode: 400 });

  const jumlah = buf.readUInt16LE(akhir + 10);
  let posisi = buf.readUInt32LE(akhir + 16);
  const isi = new Map();

  for (let n = 0; n < jumlah; n++) {
    if (buf.readUInt32LE(posisi) !== 0x02014b50) break;
    const metode = buf.readUInt16LE(posisi + 10);
    const ukuranPadat = buf.readUInt32LE(posisi + 20);
    const panjangNama = buf.readUInt16LE(posisi + 28);
    const panjangTambahan = buf.readUInt16LE(posisi + 30);
    const panjangKomentar = buf.readUInt16LE(posisi + 32);
    const awalLokal = buf.readUInt32LE(posisi + 42);
    const nama = buf.toString('utf8', posisi + 46, posisi + 46 + panjangNama);

    // Header lokal punya panjang "extra field" sendiri yang bisa berbeda.
    const namaLokal = buf.readUInt16LE(awalLokal + 26);
    const tambahanLokal = buf.readUInt16LE(awalLokal + 28);
    const awalData = awalLokal + 30 + namaLokal + tambahanLokal;
    const data = buf.subarray(awalData, awalData + ukuranPadat);

    try {
      isi.set(nama, metode === 0 ? data : zlib.inflateRawSync(data));
    } catch (e) { /* satu berkas rusak tidak boleh menggagalkan sisanya */ }

    posisi += 46 + panjangNama + panjangTambahan + panjangKomentar;
  }
  return isi;
}

// ------------------------------------------------------------------ XML
function lepasEntitas(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

// Teks bersama: sel bertipe "s" hanya menyimpan nomor urut ke daftar ini.
function bacaTeksBersama(xml) {
  if (!xml) return [];
  const hasil = [];
  const potongan = xml.split('<si>').slice(1);
  for (const p of potongan) {
    const badan = p.split('</si>')[0];
    let teks = '';
    const cocok = badan.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
    for (const t of cocok) teks += lepasEntitas(t.replace(/<[^>]+>/g, ''));
    hasil.push(teks);
  }
  return hasil;
}

function nomorKolom(alamat) {
  const huruf = String(alamat || '').replace(/[^A-Z]/g, '');
  let n = 0;
  for (const h of huruf) n = n * 26 + (h.charCodeAt(0) - 64);
  return n - 1;
}

function bacaLembar(xml, teksBersama) {
  const baris = [];
  const potonganBaris = xml.split('<row').slice(1);
  for (const pb of potonganBaris) {
    const badan = pb.split('</row>')[0];
    const sel = [];
    const potonganSel = badan.split('<c ').slice(1);
    for (const ps of potonganSel) {
      const alamat = (/r="([A-Z]+\d+)"/.exec(ps) || [])[1] || '';
      const tipe = (/t="([^"]+)"/.exec(ps) || [])[1] || 'n';
      let nilai = '';
      if (tipe === 'inlineStr') {
        const t = /<t[^>]*>([\s\S]*?)<\/t>/.exec(ps);
        nilai = t ? lepasEntitas(t[1]) : '';
      } else {
        const v = /<v[^>]*>([\s\S]*?)<\/v>/.exec(ps);
        const mentah = v ? lepasEntitas(v[1]) : '';
        nilai = tipe === 's' ? (teksBersama[Number(mentah)] || '') : mentah;
      }
      const kol = nomorKolom(alamat);
      if (kol >= 0) sel[kol] = nilai;
    }
    baris.push(Array.from(sel, s => (s == null ? '' : String(s))));
  }
  return baris;
}

// ------------------------------------------------------------------ umum
// Mengubah satu berkas Excel jadi teks berbatas tab, siap dibaca model AI
// maupun manusia. Baris kosong dibuang supaya tidak boros token.
function keTeks(buf, batasBaris) {
  const isi = bacaZip(buf);
  const teksBersama = bacaTeksBersama(isi.get('xl/sharedStrings.xml') && isi.get('xl/sharedStrings.xml').toString('utf8'));

  const namaLembar = [...isi.keys()]
    .filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

  const maksBaris = batasBaris || 400;
  const bagian = [];
  for (const nama of namaLembar) {
    const baris = bacaLembar(isi.get(nama).toString('utf8'), teksBersama)
      .filter(r => r.some(sel => String(sel).trim() !== ''))
      .slice(0, maksBaris);
    if (!baris.length) continue;
    bagian.push('--- ' + nama.replace('xl/worksheets/', '').replace('.xml', '') + ' ---');
    bagian.push(baris.map(r => r.join('\t')).join('\n'));
  }
  return bagian.join('\n');
}

module.exports = { keTeks, bacaZip };
