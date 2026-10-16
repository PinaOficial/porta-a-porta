import assert from "node:assert/strict";
import { after, afterEach, mock, test } from "node:test";
import type { Request, Response } from "express";
import type { Prisma as TiposPrisma } from "../src/generated/prisma/client.js";

process.env.DATABASE_URL = "postgresql://teste:teste@localhost:5432/teste";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.SUPABASE_URL = "https://teste.supabase.co";
process.env.SUPABASE_SECRET_KEY = "chave-apenas-para-testes";
const { prisma } = await import("../src/lib/prisma.js");
const { Prisma } = await import("../src/generated/prisma/client.js");
const { ErroDominio } = await import("../src/lib/erro-dominio.js");
const { aprovarVinculo } = await import("../src/modules/vinculos/vinculo.service.js");
const { decisaoVinculoParamsSchema } = await import("../src/modules/vinculos/vinculo.schema.js");
const { validarParams } = await import("../src/middlewares/validar.js");
const idVinculo = "abcdef00-0000-4000-8000-000000000001";
const idCondominio = "20000000-0000-4000-8000-000000000001";
const auth = { id_usuario: "10000000-0000-4000-8000-000000000001", super_admin: true };
const alvo = { id_vinculo: idVinculo, id_condominio: idCondominio, id_condomino: "30000000-0000-4000-8000-000000000001", status_vinculo: "PENDENTE" };
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

test("params exige UUID e normaliza caixa; validação HTTP interrompe antes do controller", () => {
  assert.deepEqual(decisaoVinculoParamsSchema.parse({ id: idVinculo.toUpperCase() }), { id: idVinculo });
  let status = 0;
  let body: unknown;
  const res = {
    status(valor: number) { status = valor; return this; },
    json(valor: unknown) { body = valor; return this; },
  } as unknown as Response;
  const next = mock.fn();
  validarParams(decisaoVinculoParamsSchema)({ params: { id: "abc" } } as unknown as Request, res, next);
  assert.equal(status, 400);
  assert.equal((body as { erro: string }).erro, "VALIDATION_ERROR");
  assert.equal(next.mock.callCount(), 0);
});

test("service nega falta de autenticação ou autoridade antes de iniciar transação", async () => {
  const transacao = simularMetodo(prisma, "$transaction", () => { throw new Error("Não deve iniciar"); });
  await assert.rejects(aprovarVinculo(undefined, idVinculo), erroEsperado("UNAUTHENTICATED", 401));
  await assert.rejects(aprovarVinculo({ ...auth, super_admin: false }, idVinculo), erroEsperado("FORBIDDEN", 403));
  assert.equal(transacao.mock.callCount(), 0);
});

function simularAprovacao(erroAtualizacao?: unknown, quantidade = 1) {
  const buscar = simularMetodo(prisma.vinculo_condominio, "findUnique", async () => alvo);
  const ativo = simularMetodo(prisma.vinculo_condominio, "findFirst", async (_args: TiposPrisma.vinculo_condominioFindFirstArgs) => null);
  const atualizar = simularMetodo(prisma.vinculo_condominio, "updateMany", async (_args: TiposPrisma.vinculo_condominioUpdateManyArgs) => {
    if (erroAtualizacao) throw erroAtualizacao;
    return { count: quantidade };
  });
  const auditoria = simularMetodo(prisma.auditoria, "create", async () => ({ id_auditoria: "auditoria-teste" }));
  simularMetodo(prisma, "$transaction", async (callback: (tx: TiposPrisma.TransactionClient) => Promise<unknown>) => callback(prisma));
  return { buscar, ativo, atualizar, auditoria };
}

test("cross-tenant é negado antes de verificar estado ou atualizar, sem revelar dados do alvo", async () => {
  const { ativo, atualizar, auditoria } = simularAprovacao();
  await assert.rejects(aprovarVinculo({ ...auth, super_admin: false, vinculo_ativo: {
    id_vinculo: "40000000-0000-4000-8000-000000000001", id_condominio: "50000000-0000-4000-8000-000000000001", admin_condominio: true,
  } }, idVinculo), erroEsperado("FORBIDDEN_CROSS_TENANT", 403));
  assert.equal(ativo.mock.callCount(), 0);
  assert.equal(atualizar.mock.callCount(), 0);
  assert.equal(auditoria.mock.callCount(), 0);
});

test("atualização condicional sem registro alterado resulta em 409 e não cria auditoria", async () => {
  const { ativo, atualizar, auditoria } = simularAprovacao(undefined, 0);
  await assert.rejects(aprovarVinculo(auth, idVinculo), erroEsperado("MEMBERSHIP_NOT_PENDING"));
  assert.deepEqual(ativo.mock.calls[0].arguments[0].where, {
    id_condomino: alvo.id_condomino, status_vinculo: "ATIVO", id_vinculo: { not: idVinculo },
  });
  assert.deepEqual(atualizar.mock.calls[0].arguments[0].where, {
    id_vinculo: idVinculo, id_condominio: idCondominio, status_vinculo: "PENDENTE",
  });
  assert.equal(auditoria.mock.callCount(), 0);
});

for (const meta of [
  { target: "one_active_membership_per_user" },
  { target: ["id_condomino"] },
  { driverAdapterError: { cause: { constraint: { index: "one_active_membership_per_user" } } } },
]) {
  test(`conflito esperado P2002 vira 409 (${JSON.stringify(meta)})`, async () => {
    const erro = new Prisma.PrismaClientKnownRequestError("conflito simulado", { code: "P2002", clientVersion: "7", meta });
    const { auditoria } = simularAprovacao(erro);
    await assert.rejects(aprovarVinculo(auth, idVinculo), erroEsperado("ACTIVE_MEMBERSHIP_ALREADY_EXISTS"));
    assert.equal(auditoria.mock.callCount(), 0);
  });
}

test("erros Prisma de outras constraints não são convertidos em conflito de vínculo ativo", async () => {
  const erro = new Prisma.PrismaClientKnownRequestError("outra constraint", {
    code: "P2002", clientVersion: "7", meta: { target: ["id_vinculo"] },
  });
  simularAprovacao(erro);
  await assert.rejects(aprovarVinculo(auth, idVinculo), (recebido: unknown) => recebido === erro);
});

test("outros códigos Prisma não são convertidos em conflito de vínculo ativo", async () => {
  const erro = new Prisma.PrismaClientKnownRequestError("falha de integridade", {
    code: "P2003", clientVersion: "7", meta: { target: ["id_condomino"] },
  });
  simularAprovacao(erro);
  await assert.rejects(aprovarVinculo(auth, idVinculo), (recebido: unknown) => recebido === erro);
});
