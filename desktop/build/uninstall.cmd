@echo off
chcp 65001 >nul
rem Удаление AI YT Studio: программа, ярлыки и сохранённый вход.
set "DST=%LOCALAPPDATA%\Programs\AI YT Studio"
taskkill /im "AI YT Studio.exe" /f >nul 2>&1
powershell -NoProfile -Command "Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path ([Environment]::GetFolderPath('Desktop')) 'AI YT Studio.lnk'), (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\AI YT Studio.lnk')"
rmdir /s /q "%APPDATA%\AI YT Studio" >nul 2>&1
echo AI YT Studio удалена. Ваш аккаунт и кредиты остаются на сервере.
rem Папку с программой удаляем после выхода из скрипта (скрипт может лежать внутри неё).
start "" /min cmd /c "timeout /t 2 >nul & rmdir /s /q "%DST%""
timeout /t 3 >nul
