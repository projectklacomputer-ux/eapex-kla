# ============================================================================
#  Memasang notifikasi EMAIL
# ============================================================================
#  Notifikasi HP hanya sampai kalau orangnya memasang aplikasi ke layar utama
#  DAN mengizinkan notifikasi. Yang tidak melakukannya tidak diberi tahu apa
#  pun - dia harus ingat sendiri membuka aplikasi. Di sistem persetujuan,
#  begitulah dokumen mati: bukan ditolak, tapi dilupakan. Email tidak menuntut
#  apa-apa dari penerimanya.
#
#  Yang perlu disiapkan: berkas data\email.txt berisi EMPAT baris -
#
#      smtp.gmail.com
#      587
#      alamat@kla.co.id
#      xxxx xxxx xxxx xxxx
#
#  Baris 1 server, 2 port, 3 alamat pengirim, 4 App Password.
#
#  GMAIL WAJIB App Password, BUKAN sandi akun biasa:
#    Akun Google > Security > 2-Step Verification > App passwords
#    (2-Step Verification harus menyala dulu)
#
#  Sandi diuji dengan MENGIRIM email sungguhan sebelum dipasang. Tanpa itu,
#  setelan yang salah baru ketahuan saat ada approval yang tidak sampai - dan
#  tidak ada yang menyadarinya karena kegagalan email sengaja tidak menahan
#  approval.
#
#  Jalankan:  powershell -ExecutionPolicy Bypass -File scripts\pasang-email.ps1 -KirimUjiKe alamat@anda.com
# ============================================================================

param(
  [string]$KirimUjiKe = '',
  [switch]$Lokal
)

$ErrorActionPreference = 'Continue'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Judul($t) { Write-Host ""; Write-Host "  $t" -ForegroundColor Cyan }
function Baik($t)  { Write-Host "  [OK]  $t" -ForegroundColor Green }
function Buruk($t) { Write-Host "  [!!]  $t" -ForegroundColor Red }
function Catat($t) { Write-Host "  [--]  $t" -ForegroundColor Yellow }

function Vercel([string[]]$A) {
  $keluar = & npx --yes vercel@latest @A 2>&1 | Out-String
  $global:KodeVercel = $LASTEXITCODE
  return $keluar
}

