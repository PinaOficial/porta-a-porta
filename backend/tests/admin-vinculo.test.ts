import assert from "node:assert/strict";
import { after, afterEach, mock, test } from "node:test";
import type { Prisma } from "../src/generated/prisma/client.js";
import type { ContextoAutenticado } from "../src/types/auth.js";

process.env.DATABASE_URL = "postgresql://teste:teste@localhost:5432/teste";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.SUPABASE_URL = "https://teste.supabase.co";
process.env.SUPABASE_SECRET_KEY = "chave-apenas-para-testes";
const { prisma } = await import("../src/lib/prisma.js");
const { ErroDominio } = await import("../src/lib/erro-dominio.js");
const { listarVinculosPendentes } = await import("../src/modules/vinculos/vinculo.service.js");
const { listarVinculosPendentesQuerySchema: schema } = await import("../src/modules/vinculos/vinculo.schema.js");
const idCondominio = "abcdef00-0000-4000-8000-000000000001";
const auth: ContextoAutenticado = {
  id_usuario: "10000000-0000-4000-8000-000000000001", super_admin: false,
  vinculo_ativo: { id_vinculo: "20000000-0000-4000-8000-000000000001", id_condominio: idCondominio, admin_condominio: true },
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

test("query aplica defaults, trim, busca vazia como ausência e UUID sem distinção de caixa", () => {
  assert.deepEqual(schema.parse({}), { pagina: 1, limite: 20 });
  assert.deepEqual(schema.parse({ pagina: "2", limite: "100", busca: "  Maria  ", id_condominio: idCondominio.toUpperCase() }),
    { pagina: 2, limite: 100, busca: "Maria", id_condominio: idCondominio });
  assert.equal(schema.parse({ busca: "   " }).busca, undefined);
  assert.equal(schema.parse({ busca: "" }).busca, undefined);
});

test("query rejeita valores inválidos, repetidos, objetos, campos desconhecidos e overflow", () => {
  for (const query of [
    { pagina: "abc" }, { pagina: "0" }, { pagina: "1.5" }, { pagina: "1e2" },
    { limite: "-5" }, { limite: "101" }, { limite: "1000" }, { limite: "" },
    { id_condominio: "qualquer-coisa" }, { pagina: ["1", "2"] }, { limite: ["1", "2"] },
    { busca: ["Maria", "João"] }, { busca: { nome: "Maria" } }, { busca: "a".repeat(161) },
    { id_condominio: [idCondominio, idCondominio] }, { admin_condominio: "true" },
    { pagina: "2147483647", limite: "100" }, { pagina: "99999999999999999999999" },
  ]) assert.equal(schema.safeParse(query).success, false, JSON.stringify(query));
});

test("service exige autoridade e bloqueia cross-tenant antes de consultar o banco", async () => {
  const listar = simularMetodo(prisma.vinculo_condominio, "findMany", () => { throw new Error("Não deve consultar"); });
  const casos: [ContextoAutenticado | undefined, Record<string, string>, string, number][] = [
    [undefined, {}, "UNAUTHENTICATED", 401],
    [{ id_usuario: auth.id_usuario, super_admin: false }, {}, "FORBIDDEN", 403],
    [{ ...auth, vinculo_ativo: { ...auth.vinculo_ativo!, admin_condominio: false } }, {}, "FORBIDDEN", 403],
    [auth, { id_condominio: "30000000-0000-4000-8000-000000000001" }, "FORBIDDEN_CROSS_TENANT", 403],
  ];
  for (const [contexto, query, codigo, status] of casos) {
    await assert.rejects(listarVinculosPendentes(contexto, schema.parse(query)), (erro: unknown) =>
      erro instanceof ErroDominio && erro.codigo === codigo && erro.statusHttp === status);
  }
  assert.equal(listar.mock.callCount(), 0);
});

test("repository usa mesmos filtros, select mínimo, snapshot e ordenação estável; service calcula paginação", async () => {
  const listar = simularMetodo(prisma.vinculo_condominio, "findMany", async (_args: Prisma.vinculo_condominioFindManyArgs) => []);
  const contar = simularMetodo(prisma.vinculo_condominio, "count", async (_args: Prisma.vinculo_condominioCountArgs) => 5);
  const transacao = simularMetodo(prisma, "$transaction", async (consultas: Promise<unknown>[], _opcoes: { isolationLevel: string }) => Promise.all(consultas));
  const resultado = await listarVinculosPendentes(auth, schema.parse({ busca: " Maria ", pagina: "2", limite: "2", id_condominio: idCondominio.toUpperCase() }));
  const consulta = listar.mock.calls[0].arguments[0];
  assert.deepEqual(consulta.where, {
    status_vinculo: "PENDENTE", id_condominio: idCondominio,
    OR: [
      { condomino: { is: { nome_completo: { contains: "Maria", mode: "insensitive" } } } },
      { moradia: { contains: "Maria", mode: "insensitive" } },
    ],
  });
  assert.deepEqual(contar.mock.calls[0].arguments[0].where, consulta.where);
  assert.deepEqual(consulta.select, {
    id_vinculo: true, status_vinculo: true, moradia: true, data_solicitacao: true,
    condomino: { select: { id_condomino: true, nome_completo: true } },
    condominio: { select: { id_condominio: true, nome_residencial: true } },
  });
  assert.deepEqual(consulta.orderBy, [{ data_solicitacao: "asc" }, { id_vinculo: "asc" }]);
  assert.equal(consulta.skip, 2);
  assert.equal(consulta.take, 2);
  assert.deepEqual(transacao.mock.calls[0].arguments[1], { isolationLevel: "RepeatableRead" });
  assert.deepEqual(resultado.paginacao, { pagina: 2, limite: 2, total: 5, total_paginas: 3 });
});

const { solicitarTransferenciaBodySchema } = await import("../src/modules/vinculos/vinculo.schema.js");
const { listarVinculosQuerySchema, atualizarAdminVinculoBodySchema } = await import("../src/modules/administracao/administracao.schema.js");
const { atualizarStatusContaBodySchema } = await import("../src/modules/usuarios/usuario.schema.js");
const { listarVinculosAdmin, alterarAdminVinculo } = await import("../src/modules/administracao/administracao.service.js");
const { alterarStatusConta } = await import("../src/modules/usuarios/usuario.service.js");

test("transferência valida UUID, trim e VARCHAR(80), rejeitando autoridade no body", () => {
  assert.deepEqual(solicitarTransferenciaBodySchema.parse({ id_condominio: idCondominio.toUpperCase(), moradia: "  Apto 302 " }), { id_condominio: idCondominio, moradia: "Apto 302" });
  for (const body of [ {}, { id_condominio: "abc", moradia: "Apto" }, { id_condominio: idCondominio, moradia: "  " }, { id_condominio: idCondominio, moradia: "a".repeat(81) }, { id_condominio: idCondominio, moradia: "Apto", admin_condominio: true }, { id_condominio: idCondominio, moradia: "Apto", id_condomino: auth.id_usuario } ]) {
    assert.equal(solicitarTransferenciaBodySchema.safeParse(body).success, false);
  }
});

test("listagem geral aceita somente os cinco estados reais e preserva paginação estrita", () => {
  assert.deepEqual(listarVinculosQuerySchema.parse({}), { pagina: 1, limite: 20 });
  for (const status of ["ATIVO", "PENDENTE", "SUSPENSO", "REJEITADO", "ENCERRADO"]) {
    assert.equal(listarVinculosQuerySchema.parse({ status }).status, status);
  }
  for (const query of [{ status: "ATIVA" }, { status: ["ATIVO", "PENDENTE"] }, { pagina: "0" }, { pagina: "2147483647", limite: "100" }, { cpf: "123" }]) {
    assert.equal(listarVinculosQuerySchema.safeParse(query).success, false);
  }
});

test("privilégio local exige boolean real; status global não aceita estado de vínculo nem campos extras", () => {
  for (const admin_condominio of [true, false]) assert.equal(atualizarAdminVinculoBodySchema.safeParse({ admin_condominio }).success, true);
  for (const body of [{}, { admin_condominio: "true" }, { admin_condominio: 1 }, { admin_condominio: null }, { admin_condominio: true, id_ator: auth.id_usuario }]) {
    assert.equal(atualizarAdminVinculoBodySchema.safeParse(body).success, false);
  }
  for (const status_conta of ["ATIVA", "SUSPENSA"]) assert.equal(atualizarStatusContaBodySchema.safeParse({ status_conta }).success, true);
  for (const body of [{}, { status_conta: "SUSPENSO" }, { status_conta: "ENCERRADO" }, { status_conta: "ATIVA", super_admin: true }]) assert.equal(atualizarStatusContaBodySchema.safeParse(body).success, false);
});

test("novos services administrativos bloqueiam identidade/autoridade/tenant antes de consultar", async () => {
  const tx = simularMetodo(prisma, "$transaction", () => { throw new Error("Não consultar"); });
  await assert.rejects(listarVinculosAdmin(undefined, listarVinculosQuerySchema.parse({})), { codigo: "UNAUTHENTICATED" });
  await assert.rejects(listarVinculosAdmin(auth, listarVinculosQuerySchema.parse({ id_condominio: "30000000-0000-4000-8000-000000000001" })), { codigo: "FORBIDDEN_CROSS_TENANT" });
  await assert.rejects(alterarAdminVinculo({ id_usuario: auth.id_usuario, super_admin: false }, idCondominio, { admin_condominio: true }), { codigo: "FORBIDDEN" });
  await assert.rejects(alterarStatusConta(auth, auth.id_usuario, { status_conta: "SUSPENSA" }), { codigo: "FORBIDDEN" });
  assert.equal(tx.mock.callCount(), 0);
});

const { Prisma: ErrosPrisma } = await import("../src/generated/prisma/client.js");
const { solicitarTransferencia } = await import("../src/modules/vinculos/vinculo.service.js");
const { listarVinculosAdministrativos } = await import("../src/modules/vinculos/vinculo.repository.js");

test("índice parcial de PENDENTE é convertido em MEMBERSHIP_PENDING sem mascarar outras constraints", async () => {
  for (const meta of [{ target: "one_pending_membership_per_user" }, { driverAdapterError: { cause: { constraint: { index: "one_pending_membership_per_user" } } } }]) {
    const erro = new ErrosPrisma.PrismaClientKnownRequestError("conflito", { code: "P2002", clientVersion: "7", meta });
    simularMetodo(prisma, "$transaction", async () => { throw erro; });
    await assert.rejects(solicitarTransferencia(auth, { id_condominio: idCondominio, moradia: "Nova" }), { codigo: "MEMBERSHIP_PENDING", statusHttp: 409 });
  }
  const outro = new ErrosPrisma.PrismaClientKnownRequestError("outra constraint", { code: "P2002", clientVersion: "7", meta: { target: ["id_vinculo"] } });
  simularMetodo(prisma, "$transaction", async () => { throw outro; });
  await assert.rejects(solicitarTransferencia(auth, { id_condominio: idCondominio, moradia: "Nova" }), (erro: unknown) => erro === outro);
});

test("repository administrativo compartilha where/count e seleciona relações em lote sem CPF", async () => {
  const listar = simularMetodo(prisma.vinculo_condominio, "findMany", async (_args: Prisma.vinculo_condominioFindManyArgs) => []);
  const contar = simularMetodo(prisma.vinculo_condominio, "count", async (_args: Prisma.vinculo_condominioCountArgs) => 0);
  await listarVinculosAdministrativos(prisma, { id_condominio: idCondominio, status: "ATIVO", busca: "Maria", limite: 2, deslocamento: 4 });
  const query = listar.mock.calls[0].arguments[0];
  assert.equal(query.where, contar.mock.calls[0].arguments[0].where);
  assert.equal(query.where!.id_condominio, idCondominio); assert.equal(query.where!.status_vinculo, "ATIVO");
  assert.equal(query.skip, 4); assert.equal(query.take, 2);
  assert.deepEqual(query.orderBy, [{ data_solicitacao: "asc" }, { id_vinculo: "asc" }]);
  assert.doesNotMatch(JSON.stringify(query.select), /cpf|email|data_nascimento/);
  assert.equal(listar.mock.callCount(), 1); assert.equal(contar.mock.callCount(), 1);
});
