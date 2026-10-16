import assert from "node:assert/strict";
import { after, afterEach, mock, test } from "node:test";
import type { Request, Response } from "express";
import type { Prisma } from "../src/generated/prisma/client.js";
import type { VinculoConsultado, buscarSituacaoResidencialDoUsuario } from "../src/modules/vinculos/vinculo.repository.js";

process.env.DATABASE_URL = "postgresql://teste:teste@localhost:5432/teste";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.SUPABASE_URL = "https://teste.supabase.co";
process.env.SUPABASE_SECRET_KEY = "chave-apenas-para-testes";
const { prisma } = await import("../src/lib/prisma.js");
const { ErroDominio } = await import("../src/lib/erro-dominio.js");
const { consultarMinhaSituacaoResidencial } = await import("../src/modules/vinculos/vinculo.service.js");
const { consultarMeuVinculoController } = await import("../src/modules/vinculos/vinculo.controller.js");
const { errorHandler } = await import("../src/middlewares/error-handler.js");
type Consulta = Awaited<ReturnType<typeof buscarSituacaoResidencialDoUsuario>>;
const auth = { id_usuario: "10000000-0000-4000-8000-000000000001", super_admin: false };
const usuario = { condomino: { id_condomino: auth.id_usuario }, super_admin: null };
const restauradores: (() => void)[] = [];

function simularMetodo<T extends (...args: never[]) => unknown>(objeto: object, nome: string, implementacao: T) {
  const original: unknown = Reflect.get(objeto, nome);
  const simulado = mock.fn(implementacao);
  Reflect.set(objeto, nome, simulado);
  restauradores.push(() => { Reflect.set(objeto, nome, original); });
  return simulado;
}
afterEach(() => {
  for (const restaurar of restauradores.splice(0).reverse()) restaurar();
  mock.restoreAll();
});
after(async () => { await prisma.$disconnect(); });

function vinculo(status: VinculoConsultado["status_vinculo"]): VinculoConsultado {
  return {
    id_vinculo: "20000000-0000-4000-8000-000000000001", status_vinculo: status, moradia: "Apto 302",
    admin_condominio: status === "ATIVO", data_solicitacao: new Date("2026-10-02T12:00:00Z"),
    data_aprovacao: null, data_inicio: null, data_fim: null,
    condominio: { id_condominio: "30000000-0000-4000-8000-000000000001", nome_residencial: "Residencial Exemplo", cep: "70000000", endereco: "Rua Exemplo" },
  };
}

function simularConsulta(alteracoes: Partial<Consulta> = {}) {
  const dados: Consulta = { usuario, ativos: [], pendentes: [], historico: null, ...alteracoes };
  const identidade = simularMetodo(prisma.usuario, "findUnique", async (_args: Prisma.usuarioFindUniqueArgs) => dados.usuario);
  const atuais = simularMetodo(prisma.vinculo_condominio, "findMany", async (args: Prisma.vinculo_condominioFindManyArgs) =>
    args.where?.status_vinculo === "ATIVO" ? dados.ativos : dados.pendentes);
  const historico = simularMetodo(prisma.vinculo_condominio, "findFirst", async (_args: Prisma.vinculo_condominioFindFirstArgs) => dados.historico);
  const transacao = simularMetodo(prisma, "$transaction", async (callback: (tx: Prisma.TransactionClient) => Promise<Consulta>, _opcoes: { isolationLevel: string }) => callback(prisma));
  return { identidade, atuais, historico, transacao };
}

test("sem onboarding retorna 200 lógico com todos os vínculos nulos, sem consultar vínculos", async () => {
  const { atuais, historico } = simularConsulta({ usuario: null });
  assert.deepEqual(await consultarMinhaSituacaoResidencial(auth), { dados: {
    onboarding_realizado: false, super_admin: false, vinculo_ativo: null, solicitacao_pendente: null, ultimo_vinculo: null,
  } });
  assert.equal(atuais.mock.callCount(), 0);
  assert.equal(historico.mock.callCount(), 0);
});

test("super admin sem condomino representa identidade administrativa sem vínculos", async () => {
  const { atuais } = simularConsulta({ usuario: { condomino: null, super_admin: { id_super_admin: auth.id_usuario } } });
  assert.deepEqual(await consultarMinhaSituacaoResidencial(auth), { dados: {
    onboarding_realizado: true, super_admin: true, vinculo_ativo: null, solicitacao_pendente: null, ultimo_vinculo: null,
  } });
  assert.equal(atuais.mock.callCount(), 0);
});

for (const status of ["ATIVO", "PENDENTE", "REJEITADO", "SUSPENSO", "ENCERRADO"] as const) {
  test(`representa ${status} sem confundir vínculo histórico com ativo`, async () => {
    const registro = vinculo(status);
    simularConsulta({
      ativos: status === "ATIVO" ? [registro] : [],
      pendentes: status === "PENDENTE" ? [registro] : [],
      historico: ["REJEITADO", "SUSPENSO", "ENCERRADO"].includes(status) ? registro : null,
    });
    const dados = (await consultarMinhaSituacaoResidencial(auth)).dados;
    assert.equal(dados.onboarding_realizado, true);
    assert.equal(dados.vinculo_ativo?.status_vinculo ?? null, status === "ATIVO" ? status : null);
    assert.equal(dados.solicitacao_pendente?.status_vinculo ?? null, status === "PENDENTE" ? status : null);
    assert.equal(dados.ultimo_vinculo?.status_vinculo ?? null, ["ATIVO", "PENDENTE"].includes(status) ? null : status);
    assert.doesNotMatch(JSON.stringify(dados), /cpf|data_nascimento|email|senha|jwt|refresh_token|SUPABASE_SECRET_KEY|DATABASE_URL|id_condomino|aprovado_por|admin_atualizado/);
  });
}

