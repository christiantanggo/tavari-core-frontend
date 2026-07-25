# Create a small installer that downloads and installs the app
# This creates a small .exe that downloads the ZIP from GitHub and installs it

$installerScript = @'
# Tavari Music Desktop - Downloader Installer
# This installer downloads the app from GitHub and installs it automatically

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
$desktop = "$env:USERPROFILE\Desktop"
$startMenu = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"
$downloadUrl = "https://github.com/christiantanggo/Tavari-Music-Desktop/releases/download/v1.0.0/tavari-music-desktop-portable.zip"
$tempZip = [System.IO.Path]::GetTempFileName() + ".zip"
$tempDir = [System.IO.Path]::GetTempPath() + [System.Guid]::NewGuid().ToString()

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

try {
    # Download the ZIP file
    Write-Host "Downloading Tavari Music Desktop..." -ForegroundColor Cyan
    Write-Host "This may take several minutes (file is ~1.3 GB)..." -ForegroundColor Yellow
    Write-Host ""
    
    $ProgressPreference = 'Continue'
    Invoke-WebRequest -Uri $downloadUrl -OutFile $tempZip -UseBasicParsing
    
    if (-not (Test-Path $tempZip)) {
        throw "Download failed - file not found"
    }
    
    $zipSize = (Get-Item $tempZip).Length / 1MB
    Write-Host "Download complete: $([math]::Round($zipSize, 2)) MB" -ForegroundColor Green
    Write-Host ""
    
    # Extract ZIP
    Write-Host "Extracting files..."
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
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
    
} catch {
    Write-Host ""
    Write-Host "ERROR: Installation failed!" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host "Please check your internet connection and try again." -ForegroundColor Yellow
    pause
    exit 1
} finally {
    # Cleanup
    if (Test-Path $tempDir) {
        Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
    }
    if (Test-Path $tempZip) {
        Remove-Item -Force $tempZip -ErrorAction SilentlyContinue
    }
}

Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
'@

# Save as .ps1
$outputPath = "public\installers\tavari-music-desktop-installer.ps1"
$installerScript | Out-File -FilePath $outputPath -Encoding UTF8

Write-Host "✅ Downloader installer created!" -ForegroundColor Green
Write-Host ""
Write-Host "File: $outputPath"
Write-Host "Size: $([math]::Round((Get-Item $outputPath).Length / 1KB, 2)) KB"
Write-Host ""
Write-Host "This installer will:" -ForegroundColor Cyan
Write-Host "1. Download the app from GitHub Releases" -ForegroundColor White
Write-Host "2. Extract and install automatically" -ForegroundColor White
Write-Host "3. Create shortcuts" -ForegroundColor White
Write-Host ""
Write-Host "Users can:" -ForegroundColor Cyan
Write-Host "- Right-click → Run with PowerShell" -ForegroundColor White
Write-Host "- Or rename to .bat and double-click" -ForegroundColor White
Write-Host ""




