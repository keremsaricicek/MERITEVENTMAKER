@echo off
rem MERIT Event Maker — one-click start, offline (no internet, nothing to install).
rem Starts the local plan model and the assistant's language model on this
rem computer only (127.0.0.1), then the app, waits until they answer, then opens
rem the browser. Close this window to stop.
rem A graphics card is used only when the first-run check found it gives the
rem processor's own answers (app\server\gpu-check.mjs, data\gpu.json); otherwise
rem everything runs on the processor.
setlocal
cd /d "%~dp0"
title MERIT Event Maker
set "HERE=%~dp0"
set "PATH=%HERE%runtime\llama;%HERE%runtime\llama\Library\bin;%PATH%"
set "SERVER=%HERE%runtime\llama\Library\bin\llama-server.exe"
set "NODE=%HERE%runtime\node\node.exe"
set "MODEL=%HERE%models\local-vlm\@MODEL_ID@"
set "CHAT=%HERE%models\local-chat\@CHAT_ID@"
set MODEL_PORT=8093
set CHAT_PORT=8097
set PORT=8090

echo MERIT Event Maker
if not exist "%HERE%data" mkdir "%HERE%data"
if not exist "%HERE%data\gpu.json" (
  echo   Ilk acilis: ekran karti kontrol ediliyor (bir kez, birkac dakika)...
  "%NODE%" "%HERE%app\server\gpu-check.mjs" "%SERVER%" "%MODEL%\@MODEL_FILE@" "%MODEL%\@MMPROJ_FILE@" "%MODEL%\adapter.gguf" "%MODEL%\gpu-check" "%HERE%data\gpu.json"
)
set "NGL="
findstr /c:"\"use\": \"gpu\"" "%HERE%data\gpu.json" >nul 2>&1 && set "NGL=-ngl 99"
if defined NGL (echo   Ekran karti kullaniliyor.) else (echo   Islemci kullaniliyor.)

echo   Plan modeli yukleniyor (internet gerekmez)...
start "" /b "%SERVER%" -m "%MODEL%\@MODEL_FILE@" --mmproj "%MODEL%\@MMPROJ_FILE@" --lora "%MODEL%\adapter.gguf" -c 2048 -t 4 -np 1 --cache-ram 0 %NGL% --host 127.0.0.1 --port %MODEL_PORT% --log-disable >nul 2>&1

set /a tries=0
:waitmodel
curl.exe -s -o nul -f http://127.0.0.1:%MODEL_PORT%/health && goto modelready
set /a tries+=1
if %tries% geq 180 (echo   Model sunucusu acilmadi. Bu pencereyi kapatip tekrar deneyin. & pause & exit /b 1)
timeout /t 1 /nobreak >nul
goto waitmodel
:modelready
echo   Plan modeli hazir.

if not exist "%CHAT%\manifest.json" goto nochat
echo   Asistanin dil modeli yukleniyor...
set "CHATNGL=%NGL%"
:startchat
start "" /b "%SERVER%" -m "%CHAT%\@CHAT_FILE@" --jinja -c 4096 -t 4 -np 1 --cache-ram 0 %CHATNGL% --host 127.0.0.1 --port %CHAT_PORT% --log-disable >nul 2>&1
set /a tries=0
:waitchat
curl.exe -s -o nul -f http://127.0.0.1:%CHAT_PORT%/health && goto chatready
set /a tries+=1
if %tries% geq 180 goto chatslow
timeout /t 1 /nobreak >nul
goto waitchat
:chatslow
rem the graphics card may be too small for both models: once more, on the processor
rem (on a new port: the first process may still hold its own)
if defined CHATNGL (set "CHATNGL=" & set "CHAT_PORT=8098" & echo   Dil modeli islemciyle aciliyor... & goto startchat)
echo   Dil modeli acilmadi; asistan yalnizca kurallarla calisacak.
goto nochat
:chatready
echo   Dil modeli hazir.
set ASSISTANT_CHAT_URL=http://127.0.0.1:%CHAT_PORT%
set "ASSISTANT_CHAT_MANIFEST=%CHAT%\manifest.json"
:nochat

set VLM_PROVIDER=local
set VLM_LOCAL_URL=http://127.0.0.1:%MODEL_PORT%
set "VLM_LOCAL_MANIFEST=%MODEL%\manifest.json"
set "MERIT_APP_ROOT=%HERE%app"
set "VLM_DATA_DIR=%HERE%data"
start "" /b "%NODE%" "%HERE%app\server\vlm-relay.mjs"

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
echo   Asistan: F8. Kapatmak icin bu pencereyi kapatin.
:keep
timeout /t 3600 /nobreak >nul
goto keep