# Nilai TIDAK dipipa langsung: PowerShell 5.1 menyisipkan BOM di depan setiap
# nilai yang dialirkan ke program luar, dan Vercel menyimpannya apa adanya.
function PasangEnv($nama, $nilai, $ling) {
  $tmp = [System.IO.Path]::GetTempFileName()
  try {
    [System.IO.File]::WriteAllText($tmp, $nilai, (New-Object System.Text.UTF8Encoding($false)))
    $null = Vercel @('env','rm',$nama,$ling,'--yes')
    $null = cmd /c "type `"$tmp`" | npx --yes vercel@latest env add $nama $ling" 2>&1
    return $LASTEXITCODE
  } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}

Write-Host ""
Write-Host "  ===============================================" -ForegroundColor Cyan
Write-Host "   EAPEX -> Notifikasi Email" -ForegroundColor Cyan
Write-Host "  ===============================================" -ForegroundColor Cyan

# --- 1. baca setelan ---------------------------------------------------------
Judul "1. Membaca setelan"

$f = 'data\email.txt'
if (-not (Test-Path $f)) {
  Buruk "Berkas $f belum ada."
  Write-Host ""
  Write-Host "  Isi EMPAT baris, satu nilai per baris:" -ForegroundColor Yellow
  Write-Host "    smtp.gmail.com"
  Write-Host "    587"
  Write-Host "    alamat-pengirim@kla.co.id"
  Write-Host "    App Password 16 huruf"
  Write-Host ""
  Write-Host "  Gmail WAJIB App Password, bukan sandi akun biasa:" -ForegroundColor Yellow
  Write-Host "    Akun Google > Security > 2-Step Verification > App passwords"
  Write-Host ""
  Write-Host "  Jalankan:  notepad data\email.txt"
  Write-Host ""
  exit 1
}

$baris = @(Get-Content $f | ForEach-Object { $_.Trim([char]0xFEFF).Trim() } | Where-Object { $_ -ne '' })
if ($baris.Count -lt 4) {
  Buruk "Berkas $f perlu 4 baris terisi, yang ada $($baris.Count)."
  exit 1
}
$smtpHost = $baris[0]; $port = $baris[1]; $pengirim = $baris[2]; $sandi = $baris[3]

if ($smtpHost -notmatch '^[a-z0-9.\-]+$') { Buruk "Baris 1 bukan nama server yang sah: $smtpHost"; exit 1 }
if ($port -notmatch '^\d+$')              { Buruk "Baris 2 bukan angka port: $port"; exit 1 }
if ($pengirim -notmatch '^\S+@\S+\.\S+$') { Buruk "Baris 3 bukan alamat email: $pengirim"; exit 1 }
if ($sandi.Length -lt 8)                  { Buruk "Baris 4 terlalu pendek untuk App Password."; exit 1 }

Baik "server   : $smtpHost"
Baik "port     : $port"
Baik "pengirim : $pengirim"
Baik "sandi    : $($sandi.Length) huruf, tidak ditampilkan"

# --- 2. uji kirim sungguhan --------------------------------------------------
Judul "2. Menguji dengan MENGIRIM email sungguhan"

if (-not $KirimUjiKe) {
  Buruk "Alamat tujuan uji belum disebut."
  Write-Host "  Ulangi dengan:  -KirimUjiKe alamat@anda.com" -ForegroundColor Yellow
  Write-Host "  Tanpa uji kirim, setelan yang salah baru ketahuan saat ada"
  Write-Host "  approval yang tidak sampai - dan tidak ada yang menyadarinya."
  Write-Host ""
  exit 1
}

$skrip = @'
const nodemailer = require('nodemailer');
const [host, port, pengirim, sandi, tujuan] = process.argv.slice(2);
const t = nodemailer.createTransport({
  host, port: Number(port), secure: Number(port) === 465,
  auth: { user: pengirim, pass: sandi },
});
t.verify()
  .then(() => t.sendMail({
    from: `EAPEX <${pengirim}>`,
    to: tujuan,
    subject: 'Uji notifikasi EAPEX',
    text: 'Kalau email ini sampai, notifikasi EAPEX sudah bisa dinyalakan.\n\nPT KLA Teknologi Indonesia',
  }))
  .then(i => { console.log('TERKIRIM ' + i.messageId); process.exit(0); })
  .catch(e => { console.error('GAGAL ' + e.message); process.exit(1); });
'@
$tmpJs = [System.IO.Path]::GetTempFileName() + '.js'
[System.IO.File]::WriteAllText($tmpJs, $skrip, (New-Object System.Text.UTF8Encoding($false)))

$hasil = & node $tmpJs $smtpHost $port $pengirim $sandi $KirimUjiKe 2>&1 | Out-String
Remove-Item $tmpJs -Force -ErrorAction SilentlyContinue

if ($hasil -match 'TERKIRIM') {
  Baik "Email uji terkirim ke $KirimUjiKe"
  Catat "PERIKSA KOTAK MASUKNYA sekarang - termasuk folder Spam."
} else {
  Buruk "Gagal mengirim."
  Write-Host "  $($hasil.Trim())" -ForegroundColor Yellow
  Write-Host ""
  if ($hasil -match 'Invalid login|535') {
    Write-Host "  Sandi ditolak. Untuk Gmail, sandi akun biasa TIDAK bisa dipakai -" -ForegroundColor Yellow
    Write-Host "  wajib App Password, dan 2-Step Verification harus menyala." -ForegroundColor Yellow
  }
  if ($hasil -match 'ETIMEDOUT|ECONNREFUSED') {
    Write-Host "  Server atau port tidak bisa dijangkau. Coba 587, atau 465 kalau memakai SSL." -ForegroundColor Yellow
  }
  Write-Host ""
  Write-Host "  Tidak ada yang dipasang. Perbaiki $f lalu ulangi." -ForegroundColor Yellow
  Write-Host ""
  exit 1
}

# --- 3. pasang ---------------------------------------------------------------
$nilai = [ordered]@{
  SMTP_HOST   = $smtpHost
  SMTP_PORT   = $port
  SMTP_SECURE = $(if ([int]$port -eq 465) { '1' } else { '0' })
  SMTP_USER   = $pengirim
  SMTP_PASS   = $sandi
  SMTP_FROM   = "EAPEX <$pengirim>"
}

if ($Lokal) {
  Judul "3. Memasang ke .env lokal"
  $isi = @()
  if (Test-Path '.env') {
    $isi = @(Get-Content '.env' | Where-Object { $_ -notmatch '^SMTP_' })
  }
  foreach ($k in $nilai.Keys) { $isi += "$k=$($nilai[$k])" }
  [System.IO.File]::WriteAllLines((Resolve-Path '.env'), $isi, (New-Object System.Text.UTF8Encoding($false)))
  Baik ".env diperbarui - berlaku setelah server lokal dijalankan ulang"
} else {
  Judul "3. Memasang ke Vercel"
  $siapa = @(($(Vercel @('whoami')) -split "`n") | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^[A-Za-z0-9][\w\-]*$' })
  if ($KodeVercel -ne 0 -or -not $siapa.Count) {
    Buruk "Belum masuk ke Vercel. Jalankan 'npx vercel login' dulu."
    exit 1
  }
  Baik "Masuk sebagai: $($siapa[-1])"

  foreach ($ling in @('production','preview','development')) {
    foreach ($k in $nilai.Keys) {
      $kode = PasangEnv $k $nilai[$k] $ling
      if ($kode -ne 0) { Buruk "Gagal memasang $k ($ling)."; exit 1 }
    }
  }
  Baik "6 setelan SMTP terpasang di tiga lingkungan"

  Judul "4. Menyebarkan ulang"
  Catat "Perubahan env tidak berlaku sampai disebarkan ulang."
  $hasilDeploy = Vercel @('deploy','--prod','--yes')
  if ($KodeVercel -ne 0) { Buruk "Deploy gagal."; Write-Host $hasilDeploy; exit 1 }
  $alias = [regex]::Match($hasilDeploy, 'Aliased\s+(https://[a-zA-Z0-9\.\-]+\.vercel\.app)')
  Baik ("Tersebar" + $(if ($alias.Success) { ": " + $alias.Groups[1].Value } else { "" }))
}

Judul "5. Membersihkan"
Remove-Item $f -Force
Baik "$f dihapus (memuat sandi)"

Write-Host ""
Write-Host "  ===============================================" -ForegroundColor Green
Write-Host "   EMAIL AKTIF" -ForegroundColor Green
Write-Host "  ===============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  MASIH ADA SATU LANGKAH: alamat tujuan tiap orang belum diisi."
Write-Host "  Admin > Email Notifikasi - isi alamat 27 orang di situ."
Write-Host "  Yang alamatnya kosong tetap tidak menerima email."
Write-Host ""
