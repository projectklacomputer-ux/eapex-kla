# EAPEX — Electronic Approval & Capex

Aplikasi persetujuan elektronik **PT KLA TEKNOLOGI INDONESIA** untuk pengajuan
**Biaya & CAPEX** secara berjenjang, sesuai *List Of Approval KLA*.

---

## Menyalakan di komputer sendiri

Klik dua kali **`jalankan-eapex.bat`**. Berkas itu memasang komponen bila perlu,
membuat `.env` dari contoh, menyalakan server, dan membuka peramban ke
`http://localhost:4700`.

Cara manual:

```bash
npm install
cp .env.example .env
npm start
```

Saat basis data pertama kali dibuat, sistem membuat akun contoh dan menuliskan
**sandi awalnya** ke `data/AKUN-AWAL.txt` (berkas ini sudah masuk `.gitignore`).
Semua akun **wajib ganti sandi** saat login pertama. Hapus berkas itu setelah
sandi dibagikan.

Administrator terkunci di luar aplikasi? Setel ulang dari terminal:

```bash
node scripts/reset-sandi.js admin@kla.co.id
```

Perlu mencetak ulang daftar sandi awal (mis. untuk dibagikan)? Perintah berikut
membuat sandi acak baru **hanya untuk akun yang belum pernah dipakai login**, lalu
menulisnya ke `data/AKUN-AWAL.txt`:

```bash
npm run akun-awal
```

---

## Gerbang mutu — WAJIB sebelum bilang "selesai"

```bash
npm run cek
```

Satu perintah, selalu memeriksa hal yang sama: sintaks seluruh berkas JS,
kompilasi seluruh halaman EJS, rumus uang/terbilang/ambang approval, lalu
**menjalankan server sungguhan di basis data sementara** dan menempuh satu
dokumen CAPEX dari pengajuan sampai disetujui empat penyetuju berbeda,
menguji ambang CEO dua arah, menguji saringan bulan/tahun,
serta menguji penolakan akses (tanpa login, bukan penyetuju, CSRF, lintas unit).
Keluar dengan kode 1 bila ada yang gagal. Basis data asli tidak pernah disentuh.

---

## Matriks approval

Sumber: **List Of Approval KLA.xlsx**. Semuanya tersimpan sebagai *data*
(tabel `aturan` + `aturan_langkah`), bukan kode — bisa diubah di
**Admin → Matriks Approval** tanpa menyentuh program.

| Kategori | Wilayah | Pemohon | Rantai approval | CEO |
|---|---|---|---|---|
| CAPEX / Inventaris / Aset | Store | Store Manager | Area Mgr → Regional Manager → Accounting → CEO | semua nilai |
| CAPEX / Inventaris / Aset | Back Office | Staf | Leader/Manager → Accounting → CEO | semua nilai |
| Biaya Marketing (Endorse / Ads / Lainnya) | Back Office | Marketing Staf | Marketing Coordinator → Accounting → CEO | semua nilai |
| Biaya Iklan Lowongan Kerja | Back Office | HC Staf | HC Manager → Accounting → CEO | ≥ 1 jt |
| Biaya Langganan Parkir | Back Office | HC Staf | HC Manager → Accounting → CEO | ≥ 2 jt |
| Biaya Umum Lainnya | Back Office | HC Staf | HC Manager → Accounting → CEO | ≥ 1 jt |
| Perlengkapan Kantor / Inventaris | Store | Store Manager | Area Mgr → Regional Manager → Accounting → CEO | ≥ 500 rb |
| Perlengkapan Kantor / Inventaris | Back Office | Staf | Leader/Manager → Accounting → CEO | ≥ 500 rb |
| Biaya Perjalanan Dinas | Store | Store Manager | Area Mgr → **Regional Manager** → Accounting → CEO | ≥ 2 jt |
| Biaya Perjalanan Dinas | Store | **Area Mgr (mengajukan sendiri)** | **Regional Manager** → Accounting → CEO | ≥ 2 jt |
| Biaya Perjalanan Dinas | Back Office | Staf | Leader/Manager → Accounting → CEO | ≥ 2 jt |
| Maintenance Bangunan Rutin | Store | Store Manager | Area Mgr → Regional Manager → Accounting → CEO | ≥ 4 jt |
| Maintenance Bangunan Rutin | Back Office | HC Staf | HC Manager → Accounting → CEO | ≥ 4 jt |
| Maintenance Bangunan Non Rutin | Store / BO | Store Mgr / HC Staf | … → Accounting → CEO | semua nilai |
| Refund Dana (UM penjualan / salah transfer / alasan lain) | Store | Store Manager | Area Mgr → Accounting | tanpa CEO |
| Perpindahan Area Sales / Store Manager | Store | Area Mgr **asal** | Area Mgr **tujuan** → **Regional Manager** → Accounting → CEO | semua nilai |
| Biaya Non Rutin (training, seminar, MCU) | Store / BO | HC Staf | HC Manager → Accounting → CEO | semua nilai |

### Regional Manager menggantikan Brand Manager

Sejak **31 Juli 2026** tidak ada satu pun tahap approval yang memakai Brand Manager.
Semua supervisi area & store dipegang **Regional Manager** — sesuai keputusan
manajemen, dan sejalan dengan catatan pada matriks aslinya:

> *Brand Manager hanya bersifat sementara, ketika sudah ada regional manager →
> Regional mengambil alih peran brand manager untuk tugas advisor dan supervisi
> area & store.*

Yang berubah: 5 rantai store (CAPEX, Perlengkapan Kantor, Perjalanan Dinas,
Maintenance Rutin, Maintenance Non-Rutin) kini **Area Manager → Regional Manager →
Accounting → CEO**.

Peran `brand_manager` **tetap terdaftar** di `lib/konstanta.js` dengan label
"Brand Manager (riwayat)", tapi tidak boleh dipakai pada matriks baru. Alasannya
satu: rantai dokumen **dibekukan saat diajukan**, jadi dokumen yang terlanjur
berjalan lewat Brand Manager harus tetap terbaca labelnya di layar dan cetakan.
Gerbang mutu menolak kalau ada tahap approval yang kembali memakainya.

Peran itu juga **dikeluarkan dari daftar yang boleh melihat seluruh dokumen** —
peran yang tidak lagi menyetujui apa pun tidak punya alasan membaca nominal
sekantor. Yang masih boleh: Admin, Accounting, CEO, Regional Manager.

Dijalankan sekali lewat migrasi `migrasi_regional_gantikan_brand_v1`. Pemegang
peran Brand Manager yang sungguhan **dialihkan** jadi Regional Manager, bukan
dinonaktifkan — orangnya masih bekerja, yang berganti nama perannya. Hanya akun
contoh bawaan `brand@kla.co.id` yang dimatikan, itu pun cuma kalau belum pernah
dipakai masuk.

**Dua jalur pada Perjalanan Dinas.** Pengajuan yang **diajukan Area Manager sendiri**
tidak melewati tahap Area Manager (dia pemohonnya) — langsung ke Regional Manager.
Pemohon memilih jalurnya lewat kotak **Jalur pengajuan** di formulir; pilihan yang
muncul hanya yang sesuai perannya.

### Mengubah matriks dari menu Admin

