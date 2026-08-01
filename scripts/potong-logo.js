#!/usr/bin/env node
// ============================================================================
//  Memotong logo KLA dari latar ungunya
// ============================================================================
//   node scripts/potong-logo.js
//
// Berkas logo asli berupa kotak ungu dengan lambang emas di tengahnya. Kalau
// dipasang apa adanya, yang terlihat adalah KOTAK — bukan lambangnya. Skrip ini
// membuang latar ungunya menjadi transparan, lalu memangkas pinggiran kosong,
// sehingga lambangnya bisa diletakkan di atas latar apa pun dengan ukuran yang pas.
//
// Cara kerjanya: logo ini dua warna (ungu dan emas). Untuk tiap piksel dihitung
// seberapa jauh warnanya dari ungu menuju emas — nilai itu dipakai sebagai tingkat
// kepekatan (alpha), sehingga tepi logo tetap halus, tidak bergerigi.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIR = path.join(__dirname, '..', 'public', 'gambar');
const SUMBER = path.join(DIR, 'logo-kla.png');
const TUJUAN = path.join(DIR, 'logo-kla-lambang.png');

const UNGU = [70, 24, 102];
const EMAS = [247, 191, 10];

// --------------------------------------------------------------- baca PNG
function bacaPng(berkas) {
  const b = fs.readFileSync(berkas);
  let i = 8, ihdr = null, idat = [], plte = null;
  while (i < b.length) {
    const panjang = b.readUInt32BE(i);
    const jenis = b.slice(i + 4, i + 8).toString('ascii');
    const isi = b.slice(i + 8, i + 8 + panjang);
    if (jenis === 'IHDR') ihdr = { lebar: isi.readUInt32BE(0), tinggi: isi.readUInt32BE(4), jenisWarna: isi[9] };
    else if (jenis === 'IDAT') idat.push(isi);
    else if (jenis === 'PLTE') plte = isi;
    else if (jenis === 'IEND') break;
    i += 12 + panjang;
  }
  const kanal = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.jenisWarna];
  const lebarBaris = ihdr.lebar * kanal;
  const mentah = zlib.inflateSync(Buffer.concat(idat));
  const g = Buffer.alloc(lebarBaris * ihdr.tinggi);
  const paeth = (a, bb, c) => {
    const p = a + bb - c, pa = Math.abs(p - a), pb = Math.abs(p - bb), pc = Math.abs(p - c);
    return (pa <= pb && pa <= pc) ? a : (pb <= pc ? bb : c);
  };
  for (let y = 0; y < ihdr.tinggi; y++) {
    const filter = mentah[y * (lebarBaris + 1)];
    for (let x = 0; x < lebarBaris; x++) {
      const a = x >= kanal ? g[y * lebarBaris + x - kanal] : 0;
      const bb = y > 0 ? g[(y - 1) * lebarBaris + x] : 0;
      const c = (x >= kanal && y > 0) ? g[(y - 1) * lebarBaris + x - kanal] : 0;
      let v = mentah[y * (lebarBaris + 1) + 1 + x];
      if (filter === 1) v += a; else if (filter === 2) v += bb;
      else if (filter === 3) v += Math.floor((a + bb) / 2);
      else if (filter === 4) v += paeth(a, bb, c);
      g[y * lebarBaris + x] = v & 0xff;
    }
  }
  const piksel = (x, y) => {
    const o = y * lebarBaris + x * kanal;
    if (ihdr.jenisWarna === 3) { const q = g[o]; return [plte[q * 3], plte[q * 3 + 1], plte[q * 3 + 2], 255]; }
    if (ihdr.jenisWarna === 2) return [g[o], g[o + 1], g[o + 2], 255];
    if (ihdr.jenisWarna === 6) return [g[o], g[o + 1], g[o + 2], g[o + 3]];
    return [g[o], g[o], g[o], 255];
  };
  return { lebar: ihdr.lebar, tinggi: ihdr.tinggi, piksel };
}

