# Panduan Deploy EAPEX — GitHub → Supabase → Vercel

Semuanya dikerjakan lewat **situs**. PowerShell hanya dipakai di Bagian 1 untuk
mendorong berkasnya; Bagian 2 dan 3 murni klik-klik di peramban.

Urutannya tidak boleh dibalik: Vercel butuh repo GitHub **dan** alamat basis
data Supabase, jadi keduanya harus jadi lebih dulu.

Akun yang dipakai: **`projectklacomputer-ux`**.
Rahasia yang perlu ditempel ke Vercel sudah dibuatkan di
`data/RAHASIA-DEPLOY.txt` (diabaikan git, tidak akan ikut ter-push).

---

## Sebelum mulai — soal PowerShell

Buka lewat Start → ketik `powershell`.

PowerShell di komputer ini versi 5.1, dan versi itu **tidak mengenal `&&`**
untuk menyambung dua perintah. Semua perintah di bawah sudah dipisah satu-satu:
ketik, Enter, tunggu selesai, baru baris berikutnya.

Pindah ke folder aplikasi cukup **sekali**; PowerShell mengingatnya selama
jendelanya tidak ditutup:

```powershell
cd "E:\KLA\Claude\EAPEX"
```

---

## BAGIAN 1 — GitHub

### 1.1 Buat repo kosong lewat situs

1. Buka <https://github.com>, pastikan yang masuk adalah **`projectklacomputer-ux`**
   (klik foto profil di kanan atas untuk memastikan).
2. Tombol **+** di kanan atas → **New repository**.
3. Isi:
   - **Owner**: `projectklacomputer-ux`
   - **Repository name**: `eapex-kla`
   - **Private** ← wajib. Repo ini memuat nama pegawai, struktur cabang, dan
     matriks kewenangan persetujuan.
4. **Jangan centang apa pun** di bagian "Initialize this repository with":
   tanpa README, tanpa .gitignore, tanpa license.

   > Repo harus benar-benar kosong. Kalau ada satu berkas saja di dalamnya,
   > dorongan di langkah 1.3 akan **ditolak** karena riwayatnya bentrok.

5. **Create repository**. Halaman berikutnya menampilkan beberapa perintah —
   abaikan, pakai yang di panduan ini.

Sekalian nyalakan **2FA** kalau belum: Settings → Password and authentication.
Repo ini berisi seluruh alur persetujuan pengeluaran perusahaan.

### 1.2 Pastikan tidak ada rahasia yang ikut

```powershell
git ls-files -- "data/*" ":!data/**/.gitkeep" ":!data/.gitkeep"
```

**Harus kosong.** Kalau ada yang muncul, berhenti — jangan lanjut — dan beri
tahu saya. Dua berkas `.gitkeep` yang mungkin tampak di daftar lain memang
sengaja ada dan isinya kosong; gunanya supaya folder `data/` tetap ada setelah
repo di-clone.

### 1.3 Sambungkan repo, lalu dorong

```powershell
git remote add origin https://projectklacomputer-ux@github.com/projectklacomputer-ux/eapex-kla.git
```

> Nama akun sengaja disisipkan sebelum `@github.com`. Windows menyimpan
> kredensial GitHub **satu untuk semua repo**, dan di komputer ini isinya
> `kristiantokla-arch`. Tanpa sisipan itu, `git push` akan memakai akun tersebut
> tanpa bertanya apa pun. Dengan sisipan itu, Windows menyimpannya sebagai
> kredensial terpisah dan kedua akun bisa hidup berdampingan.

```powershell
git push -u origin main
```

Sebuah jendela peramban akan muncul meminta izin. **Perhatikan akun yang tertera
di situ** — kalau yang muncul `kristiantokla-arch`, klik untuk berganti akun ke
`projectklacomputer-ux` dulu sebelum menyetujui.

### 1.4 Pastikan sudah benar

```powershell
git remote -v
```

Lalu buka <https://github.com/projectklacomputer-ux/eapex-kla> — berkasnya harus
sudah ada, dan ada label **Private** di sebelah nama repo.