test("ATIVO e PENDENTE coexistem e têm prioridade sobre histórico", async () => {
  simularConsulta({ ativos: [vinculo("ATIVO")], pendentes: [vinculo("PENDENTE")], historico: vinculo("ENCERRADO") });
  const dados = (await consultarMinhaSituacaoResidencial(auth)).dados;
  assert.equal(dados.vinculo_ativo?.status_vinculo, "ATIVO");
  assert.equal(dados.solicitacao_pendente?.status_vinculo, "PENDENTE");
  assert.equal(dados.ultimo_vinculo, null);
});

test("consulta usa UUID autenticado, seleção pública, snapshot e histórico ordenado", async () => {
  const { identidade, atuais, historico, transacao } = simularConsulta({ ativos: [vinculo("ATIVO")] });
  const resultado = await consultarMinhaSituacaoResidencial({ ...auth, vinculo_ativo: { id_vinculo: "contexto-parcial", id_condominio: "contexto-parcial", admin_condominio: false } });
  assert.deepEqual(identidade.mock.calls[0].arguments[0].where, { id_usuario: auth.id_usuario });
  assert.deepEqual(identidade.mock.calls[0].arguments[0].select, { condomino: { select: { id_condomino: true } }, super_admin: { select: { id_super_admin: true } } });
  assert.equal(atuais.mock.callCount(), 2);
  for (const [indice, status] of ["ATIVO", "PENDENTE"].entries()) {
    const consulta = atuais.mock.calls[indice].arguments[0];
    assert.deepEqual(consulta.where, { id_condomino: auth.id_usuario, status_vinculo: status });
    assert.equal(consulta.take, 2);
    assert.deepEqual(consulta.select?.condominio, { select: { id_condominio: true, nome_residencial: true, cep: true, endereco: true } });
    assert.doesNotMatch(JSON.stringify(consulta.select), /cpf|data_nascimento|email|aprovado_por|admin_atualizado/);
  }
  const consultaHistorico = historico.mock.calls[0].arguments[0];
  assert.deepEqual(consultaHistorico.where, { id_condomino: auth.id_usuario, status_vinculo: { in: ["REJEITADO", "SUSPENSO", "ENCERRADO"] } });
  assert.deepEqual(consultaHistorico.orderBy, [{ data_solicitacao: "desc" }, { id_vinculo: "desc" }]);
  assert.deepEqual(transacao.mock.calls[0].arguments[1], { isolationLevel: "RepeatableRead" });
  assert.equal(resultado.dados.vinculo_ativo?.data_solicitacao, "2026-10-02T12:00:00.000Z");
  assert.equal(resultado.dados.vinculo_ativo?.admin_condominio, true);
});

for (const dados of [
  { usuario: { condomino: null, super_admin: null } },
  { ativos: [vinculo("ATIVO"), vinculo("ATIVO")] },
  { pendentes: [vinculo("PENDENTE"), vinculo("PENDENTE")] },
]) {
  test("inconsistência de perfil ou unicidade resulta em erro interno", async () => {
    simularConsulta(dados);
    await assert.rejects(consultarMinhaSituacaoResidencial(auth), /Inconsistência no estado residencial/);
  });
}

test("controller ignora UUIDs em query, params e body", async () => {
  const { identidade } = simularConsulta({ pendentes: [vinculo("PENDENTE")] });
  let status = 0;
  let body: unknown;
  const res = { status(valor: number) { status = valor; return this; }, json(valor: unknown) { body = valor; return this; } } as unknown as Response;
  const ids = { id_usuario: "outro-usuario", id_condomino: "outro-usuario", id_condominio: "outro-condominio", id_vinculo: "outro-vinculo" };
  await consultarMeuVinculoController({ auth, query: ids, params: ids, body: ids } as unknown as Request, res);
  assert.equal(status, 200);
  assert.deepEqual(identidade.mock.calls[0].arguments[0].where, { id_usuario: auth.id_usuario });
  assert.doesNotMatch(JSON.stringify(body), /outro-usuario|outro-condominio|outro-vinculo/);
});

test("service sem autenticação nega acesso antes de ler o banco", async () => {
  const { identidade } = simularConsulta();
  await assert.rejects(consultarMinhaSituacaoResidencial(undefined), (erro: unknown) => erro instanceof ErroDominio && erro.codigo === "UNAUTHENTICATED");
  assert.equal(identidade.mock.callCount(), 0);
});

test("inconsistência é convertida pelo error handler em 500 INTERNAL_ERROR", async () => {
  simularConsulta({ usuario: { condomino: null, super_admin: null } });
  mock.method(console, "error", () => {});
  let status = 0;
  let body: unknown;
  const res = { status(valor: number) { status = valor; return this; }, json(valor: unknown) { body = valor; return this; } } as unknown as Response;
  try { await consultarMinhaSituacaoResidencial(auth); }
  catch (erro: unknown) { errorHandler(erro, {} as Request, res, mock.fn()); }
  assert.equal(status, 500);
  assert.deepEqual(body, { erro: "INTERNAL_ERROR", mensagem: "Erro interno do servidor." });
});
