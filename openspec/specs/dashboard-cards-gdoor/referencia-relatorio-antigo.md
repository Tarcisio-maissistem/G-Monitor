# Dashboard: cards do Gdoor Relatórios (referência para o G-Monitor)

- **Levantado em:** 2026-08-26, direto do sistema em produção do cliente J.Kastros
- **Origem:** `http://10.8.0.18:3001` — "Gdoor Relatórios", app antigo escrito pelo Tarcísio
- **Motivo:** o dono quer trazer os cards bons dele para o G-Monitor. O app antigo continua
  em uso e **não deve ser desligado** (decisão de 26/08: proposta de exclusão descartada
  depois que a API mostrou venda do próprio dia).

> **Acesso:** o cliente entrou na VPN em 26/08 como `10.8.0.18`. O relatório sobe na porta
> 3001 (front e API no MESMO processo — o `runtime-config.js` aponta para a própria porta) e
> o Firebird do GDOOR na 3050.

## O que o app antigo tem: 65 rotas de API

Destas, **41 responderam com dados** na varredura. As demais precisam de parâmetro
(período, id) ou pertencem a telas não usadas por este cliente.

### Os números que valem copiar primeiro

| Rota | Campos que devolve | Por que é bom |
|---|---|---|
| `/api/vendas/hoje` | `hoje{qtd,valor}`, `ontem{qtd,valor}`, `variacao_percentual`, `is_positive` | **Comparativo pronto.** Já entrega a variação calculada e o sinal — o card não precisa fazer conta |
| `/api/financeiro/caixa-hoje` | `entradas`, `saidas`, `saldo`, `saldo_fisico`, `troco`, `metricas_negocio`, `por_caixa`, `sangrias`, `suprimentos` | O mais completo de todos. Separa **saldo contábil de saldo físico** e avisa sobre venda a prazo que não entrou no caixa |
| `/api/dashboard/stats` | `totalVendas`, `faturamento`, `totalProdutos`, `totalClientes` | Os 4 números de topo, baratos de calcular |
| `/api/metas/mensal` | `meta`, `vendido`, `faltando`, `percentual`, `realizado` | Meta com o quanto **falta** — não só o percentual |

### Ranking e distribuição

| Rota | Campos |
|---|---|
| `/api/relatorios/vendas-por-vendedor` | `posicao`, `vendedor`, `qtd_vendas`, `valor_total`, `ticket_medio`, `percentual`, `score` |
| `/api/pagamentos/ranking` | `posicao`, `especie`, `qtd_vendas`, `valor_total`, `percentual` |
| `/api/relatorios/vendas-por-hora` | `hora`, `qtd_vendas`, `valor_total` |
| `/api/relatorios/vendas-por-dia-semana` | `dia_semana`, `nome_dia`, `qtd_vendas`, `valor_total` |
| `/api/vendas/por-modelo` | `modelo`, `tipo_documento`, `qtd_vendas`, `valor_total`, `ticket_medio` |
| `/api/relatorios/vendas-por-cfop` | `cfop`, `qtd_vendas`, `valor_total`, `percentual` |
| `/api/dashboard/pdvs` | `id`, `nome`, `qtd_vendas`, `primeira_venda`, `ultima_venda` |

### Margem e CMV — o que o G-Monitor ainda não tem

| Rota | Campos |
|---|---|
| `/api/produtos/cmv` | `grupo`, `qtd_produtos`, `qtd_vendida`, `cmv_total`, `faturamento`, `lucro_bruto`, `margem_percentual`, `cmv_sobre_faturamento`, `lucro_sobre_cmv` |
| `/api/produtos/ranking-lucro` | lista de produtos por lucro |
| `/api/produtos/margem` | margem por produto |
| `/api/estoque/sugestao-compras` | sugestão de reposição |
| `/api/alertas/estoque` | alertas de estoque |

**`cmv_sobre_faturamento` e `lucro_sobre_cmv` são os dois índices mais interessantes** —
não são só "lucro em reais", são as razões que dizem se a operação está saudável.

### Período e consolidado

| Rota | Campos |
|---|---|
| `/api/relatorios/evolucao-mensal` | `ano`, `mes`, `nome_mes`, `qtd_vendas`, `valor_total`, `ticket_medio`, `clientes_unicos` |
| `/api/relatorios/resumo-consolidado` | `quantidade_vendas`, `faturamento_total`, `ticket_medio`, `clientes_atendidos`, `dias_trabalhados`, `media_diaria`, `media_vendas_dia` |
| `/api/financeiro/resumo` | `quantidade_vendas`, `faturamento_total`, `ticket_medio` |

**`dias_trabalhados` + `media_diaria`** merecem cópia: faturamento do mês sozinho engana
quando o mês tem feriado ou a loja fechou um dia.

### Segmento específico: açougue

O app tem um bloco inteiro (`/api/acougue/*`) com CMV por categoria, curva ABC, metas,
comparativo anual e controle de fiados. **Não responderam na varredura** — devem exigir
parâmetro ou depender de configuração que este cliente não usa. Vale investigar antes de
desenhar equivalente, porque é a parte mais específica de mercado/açougue do sistema antigo.

## O que copiar — e o que fazer diferente

**Copiar:**
1. O par **saldo contábil × saldo físico** com o aviso de venda a prazo. É a diferença entre
   "vendi" e "tenho no caixa", e é onde o lojista se confunde.
2. A **variação já calculada** (hoje × ontem, com sinal). Card que entrega a conta pronta.
3. **Vendas por hora** e **por dia da semana** — decidem escala de funcionário.
4. Os índices de **CMV sobre faturamento** e **lucro sobre CMV**.
5. `dias_trabalhados` / `media_diaria` no consolidado.

**Fazer diferente no G-Monitor:**
- O app antigo é **local**: só funciona na máquina do cliente, com o Firebird ao lado. O
  G-Monitor já resolve acesso remoto e redundância — é a razão de existir. Os cards vêm; a
  arquitetura local, não.
- 65 rotas para um dashboard é muita superfície. Vale agrupar: um endpoint de "resumo do
  dia" que devolve o que o topo precisa, em vez de a tela fazer 8 chamadas.

## Pendência — RESPONDIDA 26/08 (sessão G-Monitor)

Backend do G-Monitor: `10.8.0.2:6070` (ms-gestor, PM2 `gmonitor-backend-pilot`), proxy pelo nginx
de `gmonitor.maissistem.com.br`. Consulta em `GET /api/agents` (com login) em 26/08 19:25:
**só o agente "Piloto - PC do Tarcisio" (v0.8.0) existe** — nas lojas J.Kastros NENHUM agente
foi instalado/registrado ainda. O dono vai rodar o instalador lá depois (decisão 26/08).
Da VPN: 10.8.0.18 tem Firebird 3050 aberto (dá para inspecionar o banco daqui) e SSH fechado
(instalação remota só com acesso do dono).
