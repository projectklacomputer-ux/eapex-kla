#!/usr/bin/env node
// ============================================================================
//  Pembuat ikon aplikasi (PNG) untuk PWA
// ============================================================================
//   node scripts/buat-ikon.js
//
// PNG ditulis langsung dari kode (zlib bawaan Node), tanpa perkakas gambar —
// supaya ikon selalu bisa dibuat ulang di komputer mana pun, termasuk yang
// tidak punya ImageMagick/Python/Photoshop.
//
// Yang dihasilkan di public/gambar:
//   ikon-192.png            ikon biasa Android/desktop
//   ikon-512.png            ikon besar (splash screen)
//   ikon-maskable-512.png   ikon penuh-bidang, ruang aman 80% (Android adaptive)
//   apple-touch-icon.png    180x180 untuk iPhone/iPad (tanpa transparansi)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIR = path.join(__dirname, '..', 'public', 'gambar');

// Warna merek
const UNGU = [70, 24, 102];        // #461866 — diambil langsung dari berkas logo
const EMAS = [247, 191, 10];       // #f7bf0a
const PUTIH = [255, 255, 255];

// --------------------------------------------------------------- kanvas
function kanvas(ukuran) {
  return { w: ukuran, h: ukuran, data: Buffer.alloc(ukuran * ukuran * 4, 0) };
}

function taruhPiksel(k, x, y, warna, alpha = 255) {
  if (x < 0 || y < 0 || x >= k.w || y >= k.h) return;
  const i = (y * k.w + x) * 4;
  const a = alpha / 255;
  const lamaA = k.data[i + 3] / 255;
  const baruA = a + lamaA * (1 - a);
  if (baruA <= 0) return;
  for (let c = 0; c < 3; c++) {
    k.data[i + c] = Math.round((warna[c] * a + k.data[i + c] * lamaA * (1 - a)) / baruA);
  }
  k.data[i + 3] = Math.round(baruA * 255);
}

function kotak(k, x0, y0, lebar, tinggi, warna) {
  for (let y = Math.round(y0); y < Math.round(y0 + tinggi); y++) {
    for (let x = Math.round(x0); x < Math.round(x0 + lebar); x++) taruhPiksel(k, x, y, warna);
  }
}

// Persegi bersudut tumpul dengan tepi halus (anti-aliasing sederhana).
function kotakTumpul(k, x0, y0, lebar, tinggi, jari, warna) {
  // Sudut lurus (jari = 0) harus digambar penuh. Tanpa cabang ini, rumus tepi
  // halus di bawah menghasilkan alpha 50% untuk SELURUH bidang — ikon jadi
  // abu-abu tembus pandang, bukan warna aslinya.
  if (jari <= 0) return kotak(k, x0, y0, lebar, tinggi, warna);
  const x1 = x0 + lebar, y1 = y0 + tinggi;
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      const dx = Math.max(x0 + jari - (x + 0.5), (x + 0.5) - (x1 - jari), 0);
      const dy = Math.max(y0 + jari - (y + 0.5), (y + 0.5) - (y1 - jari), 0);
      const jarak = Math.sqrt(dx * dx + dy * dy);
      if (jarak <= jari - 0.5) taruhPiksel(k, x, y, warna);
      else if (jarak < jari + 0.5) taruhPiksel(k, x, y, warna, Math.round((jari + 0.5 - jarak) * 255));
    }
  }
}

function lingkaran(k, cx, cy, jari, warna) {
  for (let y = Math.floor(cy - jari - 1); y <= Math.ceil(cy + jari + 1); y++) {
    for (let x = Math.floor(cx - jari - 1); x <= Math.ceil(cx + jari + 1); x++) {
      const jarak = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (jarak <= jari - 0.5) taruhPiksel(k, x, y, warna);
      else if (jarak < jari + 0.5) taruhPiksel(k, x, y, warna, Math.round((jari + 0.5 - jarak) * 255));
    }
  }
}

// Huruf "E" tebal dari empat batang — terbaca jelas walau ikonnya kecil.
function hurufE(k, x, y, lebar, tinggi, warna) {
  const tebal = Math.max(2, Math.round(tinggi * 0.19));
  kotak(k, x, y, tebal, tinggi, warna);                              // batang tegak
  kotak(k, x, y, lebar, tebal, warna);                               // atas
  kotak(k, x, y + (tinggi - tebal) / 2, lebar * 0.82, tebal, warna);  // tengah
  kotak(k, x, y + tinggi - tebal, lebar, tebal, warna);              // bawah
}


