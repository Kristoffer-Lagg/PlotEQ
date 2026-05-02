# PlotEQ — one-shot debug APK build script.
#
# What it does:
#   1. Sets JAVA_HOME / Path / ANDROID_HOME for this shell session.
#   2. Builds the web bundle (npm run build).
#   3. Syncs the bundle + plugins into android/ (npx cap sync android).
#   4. Builds the debug APK with Gradle.
#   5. Tells you where the APK landed.
#
# How to use:
#   Open PowerShell anywhere, then:
#     cd "C:\Users\loffi\Documents\Github Code\ploteq"
#     .\build-apk.ps1
#
#   Or double-click the file in Explorer (PowerShell may need to be
#   allowed to run scripts — see the bottom of this file if so).

$ErrorActionPreference = 'Stop'

# Resolve the repo root from this script's own location, so the script
# works regardless of where PowerShell happens to be when it runs.
$Repo    = Split-Path -Parent $MyInvocation.MyCommand.Path
$Android = Join-Path $Repo 'android'
$ApkOut  = Join-Path $Android 'app\build\outputs\apk\debug\app-debug.apk'

Write-Host ''
Write-Host '=== PlotEQ debug APK build ===' -ForegroundColor Cyan
Write-Host "Repo: $Repo"
Write-Host ''

# --- 1. Environment ---------------------------------------------------------
$env:JAVA_HOME    = 'C:\jbr'
$env:Path         = "$env:JAVA_HOME\bin;$env:Path"
$env:ANDROID_HOME = 'C:\Users\loffi\.bubblewrap\android_sdk'

if (-not (Test-Path $env:JAVA_HOME)) {
    Write-Host "JAVA_HOME not found at $env:JAVA_HOME" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $env:ANDROID_HOME)) {
    Write-Host "ANDROID_HOME not found at $env:ANDROID_HOME" -ForegroundColor Red
    exit 1
}

# --- 2. Web bundle ----------------------------------------------------------
Write-Host '[1/3] Building web bundle (npm run build)...' -ForegroundColor Yellow
Push-Location $Repo
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; exit $LASTEXITCODE }

# --- 3. Capacitor sync ------------------------------------------------------
Write-Host ''
Write-Host '[2/3] Syncing into android/ (npx cap sync android)...' -ForegroundColor Yellow
npx cap sync android
if ($LASTEXITCODE -ne 0) { Pop-Location; exit $LASTEXITCODE }
Pop-Location

# --- 4. Gradle assembleDebug -----------------------------------------------
Write-Host ''
Write-Host '[3/3] Building debug APK (gradlew assembleDebug)...' -ForegroundColor Yellow
Push-Location $Android
.\gradlew.bat assembleDebug
$gradleExit = $LASTEXITCODE
Pop-Location

if ($gradleExit -ne 0) { exit $gradleExit }

# --- 5. Report --------------------------------------------------------------
Write-Host ''
if (Test-Path $ApkOut) {
    Write-Host '=== BUILD SUCCESSFUL ===' -ForegroundColor Green
    Write-Host "APK: $ApkOut" -ForegroundColor Green
    Write-Host ''
    Write-Host 'Tip: copy this to Drive / your phone, uninstall the old PlotEQ first, then install.'
} else {
    Write-Host 'Gradle reported success but the APK is not where expected.' -ForegroundColor Red
    Write-Host "Looked at: $ApkOut" -ForegroundColor Red
    exit 1
}

# -- If running this complains about "scripts disabled on this system" --
# Open PowerShell *as your user* (not admin) and run once:
#     Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
# Confirm with Y. This permits LOCAL scripts (this one) but still blocks
# unsigned scripts from the internet — a sensible default for development.
