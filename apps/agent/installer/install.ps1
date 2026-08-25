# Instalador PowerShell do G-Monitor Agent.
#
# Modo 1 (autocadastro pelo login — pedido do dono 24/08): so pede o CNPJ, o agente troca
# por um token sozinho. Se a empresa ainda nao foi aprovada pelo administrador, o agente
# fica instalado e tentando conectar em backoff ate a aprovacao (nao precisa reinstalar).
#   .\install.ps1 -Cnpj "12.345.678/0001-90" -SaasUrl "https://gmonitor-pilot.anafood.vip" -WsUrl "wss://gmonitor-pilot.anafood.vip/ws/agent" -FdbPath "C:\GDOOR Sistemas\GDOOR PRO\DATAGES.FDB" -FbPassword "masterkey"
#
# Modo 2 (token ja gerado na mao pela tela de Empresas): igual ao anterior, so troca -Cnpj
# por -Token "agt_xxx_xxx_xxx".

param(
  [string]$Token,
  [string]$Cnpj,
  [Parameter(Mandatory=$true)] [string]$SaasUrl,
  [Parameter(Mandatory=$true)] [string]$WsUrl,
  [Parameter(Mandatory=$true)] [string]$FdbPath,
  [Parameter(Mandatory=$true)] [string]$FbPassword,
  [string]$FbUser = "SYSDBA",
  [string]$Channel = "stable",
  # 90s (nao 30s) — pedido do dono 24/08: servico leve, sem consumir memoria/processamento
  # a mais. E o intervalo ja validado em producao (loja Caribe, desde o incidente de sync
  # overload de 24/08 — lote de 1000 -> 200 registros nao bastou sozinho, o intervalo maior
  # tambem ajudou a nao empilhar ciclos).
  [int]$SyncIntervalMs = 90000
)

$ErrorActionPreference = "Stop"

if (-not $Token -and -not $Cnpj) {
  Write-Error "Informe -Token (gerado na tela de Empresas) OU -Cnpj (autocadastro)."
  exit 1
}

$installDir = "C:\Program Files\GMonitor\Agent"
$dataDir = "$env:PROGRAMDATA\GMonitor"

if (-not (Test-Path $installDir)) { New-Item -ItemType Directory -Force -Path $installDir | Out-Null }
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Force -Path $dataDir | Out-Null }

# Copia o executavel se ele estiver do lado do script (download costuma trazer os dois juntos).
$exeSource = Join-Path $PSScriptRoot "gmonitor-agent.exe"
if (Test-Path $exeSource) {
  Copy-Item -Path $exeSource -Destination "$installDir\gmonitor-agent.exe" -Force
  Write-Host "gmonitor-agent.exe copiado para $installDir"
}

if ($Cnpj) {
  Write-Host "Validando CNPJ $Cnpj em $SaasUrl..."
  $body = @{ cnpj = $Cnpj } | ConvertTo-Json
  try {
    $resp = Invoke-RestMethod -Uri "$SaasUrl/api/agents/register-by-cnpj" -Method Post -ContentType "application/json" -Body $body
  } catch {
    $errBody = $_.ErrorDetails.Message
    Write-Error "Nao foi possivel validar o CNPJ: $errBody`nCadastre a empresa pelo login em $SaasUrl antes de instalar o agente."
    exit 1
  }
  $Token = $resp.token
  Write-Host $resp.message
  if ($resp.pendingApproval) {
    Write-Host "IMPORTANTE: a empresa '$($resp.tenantName)' ainda esta aguardando aprovacao. O agente vai instalar normalmente e ficar tentando conectar sozinho ate ser aprovado — nao precisa rodar o instalador de novo."
  }
}

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
  syncIntervalMs = $SyncIntervalMs
  updateChannel = $Channel
} | ConvertTo-Json -Depth 10

Set-Content -Path "$dataDir\agent.json" -Value $config -Encoding utf8

Write-Host "Configuracao salva em $dataDir\agent.json"
Write-Host "Para iniciar o servico: nssm install GMonitorAgent `"$installDir\gmonitor-agent.exe`""
Write-Host "Depois: nssm start GMonitorAgent"