// --------------------------------------------------------------- pembaca PNG
// Dipakai untuk memuat berkas logo asli lalu menempelkannya ke ikon, supaya ikon
// aplikasi memakai lambang KLA yang sesungguhnya — bukan gambar tiruan.
function bacaPng(berkas) {
  const b = fs.readFileSync(berkas);
  let i = 8, ihdr = null, idat = [], plte = null;
  while (i < b.length) {
    const panjang = b.readUInt32BE(i);
    const jenis = b.slice(i + 4, i + 8).toString('ascii');
    const isi = b.slice(i + 8, i + 8 + panjang);
    if (jenis === 'IHDR') ihdr = { lebar: isi.readUInt32BE(0), tinggi: isi.readUInt32BE(4), kedalaman: isi[8], jenisWarna: isi[9] };
    else if (jenis === 'IDAT') idat.push(isi);
    else if (jenis === 'PLTE') plte = isi;
    else if (jenis === 'IEND') break;
    i += 12 + panjang;
  }
  const kanal = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.jenisWarna];
  const lebarBaris = ihdr.lebar * kanal;
  const mentah = zlib.inflateSync(Buffer.concat(idat));
  const gambar = Buffer.alloc(lebarBaris * ihdr.tinggi);
  const paeth = (a, bb, c) => {
    const p = a + bb - c, pa = Math.abs(p - a), pb = Math.abs(p - bb), pc = Math.abs(p - c);
    return (pa <= pb && pa <= pc) ? a : (pb <= pc ? bb : c);
  };
  for (let y = 0; y < ihdr.tinggi; y++) {
    const filter = mentah[y * (lebarBaris + 1)];
    for (let x = 0; x < lebarBaris; x++) {
      const a = x >= kanal ? gambar[y * lebarBaris + x - kanal] : 0;
      const bb = y > 0 ? gambar[(y - 1) * lebarBaris + x] : 0;
      const c = (x >= kanal && y > 0) ? gambar[(y - 1) * lebarBaris + x - kanal] : 0;
      let v = mentah[y * (lebarBaris + 1) + 1 + x];
      if (filter === 1) v += a; else if (filter === 2) v += bb;
      else if (filter === 3) v += Math.floor((a + bb) / 2);
      else if (filter === 4) v += paeth(a, bb, c);
      gambar[y * lebarBaris + x] = v & 0xff;
    }
  }
  const piksel = (x, y) => {
    const o = y * lebarBaris + x * kanal;
    if (ihdr.jenisWarna === 3) { const q = gambar[o]; return [plte[q * 3], plte[q * 3 + 1], plte[q * 3 + 2], 255]; }
    if (ihdr.jenisWarna === 2) return [gambar[o], gambar[o + 1], gambar[o + 2], 255];
    if (ihdr.jenisWarna === 6) return [gambar[o], gambar[o + 1], gambar[o + 2], gambar[o + 3]];
    return [gambar[o], gambar[o], gambar[o], 255];
  };
  return { lebar: ihdr.lebar, tinggi: ihdr.tinggi, piksel };
}

// Menempel gambar sumber ke kanvas dengan penghalusan rata-rata (box filter),
// supaya logo tetap tajam saat diperkecil dari 252px ke 96px.
function tempel(k, sumber, xTuju, yTuju, lebarTuju, tinggiTuju) {
  const sx = sumber.lebar / lebarTuju, sy = sumber.tinggi / tinggiTuju;
  for (let y = 0; y < tinggiTuju; y++) {
    for (let x = 0; x < lebarTuju; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < Math.min(y1, sumber.tinggi); yy++) {
        for (let xx = x0; xx < Math.min(x1, sumber.lebar); xx++) {
          const p = sumber.piksel(xx, yy);
          r += p[0]; g += p[1]; b += p[2]; a += p[3]; n++;
        }
      }
      if (!n) continue;
      taruhPiksel(k, xTuju + x, yTuju + y, [Math.round(r / n), Math.round(g / n), Math.round(b / n)], Math.round(a / n));
    }
  }
}

