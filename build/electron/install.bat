@echo off
REM Tavari Music Desktop - Auto-Installer
REM This runs automatically when the SFX .exe is executed

setlocal enabledelayedexpansion

echo ========================================
echo Tavari Music Desktop - Installing...
echo ========================================
echo.

REM Get the directory where files were extracted (same as this script)
set "EXTRACT_DIR=%~dp0"
set "INSTALL_DIR=%ProgramFiles%\Tavari Music Desktop"
set "DESKTOP=%USERPROFILE%\Desktop"
set "START_MENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs"

REM Check for admin rights
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: Administrator rights required!
    echo.
    echo Please right-click the installer and select "Run as Administrator"
    echo.
    pause
    exit /b 1
)

echo Installing from: %EXTRACT_DIR%
echo Installing to: %INSTALL_DIR%
echo.

REM Check if already installed
if exist "%INSTALL_DIR%" (
    echo Existing installation found!
    set /p OVERWRITE="Overwrite existing installation? (Y/N): "
    if /i not "!OVERWRITE!"=="Y" (
        echo Installation cancelled.
        pause
        exit /b 0
    )
    echo Removing old installation...
    rmdir /s /q "%INSTALL_DIR%"
)

REM Create installation directory
echo Creating installation directory...
mkdir "%INSTALL_DIR%" 2>nul

REM Copy all files (excluding this install.bat)
echo Copying files...
for /r "%EXTRACT_DIR%" %%f in (*) do (
    if not "%%~nxf"=="install.bat" (
        set "relPath=%%f"
        set "relPath=!relPath:%EXTRACT_DIR%=!"
        set "destPath=%INSTALL_DIR%!relPath!"
        set "destDir=%%~dpf"
        set "destDir=!destDir:%EXTRACT_DIR%=%INSTALL_DIR%!"
        if not exist "!destDir!" mkdir "!destDir!"
        copy /Y "%%f" "!destPath!" >nul
    )
)

REM Copy directories
xcopy /E /I /Y /EXCLUDE:install.bat "%EXTRACT_DIR%*" "%INSTALL_DIR%\" >nul 2>&1

echo Files copied successfully!
echo.

REM Create desktop shortcut
echo Creating desktop shortcut...
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%DESKTOP%\Tavari Music Desktop.lnk'); $s.TargetPath = '%INSTALL_DIR%\Tavari Music Desktop.exe'; $s.WorkingDirectory = '%INSTALL_DIR%'; $s.Description = 'Tavari Music Desktop Player'; $s.Save()"

REM Create start menu shortcut
echo Creating start menu shortcut...
if not exist "%START_MENU%" mkdir "%START_MENU%"
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%START_MENU%\Tavari Music Desktop.lnk'); $s.TargetPath = '%INSTALL_DIR%\Tavari Music Desktop.exe'; $s.WorkingDirectory = '%INSTALL_DIR%'; $s.Description = 'Tavari Music Desktop Player'; $s.Save()"

echo.
echo ========================================
echo Installation Complete!
echo ========================================
echo.
echo Tavari Music Desktop has been installed to:
echo %INSTALL_DIR%
echo.
echo Shortcuts created on Desktop and Start Menu.
echo.
set /p LAUNCH="Launch Tavari Music Desktop now? (Y/N): "
if /i "!LAUNCH!"=="Y" (
    start "" "%INSTALL_DIR%\Tavari Music Desktop.exe"
)
echo.
echo Press any key to exit...
pause >nul