**Admin → Matriks Approval.** Tiap aturan bisa diubah tanpa menyentuh kode: siapa
yang boleh mengajukan, urutan penyetuju, label yang tercetak di dokumen, lingkup
pencarian penyetuju, dan **ambang nominal tiap tahap**.

Menaikkan ambang CEO Perlengkapan Kantor dari Rp 500.000 jadi Rp 1.000.000: ubah
kolom **Ambang (≥ Rp)** pada baris CEO, lalu simpan. Sesudah itu dokumen
Rp 750.000 tidak lagi lewat CEO, dan Rp 1.000.000 tetap lewat.

Kotak **Ambang CEO** di atas tabel bukan isian — angkanya diturunkan sendiri dari
baris CEO. Dulu keduanya bisa diisi terpisah, dan mengubah yang salah tidak
menghasilkan apa-apa. Diamnya itu yang berbahaya: orang mengira ambangnya sudah
naik padahal dokumen tetap mengalir seperti semula.

**Dokumen yang sedang berjalan tidak ikut berubah.** Rantai approval dibekukan saat
dokumen diajukan, jadi mengubah matriks hari ini tidak mengubah dokumen yang kemarin
sudah masuk alur. Tiap perubahan tercatat di **Jejak Audit**.

---

### Penafsiran ambang yang dipakai

Matriks asli menulis `< 1 juta` dan `> 1 juta`, sehingga nominal **tepat** 1 juta
tidak masuk keduanya. Sistem memakai aturan konservatif: **CEO wajib bila total ≥ ambang**.
Ambang bisa diubah per langkah di menu Admin.

### Cara sistem memilih penyetuju

Langkah approval menyebut **peran**, bukan nama orang. Saat dokumen diajukan,
sistem mencari pengguna aktif berperan itu dari yang paling dekat ke paling umum:
departemen+cabang → departemen → cabang → area cabang → kantor pusat.
Pemohon selalu dikeluarkan dari daftar, jadi tidak ada yang bisa menyetujui
dokumennya sendiri.

Untuk peran **kantor pusat** (CEO, Accounting, Regional Manager,
Purchasing) ada jaring terakhir "siapa pun yang berperan itu". Untuk peran
**berwilayah** (Area Manager, Store Manager, manajer departemen) jaring itu
sengaja TIDAK dipakai: kalau calon di wilayahnya habis, dokumen ditolak dengan
pesan jelas — bukan dilempar ke Area Manager wilayah lain.

Kalau sebuah peran **belum punya pengguna aktif**, pengajuan **ditolak saat
diajukan** dengan pesan jelas — bukan tersimpan menggantung tanpa penyetuju.
Admin → Ringkasan Sistem menampilkan peran yang masih kosong.

---

## Master unit (cabang)

15 cabang terpasang sejak awal, plus **Kantor Pusat (HO)** untuk Back Office.
Kode cabang dipakai pada nomor dokumen, jadi jangan diubah-ubah setelah ada
dokumen berjalan.

**Dua area**, masing-masing satu Area Manager (dikonfirmasi 31 Juli 2026):

| Area Barat (8) | | Area Timur (7) |
|---|---|---|
| SMG Semarang | | YGY Yogyakarta |
| NGL Ngaliyan | | SKH Sukoharjo |
| SLW Slawi | | SLO Solo |
| TGL Tegal | | KDR Kediri |
| CRB Cirebon | | MJK Mojokerto |
| TSK Tasikmalaya | | SBYB Surabaya Babatan |
| PWT Purwokerto | | SBYM Surabaya Merr |
| PKL Pekalongan | | |

**Pembagiannya bukan geografi.** Yogyakarta masuk Timur meski satu provinsi
dengan Semarang yang masuk Barat, dan Cirebon–Tasikmalaya masuk Barat meski Jawa
Barat. Jangan "dibetulkan" berdasarkan letak kota.

Area menentukan Area Manager mana yang menerima dokumen dari cabang tersebut,
jadi salah area berarti salah penyetuju. Memindahkan cabang antar area:
**Admin → Master Unit**.

Menambah cabang baru: **Admin → Master Unit → Cabang / Unit**, isi baris kosong
paling bawah lalu tekan *Tambah*. Cabang yang tutup cukup diubah statusnya jadi
*Nonaktif* — jangan dihapus, supaya dokumen lamanya tetap terbaca.

### Departemen Back Office

| Kode | Departemen | | Kode | Departemen |
|---|---|---|---|---|
| ACC | Accounting | | BDE | Business Development Ekspansi |
| HC | Human Capital | | BDS | Business Development SOP |
| PUR | Purchasing | | CS | Customer Service |
| MKT | Marketing | | IA | Internal Audit |
| SLS | Sales (Regional & Area) | | BRD | Brand |

Kode departemen muncul pada nomor dokumen Back Office:
`0001/EXP/KLA/HO-ACC/07/2026`.

Daftar ini diselaraskan **sekali saja** saat pembaruan dipasang (ditandai lewat
baris `migrasi_departemen_v2` di tabel `pengaturan`). Sesudah itu, perubahan yang
Anda lakukan di **Admin → Master Unit** tidak akan ditimpa lagi saat server
dinyalakan ulang.

---

## Halaman Pengajuan Baru

Susunan **dua panel**: kelompok kategori di kiri, kategorinya di kanan. Dipilih
pengguna dari empat alternatif yang disimulasikan lebih dulu (31 Jul 2026).

Alasan pemilihannya bukan sekadar lebih ringkas, tetapi **tingginya tetap**:
tinggi kartu terukur 297 px dan tidak berubah saat berpindah kelompok — kategori
baru hanya menambah isi panel kanan, halaman tidak ikut memanjang. Susunan lama
mencapai 1.628 px dan terus bertambah setiap kategori baru.

Tiap baris kategori menampilkan keterangan singkat serta keping wilayah
(Store / Back Office), ambang persetujuan CEO, dan penanda **2 jalur** bila
kategori itu punya jalur pengajuan berbeda (mis. Perjalanan Dinas yang diajukan
Area Manager sendiri).

**Di layar sempit (≤ 820 px)** menu kelompok disembunyikan dan seluruh kelompok
ditampilkan berurutan lengkap dengan judulnya — supaya di HP tidak perlu
mengetuk dua kali hanya untuk melihat daftar.

Lambang tiap kelompok diatur di `lib/konstanta.js` (`IKON_GRUP`). Kelompok baru
yang belum terdaftar memakai lambang cadangan, jadi menambah kelompok tidak
merusak tampilan.

---

## Formulir pengajuan

Susunan dipilih pengguna dari beberapa simulasi (31 Jul 2026):

- **Satu halaman melebar**, tanpa panel ringkasan. Isian pendek empat per baris,
  isian sedang tiga per baris, uraian panjang selebar halaman.
- Keterangan yang **tidak bisa diubah** (unit, jalur, pemohon, tanggal, nomor)
  ditulis sebagai baris keterangan di atas — dulu memakai kotak isian terkunci
  yang memakan satu baris penuh untuk informasi mati.
- Tiap bagian bernomor bulatan emas.
- **Total pindah ke kaki tabel rincian**, sebaris dengan Subtotal — tempat yang
  wajar untuk angka, bukan panel terpisah.

Tinggi kartu formulir turun dari **1.878 px** menjadi **1.419 px** (24% lebih pendek)
pada layar 1280 px.

### Petunjuk pengisian

Bilah petunjuk menempel di tepi bawah layar selama formulir digulir:

