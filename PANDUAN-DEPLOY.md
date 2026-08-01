# Panduan Deploy EAPEX — langkah demi langkah

## SUDAH TERPASANG — 1 Agustus 2026

| | |
|---|---|
| Alamat | <https://eapex-kla.vercel.app> |
| GitHub | <https://github.com/projectklacomputer-ux/eapex-kla> (Private) |
| Basis data | Supabase `eapex-kla`, wilayah Singapura |
| Akun Vercel | `projectklacomputer-3886` |
| Terverifikasi | `/api/health` -> `{"ok":true,"db":"pg"}`, `/login` membuka halaman masuk |

Seluruh Bagian 1-3 di bawah **sudah dikerjakan** lewat dua skrip:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\hubungkan-supabase.ps1
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts\hubungkan-vercel.ps1
```

Keduanya aman dijalankan ulang. Yang perlu disiapkan sebelum menjalankan:
`data\sandi.txt` berisi sandi basis data Supabase saja, satu baris.

### Penyebaran otomatis SUDAH aktif

Sejak 1 Agustus 2026, project Vercel tertaut ke repo GitHub. Artinya:

> **`git push` langsung mengubah sistem yang dipakai 27 orang.**

Perintah yang biasanya cuma berarti "menyimpan pekerjaan" kini menyebarkan ke
produksi. Karena itu urutan berikut wajib, bukan anjuran:

```powershell
npm run cek
```

```powershell
git push
```

Menyalakannya menempuh dua langkah terpisah, dan keduanya menolak dengan pesan
yang berbeda kalau dilewati:

1. **Login Connection** pada akun Vercel (Settings akun > Login Connections >
   GitHub). Tanpa ini: *"You need to add a Login Connection to your GitHub
   account first"*. Akun Vercel di sini dibuat lewat email, jadi awalnya tidak
   punya sambungan apa pun.
2. **Vercel GitHub App** diberi akses ke repo. Tanpa ini: *"Make sure there
   aren't any typos and that you have access to the repository if it's
   private"*. Repo privat tidak terlihat oleh Vercel sampai izinnya diberikan.

Penyebaran manual tetap bisa dipakai kapan saja - berguna untuk menyebarkan
tanpa menyentuh riwayat git:

```powershell
npx vercel deploy --prod --yes
```

Bagian 4 (pemakaian setelah hidup) belum dikerjakan.

---

Akun: **`projectklacomputer-ux`** (GitHub) · project **`eapex-kla`**

---

## Mana yang butuh PowerShell, mana yang tidak

| Bagian | Dikerjakan di | Butuh PowerShell? |
|---|---|---|
| **1. GitHub** | situs + PowerShell | **Ya**, 3 perintah — ✅ **SUDAH SELESAI** |
| **2. Supabase** | situs, lalu PowerShell | **Ya**, 7 perintah (langkah 8–14) |
| **3. Vercel** | situs saja | **Tidak sama sekali** |
| **4. Sesudah hidup** | situs saja | **Tidak sama sekali** |

Jadi PowerShell hanya dipakai di **Bagian 2**. Selebihnya klik-klik di peramban.

### Cara membuka PowerShell

Tekan tombol Windows → ketik `powershell` → Enter. Jendela biru/hitam terbuka.

Aturan penting di komputer ini:

- **Satu baris satu perintah.** Ketik, Enter, tunggu selesai, baru baris berikutnya.
- **Jangan menyambung dengan `&&`.** PowerShell versi 5.1 di sini menolaknya
  dan langsung error.
- **Jangan tutup jendelanya di tengah Bagian 2.** Variabel yang dipasang di
  langkah 10–11 hilang begitu jendelanya ditutup.

---

# BAGIAN 1 — GitHub ✅ SELESAI

Sudah dikerjakan. Catatan untuk arsip:

- Repo: <https://github.com/projectklacomputer-ux/eapex-kla> (Private)
- 8 commit terdorong, `main` melacak `origin/main`
- Isi `data/` di GitHub hanya dua `.gitkeep` kosong — tidak ada `.env`,
  `AKUN-AWAL.txt`, `.docx`, atau `.db` yang ikut
- Alamat remote memakai sisipan nama akun
  (`https://projectklacomputer-ux@github.com/…`) supaya kredensialnya tersimpan
  terpisah dari akun `kristiantokla-arch` yang juga ada di komputer ini