// --------------------------------------------------------------- tulis PNG
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function bagian(jenis, isi) {
  const panjang = Buffer.alloc(4); panjang.writeUInt32BE(isi.length);
  const badan = Buffer.concat([Buffer.from(jenis, 'ascii'), isi]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(badan));
  return Buffer.concat([panjang, badan, crc]);
}
function tulisPng(lebar, tinggi, data) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lebar, 0); ihdr.writeUInt32BE(tinggi, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const baris = Buffer.alloc((lebar * 4 + 1) * tinggi);
  for (let y = 0; y < tinggi; y++) {
    baris[y * (lebar * 4 + 1)] = 0;
    data.copy(baris, y * (lebar * 4 + 1) + 1, y * lebar * 4, (y + 1) * lebar * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bagian('IHDR', ihdr),
    bagian('IDAT', zlib.deflateSync(baris, { level: 9 })),
    bagian('IEND', Buffer.alloc(0)),
  ]);
}

// --------------------------------------------------------------- jalan
const sumber = bacaPng(SUMBER);

// Warna tiap piksel diukur pada GARIS ungu->emas:
//   t = posisinya di garis itu (0 = ungu murni, 1 = emas murni) -> jadi alpha
//   sisi = jaraknya dari garis; warna yang jauh dari garis (mis. putih di sudut
//          membulat berkas asli) bukan bagian lambang, jadi dibuang.
// Tanpa pengukuran "sisi" ini, putih ikut terbaca sebagai lambang dan pemangkasan
// pinggiran tidak terjadi sama sekali.
const v = [EMAS[0] - UNGU[0], EMAS[1] - UNGU[1], EMAS[2] - UNGU[2]];
const vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
const BATAS_SISI = 60;

const alpha = new Float32Array(sumber.lebar * sumber.tinggi);
let kiri = sumber.lebar, kanan = -1, atas = sumber.tinggi, bawah = -1;
for (let y = 0; y < sumber.tinggi; y++) {
  for (let x = 0; x < sumber.lebar; x++) {
    const p = sumber.piksel(x, y);
    if (p[3] < 128) { alpha[y * sumber.lebar + x] = 0; continue; }
    const d = [p[0] - UNGU[0], p[1] - UNGU[1], p[2] - UNGU[2]];
    const t = (d[0] * v[0] + d[1] * v[1] + d[2] * v[2]) / vv;
    const sisi = Math.hypot(d[0] - t * v[0], d[1] - t * v[1], d[2] - t * v[2]);
    let a = (sisi > BATAS_SISI) ? 0 : Math.max(0, Math.min(1, t));
    if (a < 0.08) a = 0;                       // ungu murni -> transparan penuh
    alpha[y * sumber.lebar + x] = a;
    if (a > 0.35) {
      if (x < kiri) kiri = x; if (x > kanan) kanan = x;
      if (y < atas) atas = y; if (y > bawah) bawah = y;
    }
  }
}

if (kanan < 0) throw new Error('Lambang tidak terdeteksi di berkas logo');
const lebar = kanan - kiri + 1, tinggi = bawah - atas + 1;
const keluar = Buffer.alloc(lebar * tinggi * 4);
for (let y = 0; y < tinggi; y++) {
  for (let x = 0; x < lebar; x++) {
    const a = alpha[(y + atas) * sumber.lebar + (x + kiri)];
    const o = (y * lebar + x) * 4;
    keluar[o] = EMAS[0]; keluar[o + 1] = EMAS[1]; keluar[o + 2] = EMAS[2];
    keluar[o + 3] = Math.round(a * 255);
  }
}

const png = tulisPng(lebar, tinggi, keluar);
fs.writeFileSync(TUJUAN, png);
console.log(`\n  Lambang dipotong: ${sumber.lebar}x${sumber.tinggi} -> ${lebar}x${tinggi}` +
  `  (${Math.round(png.length / 1024)} KB, latar transparan)`);
console.log('  Tersimpan: public/gambar/logo-kla-lambang.png\n');