Buka juga folder `data/` di situs itu: isinya **hanya** `.gitkeep` dan
`lampiran/`. Kalau ada `.env`, `AKUN-AWAL.txt`, `.docx`, atau `.db` di sana,
hapus reponya sekarang juga dan beri tahu saya.

### 1.5 Catatan soal nama penulis commit (boleh dilewati)

Akun GitHub menentukan **siapa yang mendorong**. Email di dalam commit
menentukan **siapa yang tercatat sebagai penulis** — dan keduanya berjalan
sendiri-sendiri.

Enam commit yang sudah ada tertulis atas nama
`KLA Computer <projectklacomputer@gmail.com>`. Commit **berikutnya** sudah saya
setel memakai alamat samaran akun baru
(`311638400+projectklacomputer-ux@users.noreply.github.com`), khusus repo ini
saja — repo lain tidak ikut berubah.

Kalau email `projectklacomputer@gmail.com` itu terdaftar di akun
`kristiantokla-arch`, keenam commit lama akan menempel nama dan foto akun
tersebut di riwayat, walaupun reponya milik akun baru. Cara memeriksanya: masuk
sebagai `projectklacomputer-ux` → Settings → Emails, lihat alamat itu terdaftar
di situ atau tidak.

Kalau ternyata salah akun dan Anda ingin riwayatnya bersih, **beri tahu saya
sebelum langkah 1.3** — sesudah ter-push, memperbaikinya jauh lebih repot.
Kalau tidak dipedulikan, lewati saja bagian ini; tidak ada akibat teknis apa pun.

---

## BAGIAN 2 — Supabase (basis data)

### 2.1 Buat project

1. <https://supabase.com> → **Sign in**.
2. **New project**
   - Name: `eapex-kla`
   - Database Password: klik **Generate a password**, lalu **salin dan simpan
     sendiri**. Sandi ini hanya ditampilkan sekali dan dipakai di langkah 2.2.
   - Region: **Southeast Asia (Singapore)** — paling dekat, paling kecil jedanya.
3. **Create new project**, tunggu ±2 menit sampai statusnya hijau.

### 2.2 Ambil alamat sambungan

Tombol **Connect** di bagian atas → pilih **Transaction pooler**.

Bentuknya seperti ini:

```
postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
```

Ganti `[YOUR-PASSWORD]` dengan sandi dari langkah 2.1. Simpan hasilnya — ini
nilai `DATABASE_URL` di Bagian 3.

> **Port 6543, bukan 5432.** Vercel membuat banyak sambungan pendek. Koneksi
> langsung (5432) akan cepat penuh, dan gejalanya bukan pesan galat yang jelas
> melainkan halaman yang menggantung tanpa keterangan.

### 2.3 Tabel

Tidak perlu membuat apa pun. Aplikasi membuat seluruh tabelnya sendiri saat
pertama kali dijalankan.

---

## BAGIAN 3 — Vercel

### 3.1 Beri Vercel akses ke akun GitHub yang benar

1. <https://vercel.com> → **Sign in** → **Continue with GitHub**.
2. Kalau Vercel sudah pernah tersambung ke `kristiantokla-arch`, repo
   `eapex-kla` tidak akan muncul di daftar. Buka **Add New… → Project** →
   **Adjust GitHub App Permissions** → pilih akun `projectklacomputer-ux` →
   izinkan aksesnya (boleh hanya untuk repo `eapex-kla`).

### 3.2 Impor repo

1. **Add New… → Project** → pilih `eapex-kla` → **Import**.
2. Framework Preset: **Other**. Build/Output/Install biarkan kosong —
   `vercel.json` di repo sudah mengatur semuanya.
3. **Jangan klik Deploy dulu.** Buka **Environment Variables** lebih dahulu.

### 3.3 Isi Environment Variables

Semuanya untuk **Production, Preview, dan Development** (centang ketiganya).

| Nama | Nilai | Dari mana |
|---|---|---|
| `SESSION_SECRET` | (acak 64 huruf) | `data/RAHASIA-DEPLOY.txt` |
| `DATABASE_URL` | `postgresql://…:6543/postgres` | langkah 2.2 |
| `SIMPANAN` | `db` | ketik sendiri |
| `DI_BELAKANG_PROXY` | `1` | ketik sendiri |
| `ADMIN_EMAIL` | `admin@kla.co.id` | ketik sendiri |
| `ADMIN_PASSWORD` | (acak 16 huruf) | `data/RAHASIA-DEPLOY.txt` |
| `PENGINGAT_SECRET` | (acak 48 huruf) | `data/RAHASIA-DEPLOY.txt` |