Lanjut ke Bagian 2.

---

# BAGIAN 2 — Supabase

## 🌐 Langkah 1 — Buat project

1. Buka **<https://database.new>** (alamat pintas resmi Supabase).
2. Kalau diminta membuat **organization** dulu: Name `KLA`, Type `Company`,
   Plan **Free**.
3. Formulir project terbuka. Isi:
   - **Name**: `eapex-kla`
   - **Database Password**: klik **Generate a password**
   - **Region**: **Southeast Asia (Singapore)**
4. **Salin sandi itu dan simpan sendiri sekarang juga.** Hanya ditampilkan
   sekali. Kalau telanjur hilang: Settings → Database → **Reset database password**.
5. Klik **Create new project**. Tunggu ±2 menit sampai statusnya hijau.

## 🌐 Langkah 2 — Ambil alamat sambungan

1. Klik tombol **Connect** di bagian atas halaman project.
2. Dari lima pilihan (Framework / Server / Direct / ORM / MCP), pilih
   **Direct — Connection string**.
3. Di dalamnya ada beberapa jenis. Ambil **Transaction pooler**.

   Nama tabnya bisa berbeda antar tampilan, tapi ciri ini tidak pernah berubah:

   | Jenis | Ciri | Pakai? |
   |---|---|---|
   | Direct connection | `db.xxxx.supabase.co:` **5432** | ❌ |
   | **Transaction pooler** | `…pooler.supabase.com:` **6543** | ✅ |
   | Session pooler | `…pooler.supabase.com:` 5432 | ❌ |

   **Patokannya angka 6543.** Kalau yang tersalin berujung 5432, gejalanya nanti
   bukan pesan galat melainkan halaman yang menggantung diam — susah dilacak
   kalau tidak tahu sebabnya.

4. **Abaikan spanduk "Transaction pooler uses IPv6 by default"** dan tombol
   **Enable IPv4 add-on** di sebelahnya. Add-on itu berbayar dan tidak
   dibutuhkan: alamat `aws-0-ap-southeast-1.pooler.supabase.com` menghasilkan
   tiga alamat IPv4 dan nol IPv6, dan port 6543-nya sudah diuji tembus dari
   komputer ini. Peringatan itu berlaku untuk jaringan yang murni IPv6.

5. Salin **seluruhnya**. Kotak string itu tergulung ke kanan, jadi yang terlihat
   di layar cuma ekornya — bagian depan (`postgresql://postgres.…`) tersembunyi.
   Klik di dalam kotaknya, tekan **Ctrl+A** lalu **Ctrl+C**, dan tempel ke
   **Notepad** untuk melihat utuhnya.

   Bentuk lengkapnya:

   ```
   postgresql://postgres.KODEPROJECT:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
   ```

   Kalau yang tertempel tidak diawali `postgresql://`, berarti belum utuh.

6. Ganti `[YOUR-PASSWORD]` dengan sandi dari Langkah 1 — **kurung sikunya ikut
   dibuang**. Sandinya tidak ikut tersalin dari layar Supabase; harus Anda
   tempelkan sendiri.

   ```
   …postgres.abcd:[YOUR-PASSWORD]@aws-0…   ← belum diganti
   …postgres.abcd:[Rahasia123]@aws-0…      ← kurung siku masih ada, SALAH
   …postgres.abcd:Rahasia123@aws-0…        ← benar
   ```

> Alamat jadi ini memuat sandi basis data. Simpan sendiri, jangan dikirim ke
> siapa pun.

## Kenapa tabelnya diisi dari komputer sendiri, bukan langsung dari Vercel

Langkah 8–13 di bawah bisa saja dilewati — Vercel akan mengisi tabelnya sendiri
saat pertama kali dibuka. Tapi ada satu akibat yang tidak bisa diperbaiki
belakangan.