- tersembunyi saat tidak ada isian yang aktif;
- muncul begitu isian disentuh — kursor lewat saja sudah cukup, tidak perlu diklik;
- isinya berganti otomatis saat pindah isian, lengkap dengan nama isiannya;
- hilang sendiri saat keluar dari formulir.

Teksnya ditulis pada atribut `data-bantu` tiap isian di `views/pengajuan-form.ejs`.
Isinya sengaja bukan pengulangan nama kolom, melainkan hal yang benar-benar
membantu — contoh untuk Justifikasi: *"Paling sering ditanya CEO: dipakai untuk apa,
kenapa sekarang, dan apa akibatnya bila ditunda."*

### Lampiran penawaran ada di bagian 1

Penawaran vendor dilampirkan **sebelum** formulir diisi, bukan sesudah dokumen jadi:
berkas itulah sumber angka yang diketik di bawahnya, jadi tempatnya di awal.

Berkas ikut dalam **satu kiriman** bersama formulir (`multipart/form-data`) dan
tersimpan di transaksi yang sama dengan dokumennya — tidak ada lagi langkah
"simpan draft dulu, baru unggah".

Tiga hal yang dijaga karena berkas ditulis ke cakram sebelum kiriman dinyatakan sah:

| Keadaan | Yang terjadi |
|---|---|
| Token CSRF salah | Ditolak 403, **berkas dihapus** |
| Isian belum lengkap saat "Ajukan" | Formulir kembali dengan pesan agar berkas dipilih ulang, **berkas dihapus** |
| Wewenang kurang / galat apa pun | Berkas dihapus |

Penjaganya `bersihkanSisaBerkas` di `lib/unggah.js`: berkas dibuang kecuali rute
menandai `req.berkasDipakai = true`. Rute penerima berkas **wajib** dipasang lewat
`terimaBerkas()` — pemeriksaan CSRF yang ditunda ikut terpasang di dalamnya, jadi
rute baru tidak bisa lupa. Gerbang mutu menolak `unggah.array(` yang dipanggil
langsung di folder `routes/`.

Nama berkas dan ukurannya ditampilkan sendiri di bawah kotak pilih (kotak bawaan
peramban hanya menulis "3 files"), dan berkas yang melebihi batas ditandai merah
**sebelum** dikirim.

---

## Alur approval melebar

Pada halaman dokumen, alur approval memakai **seluruh lebar halaman** dan
ditempatkan di atas isi dokumen — "sudah sampai mana" adalah hal pertama yang
dicari orang saat membuka dokumen.

Kolomnya disejajarkan dengan grid, sehingga **tahap, nama penyetuju, status, dan
jam lurus dari atas ke bawah**:

| | Tahap | Penyetuju | Status | Waktu |
|---|---|---|---|---|
| ✓ | Area Manager | Nicolas Gandi<br>Area Manager Barat | Disetujui | 31 Juli 2026<br>08.12 WIB |
| 3 | Finance / Accounting | Kristianto Kinarjo | Menunggu sekarang | menunggu sejak<br>31/07/2026, 10.47 WIB |

Catatan penyetuju melebar di bawah barisnya. Tahap yang sedang ditunggu diberi
latar emas tipis dan bulatan bercahaya. Di layar sempit (≤ 1000 px) kolomnya
menumpuk sendiri jadi satu lajur.

---

## Waktu Indonesia Barat (WIB)

Waktu disimpan sebagai ISO UTC, tetapi **selalu ditampilkan dalam WIB** memakai
zona `Asia/Jakarta` — bukan mengikuti zona waktu server.

Ini bukan sekadar soal label. Bila aplikasi dipasang di server sewaan (hampir
selalu berzona UTC), cara lama yang memakai jam lokal server menampilkan seluruh
jam persetujuan **mundur 7 jam**: dokumen yang disetujui pukul 14.32 tercatat
pukul 07.32. Gerbang mutu menjalankan ulang pemformatan dengan `TZ=UTC` untuk
memastikan hasilnya tetap `31 Juli 2026, 14.32 WIB`.

Zona dan labelnya bisa diubah lewat variabel lingkungan `ZONA_WAKTU` dan
`LABEL_ZONA` bila suatu saat ada cabang di WITA atau WIT.

---

## Saringan daftar pengajuan

Halaman **Daftar Pengajuan** bisa disaring per **bulan** dan **tahun**, digabung
dengan saringan status, kategori, unit, dan pencarian bebas. Hasil saringan yang
sama ikut terbawa ke tombol **Unduh CSV**, jadi laporan bulanan tinggal:
pilih bulan → pilih tahun → Unduh CSV.

Memilih bulan tanpa memilih tahun otomatis memakai tahun berjalan (pilihannya
ikut ditampilkan balik di layar, tidak diam-diam). Batas bulan dihitung memakai
waktu setempat, bukan UTC — dokumen yang dibuat sore hari tidak akan terhitung
masuk bulan sebelumnya.

### Kolom Progres

Tiap baris menjawab "sudah sampai mana?" tanpa perlu membuka dokumennya:

| Keadaan | Yang tampil |
|---|---|
| Draft | `Belum diajukan` — masih bisa diubah pemohon |
| Berjalan | `Tahap 2 dari 4 · menunggu Regional Manager` + bilah 25% |
| Selesai | `Selesai — disetujui · 4 dari 4 tahap` + bilah penuh hijau |
| Ditolak | `Ditolak · di tahap Area Manager` + bilah merah |
| Perlu revisi | `Dikembalikan ke pemohon · oleh Area Manager` + bilah oranye |
| Dibatalkan | `Dibatalkan · dihentikan pemohon` |

Kalimatnya dihasilkan satu fungsi (`ringkasProgres` di `lib/pengajuan.js`) yang
dipakai bersama oleh Daftar Pengajuan dan Dasbor — supaya kedua halaman itu tidak
mungkin bercerita berbeda tentang dokumen yang sama.

---

## Alur dokumen

```
Draft ──ajukan──> Menunggu Approval ──setuju tiap tahap──> Disetujui
                        │
                        ├── minta revisi ──> Perlu Revisi ──ajukan ulang──> (rantai dihitung ulang)
                        └── tolak ────────> Ditolak
```

- **Nomor** diberikan saat diajukan, bukan saat draft dibuat — jadi tidak ada lubang nomor.
  Pola: `0001/CEA/KLA/SBYM/07/2026` = urut / jenis dokumen / KLA / unit / bulan / tahun.
- Setelah revisi, **rantai dibangun ulang** dari nominal terbaru (nominal naik melewati
  ambang → CEO otomatis ikut), tetapi **nomor dokumen tidak berubah**.
- Menolak/meminta revisi **wajib beralasan**.
- Tahap yang tidak dijalankan ditandai *dilewati* supaya riwayat tetap jujur.
- Mengubah matriks approval **tidak** mengubah dokumen yang sedang berjalan.

---

## Sandi & login pertama

Setiap pengguna **wajib mengganti sandi pada login pertama**. Selama belum diganti,
aplikasi tidak bisa dipakai sama sekali: halaman apa pun dipantulkan ke layar Ganti
Sandi, termasuk permintaan yang mengubah data — jadi tidak ada dokumen yang bisa
dibuat atau disetujui memakai sandi bawaan.

Kewajiban itu menyala pada tiga keadaan:

