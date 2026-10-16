import assert from "node:assert/strict";
import { after, afterEach, mock, test } from "node:test";
import type { Prisma, status_vinculo_enum } from "../src/generated/prisma/client.js";

process.env.DATABASE_URL = "postgresql://teste:teste@localhost:5432/teste";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.SUPABASE_URL = "https://teste.supabase.co";
process.env.SUPABASE_SECRET_KEY = "chave-apenas-para-testes";
const { prisma } = await import("../src/lib/prisma.js");
const { ErroDominio } = await import("../src/lib/erro-dominio.js");
const { rejeitarVinculo } = await import("../src/modules/vinculos/vinculo.service.js");
const auth = { id_usuario: "10000000-0000-4000-8000-000000000001", super_admin: true };
const alvo = {
  id_vinculo: "20000000-0000-4000-8000-000000000001", id_condominio: "30000000-0000-4000-8000-000000000001",
  id_condomino: "40000000-0000-4000-8000-000000000001", status_vinculo: "PENDENTE" as status_vinculo_enum,
  admin_condominio: false, data_aprovacao: null as Date | null, data_inicio: null as Date | null, data_fim: null as Date | null,
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

function simularRejeicao(registro: typeof alvo | null = alvo, count = 0) {
  simularMetodo(prisma.vinculo_condominio, "findUnique", async () => registro);
  const outroAtivo = simularMetodo(prisma.vinculo_condominio, "findFirst", () => { throw new Error("Rejeição não consulta outro ATIVO"); });
  const atualizar = simularMetodo(prisma.vinculo_condominio, "updateMany", async (_args: Prisma.vinculo_condominioUpdateManyArgs) => ({ count }));
  const auditoria = simularMetodo(prisma.auditoria, "create", async (_args: Prisma.auditoriaCreateArgs) => ({ id_auditoria: "auditoria-teste" }));
  const transacao = simularMetodo(prisma, "$transaction", async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, _opcoes: { isolationLevel: string }) => callback(prisma));
  return { outroAtivo, atualizar, auditoria, transacao };
}

test("service exige autenticação e autoridade antes de iniciar transação", async () => {
  const transacao = simularMetodo(prisma, "$transaction", () => { throw new Error("Não deve iniciar"); });
  await assert.rejects(rejeitarVinculo(undefined, alvo.id_vinculo), erroEsperado("UNAUTHENTICATED", 401));
  await assert.rejects(rejeitarVinculo({ ...auth, super_admin: false }, alvo.id_vinculo), erroEsperado("FORBIDDEN", 403));
  assert.equal(transacao.mock.callCount(), 0);
});

test("inexistência e estado inválido reutilizam os erros administrativos sem atualizar", async () => {
  const { atualizar, auditoria } = simularRejeicao(null);
  await assert.rejects(rejeitarVinculo(auth, alvo.id_vinculo), erroEsperado("MEMBERSHIP_NOT_FOUND", 404));
  assert.equal(atualizar.mock.callCount(), 0);
  assert.equal(auditoria.mock.callCount(), 0);
});

test("cross-tenant é bloqueado antes de revelar estado ou inconsistência", async () => {
  const { atualizar, auditoria } = simularRejeicao({ ...alvo, status_vinculo: "ATIVO", data_inicio: new Date() });
  await assert.rejects(rejeitarVinculo({ ...auth, super_admin: false, vinculo_ativo: {
    id_vinculo: "50000000-0000-4000-8000-000000000001", id_condominio: "60000000-0000-4000-8000-000000000001", admin_condominio: true,
  } }, alvo.id_vinculo), erroEsperado("FORBIDDEN_CROSS_TENANT", 403));
  assert.equal(atualizar.mock.callCount(), 0);
  assert.equal(auditoria.mock.callCount(), 0);
});

test("update condicional perdido retorna 409, preserva campos e não consulta outro ATIVO nem cria auditoria", async () => {
  const { outroAtivo, atualizar, auditoria, transacao } = simularRejeicao();
  await assert.rejects(rejeitarVinculo(auth, alvo.id_vinculo), erroEsperado("MEMBERSHIP_NOT_PENDING"));
  assert.deepEqual(atualizar.mock.calls[0].arguments[0], {
    where: {
      id_vinculo: alvo.id_vinculo, id_condominio: alvo.id_condominio, status_vinculo: "PENDENTE",
      admin_condominio: false, data_aprovacao: null, data_inicio: null, data_fim: null,
    },
    data: { status_vinculo: "REJEITADO", aprovado_por: auth.id_usuario },
  });
  assert.equal(outroAtivo.mock.callCount(), 0);
  assert.equal(auditoria.mock.callCount(), 0);
  assert.deepEqual(transacao.mock.calls[0].arguments[1], { isolationLevel: "ReadCommitted" });
});

test("pendência inconsistente não é normalizada nem recebe auditoria", async () => {
  const { atualizar, auditoria } = simularRejeicao({ ...alvo, data_aprovacao: new Date() });
  await assert.rejects(rejeitarVinculo(auth, alvo.id_vinculo), erroEsperado("MEMBERSHIP_INCONSISTENT"));
  assert.equal(atualizar.mock.callCount(), 0);
  assert.equal(auditoria.mock.callCount(), 0);
});
