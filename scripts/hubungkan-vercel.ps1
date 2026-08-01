# ============================================================================
#  Menyiapkan project EAPEX di Vercel: buat/pautkan project, isi seluruh
#  Environment Variables, sambungkan ke GitHub, lalu sebarkan.
# ============================================================================
#  Yang perlu disiapkan orang lebih dulu:
#    1. Sudah masuk Vercel:            npx vercel login
#    2. data\sandi.txt berisi SANDI BASIS DATA SUPABASE saja, satu baris
#
#  Nilai rahasia dibaca langsung dari berkas dan dialirkan ke Vercel tanpa
#  pernah ditampilkan di layar. Yang tampil hanya nama variabel dan panjangnya.
#
#  Jalankan:  powershell -ExecutionPolicy Bypass -File scripts\hubungkan-vercel.ps1
# ============================================================================

param(
  [string]$Ref     = 'knvfxgdmyzdkheqqxkqv',
  [string]$Wilayah = 'aws-0-ap-southeast-1',
  [int]   $Port    = 6543,
  [string]$Nama    = 'eapex-kla'
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Judul($t) { Write-Host ""; Write-Host "  $t" -ForegroundColor Cyan }
function Baik($t)  { Write-Host "  [OK]  $t" -ForegroundColor Green }
function Buruk($t) { Write-Host "  [!!]  $t" -ForegroundColor Red }
function Catat($t) { Write-Host "  [--]  $t" -ForegroundColor Yellow }

function Vercel { npx --yes vercel@latest @args }

Write-Host ""
Write-Host "  ===============================================" -ForegroundColor Cyan
Write-Host "   EAPEX -> Vercel" -ForegroundColor Cyan
Write-Host "  ===============================================" -ForegroundColor Cyan

# --- 1. sudah masuk Vercel? --------------------------------------------------
Judul "1. Memeriksa akun Vercel"

$siapa = (Vercel whoami 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $siapa -match 'not authenticated|Error') {
  Buruk "Belum masuk ke Vercel."
  Write-Host ""
  Write-Host "  Jalankan ini dulu, selesaikan di peramban yang terbuka:" -ForegroundColor Yellow
  Write-Host "    npx vercel login"
  Write-Host ""
  Write-Host "  Lalu jalankan skrip ini lagi."
  Write-Host ""
  exit 1
}
Baik "Masuk sebagai: $($siapa -split "`n" | Select-Object -Last 1)"

# --- 2. kumpulkan nilai ------------------------------------------------------
Judul "2. Mengumpulkan nilai konfigurasi"

# 2a. sandi basis data -> DATABASE_URL
$fSandi = 'data\sandi.txt'
if (-not (Test-Path $fSandi)) {
  Buruk "Berkas $fSandi belum ada."
  Write-Host "  Jalankan 'notepad data\sandi.txt', tempel sandi basis data"
  Write-Host "  Supabase (hanya sandinya), Ctrl+S, tutup, lalu ulangi skrip ini."
  Write-Host ""
  exit 1
}
$sandi = (Get-Content $fSandi -Raw); if ($null -eq $sandi) { $sandi = '' }; $sandi = $sandi.Trim()
if ($sandi.Length -eq 0)          { Buruk "$fSandi kosong."; exit 1 }
if ($sandi -match '^postgres')    { Buruk "$fSandi berisi alamat lengkap, bukan sandinya saja."; exit 1 }
if ($sandi -match '\s|\[|\]')     { Buruk "$fSandi mengandung spasi atau kurung siku."; exit 1 }

$server = "$Wilayah.pooler.supabase.com"
$dbUrl  = "postgresql://postgres.${Ref}:$([uri]::EscapeDataString($sandi))@${server}:${Port}/postgres"

# 2b. rahasia dari RAHASIA-DEPLOY.txt
$rahasia = @{}
$fRahasia = 'data\RAHASIA-DEPLOY.txt'
if (Test-Path $fRahasia) {
  foreach ($b in (Get-Content $fRahasia)) {
    if ($b -match '^([A-Z_]+)=(.+)$') { $rahasia[$Matches[1]] = $Matches[2].Trim() }
  }
}
foreach ($k in @('SESSION_SECRET','PENGINGAT_SECRET','ADMIN_PASSWORD')) {
  if (-not $rahasia.ContainsKey($k)) { Buruk "$k tidak ada di $fRahasia."; exit 1 }
}

# 2c. kunci VAPID dari .env (opsional)
$env_ = @{}
if (Test-Path '.env') {
  foreach ($b in (Get-Content '.env')) {
    if ($b -match '^([A-Z_]+)=(.*)$') { $env_[$Matches[1]] = $Matches[2].Trim() }
  }
}

$daftar = [ordered]@{
  'DATABASE_URL'      = $dbUrl
  'SESSION_SECRET'    = $rahasia['SESSION_SECRET']
  'PENGINGAT_SECRET'  = $rahasia['PENGINGAT_SECRET']
  'ADMIN_PASSWORD'    = $rahasia['ADMIN_PASSWORD']
  'ADMIN_EMAIL'       = 'admin@kla.co.id'
  'SIMPANAN'          = 'db'
  'DI_BELAKANG_PROXY' = '1'
}
foreach ($k in @('VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT')) {
  if ($env_.ContainsKey($k) -and $env_[$k]) { $daftar[$k] = $env_[$k] }
}

foreach ($k in $daftar.Keys) {
  $n = $daftar[$k].Length
  if ($k -in @('ADMIN_EMAIL','SIMPANAN','DI_BELAKANG_PROXY','VAPID_SUBJECT')) {
    Baik "$k = $($daftar[$k])"
  } else {
    Baik "$k = ($n huruf, tidak ditampilkan)"
  }
}

# --- 3. pautkan project ------------------------------------------------------
Judul "3. Menyiapkan project di Vercel"

if (Test-Path '.vercel\project.json') {
  Baik "Project sudah terpaut sebelumnya"
} else {
  Vercel link --yes --project $Nama | Out-Null
  if ($LASTEXITCODE -ne 0) { Buruk "Gagal memautkan project."; exit 1 }
  Baik "Project '$Nama' terpaut"
}

# --- 4. isi environment variables -------------------------------------------
Judul "4. Mengisi Environment Variables"

$lingkungan = @('production','preview','development')
foreach ($k in $daftar.Keys) {
  foreach ($ling in $lingkungan) {
    Vercel env rm $k $ling --yes 2>&1 | Out-Null   # buang yang lama kalau ada
    $daftar[$k] | Vercel env add $k $ling 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Buruk "Gagal memasang $k ($ling)."; exit 1 }
  }
  Baik "$k terpasang di production, preview, development"
}

# --- 5. sambungkan ke GitHub -------------------------------------------------
Judul "5. Menyambungkan ke GitHub"

Vercel git connect --yes 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
  Baik "Tersambung — setiap 'git push' akan menyebar sendiri"
} else {
  Catat "Belum tersambung otomatis. Bisa disetel belakangan lewat"
  Catat "Vercel > Settings > Git > Connect Git Repository."
}

# --- 6. sebarkan -------------------------------------------------------------
Judul "6. Menyebarkan (deploy)"

$hasil = (Vercel deploy --prod --yes 2>&1 | Out-String)
Write-Host ($hasil.TrimEnd())
if ($LASTEXITCODE -ne 0) { Buruk "Deploy gagal. Lihat pesan di atas."; exit 1 }

$alamat = $null
foreach ($m in [regex]::Matches($hasil, 'https://[a-zA-Z0-9\.\-]+\.vercel\.app')) { $alamat = $m.Value }
if (-not $alamat) { Buruk "Deploy selesai tapi alamatnya tidak terbaca."; exit 1 }
Baik "Alamat: $alamat"

# --- 7. ALAMAT_APLIKASI lalu sebarkan ulang ---------------------------------
Judul "7. Memasang ALAMAT_APLIKASI dan menyebarkan ulang"

# Dipasang setelah deploy pertama karena alamatnya baru diketahui di situ.
# Dipakai untuk tautan di dalam email dan notifikasi.
foreach ($ling in $lingkungan) {
  Vercel env rm ALAMAT_APLIKASI $ling --yes 2>&1 | Out-Null
  $alamat | Vercel env add ALAMAT_APLIKASI $ling 2>&1 | Out-Null
}
Baik "ALAMAT_APLIKASI = $alamat"

$hasil2 = (Vercel deploy --prod --yes 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) { Buruk "Deploy ulang gagal."; Write-Host $hasil2; exit 1 }
Baik "Deploy ulang selesai"

# --- 8. bersihkan ------------------------------------------------------------
Judul "8. Membersihkan"

if (Test-Path $fSandi) { Remove-Item $fSandi; Baik "$fSandi dihapus (memuat sandi)" }

Write-Host ""
Write-Host "  ===============================================" -ForegroundColor Green
Write-Host "   VERCEL SELESAI" -ForegroundColor Green
Write-Host "  ===============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Alamat aplikasi : $alamat"
Write-Host "  Masuk sebagai   : admin@kla.co.id"
Write-Host "  Sandinya ada di : data\AKUN-AWAL-SUPABASE.txt"
Write-Host ""
