# ============================================================================
#  Menyambungkan EAPEX ke basis data Supabase dan mengisi tabelnya.
# ============================================================================
#  Satu-satunya yang perlu disiapkan orang: berkas data\sandi.txt berisi
#  SANDI BASIS DATA SUPABASE saja, satu baris.
#
#  Skrip ini merangkai alamat sambungannya sendiri, jadi tidak ada teks panjang
#  yang perlu disunting tangan — di situlah kesalahan paling sering terjadi.
#  Sandi dikodekan otomatis, sehingga karakter seperti @ : / # tidak merusak
#  struktur alamat.
#
#  Sandi TIDAK PERNAH ditampilkan di layar, hanya panjangnya.
#
#  Jalankan:  powershell -ExecutionPolicy Bypass -File scripts\hubungkan-supabase.ps1
# ============================================================================

param(
  [string]$Ref     = 'knvfxgdmyzdkheqqxkqv',
  [string]$Wilayah = 'aws-0-ap-southeast-1',
  [int]   $Port    = 6543
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Judul($t) { Write-Host ""; Write-Host "  $t" -ForegroundColor Cyan }
function Baik($t)  { Write-Host "  [OK]  $t" -ForegroundColor Green }
function Buruk($t) { Write-Host "  [!!]  $t" -ForegroundColor Red }

Write-Host ""
Write-Host "  ===============================================" -ForegroundColor Cyan
Write-Host "   EAPEX -> Supabase" -ForegroundColor Cyan
Write-Host "  ===============================================" -ForegroundColor Cyan

# --- 1. sandi basis data -----------------------------------------------------
Judul "1. Membaca sandi basis data"

$fSandi = 'data\sandi.txt'
if (-not (Test-Path $fSandi)) {
  Buruk "Berkas $fSandi belum ada."
  Write-Host ""
  Write-Host "  Buat dulu dengan cara ini:" -ForegroundColor Yellow
  Write-Host "    1. Jalankan:  notepad data\sandi.txt"
  Write-Host "    2. Jawab Yes waktu ditanya membuat berkas baru"
  Write-Host "    3. Tempel SANDI BASIS DATA SUPABASE saja - satu baris,"
  Write-Host "       tanpa tanda kutip, tanpa alamat postgresql://"
  Write-Host "    4. Ctrl+S lalu tutup Notepad"
  Write-Host "    5. Jalankan skrip ini lagi"
  Write-Host ""
  Write-Host "  Lupa sandinya? Supabase > Settings > Database >" -ForegroundColor Yellow
  Write-Host "  Reset database password > Generate a password," -ForegroundColor Yellow
  Write-Host "  lalu JANGAN LUPA klik tombol konfirmasinya." -ForegroundColor Yellow
  Write-Host ""
  exit 1
}

$sandi = (Get-Content $fSandi -Raw)
if ($null -eq $sandi) { $sandi = '' }
$sandi = $sandi.Trim()

if ($sandi.Length -eq 0) {
  Buruk "Berkas $fSandi ada tapi KOSONG."
  Write-Host "  Buka lagi dengan 'notepad data\sandi.txt', tempel sandinya, Ctrl+S."
  Write-Host ""
  exit 1
}
if ($sandi -match '^postgres(ql)?://') {
  Buruk "Yang tersimpan di $fSandi adalah alamat lengkap, bukan sandinya saja."
  Write-Host "  Isi berkas itu HANYA bagian sandinya - yang di antara ':' dan '@'."
  Write-Host ""
  exit 1
}
if ($sandi -match '\[|\]') {
  Buruk "Sandi masih mengandung kurung siku - kurungnya harus ikut dibuang."
  Write-Host ""
  exit 1
}
if ($sandi -match '\s') {
  Buruk "Sandi mengandung spasi atau pindah baris. Kemungkinan ada yang ikut tersalin."
  Write-Host ""
  exit 1
}
Baik "Sandi terbaca: $($sandi.Length) huruf"

# --- 2. sandi admin aplikasi -------------------------------------------------
Judul "2. Membaca sandi admin aplikasi"

$fRahasia = 'data\RAHASIA-DEPLOY.txt'
$admin = $null
if (Test-Path $fRahasia) {
  foreach ($baris in (Get-Content $fRahasia)) {
    if ($baris -match '^ADMIN_PASSWORD=(.+)$') { $admin = $Matches[1].Trim(); break }
  }
}
if ([string]::IsNullOrEmpty($admin)) {
  Write-Host "  [--]  ADMIN_PASSWORD tidak ditemukan di $fRahasia." -ForegroundColor Yellow
  Write-Host "        Tidak apa-apa: sistem akan membuat sandi acak sendiri"
  Write-Host "        dan mencatatnya bersama 27 akun lain."
} else {
  Baik "Sandi admin terbaca: $($admin.Length) huruf"
}

# --- 3. rangkai alamat -------------------------------------------------------
Judul "3. Merangkai alamat sambungan"

$server = "$Wilayah.pooler.supabase.com"
$enc    = [uri]::EscapeDataString($sandi)
$url    = "postgresql://postgres.${Ref}:${enc}@${server}:${Port}/postgres"

Baik "pengguna : postgres.$Ref"
Baik "server   : $server"
Baik "port     : $Port"
if ($enc -ne $sandi) { Baik "sandi dikodekan otomatis (ada karakter khusus)" }

# --- 4. uji jaringan ---------------------------------------------------------
Judul "4. Menguji jaringan"

$uji = Test-NetConnection -ComputerName $server -Port $Port -WarningAction SilentlyContinue
if (-not $uji.TcpTestSucceeded) {
  Buruk "Port $Port tidak bisa dijangkau dari jaringan ini."
  Write-Host "  Kemungkinan diblokir jaringan kantor. Coba jaringan lain."
  Write-Host ""
  exit 1
}
Baik "Port $Port tembus ke $($uji.RemoteAddress)"

# --- 5. amankan berkas akun lokal -------------------------------------------
Judul "5. Mengamankan berkas akun lokal"

$adaLokal = Test-Path 'data\AKUN-AWAL-LOKAL.txt'
if ((Test-Path 'data\AKUN-AWAL.txt') -and -not $adaLokal) {
  Rename-Item 'data\AKUN-AWAL.txt' 'AKUN-AWAL-LOKAL.txt'
  $adaLokal = $true
  Baik "AKUN-AWAL.txt disimpan sementara sebagai AKUN-AWAL-LOKAL.txt"
} elseif ($adaLokal) {
  Baik "AKUN-AWAL-LOKAL.txt sudah aman dari percobaan sebelumnya"
} else {
  Baik "Tidak ada berkas akun lokal yang perlu diamankan"
}

# --- 6. isi tabelnya ---------------------------------------------------------
Judul "6. Mengisi tabel di Supabase"

$env:DATABASE_URL = $url
if (-not [string]::IsNullOrEmpty($admin)) { $env:ADMIN_PASSWORD = $admin }

$keluaran = & npm run seed 2>&1
$kode = $LASTEXITCODE
$teks = ($keluaran | Out-String)

Write-Host ($teks.TrimEnd())

$sukses = ($kode -eq 0) -and ($teks -match 'Basis data:\s*pg')

if (-not $sukses) {
  Buruk "Gagal mengisi tabel."
  if ($teks -match 'password authentication failed') {
    Write-Host ""
    Write-Host "  Sandinya ditolak Supabase. Yang paling mungkin:" -ForegroundColor Yellow
    Write-Host "    - Sandi di data\sandi.txt bukan sandi yang sedang berlaku"
    Write-Host "    - Reset password sempat dilakukan tapi tombol konfirmasinya"
    Write-Host "      belum ditekan, sehingga sandi lama masih aktif"
    Write-Host ""
    Write-Host "  Perbaikan: Supabase > Settings > Database >" -ForegroundColor Yellow
    Write-Host "  Reset database password > Generate a password >"
    Write-Host "  SALIN sandinya > klik tombol konfirmasi > tunggu"
    Write-Host "  pemberitahuan berhasil. Lalu perbarui data\sandi.txt"
    Write-Host "  dan jalankan skrip ini lagi."
  } elseif ($teks -match 'Basis data:\s*sqlite') {
    Write-Host "  Yang terisi malah basis data lokal - alamat Supabase tidak terbaca." -ForegroundColor Yellow
  }
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue
  Write-Host ""
  exit 1
}

Baik "Tabel terisi di Supabase"

# --- 7. rapikan --------------------------------------------------------------
Judul "7. Merapikan"

# Jumlah akun dibaca dari keluaran seed, bukan ditulis kaku — supaya angka yang
# dilaporkan selalu sama dengan isi basis data walau daftar peran berubah.
$jmlAkun = if ($teks -match 'Pengguna:\s*(\d+)') { $Matches[1] } else { '?' }

if (Test-Path 'data\AKUN-AWAL.txt') {
  if (Test-Path 'data\AKUN-AWAL-SUPABASE.txt') { Remove-Item 'data\AKUN-AWAL-SUPABASE.txt' }
  Rename-Item 'data\AKUN-AWAL.txt' 'AKUN-AWAL-SUPABASE.txt'
  Baik "Sandi $jmlAkun akun online tersimpan di data\AKUN-AWAL-SUPABASE.txt"
} else {
  Write-Host "  [--]  Tidak ada berkas akun baru - tabelnya memang sudah terisi sebelumnya." -ForegroundColor Yellow
}

if ($adaLokal -and -not (Test-Path 'data\AKUN-AWAL.txt')) {
  Rename-Item 'data\AKUN-AWAL-LOKAL.txt' 'AKUN-AWAL.txt'
  Baik "Berkas akun lokal dikembalikan ke AKUN-AWAL.txt"
}

foreach ($sisa in @('data\sandi.txt', 'data\dburl.txt')) {
  if (Test-Path $sisa) { Remove-Item $sisa; Baik "$sisa dihapus (memuat sandi)" }
}

Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue
Baik "Sambungan produksi dilepas - localhost kembali memakai basis data lokal"

Write-Host ""
Write-Host "  ===============================================" -ForegroundColor Green
Write-Host "   SUPABASE SELESAI" -ForegroundColor Green
Write-Host "  ===============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Berikutnya Vercel - tidak perlu PowerShell lagi."
Write-Host "  Sandi $jmlAkun akun online ada di: data\AKUN-AWAL-SUPABASE.txt"
Write-Host ""