Saat basis data pertama kali diisi, sistem membuat **28 akun dengan sandi acak**
dan mencatatnya ke sebuah berkas. Kalau itu terjadi di Vercel, berkas itu ikut
terhapus bersama cakramnya — dan 27 sandi selain admin **hilang permanen**.
Anda harus menyetel ulang satu per satu lewat menu Admin.

Kalau dijalankan dari sini, berkasnya mendarat utuh di komputer Anda.

Sekalian membuktikan alamat sambungannya benar **sebelum** Vercel ikut campur,
supaya kalau ada masalah jelas letaknya di mana.

## 💻 Langkah 3 — Buka PowerShell dan masuk ke folder

```powershell
cd "E:\KLA\Claude\EAPEX"
```

Tidak ada keluaran apa-apa kalau berhasil. Kalau muncul `Cannot find path`,
berarti foldernya bukan di situ.

## 💻 Langkah 4 — Amankan berkas akun lokal

Berkas baru nanti bernama sama dan akan menimpanya. Di dalamnya ada sandi 28
akun untuk sistem lokal Anda.

```powershell
Rename-Item data\AKUN-AWAL.txt AKUN-AWAL-LOKAL.txt
```

Kalau muncul `Cannot find path`, berarti berkasnya sudah pernah dipindah —
lewati saja langkah ini.

## 💻 Langkah 5 — Pasang sandi admin

Buka `data\RAHASIA-DEPLOY.txt` dengan Notepad, salin nilai di baris
`ADMIN_PASSWORD=` (tanpa nama variabelnya).

```powershell
$env:ADMIN_PASSWORD = 'tempel-nilai-di-sini'
```

## 💻 Langkah 6 — Pasang alamat basis data

```powershell
$env:DATABASE_URL = 'tempel-alamat-lengkap-dari-langkah-2'
```

> **Pakai petik tunggal `'…'`, jangan petik ganda.** Di PowerShell, petik ganda
> memperlakukan `$` sebagai awal nama variabel — kalau sandi Anda mengandung
> `$`, potongan itu hilang diam-diam dan sambungannya gagal tanpa alasan yang
> jelas.

Periksa sudah masuk atau belum:

```powershell
$env:DATABASE_URL.Length
```

Harus keluar angka sekitar 100–130. Kalau kosong, ulangi langkah 6 **di jendela
yang sama**.

## 💻 Langkah 7 — Isi tabelnya

```powershell
npm run seed
```

Yang diharapkan muncul:

```
Selesai. Basis data: pg. Pengguna: 28. Kategori: ...
```

**Perhatikan kata `pg`.** Kalau tertulis `sqlite`, berarti `DATABASE_URL` tidak
terbaca dan yang barusan terisi adalah basis data lokal — bukan Supabase.
Ulangi langkah 6.

## 💻 Langkah 8 — Simpan berkas sandi yang baru

```powershell
Rename-Item data\AKUN-AWAL.txt AKUN-AWAL-SUPABASE.txt
```

## 💻 Langkah 9 — Kembalikan berkas yang lama

```powershell
Rename-Item data\AKUN-AWAL-LOKAL.txt AKUN-AWAL.txt
```

Sekarang ada dua berkas terpisah, keduanya di dalam `data/` sehingga tidak akan
pernah ikut ter-push:

- `data\AKUN-AWAL-SUPABASE.txt` — 28 akun untuk sistem **online**
- `data\AKUN-AWAL.txt` — 28 akun untuk sistem **lokal**, utuh seperti semula

## 💻 Langkah 10 — Lepas sambungan produksi

```powershell
Remove-Item Env:DATABASE_URL
```

Ini bukan formalitas. Selama variabel itu menempel, `localhost:4700` akan
**mengoperasikan basis data produksi** — termasuk `npm run cek`. Menutup jendela
PowerShell juga menghapusnya.

Bagian 2 selesai. Sisanya tidak perlu PowerShell lagi.

---

# BAGIAN 3 — Vercel (peramban saja)

