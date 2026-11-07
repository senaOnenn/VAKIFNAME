<#
.SYNOPSIS
  OpenRouter API anahtarını Windows'ta güvenli dosyaya kaydeder (install_openrouter_key.sh'nin Windows karşılığı).

.DESCRIPTION
  - Yalnızca etkileşimli bir PowerShell penceresinde çalışır; aktarılan (pipe) girdiyi reddeder.
  - Anahtar gizli giriş alanından okunur (ekranda görünmez), biçimi denetlenir (sk-or-...).
  - Dosya: %LOCALAPPDATA%\vakifname\secrets\openrouter_api_key
  - İzinler anahtar yazılmadan ÖNCE daraltılır: devralma kapalı; yalnızca geçerli kullanıcı ve SYSTEM.
    Bu, backend/app/guide/secret_win.py denetimiyle uyumludur (Everyone/Users okuma izni olan dosya reddedilir).
  - Anahtar geçici dosyaya yazılır, sonra atomik olarak yerine taşınır; ekrana, günlüğe veya ortam değişkenine yazılmaz.
  - Sonunda yalnızca "Kaydedildi." yazar. Durum denetimi: scripts\secret_status.py openrouter

.EXAMPLE
  cd backend
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install_openrouter_key.ps1
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'

if ([Console]::IsInputRedirected -or -not [Environment]::UserInteractive) {
    throw 'Bu betiği kendi PowerShell pencerenizde etkileşimli olarak çalıştırın; aktarılan girdi kabul edilmez.'
}

$dir  = Join-Path $env:LOCALAPPDATA 'vakifname\secrets'
$file = Join-Path $dir 'openrouter_api_key'
$tmp  = "$file.tmp"
$sid  = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$system = 'S-1-5-18'

function Restrict([string]$path, [bool]$container) {
    $inherit = if ($container) { '(OI)(CI)' } else { '' }
    & icacls $path /inheritance:r /grant:r "*${sid}:${inherit}(F)" "*${system}:${inherit}(F)" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "İzinler ayarlanamadı: $path" }
}

New-Item -ItemType Directory -Force $dir | Out-Null
Restrict $dir $true

$secure = Read-Host 'OpenRouter API anahtarı (ekranda görünmez)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$key = $null
try {
    $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    $secure.Dispose()
}

try {
    if ($key -notmatch '^sk-or-[A-Za-z0-9_-]{20,200}$') {
        throw 'Anahtar biçimi beklenen gibi değil (sk-or-… ile başlamalı, boşluk içermemeli). Hiçbir şey yazılmadı.'
    }
    # Önce boş dosya + daraltılmış izin, sonra içerik: anahtar hiçbir an geniş izinli bir dosyada durmaz.
    [IO.File]::WriteAllText($tmp, '')
    Restrict $tmp $false
    [IO.File]::WriteAllText($tmp, $key, (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $tmp -Destination $file -Force
    Restrict $file $false
} catch {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
    throw
} finally {
    $key = $null
    Remove-Variable key -ErrorAction SilentlyContinue
    [GC]::Collect()
}
'Kaydedildi.'
