# Instalador PowerShell do G-Monitor Agent.
#
# IMPORTANTE (26/08): este arquivo e ASCII puro de proposito. O Windows PowerShell 5.1 le
# .ps1 sem BOM como ANSI (CP1252): acento e travessao viram bytes que quebram as aspas e o
# script nao roda ("a cadeia de caracteres nao tem o terminador"). Nao reintroduzir acentos,
# travessao (use "-"), aspas curvas ou emoji aqui.
#
# Modo 1 (autocadastro pelo login): so pede o CNPJ, o agente troca por um token sozinho. Se a
# empresa ainda nao foi aprovada, o agente instala e fica tentando conectar ate a aprovacao.
#   .\install.ps1 -Cnpj "12.345.678/0001-90" -SaasUrl "https://gmonitor.maissistem.com.br" -WsUrl "wss://gmonitor.maissistem.com.br/ws/agent" -FdbPath "C:\GDOOR Sistemas\GDOOR PRO\DATAGES.FDB" -FbPassword "masterkey"
#
# Modo 1b: nem -Cnpj precisa - se nenhum dos dois for passado, o instalador acha o CNPJ sozinho
# no proprio Firebird e pede confirmacao. Se nao achar, pede pra digitar.
#
# Modo 2 (token gerado na tela de Empresas): troca -Cnpj por -Token "agt_xxx_xxx_xxx".

param(
  [string]$Token,
  [string]$Cnpj,
  # Defaults do dominio de producao - assim a 1 linha do painel roda sem passar parametro.
  [string]$SaasUrl = "https://gmonitor.maissistem.com.br",
  [string]$WsUrl = "wss://gmonitor.maissistem.com.br/ws/agent",
  [string]$FdbPath = "C:\GDOOR Sistemas\GDOOR PRO\DATAGES.FDB",
  [string]$FbPassword = "masterkey",
  [string]$FbUser = "SYSDBA",
  [string]$Channel = "stable",
  # 90s (nao 30s): servico leve, intervalo ja validado em producao.
  [int]$SyncIntervalMs = 90000
)

$ErrorActionPreference = "Stop"

$installDir = "C:\Program Files\GMonitor\Agent"
$dataDir = "$env:PROGRAMDATA\GMonitor"

if (-not (Test-Path $installDir)) { New-Item -ItemType Directory -Force -Path $installDir | Out-Null }
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Force -Path $dataDir | Out-Null }

# Se o .exe nao veio ao lado do script (caso do instalador de 1 linha, que baixa so o .ps1),
# baixa o executavel do mesmo servidor antes de seguir - a autodeteccao precisa dele.
$exeSource = Join-Path $PSScriptRoot "gmonitor-agent.exe"
$exePath = "$installDir\gmonitor-agent.exe"
if (Test-Path $exeSource) {
  Copy-Item -Path $exeSource -Destination $exePath -Force
  Write-Host "gmonitor-agent.exe copiado para $installDir"
} elseif (-not (Test-Path $exePath)) {
  Write-Host "Baixando gmonitor-agent.exe (58 MB) de $SaasUrl ..."
  $prev = $ProgressPreference; $ProgressPreference = "SilentlyContinue"
  Invoke-WebRequest -Uri "$SaasUrl/downloads/gmonitor-agent.exe" -OutFile $exePath
  $ProgressPreference = $prev
  Write-Host "gmonitor-agent.exe salvo em $installDir"
}

if (-not $Token -and -not $Cnpj) {
  if (Test-Path $exePath) {
    Write-Host "Nenhum CNPJ informado - tentando achar sozinho no banco do GDOOR..."
    try {
      $detectJson = & $exePath --detect-cnpj --fdb-path $FdbPath --fb-user $FbUser --fb-password $FbPassword 2>$null
      $detected = $detectJson | ConvertFrom-Json
    } catch {
      $detected = $null
    }
    if ($detected -and $detected.value) {
      $formatted = $detected.value -replace '(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})', '$1.$2.$3/$4-$5'
      $confirm = Read-Host "CNPJ encontrado: $formatted (tabela $($detected.table).$($detected.column)) - usar este? (S/n)"
      if ($confirm -eq '' -or $confirm -match '^[sS]') {
        $Cnpj = $formatted
      }
    }
  }
  if (-not $Cnpj) {
    $Cnpj = Read-Host "Nao consegui achar o CNPJ sozinho - digite o CNPJ da empresa"
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
    Write-Host "IMPORTANTE: a empresa '$($resp.tenantName)' ainda esta aguardando aprovacao. O agente vai instalar normalmente e ficar tentando conectar sozinho ate ser aprovado - nao precisa rodar o instalador de novo."
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

# Servico Windows via NSSM. AppExit=Restart + 5s e o que permite o AUTO-UPDATE: o agente baixa
# a versao nova, troca o .exe por um .bat e sai - o NSSM sobe de novo ja com a versao nova.
$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if (-not $nssm) {
  $local = Join-Path $PSScriptRoot "nssm.exe"
  if (Test-Path $local) { Copy-Item $local "$installDir\nssm.exe" -Force; $nssm = "$installDir\nssm.exe" }
}
# Sem nssm ao lado: baixa do proprio servidor (o release-sync publica nssm.exe em /downloads).
if (-not $nssm -and -not (Test-Path "$installDir\nssm.exe")) {
  try {
    Write-Host "Baixando nssm.exe de $SaasUrl ..."
    Invoke-WebRequest -Uri "$SaasUrl/downloads/nssm.exe" -OutFile "$installDir\nssm.exe"
    $nssm = "$installDir\nssm.exe"
  } catch {
    $nssm = $null
  }
}
if ($nssm) {
  $n = if ($nssm.Source) { $nssm.Source } else { $nssm }
  & $n stop GMonitorAgent 2>$null | Out-Null
  & $n remove GMonitorAgent confirm 2>$null | Out-Null
  & $n install GMonitorAgent "$installDir\gmonitor-agent.exe" | Out-Null
  & $n set GMonitorAgent AppDirectory $installDir | Out-Null
  & $n set GMonitorAgent AppExit Default Restart | Out-Null
  & $n set GMonitorAgent AppRestartDelay 5000 | Out-Null
  & $n set GMonitorAgent Start SERVICE_AUTO_START | Out-Null
  & $n start GMonitorAgent | Out-Null
  Write-Host "Servico GMonitorAgent instalado e iniciado (auto-update ligado)."
} else {
  Write-Host "nssm nao encontrado. Baixe em nssm.cc, coloque nssm.exe ao lado deste script e rode de novo - ou rode na mao:"
  Write-Host "  nssm install GMonitorAgent `"$installDir\gmonitor-agent.exe`""
  Write-Host "  nssm set GMonitorAgent AppExit Default Restart"
  Write-Host "  nssm set GMonitorAgent AppRestartDelay 5000"
  Write-Host "  nssm start GMonitorAgent"
}
