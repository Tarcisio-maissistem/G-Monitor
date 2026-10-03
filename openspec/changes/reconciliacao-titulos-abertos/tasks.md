# Tasks — Reconciliação de títulos em aberto

- [x] 1. Backend: `GET /api/agent/open-titles` em `apps/backend/src/agents/syncRoutes.ts` (D1)
- [x] 2. Agente: 4 entradas `reconcile-*` no catálogo + `resolveReportComIds` (D2, D3)
- [x] 3. Agente: `reconciliarAbertos()` no syncer, chamado no tick com throttle de 6h (D4, D5, D6)
- [x] 4. Bump `AGENT_VERSION` (0.9.11 -> 0.9.12)
- [x] 5. Teste unitário: `resolveReportComIds` expande N placeholders e não interpola valor (7 casos)
- [x] 6. `tsc --noEmit` limpo no agente e no backend; suíte completa (127 testes) passando
- [x] 7. Prova da consulta do endpoint contra o banco de produção (leitura): CARVAO 7661/7663 e
       PALHOL 7662 entram na lista; 95 contas a pagar e 380 a receber por ciclo (teto é 1.000)

## Fora desta entrega (precisa de OK do dono)

- [ ] 8. **Observabilidade do schema detectado** (`Agent.financialSchema` + header no sync): deixado
      de fora porque exige **migration no Postgres de produção**, e mudança de banco passa pelo gate
      human-in-the-loop. Sem isso continua impossível provar pela nuvem qual variante
      (`PAGAR` x `CONTAS_PAGAR`) cada loja usa — hoje só pelo log do agente na máquina do cliente.
- [ ] 9. **Deploy** (backend no ms-gestor + release do agente 0.9.12 para as lojas) — gate de produção.
- [ ] 10. **Prova ponta a ponta no J.Kastros**: depois do deploy, confirmar que CARVAO/PALHOL saem de
      "vencido" no primeiro ciclo e que o total de contas a receber vencidas cai dos 111 presos.