1. akun dibuat pertama kali oleh sistem (akun contoh),
2. akun dibuat Administrator lewat **Admin → Pengguna**,
3. sandi disetel ulang Administrator (**Reset sandi**) — sekaligus mengakhiri
   seluruh sesi login yang sedang berjalan.

Syarat sandi baru: minimal 8 karakter, memuat huruf dan angka, tidak boleh sama
dengan sandi lama, dan **sandi lama tetap diminta** — supaya sesi yang bocor tidak
bisa dipakai mengubah kredensial orang lain.

---

## Keamanan

- Sandi disimpan sebagai hash bcrypt; sandi awal acak & wajib diganti.
- Sesi disimpan di basis data (tahan server dinyalakan ulang), cookie `httpOnly`.
- Token CSRF pada seluruh permintaan yang mengubah data.
- Semua wewenang diperiksa **di server** dan bersifat gagal-tertutup:
  hanya kandidat penyetuju tahap aktif yang bisa memutuskan; pemohon lintas unit
  tidak bisa membuka dokumen orang lain; menu Admin hanya untuk peran `admin`.
- Content-Security-Policy ketat (`script-src 'self'`) — tidak ada skrip sebaris,
  tidak ada CDN. Aplikasi tetap jalan walau internet kantor mati.
- Batas percobaan login, dan setiap percobaan gagal masuk **Jejak Audit**.
- Lampiran disimpan dengan nama acak dan hanya bisa diunduh lewat rute
  yang memeriksa wewenang; jenis & ukuran berkas dibatasi.
- Rahasia (kunci sesi, alamat basis data, token Telegram) **hanya** dari variabel
  lingkungan / `.env` — tidak pernah dari basis data atau kode.

---

## Basis data

Satu API, dua mesin — dipilih otomatis:

| Kondisi | Mesin |
|---|---|
| `DATABASE_URL` kosong | SQLite lokal `data/eapex.db` |
| `DATABASE_URL` diisi | PostgreSQL (Neon/Supabase) |

Struktur tabel dibuat otomatis saat server menyala (aman diulang).
Uang disimpan sebagai **bilangan bulat rupiah** — tidak ada galat pembulatan
pada perhitungan ambang approval.

---

## Struktur berkas

```
server.js            titik masuk
app.js               perakitan Express: keamanan, sesi, rute, penanganan galat
lib/
  db.js              abstraksi SQLite / PostgreSQL
  skema.js           struktur tabel + data awal + MATRIKS APPROVAL awal
  konstanta.js       peran, status, bentuk formulir
  aturan.js          mesin aturan: langkah berlaku + pencarian kandidat penyetuju
  alur.js            satu-satunya jalan mengubah status dokumen (+ jejak & notifikasi)
  pengajuan.js       pembacaan data & rumus total (satu sumber rumus)
  formulir.js        daftar putih kolom + pemeriksaan isi formulir
  nomor.js           penomoran dokumen (atomis)
  auth.js            sesi, login, penjaga wewenang, CSRF
  unggah.js          lampiran
  notifikasi.js      notifikasi dalam aplikasi (+ Telegram opsional)
  util.js            uang, tanggal, terbilang rupiah
routes/              auth, dasbor, pengajuan, admin
views/               halaman EJS (termasuk lembar cetak)
public/              css & js (tanpa CDN)
scripts/cek.js       GERBANG MUTU
data/                basis data SQLite + lampiran (tidak di-commit)
```

---

## Deploy sebagai website

Aplikasi ini satu aplikasi web biasa — bisa dijalankan di VPS mana pun, dan sudah
disiapkan juga untuk hosting tanpa server tetap (Vercel dan sejenisnya).

### Yang wajib diisi

| Env | Nilai | Kenapa |
|---|---|---|
| `DATABASE_URL` | `postgres://…` (Neon/Supabase) | SQLite tidak bertahan di hosting tanpa cakram |
| `SESSION_SECRET` | 32 byte acak | tanpa ini sesi bisa dipalsukan |
| `DI_BELAKANG_PROXY` | `1` | supaya cookie ditandai `Secure` di belakang HTTPS |
| `SIMPANAN` | `db` | **lihat di bawah — jangan dilewat** |

Buat kunci sesi:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### `SIMPANAN=db` — jangan dilewat

Bawaannya lampiran disimpan sebagai berkas di `data/lampiran`. Di Vercel, Cloud Run,
dan sejenisnya cakram itu **hilang setiap kali aplikasi disebarkan ulang** — dan
hilangnya diam-diam: dokumennya masih ada, nomornya masih ada, hanya penawarannya
yang tidak bisa dibuka lagi.

`SIMPANAN=db` menyimpan isi berkas di dalam basis data, ikut terbawa backup. Ongkosnya
ruang 33% lebih besar (isinya disimpan sebagai teks base64 supaya satu jalur kode
melayani SQLite maupun PostgreSQL). Untuk VPS dengan cakram tetap, `disk` tetap
pilihan yang wajar.

### Vercel + Supabase

**1. Buat basis data di Supabase.** Project baru → **Project Settings → Database →
Connection string** → pilih **Transaction pooler** (port **6543**).

Jangan pakai koneksi langsung port 5432. Vercel membuat banyak sambungan pendek;
koneksi langsung akan cepat penuh, dan gejalanya bukan galat yang jelas melainkan
permintaan yang menggantung sampai kehabisan waktu. Kolam sambungan per contoh
fungsi otomatis dikecilkan jadi 2 saat berjalan di Vercel.

**2. Isi env di Vercel** (Settings → Environment Variables):

| Env | Nilai |
|---|---|
| `DATABASE_URL` | connection string pooler tadi (port 6543) |
| `SESSION_SECRET` | 32 byte acak |
| `DI_BELAKANG_PROXY` | `1` |
| `SIMPANAN` | `db` |
| `ALAMAT_APLIKASI` | alamat Vercel-nya, mis. `https://eapex.vercel.app` |
| `PENGINGAT_SECRET` | 24 byte acak, untuk pengingat harian |

**3. Sebarkan.**

```bash
npx vercel --prod
```

Tabel dibuat sendiri saat permintaan pertama masuk — tidak ada langkah migrasi
terpisah. Akun contoh ikut dibuat, dan **sandi awalnya tidak bisa dibaca dari
Vercel**; setel dari komputer sendiri dengan `DATABASE_URL` yang sama:

```bash
node scripts/reset-sandi.js admin@kla.co.id
```

### Berapa besar basis datanya?

Supabase gratis memberi **500 MB**. Dengan `SIMPANAN=db`, lampiran ikut di dalamnya
— disimpan sebagai teks base64, jadi hitungannya **ukuran berkas × 1,33**.

Karena foto dikecilkan di peramban lebih dulu (lihat bagian berikutnya), satu foto
penawaran ±240 KB → ±320 KB di basis data. Kasarnya:

| Isi | Perkiraan |
|---|---|
| 1 dokumen + 1 foto penawaran | ±330 KB |
| 100 dokumen/bulan | ±33 MB/bulan |
| Setahun | ±400 MB |

Jadi paket gratis cukup untuk sekitar **satu tahun** pemakaian 15 cabang. Sesudah
itu naik paket, atau pindahkan lampiran ke Supabase Storage. Tanpa kompresi, angka
yang sama tercapai dalam **kurang dari satu bulan**.

### Vercel

