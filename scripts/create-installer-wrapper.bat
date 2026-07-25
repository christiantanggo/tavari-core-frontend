@echo off
REM Tavari Music Desktop - Simple Installer
REM This extracts the portable app and creates shortcuts

setlocal enabledelayedexpansion

echo ========================================
echo Tavari Music Desktop - Installer
echo ========================================
echo.

set "INSTALL_DIR=%ProgramFiles%\Tavari Music Desktop"
set "ZIP_FILE=%~dp0..\public\installers\tavari-music-desktop-portable.zip"

if not exist "%ZIP_FILE%" (
    echo ERROR: Installer ZIP not found!
    echo Expected: %ZIP_FILE%
    pause
    exit /b 1
)

echo Installing to: %INSTALL_DIR%
echo.

REM Create installation directory
if not exist "%INSTALL_DIR%" (
    mkdir "%INSTALL_DIR%"
    echo Created installation directory
) else (
    echo Installation directory already exists
    echo.
    set /p OVERWRITE="Overwrite existing installation? (Y/N): "
    if /i not "!OVERWRITE!"=="Y" (
        echo Installation cancelled.
        pause
        exit /b 0
    )
    echo Removing old installation...
    rmdir /s /q "%INSTALL_DIR%"
    mkdir "%INSTALL_DIR%"
)

echo.
echo Extracting files (this may take a minute)...
powershell -Command "$ProgressPreference = 'SilentlyContinue'; Expand-Archive -Path '%ZIP_FILE%' -DestinationPath '%INSTALL_DIR%' -Force"

if errorlevel 1 (
    echo ERROR: Failed to extract files
    pause
    exit /b 1
)

echo Files extracted successfully!
echo.

REM Create desktop shortcut
echo Creating desktop shortcut...
set "DESKTOP=%USERPROFILE%\Desktop"
set "SHORTCUT=%DESKTOP%\Tavari Music Desktop.lnk"

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath = '%INSTALL_DIR%\Tavari Music Desktop.exe'; $s.WorkingDirectory = '%INSTALL_DIR%'; $s.Description = 'Tavari Music Desktop Player'; $s.Save()"

REM Create start menu shortcut
echo Creating start menu shortcut...
set "START_MENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs"
if not exist "%START_MENU%" mkdir "%START_MENU%"

set "START_SHORTCUT=%START_MENU%\Tavari Music Desktop.lnk"
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%START_SHORTCUT%'); $s.TargetPath = '%INSTALL_DIR%\Tavari Music Desktop.exe'; $s.WorkingDirectory = '%INSTALL_DIR%'; $s.Description = 'Tavari Music Desktop Player'; $s.Save()"

echo.
echo ========================================
echo Installation Complete!
echo ========================================
echo.
echo Tavari Music Desktop has been installed to:
echo %INSTALL_DIR%
echo.
echo Shortcuts created:
echo - Desktop: %SHORTCUT%
echo - Start Menu: %START_SHORTCUT%
echo.
set /p LAUNCH="Launch Tavari Music Desktop now? (Y/N): "
if /i "!LAUNCH!"=="Y" (
    start "" "%INSTALL_DIR%\Tavari Music Desktop.exe"
)
echo.
pause




