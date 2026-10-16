import assert from "node:assert/strict";
import { after, afterEach, mock, test } from "node:test";
import type { Request, Response } from "express";
import type { Prisma } from "../src/generated/prisma/client.js";

process.env.DATABASE_URL = "postgresql://teste:teste@localhost:5432/teste";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.SUPABASE_URL = "https://teste.supabase.co";
process.env.SUPABASE_SECRET_KEY = "chave-apenas-para-testes";
const { prisma } = await import("../src/lib/prisma.js");
const { cadastrarCondominioAdmin } = await import("../src/modules/administracao/administracao.service.js");
const { criarCondominioAdminController } = await import("../src/modules/administracao/administracao.controller.js");
const { criarCondominioBodySchema } = await import("../src/modules/condominios/condominio.schema.js");
const { validarBody } = await import("../src/middlewares/validar.js");
const { ErroDominio } = await import("../src/lib/erro-dominio.js");
const auth = { id_usuario: "10000000-0000-4000-8000-000000000001", super_admin: true };
const body = { nome_residencial: "Residencial Exemplo", cep: "72000000", endereco: "Rua Exemplo, 10" };
const persistido = { ...body, id_condominio: "20000000-0000-4000-8000-000000000001", ativo: true, created_at: new Date("2026-10-16T20:00:00Z") };
const restaurar: (() => void)[] = [];
function simular(objeto: object, nome: string, implementacao: (...args: any[]) => any) {
  const original = Reflect.get(objeto, nome), fn = mock.fn(implementacao);
  Reflect.set(objeto, nome, fn); restaurar.push(() => { Reflect.set(objeto, nome, original); }); return fn;
}
afterEach(() => { restaurar.splice(0).reverse().forEach(fn => fn()); });
after(async () => { await prisma.$disconnect(); });
function resposta() {
  const resultado = { status: 200, body: undefined as any };
  const res = { status(status: number) { resultado.status = status; return this; }, json(body: unknown) { resultado.body = body; return this; } } as Response;
  return { resultado, res };
}
test("body aceita trim e limites 160/255, preservando CEP de oito dígitos", () => {
  assert.deepEqual(criarCondominioBodySchema.parse({ ...body, nome_residencial: " Residencial Exemplo ", endereco: " Rua Exemplo, 10 " }), body);
  assert.equal(criarCondominioBodySchema.parse({ ...body, nome_residencial: "x".repeat(160), endereco: "x".repeat(255) }).endereco.length, 255);
});
test("campos ausentes, inválidos e extras retornam 400 antes do service", () => {
  const invalidos = [
    {}, { ...body, nome_residencial: " " }, { ...body, nome_residencial: "x".repeat(161) },
    { ...body, endereco: " " }, { ...body, endereco: "x".repeat(256) },
    ...["72000-000", "7200000", "720000000", "abcdefgh", " 72000000", 72000000, null].map(cep => ({ ...body, cep })),
    ...["ativo", "created_at", "id_condominio", "id_usuario", "id_super_admin", "admin_condominio", "status_vinculo", "super_admin", "role"].map(campo => ({ ...body, [campo]: true })),
  ];
  for (const body of invalidos) {
    const { resultado, res } = resposta(), next = mock.fn();
    validarBody(criarCondominioBodySchema)({ body } as Request, res, next);
    assert.equal(resultado.status, 400); assert.equal(resultado.body.erro, "VALIDATION_ERROR"); assert.equal(next.mock.callCount(), 0);
  }
});
test("service exige super antes de abrir transação, inclusive para admin local", async () => {
  const tx = simular(prisma, "$transaction", () => { throw new Error("Não deve acessar DB"); });
  for (const contexto of [undefined, { ...auth, super_admin: false }, { ...auth, super_admin: false, vinculo_ativo: { id_vinculo: auth.id_usuario, id_condominio: persistido.id_condominio, admin_condominio: true } }]) {
    await assert.rejects(cadastrarCondominioAdmin(contexto, body), (erro: unknown) => erro instanceof ErroDominio && erro.codigo === (contexto ? "FORBIDDEN" : "UNAUTHENTICATED"));
  }
  assert.equal(tx.mock.callCount(), 0);
});
test("super sem residência recebe 201, DTO ISO e auditoria do ator real; sem criar perfis/vínculos", async () => {
  const criar = simular(prisma.condominio, "create", async () => persistido);
  const auditar = simular(prisma.auditoria, "create", async () => ({ id_auditoria: auth.id_usuario }));
  const transacao = simular(prisma, "$transaction", async (acao: (tx: Prisma.TransactionClient) => unknown) => acao(prisma));
  for (const entidade of [prisma.usuario, prisma.condomino, prisma.vinculo_condominio, prisma.super_admin, prisma.produto, prisma.pedido]) simular(entidade, "create", () => { throw new Error("Efeito indevido"); });
  const { res, resultado } = resposta();
  await criarCondominioAdminController({ auth, body: { ...body, ativo: false } } as unknown as Parameters<typeof criarCondominioAdminController>[0], res);
  assert.equal(resultado.status, 201);
  assert.deepEqual(resultado.body, { dados: { ...persistido, created_at: "2026-10-16T20:00:00.000Z" } });
  assert.deepEqual(criar.mock.calls[0].arguments[0], {
    data: body, select: { id_condominio: true, nome_residencial: true, cep: true, endereco: true, ativo: true, created_at: true },
  });
  assert.deepEqual(auditar.mock.calls[0].arguments[0].data, {
    id_ator: auth.id_usuario, acao: "CREATE_CONDOMINIUM", entidade: "condominio", entidade_id: persistido.id_condominio,
    id_condominio: persistido.id_condominio, metadata: { ativo: true },
  });
  assert.equal(transacao.mock.callCount(), 1);
});
test("falha de criação ou auditoria propaga rejeição da transação; rollback real é testado em PostgreSQL", async () => {
  for (const falharAuditoria of [false, true]) {
    const falha = new Error("Falha simulada");
    simular(prisma, "$transaction", async (acao: (tx: Prisma.TransactionClient) => unknown) => acao(prisma));
    simular(prisma.condominio, "create", async () => { if (!falharAuditoria) throw falha; return persistido; });
    const auditoria = simular(prisma.auditoria, "create", async () => { throw falha; });
    await assert.rejects(cadastrarCondominioAdmin(auth, body), erro => erro === falha);
    assert.equal(auditoria.mock.callCount(), falharAuditoria ? 1 : 0);
  }
});
