# Instalador PowerShell do G-Monitor Agent.
# Uso: .\install.ps1 -Token "agt_xxx_xxx_xxx" -SaasUrl "https://api.gmonitor.com.br" -WsUrl "wss://ws.gmonitor.com.br/ws/agent" -FdbPath "C:\GDOOR Sistemas\GDOOR PRO\DATAGES.FDB" -FbPassword "masterkey"

param(
  [Parameter(Mandatory=$true)] [string]$Token,
  [Parameter(Mandatory=$true)] [string]$SaasUrl,
  [Parameter(Mandatory=$true)] [string]$WsUrl,
  [Parameter(Mandatory=$true)] [string]$FdbPath,
  [Parameter(Mandatory=$true)] [string]$FbPassword,
  [string]$FbUser = "SYSDBA",
  [string]$Channel = "stable"
)

$ErrorActionPreference = "Stop"
$installDir = "C:\Program Files\GMonitor\Agent"
$dataDir = "$env:PROGRAMDATA\GMonitor"

if (-not (Test-Path $installDir)) { New-Item -ItemType Directory -Force -Path $installDir | Out-Null }
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Force -Path $dataDir | Out-Null }

$config = @{
  saasUrl = $SaasUrl
  wsUrl = $WsUrl
  token = $Token
  firebird = @{
    host = "127.0.0.1"
    port = 3050
    database = $FdbPath
    user = $FbUser
    password = $FbPassword
  }
  syncIntervalMs = 30000
  updateChannel = $Channel
} | ConvertTo-Json -Depth 10

Set-Content -Path "$dataDir\agent.json" -Value $config -Encoding utf8

Write-Host "Configuracao salva em $dataDir\agent.json"
Write-Host "Para iniciar o servico: nssm install GMonitorAgent `"$installDir\gmonitor-agent.exe`""
Write-Host "Depois: nssm start GMonitorAgent"