// --------------------------------------------------------------- gambar ikon
function gambarIkon(ukuran, opsi = {}) {
  const k = kanvas(ukuran);
  const penuh = !!opsi.penuhBidang;          // maskable / apple-touch: tanpa transparansi
  const sisip = penuh ? 0 : ukuran * 0.03;
  const jari = penuh ? 0 : ukuran * 0.22;
  kotakTumpul(k, sisip, sisip, ukuran - sisip * 2, ukuran - sisip * 2, jari, UNGU);

  // Logo asli ditempel di tengah. Untuk ikon maskable dipersempit ke 80% karena
  // Android memotong tepinya menjadi lingkaran/kotak membulat sesuai peluncurnya.
  const skala = opsi.ruangAman ? 0.80 : (penuh ? 0.92 : 1);
  const lebarLogo = Math.round(ukuran * skala);
  const tinggiLogo = Math.round(lebarLogo * (LOGO.tinggi / LOGO.lebar));
  tempel(k, LOGO, Math.round((ukuran - lebarLogo) / 2), Math.round((ukuran - tinggiLogo) / 2), lebarLogo, tinggiLogo);

  // Sudut membulat dipulihkan setelah penempelan (logo sumber berbentuk persegi).
  if (!penuh) bulatkanSudut(k, sisip, jari);
  return k;
}

// Menghapus piksel di luar persegi membulat, supaya ikon tidak bersudut siku.
function bulatkanSudut(k, sisip, jari) {
  const x0 = sisip, y0 = sisip, x1 = k.w - sisip, y1 = k.h - sisip;
  for (let y = 0; y < k.h; y++) {
    for (let x = 0; x < k.w; x++) {
      const dx = Math.max(x0 + jari - (x + 0.5), (x + 0.5) - (x1 - jari), 0);
      const dy = Math.max(y0 + jari - (y + 0.5), (y + 0.5) - (y1 - jari), 0);
      const jarak = Math.sqrt(dx * dx + dy * dy);
      const di = (y * k.w + x) * 4;
      if (x + 0.5 < x0 || x + 0.5 > x1 || y + 0.5 < y0 || y + 0.5 > y1) { k.data[di + 3] = 0; continue; }
      if (jarak <= jari - 0.5) continue;
      k.data[di + 3] = jarak >= jari + 0.5 ? 0 : Math.round(k.data[di + 3] * (jari + 0.5 - jarak));
    }
  }
}

// --------------------------------------------------------------- penulis PNG
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
  const panjang = Buffer.alloc(4);
  panjang.writeUInt32BE(isi.length);
  const badan = Buffer.concat([Buffer.from(jenis, 'ascii'), isi]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(badan));
  return Buffer.concat([panjang, badan, crc]);
}

function kePng(k) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(k.w, 0);
  ihdr.writeUInt32BE(k.h, 4);
  ihdr[8] = 8;      // kedalaman bit
  ihdr[9] = 6;      // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const baris = Buffer.alloc((k.w * 4 + 1) * k.h);
  for (let y = 0; y < k.h; y++) {
    baris[y * (k.w * 4 + 1)] = 0;   // tanpa filter
    k.data.copy(baris, y * (k.w * 4 + 1) + 1, y * k.w * 4, (y + 1) * k.w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bagian('IHDR', ihdr),
    bagian('IDAT', zlib.deflateSync(baris, { level: 9 })),
    bagian('IEND', Buffer.alloc(0)),
  ]);
}

// --------------------------------------------------------------- jalan
const LOGO = bacaPng(path.join(DIR, 'logo-kla.png'));

const berkas = [
  ['ikon-192.png', gambarIkon(192)],
  ['ikon-512.png', gambarIkon(512)],
  ['ikon-maskable-512.png', gambarIkon(512, { penuhBidang: true, ruangAman: true })],
  ['apple-touch-icon.png', gambarIkon(180, { penuhBidang: true })],
];

fs.mkdirSync(DIR, { recursive: true });
for (const [nama, k] of berkas) {
  const png = kePng(k);
  fs.writeFileSync(path.join(DIR, nama), png);
  console.log('  ' + nama.padEnd(26) + k.w + 'x' + k.h + '  ' + Math.round(png.length / 1024) + ' KB');
}
console.log('\n  Ikon dibuat di public/gambar\n');