`vercel.json` dan `api/index.js` sudah ada. Semua alamat diarahkan ke satu titik
masuk; `api/index.js` tidak memanggil `app.listen` — hosting yang memanggilnya per
permintaan. `better-sqlite3` sudah dipindah ke `optionalDependencies` supaya
pemasangan tidak gagal karena modul asli yang tidak perlu di sana.

```bash
npx vercel --prod
```

Isi env di dasbor Vercel (Settings → Environment Variables), termasuk `VAPID_*`
kalau notifikasi HP mau dipakai. Notifikasi HP baru benar-benar sampai setelah
aplikasi ada di HTTPS — di localhost hanya bisa diuji.

### VPS / server sendiri

```bash
npm ci --omit=dev && npm start
```

Pakai `SIMPANAN=disk` dan pastikan folder `data/` ikut dicadangkan.

Notifikasi Telegram menyala sendiri bila `TELEGRAM_BOT_TOKEN` dan
`TELEGRAM_CHAT_ID` diisi; kegagalan pengiriman tidak pernah menggagalkan approval.

### Sebelum menyebarkan

- `npm run cek` harus hijau seluruhnya.
- `.env` **tidak** ikut ke repositori (sudah di `.gitignore`), begitu juga
  `data/AKUN-AWAL.txt` dan basis data lokal.
- Ganti sandi akun `admin@kla.co.id` bila belum.

---

## Baca penawaran otomatis (OpenAI)

Pemakai melampirkan penawaran vendor di bagian ① lalu menekan **"Baca penawaran ini"**.
Isi penawaran dibaca dan ditampilkan di panel periksa; formulir baru terisi setelah
ditekan **"Terapkan ke formulir"**. Yang perlu diketik sendiri tinggal tujuan dan
justifikasi.

Menyala hanya bila `OPENAI_API_KEY` diisi. Tanpa itu tombolnya tidak muncul dan
aplikasi berjalan penuh seperti biasa.

### Yang keluar dari kantor

Isi berkas penawaran **dikirim ke OpenAI**. Excel dan CSV diurai dulu di server lalu
yang dikirim cukup teksnya — angkanya terbaca apa adanya dan ongkosnya jauh lebih
murah. PDF dan foto dikirim utuh; hasil pindai memang tidak bisa dibaca dengan cara
lain. Kalau harga vendor tidak boleh keluar, kosongkan `OPENAI_API_KEY`.

### Yang dijaga

| Risiko | Penjagaan |
|---|---|
| Angka salah masuk dokumen approval | Hasil selalu ditampilkan dulu; total tetap dihitung ulang server dari isian yang benar-benar dikirim |
| Model mengarang | `temperature: 0`, jawaban dikunci pada satu bentuk JSON (`strict`) |
| Jawaban model aneh | Setiap nilai dipangkas & dibatasi ulang di server: qty negatif → 1, nominal bukan angka → 0, teks kepanjangan dipotong |
| Penawaran dalam USD | Diperingatkan, angkanya **tidak** dikurskan diam-diam |
| Harga sudah termasuk PPN | Diperingatkan |
| Perintah tersembunyi di dalam berkas vendor | Perintah sistem menegaskan isi berkas adalah data; kejanggalan dicatat di kolom catatan |
| Biaya membengkak | Maksimal 5 berkas sekali baca, 20 pembacaan per 10 menit **per pengguna** (bukan per IP — satu kantor keluar lewat satu IP) |
| Pesan galat layanan bocor ke layar | Diganti pesan sendiri; aslinya hanya masuk log server |

Model diambil dari `OPENAI_MODEL` (bawaan `gpt-4o-mini`), bukan dipatok di kode.

Diuji tanpa memanggil layanan sungguhan: `npm run uji-baca` menjalankan OpenAI
tiruan di localhost dan memeriksa isi permintaan yang benar-benar dikirim.

---

## Aplikasi HP (PWA) & notifikasi approval

EAPEX bisa dipasang di layar utama HP — Android maupun iPhone — dan mengirim
notifikasi begitu ada dokumen yang menunggu keputusan seseorang.

### Memasang di HP

| Perangkat | Cara |
|---|---|
| **Android** (Chrome/Edge) | Buka alamat EAPEX → muncul tawaran **Install app**, atau menu ⋮ → *Add to Home screen* |
| **iPhone / iPad** (Safari) | Buka alamat EAPEX → tombol **Bagikan** → **Add to Home Screen** |
| **Komputer** (Chrome/Edge) | Ikon pasang di ujung kanan bilah alamat |

Setelah terpasang, aplikasi terbuka layar penuh tanpa bilah alamat, punya ikonnya
sendiri, dan mengingat sesi login seperti aplikasi biasa.

### Menyalakan notifikasi

1. Buat kunci notifikasi **sekali saja** di server:

```bash
npm run kunci-push
```

2. Salin ketiga baris hasilnya ke berkas `.env`, lalu nyalakan ulang aplikasi.
3. Tiap pengguna membuka menu **Notifikasi** → tombol **Aktifkan notifikasi di HP ini**.

Pengaturan berlaku **per perangkat**. Notifikasi dikirim saat: ada dokumen masuk
ke kotak approval seseorang, dan saat dokumen pemohon disetujui, ditolak, atau
diminta revisi. Mengetuk notifikasi langsung membuka dokumennya.

### Kapan notifikasi dikirim

| Kejadian | Yang menerima |
|---|---|
| Dokumen diajukan | seluruh calon penyetuju **tahap pertama** |
| Satu tahap disetujui | calon penyetuju **tahap berikutnya** |
| Disetujui seluruh tahap | **pemohon** |
| Ditolak | **pemohon**, berikut alasannya |
| Diminta revisi | **pemohon**, berikut catatannya |

Penyetuju tahap berikutnya **belum** diganggu sebelum gilirannya tiba, dan yang
sudah memutuskan tidak diberi notifikasi ulang.

Semua ini diuji otomatis pada tiap `npm run cek`: sebuah layanan notifikasi
tiruan dijalankan di komputer sendiri, dokumen diajukan sungguhan, lalu diperiksa
permintaannya benar-benar datang ke penyetuju yang tepat — lengkap dengan tanda
tangan VAPID, enkripsi `aes128gcm`, dan isi yang tidak terbaca sebagai teks biasa.

Tiga sifat penting yang ikut diuji:

1. **Gagal kirim tidak pernah menggagalkan approval.** HP yang mati atau tidak
   terjangkau hanya dicatat di log; dokumen tetap berjalan ke tahap berikutnya.
2. **Langganan mati dibersihkan sendiri.** Bila layanan notifikasi menjawab 410
   (aplikasi dicopot / izin dicabut), langganannya dihapus otomatis.
3. **Notifikasi di dalam aplikasi tetap tercatat** apa pun keadaan HP-nya, jadi
   tidak ada approval yang hilang hanya karena notifikasi gagal sampai.

### Syarat yang datang dari peramban, bukan dari aplikasi ini

- **Wajib HTTPS.** `http://localhost` hanya berlaku untuk uji coba di komputer
  yang sama. Supaya bisa dipakai dari HP karyawan, aplikasi harus di-hosting
  dengan sertifikat HTTPS.
- **iPhone/iPad**: izin notifikasi baru bisa diminta setelah aplikasi dipasang ke
  layar utama (aturan Apple sejak iOS 16.4). Halaman Notifikasi menampilkan
  petunjuknya otomatis bila dibuka dari Safari yang belum memasang aplikasi.
