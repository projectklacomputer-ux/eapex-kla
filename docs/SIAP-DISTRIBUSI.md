# EAPEX — Daftar Periksa Sebelum Dibagikan ke Tim

Alamat: **<https://eapex-kla.vercel.app>**
Disusun 1 Agustus 2026

---

## Sudah beres — terverifikasi, bukan asumsi

| | Bukti |
|---|---|
| Aplikasi hidup & cepat | 74 ms, fungsi berjalan di Singapura, sedekat basis datanya |
| Basis data | Supabase tersambung (`db=pg`), 27 akun, 16 kategori |
| Keamanan tampilan | tiap peran hanya melihat yang berhak — 18 pemeriksaan |
| Token keamanan formulir | tahan permintaan bersamaan & pergantian sesi — 17 pemeriksaan |
| Header keamanan | CSP, X-Frame-Options, nosniff, HSTS |
| Sesi | keluar sendiri setelah 60 menit diam, batas mutlak 12 jam |
| PWA | manifest, service worker, ikon, kunci VAPID |
| Baca penawaran AI | terbukti benar membaca Excel berantakan, ~Rp 3 per dokumen |
| Pengingat harian | diuji di produksi: ditolak tanpa rahasia, jalan dengan rahasia |
| Draft terbengkalai | diperingatkan hari ke-1, dihapus hari ke-2 berikut lampirannya |
| Panduan pemakaian | 2 PDF, dipisah Cabang & Back Office |
| Pemeriksaan otomatis | **686 lulus, 0 gagal** |
| Unggah lampiran | diuji sendiri oleh pemilik sistem di produksi |

## Belum beres — perlu tangan Anda

### 1. Notifikasi email — MASIH MATI

Ini yang paling menentukan. Tanpa email, orang **hanya** diberi tahu lewat
notifikasi HP, dan itu cuma sampai kalau dia memasang aplikasi ke layar utama
dan mengizinkan notifikasi. Yang tidak melakukannya tidak akan tahu ada dokumen
menunggu — dan dokumen mati bukan karena ditolak, melainkan karena dilupakan.

Dua langkah:

```powershell
notepad data\email.txt
```

Isi empat baris: server, port, alamat pengirim, App Password. Gmail **wajib**
App Password (Akun Google > Security > 2-Step Verification > App passwords),
bukan sandi akun biasa.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\pasang-email.ps1 -KirimUjiKe alamat@anda.com
```

Skripnya **mengirim email uji lebih dulu** dan menolak memasang kalau gagal.

### 2. Alamat email 27 orang

Admin > **Email Notifikasi**. Yang alamatnya kosong tetap tidak menerima email,
tanpa galat dan tanpa menahan siapa pun.

### 3. Ambang ATK Rp 550.000

Admin > **Matriks Approval**. Saat ini ATK Rp 550.000 masih menuntut tanda
tangan CEO di 15 cabang. Belum diputuskan sejak awal.

---

## Cara membagikan

### Berkas per orang — jangan bagikan daftar utuhnya

`data\bagikan\` berisi **27 berkas, satu per orang**, masing-masing hanya
memuat kredensialnya sendiri.

```powershell
explorer "E:\KLA\Claude\EAPEX\data\bagikan"
```

Jangan meneruskan `data\AKUN-AWAL-SUPABASE.txt` ke siapa pun — di dalamnya
sandi 27 orang sekaligus, termasuk CEO dan Accounting. Mengirim tangkapan
layarnya adalah kesalahan yang wajar terjadi dan tidak bisa ditarik kembali.

### Panduan

- `docs\Tutorial-EAPEX-Cabang.pdf` — 15 Store Manager & 2 Area Manager
- `docs\Tutorial-EAPEX-Back-Office.pdf` — HC, Marketing, Accounting di Kantor Pusat

### Contoh pengumuman

> *Selamat siang Bapak/Ibu,*
>
> *Mulai hari ini pengajuan biaya dan CAPEX dipindah ke aplikasi EAPEX. Tidak
> ada lagi formulir kertas atau kirim berkas lewat chat.*
>
> *Alamat: https://eapex-kla.vercel.app*
>
> *Akun masing-masing saya kirim japri. Sandinya sementara — nanti diminta
> ganti saat pertama masuk.*
>
> ***PENTING:** buka alamatnya di HP, lalu pasang ke layar utama:*
> - *Android (Chrome): menu titik tiga > Install app*
> - *iPhone (Safari): tombol Bagikan > Add to Home Screen*
>
> *Tanpa dipasang, Bapak/Ibu tidak akan menerima pemberitahuan saat ada dokumen
> yang menunggu persetujuan.*
>
> *Panduan lengkapnya terlampir. Kalau ada kendala, hubungi saya.*

Kalimat soal memasang di HP itu **jangan dihapus** selama email belum menyala —
itu satu-satunya cara orang diberi tahu.

---

## Sesudah semua terbagi

```powershell
Remove-Item -Recurse data\bagikan
```

`data\AKUN-AWAL-SUPABASE.txt` jangan dihapus sampai semua orang berhasil masuk
dan mengganti sandinya.

```powershell
Remove-Item data\RAHASIA-DEPLOY.txt
```

Hanya setelah dipastikan seluruh nilainya sudah terpasang di Vercel.

---

## Kalau ada yang melapor bermasalah

| Keluhan | Sebab tersering |
|---|---|
| "Token keamanan tidak cocok" | Halaman dibiarkan terbuka > 60 menit. Muat ulang, isi lagi. |
| "Halaman tidak ditemukan" sesudah menekan tombol | Peramban mengulang kiriman lama. Ketik alamatnya dari awal di bilah alamat, jangan muat ulang. |
| Tidak menerima pemberitahuan | Aplikasi belum dipasang ke layar utama, atau notifikasi belum diizinkan. |
| iPhone tidak bisa notifikasi | Wajib dipasang lewat Bagikan > Add to Home Screen. Batasan Safari, bukan aplikasinya. |
| Tombol "Isi dengan AI" mati | Belum ada berkas yang dipilih. Lampirkan penawaran dulu. |

Untuk melihat sebab sesungguhnya:

```powershell
npx vercel logs https://eapex-kla.vercel.app
```

Penolakan token dan 404 sudah dicatat berikut keterangannya.

---

## Menyebarkan perubahan kode

`git push` **langsung mengubah** sistem yang dipakai 27 orang. Urutannya wajib:

```powershell
npm run cek
```

```powershell
git push
```
