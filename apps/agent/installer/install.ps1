# Instalador PowerShell do G-Monitor Agent.
#
# Modo 1 (autocadastro pelo login — pedido do dono 24/08): so pede o CNPJ, o agente troca
# por um token sozinho. Se a empresa ainda nao foi aprovada pelo administrador, o agente
# fica instalado e tentando conectar em backoff ate a aprovacao (nao precisa reinstalar).
#   .\install.ps1 -Cnpj "12.345.678/0001-90" -SaasUrl "https://gmonitor-pilot.anafood.vip" -WsUrl "wss://gmonitor-pilot.anafood.vip/ws/agent" -FdbPath "C:\GDOOR Sistemas\GDOOR PRO\DATAGES.FDB" -FbPassword "masterkey"
#
# Modo 1b (pedido do dono 25/08): nem -Cnpj precisa — se nenhum dos dois for passado, o
# instalador tenta achar o CNPJ sozinho no proprio Firebird (varre por coluna tipo CNPJ/CGC
# nas tabelas do GDOOR) e pede confirmacao antes de usar. Se nao achar, pede pra digitar.
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

$installDir = "C:\Program Files\GMonitor\Agent"
$dataDir = "$env:PROGRAMDATA\GMonitor"

if (-not (Test-Path $installDir)) { New-Item -ItemType Directory -Force -Path $installDir | Out-Null }
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Force -Path $dataDir | Out-Null }

# Copia o executavel se ele estiver do lado do script (download costuma trazer os dois
# juntos) — precisa estar em $installDir ANTES da autodeteccao, que roda esse mesmo .exe.
$exeSource = Join-Path $PSScriptRoot "gmonitor-agent.exe"
$exePath = "$installDir\gmonitor-agent.exe"
if (Test-Path $exeSource) {
  Copy-Item -Path $exeSource -Destination $exePath -Force
  Write-Host "gmonitor-agent.exe copiado para $installDir"
}

if (-not $Token -and -not $Cnpj) {
  if (Test-Path $exePath) {
    Write-Host "Nenhum CNPJ informado — tentando achar sozinho no banco do GDOOR..."
    try {
      $detectJson = & $exePath --detect-cnpj --fdb-path $FdbPath --fb-user $FbUser --fb-password $FbPassword 2>$null
      $detected = $detectJson | ConvertFrom-Json
    } catch {
      $detected = $null
    }
    if ($detected -and $detected.value) {
      $formatted = $detected.value -replace '(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})', '$1.$2.$3/$4-$5'
      $confirm = Read-Host "CNPJ encontrado: $formatted (tabela $($detected.table).$($detected.column)) — usar este? (S/n)"
      if ($confirm -eq '' -or $confirm -match '^[sS]') {
        $Cnpj = $formatted
      }
    }
  }
  if (-not $Cnpj) {
    $Cnpj = Read-Host "Nao consegui achar o CNPJ sozinho — digite o CNPJ da empresa"
  }
}

if (-not $Token -and -not $Cnpj) {
  Write-Error "Informe -Token (gerado na tela de Empresas) OU -Cnpj (autocadastro)."
  exit 1
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
