import assert from "node:assert/strict";
import { after, afterEach, mock, test } from "node:test";
import type { Prisma, status_vinculo_enum } from "../src/generated/prisma/client.js";

process.env.DATABASE_URL = "postgresql://teste:teste@localhost:5432/teste";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.SUPABASE_URL = "https://teste.supabase.co";
process.env.SUPABASE_SECRET_KEY = "chave-apenas-para-testes";
const { prisma } = await import("../src/lib/prisma.js");
const { ErroDominio } = await import("../src/lib/erro-dominio.js");
const { suspenderVinculo } = await import("../src/modules/vinculos/vinculo.service.js");
const auth = { id_usuario: "10000000-0000-4000-8000-000000000001", super_admin: true };
const alvo = {
  id_vinculo: "20000000-0000-4000-8000-000000000001", id_condominio: "30000000-0000-4000-8000-000000000001",
  id_condomino: "40000000-0000-4000-8000-000000000001", status_vinculo: "ATIVO" as status_vinculo_enum,
};
const restauradores: (() => void)[] = [];
function simularMetodo<T extends (...args: never[]) => unknown>(objeto: object, nome: string, implementacao: T) {
  const original: unknown = Reflect.get(objeto, nome);
  const simulado = mock.fn(implementacao);
  Reflect.set(objeto, nome, simulado);
  restauradores.push(() => { Reflect.set(objeto, nome, original); });
  return simulado;
}
afterEach(() => { for (const restaurar of restauradores.splice(0).reverse()) restaurar(); });
after(async () => { await prisma.$disconnect(); });
const erroEsperado = (codigo: string, status = 409) => (erro: unknown) =>
  erro instanceof ErroDominio && erro.codigo === codigo && erro.statusHttp === status;

function simularSuspensao(registro: typeof alvo | null = alvo) {
  simularMetodo(prisma.vinculo_condominio, "findUnique", async () => registro);
  const contar = simularMetodo(prisma.vinculo_condominio, "count", () => { throw new Error("Não deve contar administradores"); });
  const atualizar = simularMetodo(prisma.vinculo_condominio, "updateMany", async (_args: Prisma.vinculo_condominioUpdateManyArgs) => ({ count: 0 }));
  const auditoria = simularMetodo(prisma.auditoria, "create", async () => ({ id_auditoria: "auditoria-teste" }));
  const transacao = simularMetodo(prisma, "$transaction", async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, _opcoes: { isolationLevel: string }) => callback(prisma));
  return { contar, atualizar, auditoria, transacao };
}

test("service exige autenticação e autoridade antes de iniciar transação", async () => {
  const transacao = simularMetodo(prisma, "$transaction", () => { throw new Error("Não deve iniciar"); });
  await assert.rejects(suspenderVinculo(undefined, alvo.id_vinculo), erroEsperado("UNAUTHENTICATED", 401));
  await assert.rejects(suspenderVinculo({ ...auth, super_admin: false }, alvo.id_vinculo), erroEsperado("FORBIDDEN", 403));
  assert.equal(transacao.mock.callCount(), 0);
});

test("inexistência reutiliza MEMBERSHIP_NOT_FOUND sem atualizar ou criar auditoria", async () => {
  const { atualizar, auditoria } = simularSuspensao(null);
  await assert.rejects(suspenderVinculo(auth, alvo.id_vinculo), erroEsperado("MEMBERSHIP_NOT_FOUND", 404));
  assert.equal(atualizar.mock.callCount(), 0);
  assert.equal(auditoria.mock.callCount(), 0);
});

test("cross-tenant é bloqueado antes de revelar estado do alvo", async () => {
  const { atualizar, auditoria } = simularSuspensao({ ...alvo, status_vinculo: "PENDENTE" });
  await assert.rejects(suspenderVinculo({ ...auth, super_admin: false, vinculo_ativo: {
    id_vinculo: "50000000-0000-4000-8000-000000000001", id_condominio: "60000000-0000-4000-8000-000000000001", admin_condominio: true,
  } }, alvo.id_vinculo), erroEsperado("FORBIDDEN_CROSS_TENANT", 403));
  assert.equal(atualizar.mock.callCount(), 0);
  assert.equal(auditoria.mock.callCount(), 0);
});

test("update condicional perdido gera 409, altera somente status e não cria auditoria ou regra de último admin", async () => {
  const { contar, atualizar, auditoria, transacao } = simularSuspensao();
  await assert.rejects(suspenderVinculo(auth, alvo.id_vinculo), erroEsperado("MEMBERSHIP_NOT_ACTIVE"));
  assert.deepEqual(atualizar.mock.calls[0].arguments[0], {
    where: { id_vinculo: alvo.id_vinculo, id_condominio: alvo.id_condominio, status_vinculo: "ATIVO" },
    data: { status_vinculo: "SUSPENSO" },
  });
  assert.equal(contar.mock.callCount(), 0);
  assert.equal(auditoria.mock.callCount(), 0);
  assert.deepEqual(transacao.mock.calls[0].arguments[1], { isolationLevel: "ReadCommitted" });
});
