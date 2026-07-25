# Tavari Music Desktop - Self-Extracting Installer Script
# This creates a PowerShell-based installer that extracts and installs the app

param(
    [string]$ZipPath = ".\public\installers\tavari-music-desktop-portable.zip",
    [string]$OutputPath = ".\public\installers\tavari-music-desktop-installer.ps1"
)

$installDir = "${env:ProgramFiles}\Tavari Music Desktop"
$desktop = "$env:USERPROFILE\Desktop"
$startMenu = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"

Write-Host "Creating self-extracting installer..."
Write-Host "Source ZIP: $ZipPath"
Write-Host "Output: $OutputPath"
Write-Host ""

# Read the ZIP file as base64
if (-not (Test-Path $ZipPath)) {
    Write-Host "ERROR: ZIP file not found at: $ZipPath" -ForegroundColor Red
    exit 1
}

$zipBytes = [System.IO.File]::ReadAllBytes((Resolve-Path $ZipPath))
$zipBase64 = [Convert]::ToBase64String($zipBytes)

# Create the installer script
$installerScript = @"
# Tavari Music Desktop - Self-Extracting Installer
# Generated installer script

`$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Tavari Music Desktop - Installer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

`$installDir = "${env:ProgramFiles}\Tavari Music Desktop"
`$desktop = "$env:USERPROFILE\Desktop"
`$startMenu = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"

# Check for admin rights
`$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not `$isAdmin) {
    Write-Host "ERROR: Administrator rights required!" -ForegroundColor Red
    Write-Host "Please right-click and select 'Run as Administrator'" -ForegroundColor Yellow
    Write-Host ""
    pause
    exit 1
}

# Check if already installed
if (Test-Path "`$installDir") {
    Write-Host "Existing installation found at: `$installDir" -ForegroundColor Yellow
    `$overwrite = Read-Host "Overwrite? (Y/N)"
    if (`$overwrite -ne "Y" -and `$overwrite -ne "y") {
        Write-Host "Installation cancelled."
        pause
        exit 0
    }
    Write-Host "Removing old installation..."
    Remove-Item -Recurse -Force "`$installDir" -ErrorAction SilentlyContinue
}

# Create installation directory
Write-Host "Creating installation directory..."
New-Item -ItemType Directory -Path "`$installDir" -Force | Out-Null

# Extract ZIP from embedded base64
Write-Host "Extracting files (this may take a minute)..."
`$zipBase64 = @"
$zipBase64
"@

`$zipBytes = [Convert]::FromBase64String(`$zipBase64)
`$tempZip = [System.IO.Path]::GetTempFileName()
[System.IO.File]::WriteAllBytes(`$tempZip, `$zipBytes)

try {
    Expand-Archive -Path `$tempZip -DestinationPath "`$installDir" -Force
    Write-Host "Files extracted successfully!" -ForegroundColor Green
} finally {
    Remove-Item `$tempZip -Force -ErrorAction SilentlyContinue
}

# Create desktop shortcut
Write-Host "Creating desktop shortcut..."
`$shell = New-Object -ComObject WScript.Shell
`$shortcut = `$shell.CreateShortcut("`$desktop\Tavari Music Desktop.lnk")
`$shortcut.TargetPath = "`$installDir\Tavari Music Desktop.exe"
`$shortcut.WorkingDirectory = "`$installDir"
`$shortcut.Description = "Tavari Music Desktop Player"
`$shortcut.Save()

# Create start menu shortcut
Write-Host "Creating start menu shortcut..."
if (-not (Test-Path "`$startMenu")) {
    New-Item -ItemType Directory -Path "`$startMenu" -Force | Out-Null
}
`$startShortcut = `$shell.CreateShortcut("`$startMenu\Tavari Music Desktop.lnk")
`$startShortcut.TargetPath = "`$installDir\Tavari Music Desktop.exe"
`$startShortcut.WorkingDirectory = "`$installDir"
`$startShortcut.Description = "Tavari Music Desktop Player"
`$startShortcut.Save()

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "Installation Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Tavari Music Desktop has been installed to:" -ForegroundColor Cyan
Write-Host "`$installDir" -ForegroundColor White
Write-Host ""
Write-Host "Shortcuts created:" -ForegroundColor Cyan
Write-Host "- Desktop: `$desktop\Tavari Music Desktop.lnk" -ForegroundColor White
Write-Host "- Start Menu: `$startMenu\Tavari Music Desktop.lnk" -ForegroundColor White
Write-Host ""

`$launch = Read-Host "Launch Tavari Music Desktop now? (Y/N)"
if (`$launch -eq "Y" -or `$launch -eq "y") {
    Start-Process "`$installDir\Tavari Music Desktop.exe"
}

Write-Host ""
Write-Host "Press any key to exit..."
`$null = `$Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
"@

# Write the installer script
$installerScript | Out-File -FilePath $OutputPath -Encoding UTF8

Write-Host "✅ Self-extracting installer created!" -ForegroundColor Green
Write-Host ""
Write-Host "The installer script is at: $OutputPath"
Write-Host "Size: $([math]::Round((Get-Item $OutputPath).Length / 1MB, 2)) MB"
Write-Host ""
Write-Host "Users can:" -ForegroundColor Cyan
Write-Host "1. Download the installer.ps1 file"
Write-Host "2. Right-click and 'Run as Administrator'"
Write-Host "3. It will extract and install automatically"
Write-Host ""