- Kalau pengguna menolak izin, tombolnya menjadi mati dan izin harus dipulihkan
  dari pengaturan peramban — aplikasi tidak bisa memintanya ulang.

### Yang sengaja TIDAK disimpan di HP

Service worker hanya menyimpan **kerangka aplikasi** (CSS, JavaScript, ikon) dan
satu halaman "tidak ada jaringan". Isi dokumen — nominal, nomor rekening,
keputusan approval — **tidak pernah** disimpan di perangkat, supaya tidak bisa
dibaca orang lain yang memegang HP itu walau pemiliknya sudah logout.

Isi notifikasi memuat nomor dokumen, perihal, dan nilainya. Pesan itu bisa
terbaca di layar kunci, jadi sebaiknya diaktifkan hanya di perangkat pribadi.

### Membuat ulang ikon

Ikon dibuat dari kode (tanpa perkakas gambar) supaya selalu bisa dihasilkan ulang:

```bash
npm run buat-ikon
```

---

## Identitas visual

Tema **gelap futuristik** dengan warna merek KLA. Warna diambil **langsung dari
berkas logo** dengan membaca pikselnya, bukan dikira-kira:

| Warna | Kode | Dipakai untuk |
|---|---|---|
| Ungu merek | `#461866` | warna resmi logo, bilah status HP, ikon aplikasi |
| Ungu gelap | `#120520` | latar aplikasi |
| Ungu terang | `#7c3fbf` | tombol utama, menu aktif, cincin fokus isian |
| Emas | `#f7bf0a` | tombol tindakan, lencana angka, judul bagian |

Ciri tampilannya: latar gelap dengan tiga lapis cahaya ungu–emas, kartu
semi-tembus pandang berefek kaca (`backdrop-filter`), tombol bergradasi dengan
cahaya saat disentuh, alur approval bergaris penghubung dengan lingkaran
bercahaya pada tahap yang sedang berjalan, dan halaman masuk dengan dua bulatan
cahaya yang bergerak perlahan (berhenti otomatis bila pengguna menyetel
"kurangi gerakan" di perangkatnya).

**Lembar cetak tetap putih dengan tulisan hitam** — itu dokumen resmi di atas
kertas, bukan tampilan layar.

### Logo

Berkas logo asli berupa kotak ungu dengan lambang emas di tengahnya. Kalau
dipasang apa adanya, yang terlihat justru KOTAKNYA. Karena itu
`scripts/potong-logo.js` membuang latar ungunya menjadi transparan dan
memangkas pinggirannya (252×270 → 233×96), menghasilkan
`logo-kla-lambang.png`.

| Berkas | Dipakai di |
|---|---|
| `logo-kla-lambang.png` | bilah samping (26px), halaman masuk (34px), halaman luring |
| `logo-kla.png` | kop cetakan — di atas kertas putih, emas polos terlalu tipis terbaca |
| `ikon-*.png` | ikon aplikasi di HP, dibuat dari logo asli |

Kalau logo diganti, jalankan ulang keduanya:

```bash
npm run potong-logo
npm run buat-ikon
```

### Cap versi aset

CSS dan JavaScript dipanggil dengan cap versi dari isi berkasnya
(`/css/app.css?v=4d457e67`). Ini bukan hiasan: tanpa cap itu, service worker
menyimpan salinan alamat yang sama selamanya, sehingga tampilan yang sudah
diganti di server **tidak pernah sampai ke layar** — persis yang terjadi
31 Jul 2026 dan sempat terlihat seperti bug tampilan. Cap dihitung otomatis saat
server menyala; tidak ada yang perlu diingat manusia.

---

## Notifikasi email

Notifikasi HP hanya sampai kalau orangnya memasang aplikasi, mengizinkan
notifikasi, dan alamatnya HTTPS. Sebagian penyetuju tidak akan melakukannya.
Email tidak menuntut apa pun dari penerimanya.

**Alamatnya tidak wajib.** Alamat di kolom *email* dipakai untuk **masuk** dan
boleh berupa alamat tanpa kotak surat sungguhan (`sm.smg@kla.co.id` dan
sejenisnya). Alamat kiriman diisi terpisah di **Admin → Pengguna → "Email untuk
notifikasi"**. Yang dikosongkan sekadar tidak menerima email — tanpa galat, tanpa
menahan siapa pun.

Nyalakan dengan mengisi `SMTP_*` di `.env`. Untuk Gmail/Google Workspace pakai
**App Password**, bukan sandi akun. Tanpa `SMTP_HOST`, fitur ini mati bersih dan
aplikasi berjalan seperti biasa.

Isi `ALAMAT_APLIKASI` supaya email memuat tombol "Buka dokumen". Tanpa itu email
tetap terkirim, hanya tanpa tautan — bukan tautan ke `localhost` yang tidak bisa
dibuka siapa pun.

Gagal kirim **tidak pernah** menggagalkan approval: dikirim setelah transaksi
selesai, kegagalannya hanya dicatat di log.

---

## Pengingat approval harian (10.00 WIB)

Approval jarang mati karena ditolak — matinya karena dilupakan. Setiap hari pukul
**10.00 WIB** setiap penyetuju yang punya tunggakan menerima satu pesan berisi
daftar dokumen yang menunggu keputusannya, lengkap dengan umur tiap dokumen
("sudah 3 hari"). Yang tidak punya tunggakan tidak diganggu.

| Tempat jalan | Caranya |
|---|---|
| VPS / komputer sendiri | Otomatis, tidak perlu diatur apa-apa |
| Vercel & sejenisnya | Penjadwal platform memanggil `/api/pengingat` (sudah ada di `vercel.json`, 03:00 UTC = 10:00 WIB) |

Alamat pemicunya dilindungi `PENGINGAT_SECRET`. **Tanpa rahasia itu terisi,
alamatnya MATI — bukan terbuka**: alamat yang bisa dipanggil siapa saja bisa
dipakai membanjiri seluruh penyetuju atau memancing biaya kirim email.

Dijamin **sekali sehari**: tanggal jalan terakhir dicatat di tabel `pengaturan`
dan ditandai *sebelum* pesan pertama dikirim, jadi server yang menyala-mati
berkali-kali atau dua contoh yang berjalan bersamaan tidak membuat orang menerima
pengingat berulang. Ganti jamnya lewat `JAM_PENGINGAT`.

Dokumen yang tahapnya **tidak punya satu pun penyetuju tersedia** dilaporkan ke
Administrator, bukan ke penyetuju — yang perlu bertindak memang bukan mereka.

---

## Cuti penyetuju

Satu Regional Manager memegang tahap kedua semua rantai store. Kalau dia cuti
seminggu, pengajuan 15 cabang berhenti.

Ditandai di **Admin → Pengguna → Ubah → Cuti / berhalangan**. Selama tanggal itu:

- kalau ada **pengganti** yang ditunjuk → penggantinya yang menyetujui;
- kalau tidak → **tahapnya dilewati**, dan alur lanjut ke tahap berikutnya.

Empat hal yang sengaja dibuat begitu:

1. **Cuti ditandai manusia, tidak pernah ditebak sistem.** Sistem tidak boleh
   menyimpulkan "sudah tiga hari tidak dibuka, berarti cuti" — diam bisa berarti
   sibuk, ragu, atau sengaja menahan. Melewati penyetuju karena ia lambat sama
   saja menghapus kontrol tanpa ada yang memutuskan.
