# VAKIFNAME yerel geliştirme backend'i (API v5) — kalıcı hesap ve ilerleme veritabanlarıyla.
#
# Kullanım (backend klasöründe):  .\scripts\start_backend_dev.ps1
#
# - Hesaplar ve oturumlar:  %LOCALAPPDATA%\vakifname\data\accounts.sqlite3
#   Oyun ilerlemesi:         %LOCALAPPDATA%\vakifname\data\progress.sqlite3
#   Dosyalar yoksa uygulama kendi başlatma mekanizmasıyla oluşturur; varsa olduğu gibi açar (silmez, sıfırlamaz).
# - Veri klasörü yalnızca bu Windows hesabına ve SYSTEM'e açıktır (kalıtım kapalı; içindeki dosyalar aynı izni alır).
# - Geliştirme ayarları (Evren + Gemma rehber, OpenRouter görsel sağlayıcı, yüz denetimi modelleri, geliştirme kataloğu)
#   önceki başlatmalarla aynıdır. Anahtarlar dosyalardan okunur; bu betik hiçbir anahtarı veya parolayı yazdırmaz.
# - Bu iki yol verilmezse hesaplar bellekte tutulur ve her yeniden başlatmada silinir (R6.4.2).

# -ContentDir (R6.17, isteğe bağlı): içerik deposu klasörü (VAKIFNAME_CONTENT_DIR). Yalnızca yerel deneme içindir
#   (ör. %LOCALAPPDATA%\vakifname\content_r617_localtest: "yerel-test" onaylı İngilizce taslaklar); verilmezse depo kapalıdır.
param([string]$ContentDir = '')

$ErrorActionPreference = 'Stop'
$backend = Split-Path -Parent $PSScriptRoot
Set-Location $backend

$data = Join-Path $env:LOCALAPPDATA 'vakifname\data'
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$system = 'S-1-5-18'
New-Item -ItemType Directory -Force $data | Out-Null   # klasör varsa içine dokunmaz
& icacls $data /inheritance:r /grant:r "*${sid}:(OI)(CI)(F)" "*${system}:(OI)(CI)(F)" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Veri klasörünün izinleri ayarlanamadı: $data" }

$env:VAKIFNAME_ACCOUNTS_DB = Join-Path $data 'accounts.sqlite3'
$env:VAKIFNAME_PROGRESS_DB = Join-Path $data 'progress.sqlite3'

# Geliştirme ayarları (önceki başlatmalarla aynı).
$env:VAKIFNAME_PUBLIC_CATALOG_FILE = Join-Path $backend 'tests\ask_eval\catalog_snapshot.json'
$env:VAKIFNAME_GUIDE_MODE = 'on'
$env:VAKIFNAME_GUIDE_PROVIDER = 'evren'
$env:VAKIFNAME_GUIDE_MODEL = 'gemma-4-31b'
$env:VAKIFNAME_GUIDE_FALLBACK = 'none'
$env:VAKIFNAME_GUIDE_BUDGET_DB = ':memory:'
$env:VAKIFNAME_GUIDE_LEXICON = 'off'
$env:VAKIFNAME_VISIT_SIMULATION = 'off'
$env:VAKIFNAME_MAIL_BACKEND = 'off'
$env:VAKIFNAME_GUIDE_VISION_PROVIDER = 'openrouter'
$env:VAKIFNAME_GUIDE_FACE_MODEL_DIR = Join-Path $env:LOCALAPPDATA 'vakifname\models\face'
# R6.12: OpenRouter görsel modelinin (fotoğraf analizi) anahtar DOSYASI. Windows'ta varsayılan yol (/etc/...) olmadığından
# açıkça verilir; verilmezse rehber fotoğraf seçeneğini kapatır (photo=false). Betik anahtarı okumaz ve yazdırmaz.
$env:VAKIFNAME_OPENROUTER_KEY_FILE = Join-Path $env:LOCALAPPDATA 'vakifname\secrets\openrouter_api_key'
# R6.15.2: yayın izni bekleyen envanter fotoğrafları — YALNIZCA bu bilgisayardaki yerel önizleme (loopback, vekilsiz).
# Klasör proje dışında ve kullanıcıya özeldir; canlı sunucuda bu değişken tanımlanmaz.
$preview = Join-Path $env:LOCALAPPDATA 'vakifname\local_preview_photos'
if (Test-Path (Join-Path $preview 'manifest.json')) { $env:VAKIFNAME_LOCAL_PREVIEW_PHOTOS_DIR = $preview }
if ($ContentDir) {
  $env:VAKIFNAME_CONTENT_DIR = $ContentDir
  Write-Host "İçerik deposu (yerel deneme): $ContentDir"
}

Write-Host "Hesap veritabanı:     $env:VAKIFNAME_ACCOUNTS_DB (var: $(Test-Path $env:VAKIFNAME_ACCOUNTS_DB))"
Write-Host "İlerleme veritabanı:  $env:VAKIFNAME_PROGRESS_DB (var: $(Test-Path $env:VAKIFNAME_PROGRESS_DB))"
Write-Host 'Backend: http://127.0.0.1:8000  (durdurmak için Ctrl+C)'
& (Join-Path $backend '.venv\Scripts\python.exe') -m uvicorn app.main:app --host 127.0.0.1 --port 8000