Tiga baris yang paling gampang terlewat, dan akibatnya:

- **`SIMPANAN=db`** — cakram Vercel dihapus setiap kali deploy. Tanpa ini,
  seluruh lampiran dokumen lama hilang begitu ada perbaikan kode, tanpa
  pemberitahuan apa pun.
- **`DI_BELAKANG_PROXY=1`** — tanpa ini cookie sesi tidak ditandai `secure`.
- **`ADMIN_PASSWORD`** — sandi 27 akun lain ditulis ke berkas di dalam server,
  dan berkas itu ikut terhapus bersama cakramnya. Hanya admin yang bisa masuk
  pertama kali; tanpa sandi ini Anda terkunci di luar sistem sendiri.

### 3.4 Deploy

Klik **Deploy**, tunggu selesai. Catat alamat yang diberikan, misalnya
`https://eapex-kla.vercel.app`.

### 3.5 Satu env terakhir

Settings → Environment Variables → tambah:

| Nama | Nilai |
|---|---|
| `ALAMAT_APLIKASI` | alamat dari langkah 3.4 |

Lalu Deployments → titik tiga pada deploy teratas → **Redeploy**.

Ini dipakai untuk tautan di dalam email dan notifikasi. Tanpa itu notifikasinya
tetap terkirim, hanya tanpa tombol menuju dokumennya.

### 3.6 Pengingat harian

Sudah diatur di `vercel.json`: `0 3 * * *` UTC = **10.00 WIB**, sesuai
permintaan. Cek di Settings → Cron Jobs bahwa `/api/pengingat` terdaftar.

Kalau `PENGINGAT_SECRET` kosong, alamat pemicunya **mati** — bukan terbuka untuk
umum.

---

## BAGIAN 4 — Sesudah hidup

1. Buka alamatnya, masuk sebagai `admin@kla.co.id` dengan `ADMIN_PASSWORD`.
   Sistem akan meminta ganti sandi.
2. Admin → Pengguna → setel ulang sandi untuk 27 akun lain, bagikan ke orangnya.
3. Isi **Email untuk notifikasi** tiap pengguna (tidak wajib, tapi tanpa itu
   orangnya tidak dapat email).
4. Admin → Matriks Approval → tentukan ambang ATK Rp 550.000 → CEO yang masih
   menggantung.
5. Buat satu dokumen uji sungguhan dari satu cabang, lewatkan sampai selesai.
6. Hapus `data/RAHASIA-DEPLOY.txt` setelah semua nilainya terpasang di Vercel.

## Menyusul (belum perlu sekarang)

- `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` — notifikasi email
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — notifikasi HP, buat dengan
  `npm run kunci-push`
- `OPENAI_API_KEY` — tombol "Baca penawaran ini". Sadari: begitu diisi, isi
  berkas penawaran dikirim ke OpenAI. Harga vendor ikut keluar dari kantor.

## Kalau ada yang meleset

| Gejala | Sebabnya biasanya |
|---|---|
| Push ditolak, "rejected / fetch first" | Repo GitHub tidak dibuat kosong (ada README) |
| Push memakai akun yang salah | Nama akun tidak disisipkan di alamat remote (1.3) |
| Repo `eapex-kla` tidak muncul di Vercel | Izin GitHub App belum diberikan ke akun baru (3.1) |
| Halaman menggantung, tidak ada galat | `DATABASE_URL` pakai port 5432, bukan 6543 |
| Lampiran dokumen lama hilang | `SIMPANAN` bukan `db` |
| Masuk lalu langsung terlempar keluar | `DI_BELAKANG_PROXY` belum `1` |
| Tidak bisa masuk sama sekali | `ADMIN_PASSWORD` belum diisi sebelum deploy pertama |
| Pengingat tidak jalan | `PENGINGAT_SECRET` kosong |

Perubahan env **tidak berlaku sampai di-Redeploy**.