## 🌐 Langkah 11 — Masuk dan beri izin ke akun yang benar

1. <https://vercel.com> → **Sign in** → **Continue with GitHub**.
2. Pastikan yang dipakai akun **`projectklacomputer-ux`**.
3. **Add New… → Project**.
4. Kalau `eapex-kla` **tidak muncul** di daftar: klik
   **Adjust GitHub App Permissions** → pilih akun `projectklacomputer-ux` →
   izinkan (boleh hanya untuk repo `eapex-kla`) → kembali.

   Ini penyebab tersering repo tidak kelihatan, dan gejalanya cuma "tidak ada di
   daftar" tanpa penjelasan.

## 🌐 Langkah 12 — Impor

1. Pilih `eapex-kla` → **Import**.
2. **Framework Preset**: **Other**.
3. Build Command / Output Directory / Install Command: **biarkan kosong**.
   `vercel.json` di repo sudah mengatur semuanya.
4. **Jangan klik Deploy dulu.** Buka **Environment Variables** lebih dahulu.

## 🌐 Langkah 13 — Isi Environment Variables

Centang ketiganya (**Production, Preview, Development**) untuk setiap baris.

### Wajib

| Nama | Nilai | Diambil dari |
|---|---|---|
| `SESSION_SECRET` | acak 64 huruf | `data\RAHASIA-DEPLOY.txt` |
| `DATABASE_URL` | alamat Supabase | Langkah 2 |
| `SIMPANAN` | `db` | ketik sendiri |
| `DI_BELAKANG_PROXY` | `1` | ketik sendiri |
| `ADMIN_EMAIL` | `admin@kla.co.id` | ketik sendiri |
| `ADMIN_PASSWORD` | acak 16 huruf | `data\RAHASIA-DEPLOY.txt` |
| `PENGINGAT_SECRET` | acak 48 huruf | `data\RAHASIA-DEPLOY.txt` |

### Opsional — kuncinya sudah ada, tinggal salin

Notifikasi ke HP. Buka `.env` di folder aplikasi dengan Notepad, salin tiga
nilai ini apa adanya:

| Nama | Diambil dari |
|---|---|
| `VAPID_PUBLIC_KEY` | `.env` baris `VAPID_PUBLIC_KEY=` |
| `VAPID_PRIVATE_KEY` | `.env` baris `VAPID_PRIVATE_KEY=` |
| `VAPID_SUBJECT` | `.env` baris `VAPID_SUBJECT=` |

Tanpa ini aplikasi tetap jalan penuh, hanya notifikasi HP-nya mati.

### Tiga yang paling gampang terlewat

- **`SIMPANAN=db`** — cakram Vercel dihapus **setiap kali deploy**. Tanpa ini,
  seluruh lampiran dokumen lama hilang begitu ada perbaikan kode, tanpa
  pemberitahuan apa pun.
- **`DI_BELAKANG_PROXY=1`** — tanpa ini cookie sesi tidak ditandai `secure`, dan
  gejalanya orang login lalu langsung terlempar keluar.
- **`ADMIN_PASSWORD`** — pengaman kalau basis data suatu saat dikosongkan. Untuk
  login pertama nanti, yang berlaku adalah isi `data\AKUN-AWAL-SUPABASE.txt`.

## 🌐 Langkah 14 — Deploy

Klik **Deploy**. Tunggu sampai selesai (±1–2 menit). Catat alamat yang
diberikan, misalnya `https://eapex-kla.vercel.app`.

## 🌐 Langkah 15 — Satu env terakhir

1. Settings → Environment Variables → **Add**:

   | Nama | Nilai |
   |---|---|
   | `ALAMAT_APLIKASI` | alamat dari Langkah 14 |

2. Deployments → titik tiga pada deploy teratas → **Redeploy**.

Dipakai untuk tautan di dalam email dan notifikasi. Tanpa itu notifikasinya
tetap terkirim, hanya tanpa tombol menuju dokumennya.

> **Perubahan env tidak berlaku sampai di-Redeploy.** Ini berlaku untuk semua
> perubahan env berikutnya juga.

