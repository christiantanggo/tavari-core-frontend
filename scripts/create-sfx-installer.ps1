# Create Self-Extracting Installer (.exe) using 7-Zip SFX
# This creates a single .exe file that extracts and installs automatically

param(
    [string]$SourceDir = ".\dist\win-unpacked",
    [string]$OutputExe = ".\public\installers\tavari-music-desktop-setup.exe"
)

Write-Host "========================================"
Write-Host "Creating Self-Extracting Installer"
Write-Host "========================================"
Write-Host ""

if (-not (Test-Path $SourceDir)) {
    Write-Host "ERROR: Source directory not found: $SourceDir" -ForegroundColor Red
    Write-Host "Run 'npm run build-desktop' first" -ForegroundColor Yellow
    exit 1
}

# Check if 7-Zip is available
$7zipPath = $null

# Check environment variable first
if ($env:7ZIP_PATH -and (Test-Path $env:7ZIP_PATH)) {
    $7zipPath = $env:7ZIP_PATH
}

# Check node_modules (electron-builder's 7zip)
if (-not $7zipPath) {
    $nodeModulesPath = ".\node_modules\7zip-bin\win\x64\7za.exe"
    if (Test-Path $nodeModulesPath) {
        $7zipPath = (Resolve-Path $nodeModulesPath).Path
    }
}

# Check standard installation paths
if (-not $7zipPath) {
    $possiblePaths = @(
        "C:\Program Files\7-Zip\7z.exe",
        "C:\Program Files (x86)\7-Zip\7z.exe",
        "$env:ProgramFiles\7-Zip\7z.exe",
        "$env:ProgramFiles(x86)\7-Zip\7z.exe"
    )

    foreach ($path in $possiblePaths) {
        if (Test-Path $path) {
            $7zipPath = $path
            break
        }
    }
}

if (-not $7zipPath) {
    Write-Host "ERROR: 7-Zip not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install 7-Zip from: https://www.7-zip.org/" -ForegroundColor Yellow
    Write-Host "Or use the portable version and set 7ZIP_PATH environment variable" -ForegroundColor Yellow
    exit 1
}

Write-Host "Using 7-Zip: $7zipPath"
Write-Host "Source: $SourceDir"
Write-Host "Output: $OutputExe"
Write-Host ""

# Create temp directory for SFX config
$tempDir = [System.IO.Path]::GetTempPath() + [System.Guid]::NewGuid().ToString()
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

# Create SFX config file
$sfxConfig = @"
;!@Install@!UTF-8!
Title="Tavari Music Desktop - Installer"
BeginPrompt="This will install Tavari Music Desktop to your computer.\n\nClick OK to continue."
RunProgram="install.bat"
;!@InstallEnd@!
"@

$sfxConfigPath = Join-Path $tempDir "config.txt"
$sfxConfig | Out-File -FilePath $sfxConfigPath -Encoding UTF8

# Create temp ZIP
$tempZip = Join-Path $tempDir "app.zip"

Write-Host "Creating archive..."
& $7zipPath a -tzip -mx=9 "$tempZip" "$SourceDir\*" | Out-Null

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to create archive" -ForegroundColor Red
    Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
    exit 1
}

# Get 7-Zip SFX module
$sfxModulePath = Join-Path (Split-Path $7zipPath) "7z.sfx"
if (-not (Test-Path $sfxModulePath)) {
    Write-Host "WARNING: 7z.sfx not found, trying alternative method..." -ForegroundColor Yellow
    
    # Try to create SFX using 7z command
    Write-Host "Creating self-extracting archive..."
    & $7zipPath a -sfx "$OutputExe" "$tempZip" | Out-Null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Self-extracting installer created!" -ForegroundColor Green
    } else {
        Write-Host "ERROR: Failed to create SFX" -ForegroundColor Red
        Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
        exit 1
    }
} else {
    # Combine SFX module + config + ZIP
    Write-Host "Creating self-extracting installer..."
    
    $outputDir = Split-Path $OutputExe -Parent
    if (-not (Test-Path $outputDir)) {
        New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
    }
    
    # Combine files: SFX + Config + ZIP = EXE
    $fs = [System.IO.FileStream]::new($OutputExe, [System.IO.FileMode]::Create)
    $sfxBytes = [System.IO.File]::ReadAllBytes($sfxModulePath)
    $configBytes = [System.IO.File]::ReadAllBytes($sfxConfigPath)
    $zipBytes = [System.IO.File]::ReadAllBytes($tempZip)
    
    $fs.Write($sfxBytes, 0, $sfxBytes.Length)
    $fs.Write($configBytes, 0, $configBytes.Length)
    $fs.Write($zipBytes, 0, $zipBytes.Length)
    $fs.Close()
    
    Write-Host "✅ Self-extracting installer created!" -ForegroundColor Green
}

# Cleanup
Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue

$exeSize = (Get-Item $OutputExe).Length / 1MB
Write-Host ""
Write-Host "========================================"
Write-Host "✅ SUCCESS!"
Write-Host "========================================"
Write-Host "Installer: $OutputExe"
Write-Host "Size: $([math]::Round($exeSize, 2)) MB"
Write-Host ""
Write-Host "Users can now:"
Write-Host "1. Download the .exe file"
Write-Host "2. Double-click to run"
Write-Host "3. It will extract and install automatically!"
Write-Host ""