2. **Tanggal selesai wajib.** Cuti tanpa ujung akan terlupakan dan berubah jadi
   penyetuju yang dilewati selamanya. Lebih dari 180 hari ditolak — itu bukan
   cuti, itu penonaktifan akun.
3. **Dilewati itu tercatat di dokumen.** Tahapnya tetap tampil di tempatnya
   dengan keterangan siapa yang berhalangan dan sampai kapan. Nomor urut tidak
   dirapatkan, jadi setahun kemudian masih bisa dibaca kenapa dokumen ini hanya
   melewati tiga tanda tangan.
4. **Tidak semua tahap boleh dilewati.** Kalau seluruh penyetuju pada satu alur
   sedang cuti, dokumen **ditolak diajukan** — kalau diteruskan, dokumen itu akan
   sah tanpa satu pun persetujuan.

Pengganti lebih aman daripada melewati: kontrolnya tidak hilang, hanya berpindah
tangan. Melewati tahap Regional Manager berarti pengajuan store minggu itu punya
satu lapis pemeriksaan lebih sedikit.

---

## Semua isian wajib, lampiran wajib

Sejak 31 Juli 2026 dokumen **tidak bisa diajukan** kalau isinya belum lengkap.
Draft tetap boleh disimpan setengah jadi — yang dikunci hanya tombol **Ajukan**.

### Yang wajib

Daftarnya ada di satu tempat saja, `WAJIB` di `lib/formulir.js`. Layar mengambil
daftar yang sama lewat atribut `data-wajib` pada formulir, lalu `app.js` yang
memasang tanda bintang dan atribut `required`. Ditulis sekali supaya layar dan
pemeriksaan server tidak pernah berbeda isi — gerbang mutu membandingkan keduanya.

Untuk CAPEX: nama proyek, tujuan pengadaan (minimal satu), kategori aset,
deskripsi, lokasi, vendor, jadwal kebutuhan, penjelasan, justifikasi — plus tiap
baris rincian harus punya uraian, jumlah > 0, satuan, dan harga > 0.

### Yang SENGAJA tidak wajib

| Kolom | Alasan |
|---|---|
| Pengiriman, Instalasi, Biaya lain | Nol itu jawaban yang sah — barang diambil sendiri, atau tidak perlu dipasang. Kalau dipaksa berisi, orang akan mengarang angka |
| Sales tambahan, Margin (Analisa Retail) | Hanya berlaku untuk capex yang memang menambah penjualan. AC ruang kasir tidak menambah omzet, dan memaksa mengisinya membuat analisanya bohong |
| Referensi disposal | Hanya ada bila memang ada aset lama yang dilepas |
| Keterangan tiap baris | Catatan tambahan, bukan penentu keputusan |

### Lampiran

Bawaannya **wajib untuk semua kategori**. Dokumen approval tanpa penawaran memaksa
penyetuju memutuskan berdasarkan angka yang diketik sendiri oleh pemohon, tanpa apa
pun untuk dicocokkan.

Diperiksa **dua kali**: di peramban sebelum kiriman berangkat (pesannya langsung,
tidak perlu menunggu halaman kembali), dan di server saat dokumen diajukan — sebab
pemeriksaan di peramban bisa dilewati siapa pun yang mau.

Bisa dimatikan per kategori lewat kolom `kategori.lampiran_wajib`.

---

## Foto penawaran dikecilkan sendiri

Foto penawaran dari HP biasanya 3–8 MB, padahal yang dibutuhkan cuma tulisannya
terbaca. Foto dikecilkan **di peramban, sebelum dikirim** — hemat kuota orang
cabang, hemat penyimpanan Supabase, dan unggahannya jauh lebih cepat.

Terukur pada foto uji 4000×3000 berisi tabel harga:

| | Sebelum | Sesudah |
|---|---|---|
| Ukuran | 4,00 MB | **236 KB** |
| Dimensi | 4000×3000 | 2000×1500 |

Hemat **94%**.

### Syaratnya: harus tetap jelas

Itu yang menentukan angka-angkanya, bukan sebaliknya:

- **Sisi terpanjang 2000 piksel.** Untuk foto kertas A4 itu sekitar 7 piksel per
  milimeter — tulisan 10pt jadi ±23 piksel, masih terbaca lega. Mengecilkan lebih
  jauh memang lebih hemat, tapi angka nominal mulai meragukan, dan penawaran yang
  angkanya meragukan tidak ada gunanya dilampirkan.
- **Mutu 0,85, bukan 0,6.** Selisih ukurannya kecil, selisih ketajaman tulisannya
  besar.
