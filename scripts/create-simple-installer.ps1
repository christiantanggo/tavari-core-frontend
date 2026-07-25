# Create a simple installer that packages everything into a single executable
# This uses PowerShell's built-in compression

param(
    [string]$SourceDir = ".\dist\win-unpacked",
    [string]$OutputExe = ".\public\installers\tavari-music-desktop-setup.exe"
)

Write-Host "========================================"
Write-Host "Creating Simple Installer"
Write-Host "========================================"
Write-Host ""

if (-not (Test-Path $SourceDir)) {
    Write-Host "ERROR: Source directory not found: $SourceDir" -ForegroundColor Red
    exit 1
}

# Ensure install.bat exists
if (-not (Test-Path "$SourceDir\install.bat")) {
    Write-Host "Copying install.bat..." -ForegroundColor Yellow
    Copy-Item ".\build\electron\install.bat" -Destination "$SourceDir\install.bat" -Force
}

# Create temp ZIP
$tempZip = [System.IO.Path]::GetTempFileName() + ".zip"
Write-Host "Creating archive..."
Compress-Archive -Path "$SourceDir\*" -DestinationPath $tempZip -CompressionLevel Optimal -Force

if (-not (Test-Path $tempZip)) {
    Write-Host "ERROR: Failed to create archive" -ForegroundColor Red
    exit 1
}

$zipSize = (Get-Item $tempZip).Length / 1MB
Write-Host "Archive created: $([math]::Round($zipSize, 2)) MB"
Write-Host ""

# Create installer script that embeds the ZIP
Write-Host "Creating installer script..."

$zipBytes = [System.IO.File]::ReadAllBytes($tempZip)
$zipBase64 = [Convert]::ToBase64String($zipBytes)

$installerScript = @'
# Tavari Music Desktop - Self-Extracting Installer
# This file extracts and installs the application automatically

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Tavari Music Desktop - Installer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check for admin rights
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "ERROR: Administrator rights required!" -ForegroundColor Red
    Write-Host "Please right-click this file and select 'Run as Administrator'" -ForegroundColor Yellow
    Write-Host ""
    pause
    exit 1
}

$installDir = "${env:ProgramFiles}\Tavari Music Desktop"
$tempDir = [System.IO.Path]::GetTempPath() + [System.Guid]::NewGuid().ToString()
$desktop = "$env:USERPROFILE\Desktop"
$startMenu = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"

# Check if already installed
if (Test-Path $installDir) {
    Write-Host "Existing installation found!" -ForegroundColor Yellow
    $overwrite = Read-Host "Overwrite existing installation? (Y/N)"
    if ($overwrite -ne "Y" -and $overwrite -ne "y") {
        Write-Host "Installation cancelled."
        pause
        exit 0
    }
    Write-Host "Removing old installation..."
    Remove-Item -Recurse -Force $installDir -ErrorAction SilentlyContinue
}

# Create temp directory
Write-Host "Extracting files..."
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

try {
    # Extract embedded ZIP
    $zipBase64 = @"
'@ + $zipBase64 + @'
"@

    $zipBytes = [Convert]::FromBase64String($zipBase64)
    $tempZip = [System.IO.Path]::GetTempFileName() + ".zip"
    [System.IO.File]::WriteAllBytes($tempZip, $zipBytes)

    Expand-Archive -Path $tempZip -DestinationPath $tempDir -Force

    # Create installation directory
    Write-Host "Installing to: $installDir"
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null

    # Copy files
    Write-Host "Copying files..."
    Copy-Item -Path "$tempDir\*" -Destination $installDir -Recurse -Force

    # Create desktop shortcut
    Write-Host "Creating desktop shortcut..."
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut("$desktop\Tavari Music Desktop.lnk")
    $shortcut.TargetPath = "$installDir\Tavari Music Desktop.exe"
    $shortcut.WorkingDirectory = $installDir
    $shortcut.Description = "Tavari Music Desktop Player"
    $shortcut.Save()

    # Create start menu shortcut
    Write-Host "Creating start menu shortcut..."
    if (-not (Test-Path $startMenu)) {
        New-Item -ItemType Directory -Path $startMenu -Force | Out-Null
    }
    $startShortcut = $shell.CreateShortcut("$startMenu\Tavari Music Desktop.lnk")
    $startShortcut.TargetPath = "$installDir\Tavari Music Desktop.exe"
    $startShortcut.WorkingDirectory = $installDir
    $startShortcut.Description = "Tavari Music Desktop Player"
    $startShortcut.Save()

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "Installation Complete!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Tavari Music Desktop has been installed to:" -ForegroundColor Cyan
    Write-Host $installDir -ForegroundColor White
    Write-Host ""
    Write-Host "Shortcuts created on Desktop and Start Menu." -ForegroundColor Cyan
    Write-Host ""

    $launch = Read-Host "Launch Tavari Music Desktop now? (Y/N)"
    if ($launch -eq "Y" -or $launch -eq "y") {
        Start-Process "$installDir\Tavari Music Desktop.exe"
    }

} finally {
    # Cleanup
    Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
    if (Test-Path $tempZip) {
        Remove-Item -Force $tempZip -ErrorAction SilentlyContinue
    }
}

Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
'@

# Save as .ps1 first
$ps1Path = $OutputExe -replace '\.exe$', '.ps1'
$installerScript | Out-File -FilePath $ps1Path -Encoding UTF8

Write-Host "✅ Installer script created: $ps1Path"
Write-Host ""

# Try to convert to .exe using ps2exe if available, otherwise use .ps1
$ps2exePath = Get-Command ps2exe -ErrorAction SilentlyContinue
if ($ps2exePath) {
    Write-Host "Converting to .exe using ps2exe..."
    & ps2exe $ps1Path $OutputExe
    if (Test-Path $OutputExe) {
        Write-Host "✅ .exe created: $OutputExe" -ForegroundColor Green
        Remove-Item $ps1Path -Force
    } else {
        Write-Host "⚠️  ps2exe failed, keeping .ps1 file" -ForegroundColor Yellow
        $OutputExe = $ps1Path
    }
} else {
    Write-Host "⚠️  ps2exe not found. Installer is a .ps1 file." -ForegroundColor Yellow
    Write-Host "Users can:" -ForegroundColor Cyan
    Write-Host "1. Right-click the .ps1 file" -ForegroundColor White
    Write-Host "2. Select 'Run with PowerShell'" -ForegroundColor White
    Write-Host "3. Or rename to .bat and double-click" -ForegroundColor White
    $OutputExe = $ps1Path
}

# Cleanup temp ZIP
Remove-Item $tempZip -Force -ErrorAction SilentlyContinue

$finalSize = (Get-Item $OutputExe).Length / 1MB
Write-Host ""
Write-Host "========================================"
Write-Host "✅ SUCCESS!"
Write-Host "========================================"
Write-Host "Installer: $OutputExe"
Write-Host "Size: $([math]::Round($finalSize, 2)) MB"
Write-Host ""
Write-Host "Users can now download and run this file!" -ForegroundColor Green
Write-Host ""




