import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { Errors } from '@gmonitor/shared';
import { seal, isSealed } from '../lib/secretBox.js';
import { prisma } from '../db/prisma.js';
import { requireAuth, requireCapability } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';

const updateTenantSchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
});

const createStoreSchema = z.object({
  name: z.string().min(2),
  externalId: z.string().min(1),
  timezone: z.string().default('America/Sao_Paulo'),
});

const updateStoreSchema = z.object({
  name: z.string().min(2).optional(),
  timezone: z.string().optional(),
});

// Configuracoes de negocio (meta mensal, regras de comissao) — guardadas em Tenant.meta
// (JSON) pra nao precisar de tabela nova so pra 2 campos. Usado por MetaMensalPage e
// ComissaoPage (resgatadas 23/08, nunca tinham backend correspondente).
// Taxas de adquirente por canal (conciliacao bancaria, Fase 2 — 26/08). Ficam em tenant.meta
// (mesmo padrao de monthlyGoal/commissionRules) porque sao poucas linhas por loja e nao
// justificam tabela propria. `installments: null` = vale para qualquer parcelamento;
// `acquirer: null` = vale para qualquer adquirente (Cielo/Rede). Ver openspec D21.
const feeRuleSchema = z.object({
  channel: z.enum(['tef_debito', 'tef_credito', 'pos_debito', 'pos_credito', 'pix_tef', 'pix_estatico']),
  acquirer: z.string().max(40).nullable().optional(),
  installments: z.number().int().min(1).max(24).nullable().optional(),
  percent: z.number().min(0).max(100),
  fixedValue: z.number().min(0).default(0),
  daysToReceive: z.number().int().min(0).max(180).default(1),
});

const settingsSchema = z.object({
  monthlyGoal: z.number().nonnegative().optional(),
  commissionRules: z.array(z.object({ operator: z.string(), percent: z.number().min(0).max(100) })).optional(),
  feeRules: z.array(feeRuleSchema).max(60).optional(),
});

export async function tenantRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/tenant/me', { preHandler: [requireAuth] }, async (req) => {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.user!.tenantId } });
    return { tenant };
  });

  app.patch('/api/tenant/me', { preHandler: [requireAuth, requireCapability('tenant.update'), audit({ action: 'tenant.update', captureBody: true })] }, async (req) => {
    const body = updateTenantSchema.parse(req.body);
    const tenant = await prisma.tenant.update({
      where: { id: req.user!.tenantId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.meta !== undefined ? { meta: body.meta as Prisma.InputJsonValue } : {}),
      },
    });
    return { tenant };
  });

  app.get('/api/tenant/settings', { preHandler: [requireAuth] }, async (req) => {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.user!.tenantId }, select: { meta: true } });
    const meta = (tenant?.meta ?? {}) as Record<string, unknown>;
    return { settings: { monthlyGoal: meta.monthlyGoal, commissionRules: meta.commissionRules, feeRules: meta.feeRules ?? [] } };
  });

  app.patch('/api/tenant/settings', { preHandler: [requireAuth, requireCapability('tenant.update'), audit({ action: 'tenant.settings.update', captureBody: true })] }, async (req) => {
    const body = settingsSchema.parse(req.body);
    const tenant = await prisma.tenant.findUnique({ where: { id: req.user!.tenantId }, select: { meta: true } });
    const meta = { ...(tenant?.meta as Record<string, unknown> ?? {}), ...body };
    const updated = await prisma.tenant.update({
      where: { id: req.user!.tenantId },
      data: { meta: meta as Prisma.InputJsonValue },
    });
    const updatedMeta = updated.meta as Record<string, unknown>;
    return { settings: { monthlyGoal: updatedMeta.monthlyGoal, commissionRules: updatedMeta.commissionRules, feeRules: updatedMeta.feeRules ?? [] } };
  });

  // ─── Integracoes de terceiro (27/08) ───────────────────────────────────────────────
  // Hoje so o portal GetCard (conciliacao). A SENHA e cifrada com AES-256-GCM (secretBox) e a
  // API NUNCA a devolve, nem mascarada — devolve `temSenha`. Guardar a senha em claro no meta
  // seria pior que nao ter cifra nenhuma, porque daria a falsa sensacao de estar protegida.
  const getcardSchema = z.object({
    user: z.string().min(3).max(60),
    // opcional no PATCH: mandar so o usuario mantem a senha ja salva
    password: z.string().min(1).max(120).optional(),
  });

  app.get('/api/tenant/integracoes', { preHandler: [requireAuth] }, async (req) => {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.user!.tenantId }, select: { meta: true } });
    const g = ((tenant?.meta as Record<string, unknown> ?? {}).getcard ?? {}) as { user?: string; senha?: string };
    return { getcard: { user: g.user ?? null, temSenha: isSealed(g.senha) } };
  });

  app.put('/api/tenant/integracoes/getcard', { preHandler: [requireAuth, requireCapability('tenant.update'), audit({ action: 'tenant.integracao.getcard', entity: 'tenant' })] }, async (req) => {
    const body = getcardSchema.parse(req.body);
    const tenant = await prisma.tenant.findUnique({ where: { id: req.user!.tenantId }, select: { meta: true } });
    const meta = (tenant?.meta as Record<string, unknown>) ?? {};
    const atual = (meta.getcard ?? {}) as { senha?: string };
    const getcard = {
      user: body.user,
      senha: body.password ? seal(body.password) : atual.senha, // sem senha nova, mantem a antiga
    };
    await prisma.tenant.update({ where: { id: req.user!.tenantId }, data: { meta: { ...meta, getcard } as Prisma.InputJsonValue } });
    return { getcard: { user: getcard.user, temSenha: isSealed(getcard.senha) } };
  });

  app.get('/api/tenant/stores', { preHandler: [requireAuth] }, async (req) => {
    const stores = await prisma.store.findMany({
      where: { tenantId: req.user!.tenantId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
    return { stores };
  });

  app.post('/api/tenant/stores', { preHandler: [requireAuth, requireCapability('store.create'), audit({ action: 'store.create', entity: 'store', captureBody: true })] }, async (req, reply) => {
    const body = createStoreSchema.parse(req.body);
    const store = await prisma.store.create({
      data: { ...body, tenantId: req.user!.tenantId },
    });
    reply.status(201).send({ store });
  });

  app.patch('/api/tenant/stores/:id', { preHandler: [requireAuth, requireCapability('store.update'), audit({ action: 'store.update', entity: 'store', captureBody: true })] }, async (req) => {
    const { id } = req.params as { id: string };
    const body = updateStoreSchema.parse(req.body);
    const store = await prisma.store.findFirst({
      where: { id, tenantId: req.user!.tenantId, deletedAt: null },
    });
    if (!store) throw Errors.notFound('Loja nao encontrada');
    const updated = await prisma.store.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      },
    });
    return { store: updated };
  });

  app.delete('/api/tenant/stores/:id', { preHandler: [requireAuth, requireCapability('store.delete'), audit({ action: 'store.delete', entity: 'store' })] }, async (req) => {
    const { id } = req.params as { id: string };
    const store = await prisma.store.findFirst({
      where: { id, tenantId: req.user!.tenantId, deletedAt: null },
    });
    if (!store) throw Errors.notFound('Loja nao encontrada');
    await prisma.store.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  });
}
