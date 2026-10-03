# atualizar-agente.ps1 - v1.0.0 (03/10/2026) - change updater-loop-download.
#
# Troca SO o binario do agente, preservando a configuracao da loja.
#
# POR QUE NAO USAR O install.ps1 PARA ATUALIZAR: ele reescreve o
# %PROGRAMDATA%\GMonitor\agent.json sempre, sem checar se ja existe. Rodado sem -Token, o
# agente faz autocadastro de novo e nasce um registro DUPLICADO no painel - foi o que deixou
# 2 agentes orfaos em 0.9.3 no J.Kastros. Este script nao toca no agent.json.
#
# QUANDO USAR: para tirar uma estacao do loop de download do auto-update (versoes 0.9.3, 0.9.6
# e 0.9.8 carregam o updater velho e nao conseguem se atualizar sozinhas - ver updater.ts v2.0.0).
# Da 0.9.13 em diante o agente se atualiza sozinho e este script deixa de ser necessario.
#
# IMPORTANTE: ASCII puro de proposito, como o install.ps1. O PowerShell 5.1 le .ps1 sem BOM como
# ANSI (CP1252) e acento/travessao quebram as aspas ("a cadeia de caracteres nao tem o
# terminador"). Nao reintroduzir acentos, travessao, aspas curvas ou emoji aqui.
#
# USO (PowerShell como Administrador):
#   .\atualizar-agente.ps1
# ou direto do servidor, sem baixar nada antes:
#   iwr -useb https://gmonitor.maissistem.com.br/downloads/atualizar-agente.ps1 | iex

param(
  [string]$SaasUrl = "https://gmonitor.maissistem.com.br",
  [string]$InstallDir = "C:\Program Files\GMonitor\Agent",
  [string]$ServiceName = "GMonitorAgent"
)

$ErrorActionPreference = "Stop"

function Passo($txt) { Write-Host "==> $txt" -ForegroundColor Cyan }

# TLS 1.2 explicito: o PowerShell 5.1 ainda negocia TLS 1.0 por padrao em Windows antigo e o
# Invoke-WebRequest falha com "A conexao subjacente foi fechada".
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$exePath = Join-Path $InstallDir "gmonitor-agent.exe"
if (-not (Test-Path $exePath)) {
  throw "Nao achei $exePath. O agente esta instalado neste computador? Para INSTALAR use o install.ps1."
}

Passo "Lendo o manifesto de $SaasUrl"
$manifesto = Invoke-RestMethod -Uri "$SaasUrl/downloads/latest.json" -Headers @{"Cache-Control"="no-cache"}
if (-not $manifesto.version -or -not $manifesto.sha256) { throw "Manifesto sem version/sha256: $SaasUrl/downloads/latest.json" }
Write-Host "    versao publicada: $($manifesto.version)"

$tmp = "$exePath.novo"
Passo "Baixando o binario novo (58 MB)"
Invoke-WebRequest -Uri "$SaasUrl/downloads/gmonitor-agent.exe" -OutFile $tmp -Headers @{"Cache-Control"="no-cache"}

Passo "Conferindo o sha256 ANTES de encostar no que esta rodando"
$sha = (Get-FileHash -Path $tmp -Algorithm SHA256).Hash.ToLower()
if ($sha -ne $manifesto.sha256.ToLower()) {
  Remove-Item -Force $tmp -ErrorAction SilentlyContinue
  throw "sha256 nao bate. Esperado $($manifesto.sha256), obtido $sha. Nada foi alterado."
}
Write-Host "    sha256 confere"

# Com o servico PARADO o .exe nao esta em uso: a troca e direta e nao existe a corrida que
# causou o loop (nssm reiniciando em 5s enquanto o .bat tentava mover).
Passo "Parando o servico $ServiceName"
Stop-Service -Name $ServiceName -Force -ErrorAction Stop
# Stop-Service volta antes do processo morrer de fato; esperar o arquivo ficar livre.
$limite = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $limite) {
  try { [IO.File]::OpenWrite($exePath).Close(); break } catch { Start-Sleep -Milliseconds 500 }
}

$backup = "$exePath.anterior"
try {
  Passo "Trocando o binario (guardando o anterior em .anterior)"
  Move-Item -Path $exePath -Destination $backup -Force
  Move-Item -Path $tmp -Destination $exePath -Force
} catch {
  # Nunca deixar o servico sem binario: devolve o antigo e aborta.
  if ((Test-Path $backup) -and -not (Test-Path $exePath)) { Move-Item -Path $backup -Destination $exePath -Force }
  Start-Service -Name $ServiceName -ErrorAction SilentlyContinue
  throw "Falha ao trocar o binario: $($_.Exception.Message). O anterior foi restaurado e o servico religado."
}

# Restos do loop de download: o .new de 58 MB que ficou pela metade e o .bat que nunca rodou.
Passo "Limpando restos do loop antigo"
foreach ($resto in @("$exePath.new", "$exePath.old", (Join-Path $InstallDir "updater.bat"))) {
  if (Test-Path $resto) { Remove-Item -Force $resto -ErrorAction SilentlyContinue; Write-Host "    removido: $resto" }
}

Passo "Subindo o servico"
Start-Service -Name $ServiceName
Start-Sleep -Seconds 3
$svc = Get-Service -Name $ServiceName
Write-Host "    servico: $($svc.Status)"

if ($svc.Status -ne "Running") {
  Write-Host ""
  Write-Host "O servico nao subiu. Devolvendo a versao anterior." -ForegroundColor Yellow
  Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
  Move-Item -Path $exePath -Destination "$exePath.falhou" -Force
  Move-Item -Path $backup -Destination $exePath -Force
  Start-Service -Name $ServiceName
  throw "Rollback feito: a versao anterior voltou. O binario novo ficou em $exePath.falhou para analise."
}

Remove-Item -Force $backup -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Pronto: agente atualizado para $($manifesto.version)." -ForegroundColor Green
Write-Host "Confira no log de servico se ele conectou:" -ForegroundColor Gray
Write-Host "  Get-Content '$InstallDir\service.log' -Tail 20" -ForegroundColor Gray
Write-Host "A configuracao da loja (agent.json) NAO foi alterada." -ForegroundColor Gray
