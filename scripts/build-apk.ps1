# Kullanım: powershell -ExecutionPolicy Bypass -File scripts\build-apk.ps1 [-ServerUrl https://drive.alanadiniz.com]
# ServerUrl verilmezse uygulama ilk girişte sunucu adresini sorar (masaüstü kurulumuna eklenen APK budur).
param([string]$ServerUrl = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

# Capacitor 6 (Gradle 8.2) JDK 17 ister; Android Studio'nun yeni jbr'si (JDK 25) çalışmaz
if (-not $env:JAVA_HOME) {
  $jdk = Get-ChildItem "$env:USERPROFILE\.jdks" -Directory -ErrorAction SilentlyContinue | Where-Object Name -match '17' | Select-Object -First 1
  if (-not $jdk) { throw "JDK 17 bulunamadı. Android Studio > Settings > Build Tools > Gradle > Gradle JDK > Download JDK (17) ile indirin veya JAVA_HOME ayarlayın." }
  $env:JAVA_HOME = $jdk.FullName
}
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk" }

Push-Location $root
try {
  if ($ServerUrl) { $env:VITE_API_BASE = $ServerUrl.TrimEnd('/') }
  npm.cmd run build:web; if ($LASTEXITCODE) { throw 'web build hatası' }
  Push-Location apps\mobile
  npx.cmd cap sync android; if ($LASTEXITCODE) { throw 'cap sync hatası' }
  Push-Location android
  .\gradlew.bat assembleDebug; if ($LASTEXITCODE) { throw 'gradle hatası' }
  Pop-Location; Pop-Location
  Copy-Item apps\mobile\android\app\build\outputs\apk\debug\app-debug.apk "$root\NukeDrive.apk" -Force
  Write-Host "APK hazır: $root\NukeDrive.apk"
} finally {
  # Sunucunun servis ettiği web sürümünü aynı-origin moduna geri döndür
  if ($ServerUrl) {
    Remove-Item Env:VITE_API_BASE -ErrorAction SilentlyContinue
    npm.cmd run build:web | Out-Null
  }
  Pop-Location
}
