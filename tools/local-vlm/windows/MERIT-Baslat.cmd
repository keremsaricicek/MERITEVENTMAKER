@echo off
rem MERIT Event Maker — one-click start, offline (no internet, nothing to install).
rem Starts the local model server and the app on this computer only (127.0.0.1),
rem waits until both answer, then opens the browser. Close this window to stop.
setlocal
cd /d "%~dp0"
title MERIT Event Maker
set "HERE=%~dp0"
set "PATH=%HERE%runtime\llama;%HERE%runtime\llama\Library\bin;%PATH%"
set "MODEL=%HERE%models\local-vlm\@MODEL_ID@"
set MODEL_PORT=8093
set PORT=8090

echo MERIT Event Maker
echo   Yerel model yukleniyor (internet gerekmez)...
start "" /b "%HERE%runtime\llama\Library\bin\llama-server.exe" -m "%MODEL%\@MODEL_FILE@" --mmproj "%MODEL%\@MMPROJ_FILE@" --lora "%MODEL%\adapter.gguf" -c 2048 -t 4 -np 1 --cache-ram 0 --host 127.0.0.1 --port %MODEL_PORT% --log-disable >nul 2>&1

set /a tries=0
:waitmodel
curl.exe -s -o nul -f http://127.0.0.1:%MODEL_PORT%/health && goto modelready
set /a tries+=1
if %tries% geq 180 (echo   Model sunucusu acilmadi. Bu pencereyi kapatip tekrar deneyin. & pause & exit /b 1)
timeout /t 1 /nobreak >nul
goto waitmodel
:modelready
echo   Model hazir.

set VLM_PROVIDER=local
set VLM_LOCAL_URL=http://127.0.0.1:%MODEL_PORT%
set "VLM_LOCAL_MANIFEST=%MODEL%\manifest.json"
set "MERIT_APP_ROOT=%HERE%app"
set "VLM_DATA_DIR=%HERE%data"
start "" /b "%HERE%runtime\node\node.exe" "%HERE%app\server\vlm-relay.mjs"

set /a tries=0
:waitapp
curl.exe -s -o nul -f http://127.0.0.1:%PORT%/index.html && goto appready
set /a tries+=1
if %tries% geq 60 (echo   Uygulama acilmadi. & pause & exit /b 1)
timeout /t 1 /nobreak >nul
goto waitapp
:appready
echo   Uygulama hazir: http://127.0.0.1:%PORT%/index.html
start "" http://127.0.0.1:%PORT%/index.html
echo.
echo   Kapatmak icin bu pencereyi kapatin.
:keep
timeout /t 3600 /nobreak >nul
goto keep