## 🌐 Langkah 16 — Periksa pengingat harian

Settings → **Cron Jobs**. Harus terdaftar `/api/pengingat` dengan jadwal
`0 3 * * *` — itu UTC, sama dengan **10.00 WIB** sesuai permintaan.

Kalau `PENGINGAT_SECRET` kosong, alamat pemicunya **mati** — bukan terbuka untuk
umum.

---

# BAGIAN 4 — Sesudah hidup (peramban saja)

## 🌐 Langkah 17 — Masuk pertama kali

Buka alamat aplikasinya. Masuk sebagai `admin@kla.co.id` dengan sandi admin dari
`data\AKUN-AWAL-SUPABASE.txt`. Sistem akan meminta ganti sandi.

## 🌐 Langkah 18 — Bagikan sandi ke 27 orang lain

Semuanya ada di `data\AKUN-AWAL-SUPABASE.txt`. Setiap orang akan diminta ganti
sandi saat login pertama.

## 🌐 Langkah 19 — Isi email notifikasi

Admin → Pengguna → **Email untuk notifikasi** tiap orang. Tidak wajib, tapi yang
kosong tidak akan menerima email.

## 🌐 Langkah 20 — Putuskan ambang yang menggantung

Admin → **Matriks Approval**. Yang masih perlu keputusan: ATK Rp 550.000 saat
ini masih menuntut tanda tangan CEO di 15 cabang.

## 🌐 Langkah 21 — Uji satu dokumen sungguhan

Buat satu pengajuan dari satu cabang, lewatkan sampai selesai, pastikan
notifikasinya sampai.

## 💻 Langkah 22 — Hapus berkas rahasia

Setelah semua nilainya terpasang di Vercel:

```powershell
Remove-Item data\RAHASIA-DEPLOY.txt
```

`data\AKUN-AWAL-SUPABASE.txt` **jangan dihapus** sampai semua 27 orang sudah
menerima sandinya.

---

# Menyusul (belum perlu sekarang)

- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` —
  notifikasi email. Gmail wajib pakai App Password, bukan sandi akun biasa.
- `OPENAI_API_KEY` — tombol "Baca penawaran ini". **Sadari:** begitu diisi, isi
  berkas penawaran dikirim ke OpenAI. Harga vendor ikut keluar dari kantor.

---

# Kalau ada yang meleset

| Gejala | Sebabnya biasanya | Perbaikan |
|---|---|---|
| `Cannot find path` di PowerShell | Salah folder, atau berkasnya sudah dipindah | Ulangi Langkah 3 |
| `password authentication failed` | `[YOUR-PASSWORD]` belum diganti, atau kurung sikunya ikut | Ulangi Langkah 2 no. 5 |
| `getaddrinfo ENOTFOUND` | Alamat terpotong saat menempel | Salin ulang utuh |
| `Basis data: sqlite` | Variabel belum terpasang | Ulangi Langkah 6 di jendela yang **sama** |
| `npm run seed` menggantung lalu timeout | Port 5432, bukan 6543 | Ambil ulang Transaction pooler |
| Repo tidak muncul di Vercel | Izin GitHub App belum diberikan | Langkah 11 no. 4 |
| Halaman menggantung, tanpa galat | `DATABASE_URL` pakai port 5432 | Ganti ke 6543, lalu Redeploy |
| Lampiran dokumen lama hilang | `SIMPANAN` bukan `db` | Betulkan, lalu Redeploy |
| Login lalu langsung terlempar keluar | `DI_BELAKANG_PROXY` belum `1` | Betulkan, lalu Redeploy |
| Pengingat tidak jalan | `PENGINGAT_SECRET` kosong | Isi, lalu Redeploy |
| Notifikasi HP tidak muncul | VAPID belum diisi, atau alamat bukan https | Langkah 13 bagian opsional |

Sandi Supabase yang mengandung `@ : / ? #` merusak struktur alamat sambungan.
Paling cepat: Settings → Database → **Reset database password** → **Generate a
password**.