- **Foto di bawah 600 KB tidak disentuh sama sekali.**
- **Kalau hasilnya ternyata tidak lebih kecil, yang asli yang dipakai.**
- **PDF, Excel, dan Word tidak pernah disentuh** — isinya bukan piksel.
- **Arah foto dari HP diikutkan** (`imageOrientation: 'from-image''). Tanpa ini foto
  potret bisa tersimpan miring — lebih susah dibaca daripada sebelum dikompres.

Ukuran sebelum dan sesudah ditampilkan di daftar berkas (`4,0 MB → 236 KB`), jadi
pemakainya melihat sendiri apa yang terjadi. Kiriman ditahan selama kompresi belum
selesai — tanpa itu, orang yang cepat menekan Ajukan akan mengirim berkas aslinya
yang berukuran penuh.

Aturannya bisa diubah di atribut `data-maks-piksel` dan `data-mutu-gambar` pada
kotak berkas di `views/pengajuan-form.ejs`.

---

## Gladi bersih satu cabang

```bash
npm run gladi           # SEMUA cabang sekaligus
npm run gladi -- SMG    # satu cabang saja, pakai kodenya
```

Bukan pengujian benar/salah seperti `npm run cek`. Ini menempuh **satu hari kerja
cabang**: empat dokumen yang bentuknya seperti pengajuan sungguhan (CAPEX AC,
perbaikan atap, ATK bulanan, refund uang muka), lengkap dengan lampiran, dari
pengajuan sampai disetujui seluruh rantai. Lalu melaporkan **hambatan yang akan
ditemui orang**, bukan sekadar lulus/gagal.

Dijalankan di basis data sementara — data asli tidak tersentuh.

Tiga tingkat temuan:

| Tingkat | Artinya |
|---|---|
| **HARUS DIBERESKAN** | Cabang ini tidak bisa dipakai sebelum ini beres (peran kosong, dokumen berhenti, akun tidak ada) |
| **PERIKSA ATURAN** | Sistemnya benar, tapi aturannya mungkin tidak masuk akal di lapangan — mis. dokumen Rp 550.000 yang tetap butuh tanda tangan CEO |
| **SEBAIKNYA** | Jalan, tapi ada yang belum dinyalakan (email, notifikasi HP, tombol AI) |

Jalankan ini **sebelum** menyerahkan cabang baru ke penggunanya.

---

## Melewati tahap berikutnya — keputusan penyetuju sebelumnya

Yang paling tahu apakah penyetuju berikutnya bisa dihubungi **hari ini** adalah
orang di tahap sebelumnya — bukan sistem, dan bukan catatan cuti yang mungkin
belum sempat diisi. Karena itu keputusannya ada di tangan dia, per dokumen.

Saat menyetujui, penyetuju melihat siapa yang berikutnya, apakah orang itu
tercatat sedang cuti, dan satu pilihan: **"Lewati [tahap] — hari ini tidak
memungkinkan menyetujui"**.

Ini wewenang menghapus satu lapis pemeriksaan, jadi dibatasi:

| Pagar | Alasan |
|---|---|
| Hanya **satu** tahap, yaitu yang tepat berikutnya | Melompat dua tahap sekaligus berarti dokumen bisa melewati hampir seluruh rantai |
| **Accounting tidak bisa dilewati** | Matriks aslinya menegaskan berulang kali *"nominal berapa pun tetap melalui Accounting untuk verifikasi"* — itu bukan tahap persetujuan, itu pemeriksaan |
| **Tahap terakhir tidak bisa dilewati** | Kalau boleh, sebuah dokumen bisa dinyatakan disetujui penuh tanpa pernah sampai ke pemegang wewenang akhir |
| **Alasan wajib** | Tercatat di dokumen beserta nama yang memutuskan, dan sebagai baris tersendiri di jejak audit |
| **Yang dilewati diberi tahu** | Satu-satunya orang yang bisa protes kalau keputusannya keliru justru dia — dia harus mendengarnya |

Tahapnya tetap tampil di alur dengan keterangan *"Dilewati atas keputusan
[nama] ([tahapnya]): [alasan]"*. Nomor urutnya tidak dirapatkan, jadi setahun
kemudian masih terbaca kenapa dokumen ini hanya punya tiga tanda tangan.

Ini **melengkapi**, bukan menggantikan, penandaan cuti. Cuti dipakai untuk yang
sudah diketahui jauh hari; pilihan ini untuk yang baru ketahuan saat dokumennya
sudah di meja. **Pagar yang sama berlaku untuk keduanya** — Accounting dan tahap
terakhir tidak bisa dilewati lewat jalur mana pun. Kalau penyetujunya cuti dan
minta dilewati tapi tahapnya termasuk yang tidak boleh dilewati, tahap itu tetap
dijalankan dan calon penyetujunya dikembalikan; dokumennya menunggu dan dilaporkan
ke Administrator sebagai dokumen tersendat oleh pengingat harian.

### Hanya dua jalan tahap approval berpindah

Mencatat cuti TIDAK dengan sendirinya melewati tahap siapa pun. Menghapus satu
lapis pemeriksaan tidak boleh bisa dilakukan sendiri oleh orang yang justru
sedang tidak di tempat — harus ada manusia lain yang memastikannya.

| Jalan | Siapa yang memutuskan | Kontrolnya |
|---|---|---|
| **Menunjuk pengganti** | Orangnya sendiri (atau Admin) | Tidak hilang — berpindah tangan. Berlaku otomatis |
| **Dipastikan penyetuju sebelumnya** | Orang di tahap sebelumnya | Hilang satu lapis, jadi wajib beralasan tertulis dan tercatat |

Pilihan **"Menyatakan tidak bisa menyetujui"** hanyalah PERNYATAAN. Tahapnya tetap
berjalan dan tetap miliknya; pernyataan itu muncul di layar penyetuju sebelumnya
sebagai peringatan merah, dan dialah yang memastikan lalu memutuskan melewatinya
atau menunggu. Kalau tidak ada yang memastikan, dokumennya menunggu — dan
pengingat harian melaporkannya ke Administrator sebagai dokumen tersendat.

### Mengisi cuti

Dua jalur, keduanya menghasilkan hal yang sama:

| Siapa | Di mana |
|---|---|
| **Orangnya sendiri** | Menu **Cuti Saya** — yang paling dulu tahu memang dia |
| **Administrator / HC** | **Admin → Pengguna → Ubah → Cuti** |

Lewat jalur mana pun, **orang yang ditandai cuti selalu diberi tahu** — di dalam
aplikasi, di HP, dan lewat email. Kalau ditandai orang lain, pemberitahuannya
menyebut siapa yang menandai. Ditandai berhalangan berarti tahap approval-nya
bisa dilewati; itu tidak boleh terjadi tanpa sepengetahuannya.

Orang yang ditunjuk sebagai **pengganti** juga diberi tahu, dan orang yang
tahapnya benar-benar dilewati oleh sebuah dokumen menerima pemberitahuan
tersendiri berisi nomor dokumen dan alasannya.

---

## Unduhan daftar pengajuan (Excel)

Tombol **Unduh Excel** di Daftar Pengajuan menghasilkan `.xlsx` sungguhan, bukan
CSV berganti nama.

Bedanya bukan sekadar akhiran berkas: kolom **Total** di sini benar-benar **angka**,
jadi bisa langsung dijumlah dan disaring di Excel. CSV selalu berakhir jadi teks —
pemisah titik-koma, titik ribuan, dan tanggal ikut salah tafsir tergantung
pengaturan Windows tiap orang, dan yang menerimanya harus membetulkan manual.

Isinya: nomor, tanggal dibuat, tanggal diajukan, kategori, kelompok, perihal,
pemohon, unit, total, status, dan progres. Baris kepala menempel saat digulir,
saringan per kolom sudah aktif, lebar kolom sudah disetel.

Unduhan **mengikuti saringan yang sedang dipakai** di layar (status, kategori,
cabang, bulan, tahun, pencarian) dan mengambil sampai 2.000 baris — bukan 50 baris
yang tampil. Nama berkasnya ikut menyebut periodenya, mis.
`EAPEX-Daftar-Pengajuan-2026-Agustus.xlsx`, supaya unduhan bulan berbeda tidak
tertukar di folder Unduhan.

Penulisnya `lib/xlsx-tulis.js` — ditulis sendiri tanpa pustaka tambahan, dan
diuji dengan cara dibaca ulang oleh pembaca `.xlsx` milik aplikasi ini sendiri
(`lib/xlsx-ringkas.js`), jadi yang dibuktikan bukan "ada berkasnya" tapi
"isinya benar".

---

## Dokumen tertahan diberitahukan seketika

Kalau sebuah dokumen mendarat di tahap yang **seluruh** penyetujunya sudah
menyatakan tidak bisa menyetujui, dokumen itu akan diam di situ. Menunggu
pengingat harian besok pagi berarti dokumen itu hilang sehari tanpa ada yang tahu.

Karena itu pemberitahuannya dikirim **saat itu juga**, masing-masing berisi hal
yang bisa dilakukan penerimanya:

| Penerima | Isinya |
|---|---|
| Yang menyatakan tidak bisa | *"Dokumen menunggu Anda, padahal Anda menyatakan tidak bisa. Tunjuk pengganti lewat menu Cuti Saya, atau setujui sendiri kalau ternyata sempat."* |
| Administrator | *"Dokumen tertahan di [tahap] ([nama]). Tunjuk pengganti supaya jalan lagi."* |

Penyetuju sebelumnya sengaja **tidak** diminta bertindak di sini: dia sudah
memutuskan dan dokumennya sudah lewat. Tempatnya memutuskan tadi — saat menekan
setuju, lewat pilihan "Lewati tahap berikutnya".

Cukup **satu** calon penyetuju yang masih sanggup untuk membuat dokumennya jalan;
peringatan ini hanya muncul kalau benar-benar tidak ada yang bisa.
