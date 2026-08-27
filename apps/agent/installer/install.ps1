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
} else {
  # SEMPRE baixa, mesmo se o exe ja existir. O guard antigo (`elseif -not Test-Path`) mantinha
  # a versao velha de uma tentativa anterior: na J.Kastros o instalador rodava "com sucesso" e
  # deixava um agente 0.8.0 no disco, que ficava em loop de auto-update. Quem roda o instalador
  # quer a versao atual - 58MB uma vez por instalacao e barato perto de depurar versao errada.
  Write-Host "Baixando gmonitor-agent.exe (58 MB) de $SaasUrl ..."
  $prev = $ProgressPreference; $ProgressPreference = "SilentlyContinue"
  $tmpExe = "$installDir\gmonitor-agent.exe.download"
  Invoke-WebRequest -Uri "$SaasUrl/downloads/gmonitor-agent.exe" -OutFile $tmpExe -Headers @{"Cache-Control"="no-cache"}
  $ProgressPreference = $prev
  # confere o sha256 do manifesto antes de instalar - binario truncado no meio do caminho nao entra
  try {
    $manifesto = Invoke-RestMethod -Uri "$SaasUrl/downloads/latest.json"
    $sha = (Get-FileHash $tmpExe -Algorithm SHA256).Hash.ToLower()
    if ($sha -ne $manifesto.sha256) {
      Remove-Item -Force $tmpExe
      Write-Error "Download corrompido (sha256 nao confere). Rode o instalador de novo."
      exit 1
    }
    Write-Host "gmonitor-agent.exe v$($manifesto.version) baixado e verificado"
  } catch {
    Write-Host "AVISO: nao consegui conferir o sha256 - seguindo com o arquivo baixado"
  }
  # Stop-Service (cmdlet) e nao `net stop`: o net.exe escreve em stderr quando o servico ja
  # esta parado ("O servico nao foi iniciado") e, com ErrorActionPreference=Stop, o PowerShell
  # ABORTA o instalador ali mesmo - foi o que aconteceu na Ferragista em 27/08. O cmdlet
  # respeita -ErrorAction e simplesmente segue.
  Stop-Service -Name GMonitorAgent -Force -ErrorAction SilentlyContinue
  Move-Item -Force $tmpExe $exePath
  Remove-Item -Force "$installDir\gmonitor-agent.exe.new" -ErrorAction SilentlyContinue
}

# Sem -Token e sem -Cnpj: DETECTA primeiro, pergunta so se falhar. A ordem antiga (perguntar
# antes) existia porque a deteccao levava ~90s varrendo 53 tabelas; desde 27/08 ela consulta a
# tabela EMITENTE (o emitente fiscal do GDOOR = a propria loja) e responde em ~3s, entao nao ha
# mais motivo pra fazer o instalador digitar nada. Medido nos bancos reais das duas lojas.
if (-not $Token -and -not $Cnpj) {
  if (Test-Path $exePath) {
    Write-Host "Procurando o CNPJ da loja no banco do GDOOR..."
    try {
      # Pega so a ULTIMA linha nao vazia: se o exe imprimir qualquer coisa antes (log), o
      # ConvertFrom-Json receberia varios objetos e devolveria um ARRAY - ai $detected.value
      # vira lista e o CNPJ sai com espaco na frente, que a API rejeita.
      $saida = & $exePath --detect-cnpj --fdb-path $FdbPath --fb-user $FbUser --fb-password $FbPassword 2>$null
      $ultima = ($saida | Where-Object { $_ -and $_.Trim() -ne '' } | Select-Object -Last 1)
      $detected = $ultima | ConvertFrom-Json
    } catch {
      $detected = $null
    }
    if ($detected -and $detected.value) {
      # Trim de seguranca: CNPJ com espaco nao casa com o cadastro no servidor.
      $digitos = ([string]$detected.value).Trim() -replace '[^0-9]', ''
      $formatted = $digitos -replace '(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})', '$1.$2.$3/$4-$5'
      # Confirma antes de registrar: cadastrar a loja na empresa ERRADA da um trabalhao pra
      # desfazer. Enter aceita, entao o caminho feliz e uma tecla.
      $confirm = Read-Host "CNPJ encontrado: $formatted (tabela $(([string]$detected.table).Trim())) - usar este? [S/n]"
      if ($confirm -eq '' -or $confirm -match '^[sS]') { $Cnpj = $formatted }
    } else {
      Write-Host "Nao encontrei o CNPJ no banco (o GDOOR desta maquina pode ter outro layout)."
    }
  }
  if (-not $Cnpj) {
    $Cnpj = (Read-Host "Digite o CNPJ da empresa").Trim()
  }
}

if (-not $Token -and -not $Cnpj) {
  Write-Error "Informe -Token (gerado na tela de Empresas) OU -Cnpj (autocadastro)."
  exit 1
}

