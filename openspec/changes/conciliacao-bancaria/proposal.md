# Conciliação bancária: cartão, PIX TEF (Shipay) e PIX estático

- **Pedido do dono:** 26/08/2026
- **Status:** proposta (aguarda credencial do portal TEF para a Fase 3)

## Problema

O lojista vende R$ 460 mil em cartão por mês (Piloto, agosto/2026) e **não sabe quanto
disso realmente cai na conta**. Entre a venda e o depósito existem a taxa da adquirente, o
prazo de recebimento e, eventualmente, transação que simplesmente não é repassada. Hoje o
G-Monitor mostra só o valor BRUTO da venda — o líquido é invisível.

Três canais precisam de conciliação, cada um com taxa própria:
1. **Cartão nas maquininhas POS** (Cielo, Rede) — taxa por bandeira/tipo/parcelas
2. **PIX pelo TEF (Shipay)** — taxa por transação
3. **PIX estático** (QR fixo da loja) — taxa própria (ou zero)

## O que foi apurado no banco do cliente (26/08, Firebird do PC do dono)

| Achado | Consequência no desenho |
|---|---|
| `MOVIMENTACAO_CARTAO`: **8.561 transações, 100% com NSU**, abr–ago/2026 | O NSU é a **chave de conciliação** com o extrato da adquirente. Dá para casar transação a transação. |
| `MOVIMENTACAO_CARTAO.BANDEIRA` traz **REDE / CIELO** (adquirente, não bandeira do cartão) | Agrupar por adquirente vem de graça; bandeira real do cartão não está disponível. |
| `VENDA_PAGAMENTO_CARTAO`: 8.645 vínculos | Liga a transação de cartão ao pagamento/venda — dá para achar a venda de uma divergência. |
| `TAXAS_CARTAO`: 10 linhas, **TODAS com TAXA = 0%** | **O GDOOR não tem as taxas reais.** Elas precisam ser cadastradas no G-Monitor — é a razão de a tela de configuração existir. |
| `TEF_VENDAS`, `TEF_POS`, `MAQUINA_CARTAO`: **vazias** | O GDOOR não guarda o TEF desta loja. O dado do TEF só existe no portal externo. |
| Portal `relatoriodevendas.com.br`: CodeIgniter com `csrf_cookie_name` + `ci_session_1`, login redireciona | Coleta exige sessão + token CSRF; é raspagem autenticada, não API. |

## Objetivo

Responder três perguntas que hoje ninguém responde:
1. **Quanto era pra cair?** — bruto − taxa, por adquirente/canal, com data prevista.
2. **Caiu tudo?** — casar NSU a NSU o que o GDOOR registrou contra o extrato do portal TEF.
3. **A taxa cobrada foi a combinada?** — comparar taxa real do extrato com a cadastrada.

## Escopo em 3 fases (cada uma entrega valor sozinha)

- **Fase 1 — transações de cartão no G-Monitor.** Agente sincroniza `MOVIMENTACAO_CARTAO` +
  `VENDA_PAGAMENTO_CARTAO`. Tela lista as transações com NSU, adquirente, valor, data.
- **Fase 2 — taxas e líquido previsto.** Cadastro de taxas por adquirente/canal/parcelas
  (POS, PIX TEF/Shipay, PIX estático) + cálculo **bruto → taxa → líquido previsto** e a data
  prevista de crédito. Já responde a pergunta 1 sem depender do portal.
- **Fase 3 — conciliação contra o extrato.** Configuração de usuário/senha do portal
  (cifrada), coleta do CSV por período e casamento por NSU: conciliado / não repassado /
  só no extrato / taxa divergente.

## Não faz parte

- Integração com banco (OFX/extrato bancário) — a conciliação é contra a **adquirente**.
- Lançar contas a receber automaticamente a partir do previsto (fica como decisão futura).
- Antecipação de recebíveis: `TAXAS_CARTAO` tem os campos, mas a loja não usa hoje.
