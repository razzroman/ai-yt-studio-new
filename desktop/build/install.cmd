@echo off
chcp 65001 >nul
rem Установка AI YT Studio для текущего пользователя: без прав администратора.
set "SRC=%~dp0"
set "DST=%LOCALAPPDATA%\Programs\AI YT Studio"
echo Устанавливаю AI YT Studio в "%DST%"...
taskkill /im "AI YT Studio.exe" /f >nul 2>&1
robocopy "%SRC%." "%DST%" /E /NFL /NDL /NJH /NJS /NP /XF "Install.cmd" >nul
if errorlevel 8 (
  echo Не удалось скопировать файлы. Закройте программу и попробуйте снова.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=New-Object -ComObject WScript.Shell;" ^
  "foreach($p in @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'))){" ^
  "$l=$s.CreateShortcut((Join-Path $p 'AI YT Studio.lnk'));$l.TargetPath='%DST%\AI YT Studio.exe';$l.WorkingDirectory='%DST%';$l.IconLocation='%DST%\AI YT Studio.exe,0';$l.Description='AI YT Studio';$l.Save()}"
echo Готово. Ярлыки — на рабочем столе и в меню «Пуск».
start "" "%DST%\AI YT Studio.exe"
timeout /t 3 >nul
