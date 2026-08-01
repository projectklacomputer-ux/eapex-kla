# Panduan Deploy EAPEX — GitHub → Supabase → Vercel

Urutannya tidak boleh dibalik: Vercel butuh repo GitHub **dan** alamat basis data
Supabase, jadi keduanya harus jadi lebih dulu.

Semua rahasia yang perlu ditempel ke Vercel sudah dibuatkan di
`data/RAHASIA-DEPLOY.txt` (berkas itu diabaikan git, tidak akan ikut ter-push).

---

## BAGIAN 1 — GitHub

### 1.1 Buat akun

Buka <https://github.com/signup>. Pakai email yang Anda pegang sendiri, bukan
email bersama. Selesaikan verifikasinya.

**Nyalakan 2FA** di Settings → Password and authentication → Two-factor
authentication. Repo ini berisi seluruh alur persetujuan pengeluaran perusahaan;
akun tanpa 2FA hanya dijaga satu sandi.

### 1.2 Sambungkan gh CLI ke akun baru

Kalau di komputer ini pernah login akun lain, keluarkan dulu:

```bash
gh auth logout
```

Lalu masuk dengan akun baru (pilih **GitHub.com** → **HTTPS** → **Login with a
web browser**, lalu tempel kode yang muncul di peramban):

```bash
gh auth login
```

Pastikan yang aktif memang akun baru:

```bash
gh auth status
```

### 1.3 Buat repo dan dorong isinya

```bash
cd "E:\KLA\Claude\EAPEX" && gh repo create eapex-kla --private --source=. --push
```

`--private` wajib. Repo ini memuat nama pegawai, struktur cabang, dan matriks
kewenangan persetujuan.

### 1.4 Pastikan tidak ada rahasia yang ikut

```bash
cd "E:\KLA\Claude\EAPEX" && git ls-files | grep -i "^data/\|\.env$\|akun-awal\|\.db$"
```

**Harus kosong.** Kalau ada yang muncul, berhenti — jangan lanjut ke Vercel —
dan beri tahu saya.

---

## BAGIAN 2 — Supabase (basis data)

### 2.1 Buat project

1. <https://supabase.com> → **Start your project** → masuk pakai akun GitHub tadi.
2. **New project**
   - Name: `eapex-kla`
   - Database Password: klik **Generate a password**, lalu **salin dan simpan**.
     Sandi ini hanya ditampilkan sekali dan dipakai di langkah 2.2.
   - Region: **Southeast Asia (Singapore)** — paling dekat, paling kecil jedanya.
3. **Create new project**, tunggu ±2 menit sampai statusnya hijau.

### 2.2 Ambil alamat sambungan

Klik tombol **Connect** di atas → tab **App Frameworks** atau **ORMs** →
pilih **Transaction pooler**.

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

### 3.1 Impor repo

1. <https://vercel.com> → **Sign up** → **Continue with GitHub** → izinkan aksesnya.
2. **Add New… → Project** → pilih `eapex-kla` → **Import**.
3. Framework Preset: **Other**. Build/Output/Install biarkan kosong —
   `vercel.json` di repo sudah mengatur semuanya.
4. **Jangan klik Deploy dulu.** Buka **Environment Variables** lebih dahulu.

### 3.2 Isi Environment Variables

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
- **`ADMIN_PASSWORD`** — 27 sandi akun lain ditulis ke berkas di dalam server,
  dan berkas itu ikut terhapus. Hanya admin yang bisa masuk pertama kali;
  tanpa sandi ini Anda terkunci di luar sistem sendiri.

### 3.3 Deploy

Klik **Deploy**, tunggu sampai selesai. Catat alamat yang diberikan, misalnya
`https://eapex-kla.vercel.app`.

### 3.4 Satu env terakhir

Settings → Environment Variables → tambah:

| Nama | Nilai |
|---|---|
| `ALAMAT_APLIKASI` | alamat dari langkah 3.3 |

Lalu Deployments → titik tiga pada deploy teratas → **Redeploy**.

Ini dipakai untuk tautan di dalam email dan notifikasi. Tanpa itu notifikasinya
tetap terkirim, hanya tanpa tombol menuju dokumennya.

### 3.5 Pengingat harian

Sudah diatur di `vercel.json`: `0 3 * * *` UTC = **10.00 WIB**, sesuai permintaan.
Cek di Settings → Cron Jobs bahwa `/api/pengingat` terdaftar.

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

- `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` — notifikasi email
- `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` — notifikasi HP, buat dengan `npm run kunci-push`
- `OPENAI_API_KEY` — tombol "Baca penawaran ini". Sadari: begitu diisi, isi
  berkas penawaran dikirim ke OpenAI. Harga vendor ikut keluar dari kantor.

## Kalau ada yang meleset

| Gejala | Sebabnya biasanya |
|---|---|
| Halaman menggantung, tidak ada galat | `DATABASE_URL` pakai port 5432, bukan 6543 |
| Lampiran dokumen lama hilang | `SIMPANAN` bukan `db` |
| Masuk lalu langsung terlempar keluar | `DI_BELAKANG_PROXY` belum `1` |
| Tidak bisa masuk sama sekali | `ADMIN_PASSWORD` belum diisi sebelum deploy pertama |
| Pengingat tidak jalan | `PENGINGAT_SECRET` kosong |

Perubahan env **tidak berlaku sampai di-Redeploy**.
