# ============================================================================
#  Memasang kunci OpenAI untuk fitur "Isi dengan AI"
# ============================================================================
#  Yang perlu disiapkan: berkas data\openai.txt berisi KUNCI API saja,
#  satu baris, diawali 'sk-'.
#
#  Kuncinya diuji dulu ke OpenAI sebelum dipasang. Tanpa itu, kunci yang salah
#  baru ketahuan saat ada orang menekan tombolnya - dan yang dia lihat cuma
#  pesan gagal tanpa sebab.
#
#  Kunci tidak pernah ditampilkan di layar, hanya panjang dan empat huruf
#  terakhirnya.
#
#  Jalankan:  powershell -ExecutionPolicy Bypass -File scripts\pasang-openai.ps1
#             powershell ... -File scripts\pasang-openai.ps1 -Lokal   (untuk .env saja)
# ============================================================================

param(
  [string]$Model = 'gpt-4o-mini',
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

# Nilai TIDAK BOLEH dipipa langsung: PowerShell 5.1 menyisipkan BOM UTF-8 di
# depan setiap nilai yang dialirkan ke program luar, dan Vercel menyimpannya
# apa adanya sehingga kuncinya jadi tidak sah tanpa gejala yang jelas.
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
Write-Host "   EAPEX -> OpenAI (baca penawaran otomatis)" -ForegroundColor Cyan
Write-Host "  ===============================================" -ForegroundColor Cyan

# --- 1. baca kunci -----------------------------------------------------------
Judul "1. Membaca kunci"

$f = 'data\openai.txt'
if (-not (Test-Path $f)) {
  Buruk "Berkas $f belum ada."
  Write-Host ""
  Write-Host "  Cara menyiapkannya:" -ForegroundColor Yellow
  Write-Host "    1. Buka https://platform.openai.com/api-keys"
  Write-Host "    2. Create new secret key - salin kuncinya (hanya tampil sekali)"
  Write-Host "    3. Jalankan:  notepad data\openai.txt"
  Write-Host "    4. Tempel kuncinya saja, satu baris, Ctrl+S, tutup"
  Write-Host "    5. Jalankan skrip ini lagi"
  Write-Host ""
  Write-Host "  Pastikan akun OpenAI-nya sudah punya saldo. Kunci pada akun" -ForegroundColor Yellow
  Write-Host "  tanpa saldo tetap sah tapi setiap permintaan ditolak." -ForegroundColor Yellow
  Write-Host ""
  exit 1
}

$kunci = (Get-Content $f -Raw); if ($null -eq $kunci) { $kunci = '' }
$kunci = $kunci.Trim([char]0xFEFF).Trim()

if ($kunci.Length -eq 0)      { Buruk "$f kosong."; exit 1 }
if ($kunci -notmatch '^sk-')  { Buruk "Isi $f tidak diawali 'sk-'. Itu bukan kunci API OpenAI."; exit 1 }
if ($kunci -match '\s')       { Buruk "Kunci mengandung spasi - ada yang ikut tersalin."; exit 1 }

$ekor = $kunci.Substring($kunci.Length - 4)
Baik "Kunci terbaca: $($kunci.Length) huruf, berakhiran ...$ekor"

# --- 2. uji ke OpenAI --------------------------------------------------------
Judul "2. Menguji kunci ke OpenAI"

try {
  $r = Invoke-WebRequest -Uri 'https://api.openai.com/v1/models' -Headers @{ Authorization = "Bearer $kunci" } -TimeoutSec 45 -ErrorAction Stop
  $daftar = ($r.Content | ConvertFrom-Json).data
  Baik "Kunci diterima. $($daftar.Count) model tersedia."

  if ($daftar.id -contains $Model) {
    Baik "Model '$Model' tersedia untuk akun ini"
  } else {
    Catat "Model '$Model' TIDAK ada di daftar akun ini."
    Catat "Fiturnya tetap dipasang, tapi tombolnya akan gagal saat dipakai."
    Catat "Ganti dengan -Model <nama-model-yang-ada>."
  }
} catch {
  $kode = $_.Exception.Response.StatusCode.value__
  Buruk "Kunci DITOLAK OpenAI (status $kode)."
  if ($kode -eq 401) { Write-Host "  Kuncinya salah, sudah dicabut, atau tersalin sebagian." -ForegroundColor Yellow }
  if ($kode -eq 429) { Write-Host "  Kuncinya sah tapi akunnya tanpa saldo / melewati batas." -ForegroundColor Yellow }
  Write-Host ""
  Write-Host "  Tidak ada yang dipasang. Perbaiki $f lalu ulangi." -ForegroundColor Yellow
  Write-Host ""
  exit 1
}

# --- 3. pasang ---------------------------------------------------------------
if ($Lokal) {
  Judul "3. Memasang ke .env lokal"

  $baris = @()
  if (Test-Path '.env') {
    $baris = @(Get-Content '.env' | Where-Object { $_ -notmatch '^(OPENAI_API_KEY|OPENAI_MODEL)=' })
  }
  $baris += "OPENAI_API_KEY=$kunci"
  $baris += "OPENAI_MODEL=$Model"
  [System.IO.File]::WriteAllLines((Resolve-Path '.env'), $baris, (New-Object System.Text.UTF8Encoding($false)))
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
    foreach ($pasangan in @(@('OPENAI_API_KEY', $kunci), @('OPENAI_MODEL', $Model))) {
      $kode = PasangEnv $pasangan[0] $pasangan[1] $ling
      if ($kode -ne 0) { Buruk "Gagal memasang $($pasangan[0]) ($ling)."; exit 1 }
    }
  }
  Baik "OPENAI_API_KEY dan OPENAI_MODEL terpasang di tiga lingkungan"

  Judul "4. Menyebarkan ulang"
  Catat "Perubahan env tidak berlaku sampai disebarkan ulang."
  $hasil = Vercel @('deploy','--prod','--yes')
  if ($KodeVercel -ne 0) {
    Buruk "Deploy gagal."
    Write-Host $hasil
    exit 1
  }
  $alias = [regex]::Match($hasil, 'Aliased\s+(https://[a-zA-Z0-9\.\-]+\.vercel\.app)')
  Baik ("Tersebar" + $(if ($alias.Success) { ": " + $alias.Groups[1].Value } else { "" }))
}

# --- 5. bersihkan ------------------------------------------------------------
Judul "5. Membersihkan"
Remove-Item $f -Force
Baik "$f dihapus (memuat kunci)"

Write-Host ""
Write-Host "  ===============================================" -ForegroundColor Green
Write-Host "   SELESAI - tombol 'Isi dengan AI' aktif" -ForegroundColor Green
Write-Host "  ===============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  SADARI: sejak sekarang, menekan tombol itu MENGIRIM isi berkas"
Write-Host "  penawaran ke OpenAI - termasuk harga dari vendor. Untuk"
Write-Host "  mematikannya kembali:"
Write-Host "    npx vercel env rm OPENAI_API_KEY production --yes"
Write-Host "    npx vercel deploy --prod --yes"
Write-Host ""
