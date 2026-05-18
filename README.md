# G-Monitor

Plataforma SaaS multi-tenant de BI/dashboard gerencial para varejistas que utilizam o ERP/PDV GDOOR PRO.

Hospedada em VPS, com agente leve instalado na máquina onde roda o Firebird local. Comunicação outbound via WebSocket TLS — sem porta aberta na loja.

## Estado atual

Fase de especificação. Toda a arquitetura, requisitos e tarefas estão descritos em [`openspec/`](./openspec/) seguindo o formato [OpenSpec](https://github.com/Fission-AI/OpenSpec).

## Estrutura

```
G-Monitor/
├── README.md                            # este arquivo
└── openspec/
    ├── config.yaml                      # convenções do projeto
    ├── project.md                       # contexto, personas, stack
    └── changes/
        └── create-saas-platform/        # change inicial (greenfield)
            ├── proposal.md              # motivação e capabilities
            ├── design.md                # arquitetura e decisões
            ├── tasks.md                 # checklist de implementação
            └── specs/                   # uma capability por pasta
                ├── tenant-management/
                ├── user-auth/
                ├── agent-connection/
                ├── agent-rpc/
                ├── firebird-bridge/
                ├── query-routing/
                ├── data-sync/
                ├── dashboard-reports/
                ├── observability/
                ├── agent-updater/
                ├── billing/
                ├── audit-log/
                └── notification-engine/
```

## Como navegar

1. Comece por [`openspec/project.md`](./openspec/project.md) para contexto geral.
2. Leia [`openspec/changes/create-saas-platform/proposal.md`](./openspec/changes/create-saas-platform/proposal.md) para entender escopo.
3. Veja [`openspec/changes/create-saas-platform/design.md`](./openspec/changes/create-saas-platform/design.md) para arquitetura e decisões.
4. Consulte specs individuais em `openspec/changes/create-saas-platform/specs/<capability>/spec.md`.
5. Acompanhe progresso em [`openspec/changes/create-saas-platform/tasks.md`](./openspec/changes/create-saas-platform/tasks.md).

## Próximos passos

- Validar specs com stakeholders (você + sócios + cliente piloto).
- Instalar CLI OpenSpec: `npm install -g @fission-ai/openspec@latest`.
- Após aprovação, executar tasks em ordem (1 → 19). Cada item completo marca `[x]`.
- Após o change implementado, arquivar com `openspec archive`; os specs migram para `openspec/specs/`.

## Projeto separado

Este projeto NÃO compartilha código com `gdoor-relatorio` (sistema local atual). O `gdoor-relatorio` continua existindo apenas para consulta e operação dos clientes que ainda não migraram.