if ($Cnpj) {
  Write-Host "Validando CNPJ $Cnpj em $SaasUrl..."
  $Cnpj = ([string]$Cnpj).Trim()
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

# SEM BOM. `Set-Content -Encoding utf8` no PowerShell 5.1 grava BOM (EF BB BF) e o agente
# quebrava no JSON.parse antes de logar qualquer coisa - o servico so ficava "Paused".
[System.IO.File]::WriteAllText("$dataDir\agent.json", $config, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "Configuracao salva em $dataDir\agent.json"

# Servico Windows via NSSM. AppExit=Restart + 5s e o que permite o AUTO-UPDATE: o agente baixa
# a versao nova, troca o .exe por um .bat e sai - o NSSM sobe de novo ja com a versao nova.
$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if (-not $nssm) {
  $local = Join-Path $PSScriptRoot "nssm.exe"
  if (Test-Path $local) { Copy-Item $local "$installDir\nssm.exe" -Force; $nssm = "$installDir\nssm.exe" }
}
# Sem nssm no PATH nem ao lado do script: usa o que ja esta no installDir (de uma tentativa
# anterior) ou baixa do proprio servidor. BUG corrigido 26/08: quando o nssm.exe JA existia em
# installDir mas nao no PATH, o guard antigo pulava o download E nao setava $nssm - caia no
# "nssm nao encontrado" com o arquivo ali do lado.
if (-not $nssm) {
  if (Test-Path "$installDir\nssm.exe") {
    $nssm = "$installDir\nssm.exe"
  } else {
    try {
      Write-Host "Baixando nssm.exe de $SaasUrl ..."
      Invoke-WebRequest -Uri "$SaasUrl/downloads/nssm.exe" -OutFile "$installDir\nssm.exe"
      $nssm = "$installDir\nssm.exe"
    } catch {
      $nssm = $null
    }
  }
}
if ($nssm) {
  $n = if ($nssm.Source) { $nssm.Source } else { $nssm }
  # nssm escreve em stderr e retorna != 0 ("Can't open service!") quando o servico ainda nao
  # existe (1a instalacao). Com ErrorActionPreference=Stop isso ABORTAVA antes do install e o
  # servico nunca subia (visto na J.Kastros 26/08). So limpa se ja existir; e afrouxa o modo
  # estrito nas chamadas do nssm, que sao ruidosas por natureza.
  $prevEap = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  if (Get-Service -Name GMonitorAgent -ErrorAction SilentlyContinue) {
    & $n stop GMonitorAgent 2>&1 | Out-Null
    & $n remove GMonitorAgent confirm 2>&1 | Out-Null
  }
  & $n install GMonitorAgent "$installDir\gmonitor-agent.exe" 2>&1 | Out-Null
  & $n set GMonitorAgent AppDirectory $installDir 2>&1 | Out-Null
  # LOG do servico. Sem isto o agente que morre no boot nao deixa rastro nenhum e o servico so
  # aparece como "Paused" - foi o que cegou o diagnostico na J.Kastros em 27/08. Rotaciona em
  # 10MB pra nao encher o disco da loja.
  & $n set GMonitorAgent AppStdout "$installDir\service.log" 2>&1 | Out-Null
  & $n set GMonitorAgent AppStderr "$installDir\service.log" 2>&1 | Out-Null
  & $n set GMonitorAgent AppRotateFiles 1 2>&1 | Out-Null
  & $n set GMonitorAgent AppRotateBytes 10485760 2>&1 | Out-Null
  & $n set GMonitorAgent AppExit Default Restart 2>&1 | Out-Null
  & $n set GMonitorAgent AppRestartDelay 5000 2>&1 | Out-Null
  & $n set GMonitorAgent Start SERVICE_AUTO_START 2>&1 | Out-Null
  & $n start GMonitorAgent 2>&1 | Out-Null
  $ErrorActionPreference = $prevEap
  Start-Sleep -Seconds 2
  $svc = Get-Service -Name GMonitorAgent -ErrorAction SilentlyContinue
  if ($svc -and $svc.Status -eq 'Running') {
    Write-Host "Servico GMonitorAgent instalado e RODANDO (auto-update ligado)."
  } else {
    # 'Paused' = o NSSM desistiu porque o agente fechou sozinho varias vezes seguidas. Nao
    # adianta mandar 'start' de novo: e preciso ver POR QUE ele fecha. Rodar o exe na frente
    # mostra o erro na hora (banco inacessivel, caminho do .FDB errado, etc).
    Write-Host ""
    Write-Host "ATENCAO: o servico ficou com status '$($svc.Status)' - o agente nao conseguiu subir."
    Write-Host "Rode a linha abaixo para ver o motivo na tela:"
    Write-Host "  & '$installDir\gmonitor-agent.exe'"
    Write-Host "O log do servico fica em: $installDir\service.log"
  }
} else {
  Write-Host "nssm nao encontrado. Baixe em nssm.cc, coloque nssm.exe ao lado deste script e rode de novo - ou rode na mao:"
  Write-Host "  nssm install GMonitorAgent `"$installDir\gmonitor-agent.exe`""
  Write-Host "  nssm set GMonitorAgent AppExit Default Restart"
  Write-Host "  nssm set GMonitorAgent AppRestartDelay 5000"
  Write-Host "  nssm start GMonitorAgent"
}
