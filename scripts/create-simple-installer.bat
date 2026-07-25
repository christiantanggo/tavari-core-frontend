@echo off
REM Simple installer script for Tavari Music Desktop
REM This extracts the portable ZIP and sets up shortcuts

echo ========================================
echo Tavari Music Desktop - Simple Installer
echo ========================================
echo.

set "INSTALL_DIR=%ProgramFiles%\Tavari Music Desktop"
set "ZIP_FILE=%~dp0..\public\installers\tavari-music-desktop-portable.zip"

if not exist "%ZIP_FILE%" (
    echo ERROR: Installer ZIP not found at: %ZIP_FILE%
    pause
    exit /b 1
)

echo Installing to: %INSTALL_DIR%
echo.

REM Create installation directory
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

REM Extract ZIP (requires PowerShell)
echo Extracting files...
powershell -Command "Expand-Archive -Path '%ZIP_FILE%' -DestinationPath '%INSTALL_DIR%' -Force"

if errorlevel 1 (
    echo ERROR: Failed to extract files
    pause
    exit /b 1
)

REM Create desktop shortcut
echo Creating desktop shortcut...
set "SHORTCUT=%USERPROFILE%\Desktop\Tavari Music Desktop.lnk"
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath = '%INSTALL_DIR%\Tavari Music Desktop.exe'; $s.WorkingDirectory = '%INSTALL_DIR%'; $s.Save()"

REM Create start menu shortcut
echo Creating start menu shortcut...
set "START_MENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Tavari Music Desktop.lnk"
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%START_MENU%'); $s.TargetPath = '%INSTALL_DIR%\Tavari Music Desktop.exe'; $s.WorkingDirectory = '%INSTALL_DIR%'; $s.Save()"

echo.
echo ========================================
echo Installation Complete!
echo ========================================
echo.
echo Tavari Music Desktop has been installed to:
echo %INSTALL_DIR%
echo.
echo Shortcuts have been created on your desktop and start menu.
echo.
pause




