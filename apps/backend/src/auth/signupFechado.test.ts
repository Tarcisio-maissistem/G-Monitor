// v2026-10-24 — change fechar-autocadastro-empresa.
// Trava a decisão do dono (24/10): NÃO existe cadastro público de empresa. Em 21/10 uma
// rodada de QA usou `POST /api/auth/signup` e criou 5 empresas que o dono não reconheceu.
// Sem este teste, alguém reintroduz a rota sem perceber.
import { describe, it, expect } from "vitest";
import Fastify from "fastify";

// config.ts valida o ambiente no import — preenche o mínimo para carregar o módulo.
process.env.DATABASE_URL ||= "postgresql://u:p@localhost:5432/db";
process.env.REDIS_URL ||= "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET ||= "x".repeat(32);
process.env.JWT_REFRESH_SECRET ||= "y".repeat(32);
process.env.AGENT_TOKEN_SECRET ||= "z".repeat(32);

async function montar() {
  const { authRoutes } = await import("./routes.js");
  const app = Fastify();
  await app.register(authRoutes);
  return app;
}

describe("cadastro público de empresa está fechado", () => {
  it("POST /api/auth/signup responde 404 — a rota não existe mais", async () => {
    const app = await montar();
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { tenantName: "Loja Fantasma", cnpj: "11222333000181", email: "x@y.com", name: "Fulano", password: "senhasenha12" },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("o login continua existindo (não derrubamos o módulo junto)", async () => {
    const app = await montar();
    const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "x@y.com", password: "123" } });
    expect(r.statusCode).not.toBe(404);
    await app.close();
  });

  it("o ÚNICO caminho de criar empresa exige super-admin", async () => {
    const { adminRoutes } = await import("../admin/routes.js");
    const app = Fastify();
    await app.register(adminRoutes);
    const r = await app.inject({ method: "POST", url: "/api/admin/tenants", payload: { name: "Loja Fantasma" } });
    // sem token: recusado (401/403) — nunca criado
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
    expect(r.statusCode).toBeLessThan(500);
    await app.close();
  });
});
