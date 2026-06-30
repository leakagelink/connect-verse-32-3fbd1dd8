param(
  [switch]$OpenAndroidStudio,
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"

function Write-Step($Message) {
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Use-AndroidStudioJdkIfNeeded {
  $javaExe = $null
  if ($env:JAVA_HOME) {
    $candidate = Join-Path $env:JAVA_HOME "bin\java.exe"
    if (Test-Path $candidate) { $javaExe = $candidate }
  }

  if ($javaExe) {
    Write-Host "JAVA_HOME OK: $env:JAVA_HOME"
    return
  }

  $knownJdks = @(
    "$env:ProgramFiles\Android\Android Studio\jbr",
    "$env:ProgramFiles\Android\Android Studio\jre",
    "$env:ProgramFiles\Eclipse Adoptium\jdk-21.0.5.11-hotspot",
    "$env:ProgramFiles\Eclipse Adoptium\jdk-21.0.4.7-hotspot",
    "$env:ProgramFiles\Eclipse Adoptium\jdk-17.0.13.11-hotspot",
    "$env:ProgramFiles\Java\jdk-21",
    "$env:ProgramFiles\Java\jdk-17"
  )

  foreach ($jdk in $knownJdks) {
    if ($jdk -and (Test-Path (Join-Path $jdk "bin\java.exe"))) {
      $env:JAVA_HOME = $jdk
      $env:Path = "$env:JAVA_HOME\bin;$env:Path"
      Write-Host "Using JAVA_HOME: $env:JAVA_HOME" -ForegroundColor Green
      return
    }
  }

  throw "JAVA_HOME invalid hai. Android Studio install karo ya JAVA_HOME ko Android Studio ke bundled JDK par set karo, e.g. C:\Program Files\Android\Android Studio\jbr"
}

function Require-Command($Name, $InstallHint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name command nahi mila. $InstallHint"
  }
}

function Require-File($Path, $Message) {
  if (-not (Test-Path $Path)) { throw $Message }
}

Write-Step "Toolchain check"
Use-AndroidStudioJdkIfNeeded
Require-Command "git" "Git for Windows install karo."
Require-Command "bun" "PowerShell me: powershell -c \"irm bun.sh/install.ps1 | iex\""

if (-not $env:ANDROID_HOME) {
  $defaultSdk = "$env:LOCALAPPDATA\Android\Sdk"
  if (Test-Path $defaultSdk) {
    $env:ANDROID_HOME = $defaultSdk
    Write-Host "Using ANDROID_HOME: $env:ANDROID_HOME" -ForegroundColor Green
  } else {
    Write-Warning "ANDROID_HOME set nahi hai. Android Studio > SDK Manager me Android SDK install karke ANDROID_HOME set karo."
  }
}

Write-Step "Project files verify"
Require-File "package.json" "Is script ko project root folder se run karo."
Require-File "capacitor.config.ts" "capacitor.config.ts missing hai. Latest project clone/pull karo."
Require-File "android\app\src\main\java\in\talkora\app\CallPermissionsPlugin.java" "CallPermissionsPlugin.java missing hai. Aapne android folder regenerate/delete kiya hai; fresh repo clone karo."
Require-File "android\app\src\main\java\in\talkora\app\MainActivity.java" "MainActivity.java missing hai. Fresh repo clone karo."
Require-File "android\app\src\main\AndroidManifest.xml" "AndroidManifest.xml missing hai. Fresh repo clone karo."

$manifest = Get-Content "android\app\src\main\AndroidManifest.xml" -Raw
foreach ($perm in @("android.permission.RECORD_AUDIO", "android.permission.CAMERA", "android.permission.POST_NOTIFICATIONS", "android.permission.INTERNET")) {
  if ($manifest -notmatch [regex]::Escape($perm)) { throw "AndroidManifest.xml me $perm missing hai." }
}

Write-Step "Install packages"
if (-not $SkipInstall) { bun install }

Write-Step "Web build"
bun run build

Write-Step "Capacitor sync"
New-Item -ItemType Directory -Force -Path "android\app\src\main\assets" | Out-Null
bunx cap sync android

Write-Step "Generated config verify"
Require-File "android\app\src\main\assets\capacitor.config.json" "capacitor.config.json generate nahi hua. bunx cap sync android dobara run karo."
$capConfig = Get-Content "android\app\src\main\assets\capacitor.config.json" -Raw
if ($capConfig -notmatch "https://talkoraapp\.com") {
  throw "Android capacitor.config.json me https://talkoraapp.com missing hai. Aap old code build kar rahe ho ya capacitor.config.ts update nahi hua. Latest Lovable/GitHub code lo, phir bunx cap sync android run karo."
}
if ($capConfig -notmatch "talkoraapp\.com") {
  throw "Android allowNavigation me talkoraapp.com missing hai. Iske bina app custom domain ko external browser me khol degi."
}
Write-Host "Verified Android WebView URL: https://talkoraapp.com" -ForegroundColor Green

Write-Step "Gradle clean + debug APK build"
Push-Location android
try {
  .\gradlew clean
  .\gradlew assembleDebug
} finally {
  Pop-Location
}

Write-Step "Success"
Write-Host "Debug APK ready: android\app\build\outputs\apk\debug\app-debug.apk" -ForegroundColor Green
Write-Host "Agar phone me pehle wali app installed thi: adb uninstall in.talkora.app; phir ye naya APK install karo." -ForegroundColor Yellow
Write-Host "Mic/camera permission install ke time nahi, call screen par 'Allow access' tap karne ke baad aayegi." -ForegroundColor Yellow

if ($OpenAndroidStudio) {
  Write-Step "Opening Android Studio"
  bunx cap open android
}