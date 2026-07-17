# install.ps1 — устанавливает плагин Yandex AI Assistant в Stream Deck и перезапускает приложение.
$ErrorActionPreference = 'Stop'

$src = Join-Path $PSScriptRoot 'com.subbotaaa.yandex-assistant.sdPlugin'
$dst = Join-Path $env:APPDATA 'Elgato\StreamDeck\Plugins\com.subbotaaa.yandex-assistant.sdPlugin'

if (-not (Test-Path (Join-Path $src 'manifest.json'))) { throw "Не найден плагин в $src" }
if (-not (Test-Path (Join-Path $src 'node_modules\ws\package.json'))) {
    Write-Host 'Устанавливаю зависимости (npm install)...'
    Push-Location $src
    npm install --no-audit --no-fund
    Pop-Location
}

$sd = Get-Process StreamDeck -ErrorAction SilentlyContinue
$sdPath = if ($sd) { $sd[0].Path } else { "$env:ProgramFiles\Elgato\StreamDeck\StreamDeck.exe" }

if ($sd) {
    Write-Host 'Останавливаю Stream Deck...'
    Stop-Process -Name StreamDeck -Force -Confirm:$false
    Start-Sleep -Seconds 2
}

Write-Host "Копирую плагин в $dst"
robocopy $src $dst /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy завершился с ошибкой ($LASTEXITCODE)" }

Write-Host 'Запускаю Stream Deck...'
Start-Process $sdPath
Write-Host 'Готово. Найдите действие «Голосовой ассистент» в категории «Yandex AI».'
