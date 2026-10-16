import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, mock, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { Prisma, status_vinculo_enum } from "../src/generated/prisma/client.js";
import type { ResultadoRejeicaoVinculo, SituacaoResidencial } from "../src/modules/vinculos/vinculo.model.js";

const urlTeste = process.env.ONBOARDING_TEST_DATABASE_URL;
if (!urlTeste) throw new Error("Configure ONBOARDING_TEST_DATABASE_URL para o PostgreSQL temporário local.");
const url = new URL(urlTeste);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/porta_onboarding_teste") {
  throw new Error("Integração exige banco local chamado porta_onboarding_teste.");
}
process.env.DATABASE_URL = urlTeste;
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.SUPABASE_URL = "https://teste.supabase.co";
process.env.SUPABASE_SECRET_KEY = "chave-apenas-para-testes";
const { prisma } = await import("../src/lib/prisma.js");
const { app } = await import("../src/app.js");
const chaves = await generateKeyPair("ES256");
const jwk = { ...await exportJWK(chaves.publicKey), kid: "rejeicao-teste", alg: "ES256", use: "sig" };
const condominioA = randomUUID();
const condominioB = randomUUID();
const servidor = createServer(app);
let base: string;
let admin: string;
let superAdmin: string;

async function criarMorador(status: status_vinculo_enum = "PENDENTE", idCondominio = condominioA, administrador = false) {
  const id = randomUUID();
  await prisma.usuario.create({ data: { id_usuario: id, email: `${id}@exemplo.com` } });
  await prisma.condomino.create({ data: {
    id_condomino: id, nome_completo: "Morador da Rejeição",
    cpf: String(randomInt(0, 100_000_000_000)).padStart(11, "0"), data_nascimento: new Date("2000-05-20T00:00:00Z"),
  } });
  const vinculo = await prisma.vinculo_condominio.create({ data: {
    id_condomino: id, id_condominio: idCondominio, status_vinculo: status,
    admin_condominio: administrador, moradia: "Bloco B - Apto 302",
  } });
  return { id, vinculo };
}

async function headers(id: string, forjarAdmin = false) {
  const token = await new SignJWT({ email: `${id}@exemplo.com`, ...(forjarAdmin ? { super_admin: true, user_metadata: { admin_condominio: true } } : {}) })
    .setProtectedHeader({ alg: "ES256", kid: jwk.kid }).setSubject(id)
    .setIssuer("https://teste.supabase.co/auth/v1").setAudience("authenticated").setExpirationTime("5m").sign(chaves.privateKey);
  return { Authorization: `Bearer ${token}` };
}

async function requisitar(id: string, idVinculo: string, opcoes: { acao?: "aprovar" | "rejeitar"; body?: unknown; query?: string; forjarAdmin?: boolean } = {}) {
  const resposta = await fetch(`${base}/admin/vinculos/${idVinculo}/${opcoes.acao ?? "rejeitar"}${opcoes.query ?? ""}`, {
    method: "PATCH", headers: { ...await headers(id, opcoes.forjarAdmin), ...(opcoes.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(opcoes.body !== undefined ? { body: JSON.stringify(opcoes.body) } : {}),
  });
  return { status: resposta.status, body: await resposta.json() };
}

async function vinculoAtual(idVinculo: string) {
  return prisma.vinculo_condominio.findUniqueOrThrow({ where: { id_vinculo: idVinculo } });
}
async function auditorias(idVinculo: string) {
  return prisma.auditoria.findMany({ where: { entidade_id: idVinculo } });
}
async function confirmarSemAlteracao(antes: Awaited<ReturnType<typeof vinculoAtual>>) {
  assert.deepEqual(await vinculoAtual(antes.id_vinculo), antes);
  assert.deepEqual(await auditorias(antes.id_vinculo), []);
}

before(async () => {
  const fetchOriginal = globalThis.fetch;
  mock.method(globalThis, "fetch", async (...args: Parameters<typeof fetch>) =>
    String(args[0]) === "https://teste.supabase.co/auth/v1/.well-known/jwks.json"
      ? new globalThis.Response(JSON.stringify({ keys: [jwk] }), { status: 200 }) : fetchOriginal(...args));
  await prisma.condominio.createMany({ data: [
    { id_condominio: condominioA, nome_residencial: "Residencial Rejeição A", cep: "70000000", endereco: "Rua A" },
    { id_condominio: condominioB, nome_residencial: "Residencial Rejeição B", cep: "70000001", endereco: "Rua B" },
  ] });
  admin = (await criarMorador("ATIVO", condominioA, true)).id;
  superAdmin = randomUUID();
  await prisma.usuario.create({ data: { id_usuario: superAdmin, email: `${superAdmin}@exemplo.com` } });
  await prisma.super_admin.create({ data: { id_super_admin: superAdmin } });
  servidor.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { servidor.once("listening", resolve); servidor.once("error", reject); });
  const endereco = servidor.address();
  assert.ok(endereco && typeof endereco === "object");
  base = `http://127.0.0.1:${endereco.port}/api`;
});
after(async () => {
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
  mock.restoreAll();
  await prisma.$disconnect();
});

test("sem token ou token inválido retorna 401 sem alterações", async () => {
  const { vinculo } = await criarMorador();
  const casos: Record<string, string>[] = [{}, { Authorization: "Bearer invalido" }];
  for (const cabecalhos of casos) {
    const resposta = await fetch(`${base}/admin/vinculos/${vinculo.id_vinculo}/rejeitar`, { method: "PATCH", headers: cabecalhos });
    assert.equal(resposta.status, 401);
    assert.equal((await resposta.json()).erro, "UNAUTHENTICATED");
  }
  await confirmarSemAlteracao(vinculo);
});

test("morador comum, PENDENTE e ex-admin sem ATIVO recebem 403, mesmo forjando claims", async () => {
  const { vinculo } = await criarMorador();
  for (const status of ["ATIVO", "PENDENTE", "REJEITADO", "SUSPENSO", "ENCERRADO"] as const) {
    const ator = await criarMorador(status, condominioA, status !== "ATIVO");
    const resposta = await requisitar(ator.id, vinculo.id_vinculo, { forjarAdmin: true });
    assert.equal(resposta.status, 403);
    assert.equal(resposta.body.erro, "FORBIDDEN");
  }
  await confirmarSemAlteracao(vinculo);
});

test("onboarding → rejeição local preserva datas nulas e histórico, sai da fila e registra ator/auditoria", async () => {
  const idMorador = randomUUID();
  const nome = `Maria ${idMorador}`;
  const cabecalhos = { ...await headers(idMorador), "Content-Type": "application/json" };
  const onboarding = await fetch(`${base}/onboarding`, { method: "POST", headers: cabecalhos, body: JSON.stringify({
    nome_completo: nome, cpf: String(randomInt(0, 100_000_000_000)).padStart(11, "0"),
    data_nascimento: "2000-05-20", id_condominio: condominioA, moradia: "Bloco B - Apto 302",
  }) });
  assert.equal(onboarding.status, 201);
  const idVinculo = (await onboarding.json()).dados.id_vinculo as string;
  const antes = await vinculoAtual(idVinculo);
  async function fila() {
    const resposta = await fetch(`${base}/admin/vinculos/pendentes?busca=${encodeURIComponent(nome)}`, { headers: await headers(admin) });
    assert.equal(resposta.status, 200);
    return resposta.json();
  }
  assert.equal((await fila()).dados[0].id_vinculo, idVinculo);
  const inicio = Date.now();
  const resposta = await requisitar(admin, idVinculo, { query: `?aprovado_por=${superAdmin}&id_admin=${superAdmin}` });
  assert.equal(resposta.status, 200);
  const dados = (resposta.body as ResultadoRejeicaoVinculo).dados;
  assert.deepEqual(dados, {
    id_vinculo: idVinculo, status_vinculo: "REJEITADO", moradia: antes.moradia, admin_condominio: false,
    data_solicitacao: antes.data_solicitacao.toISOString(), data_aprovacao: null, data_inicio: null, data_fim: null,
    condominio: { id_condominio: condominioA, nome_residencial: "Residencial Rejeição A" },
    morador: { id_condomino: idMorador, nome_completo: nome },
  });
  assert.doesNotMatch(JSON.stringify(resposta.body), /cpf|data_nascimento|email|aprovado_por|metadata|status_conta|token|JWT|admin_atualizado/);
  assert.deepEqual(await vinculoAtual(idVinculo), { ...antes, status_vinculo: "REJEITADO", aprovado_por: admin });
  const registros = await auditorias(idVinculo);
  assert.equal(registros.length, 1);
  assert.deepEqual(registros[0], {
    id_auditoria: registros[0].id_auditoria, id_ator: admin, acao: "REJECT_MEMBERSHIP", entidade: "vinculo_condominio",
    entidade_id: idVinculo, id_condominio: condominioA, created_at: registros[0].created_at,
    metadata: { status_anterior: "PENDENTE", status_novo: "REJEITADO" },
  });
  assert.ok(registros[0].created_at.getTime() >= inicio && registros[0].created_at.getTime() <= Date.now());
  const situacao = await fetch(`${base}/vinculos/me`, { headers: cabecalhos });
  assert.equal(situacao.status, 200);
  const residencial = (await situacao.json() as SituacaoResidencial).dados;
  assert.equal(residencial.solicitacao_pendente, null);
  assert.equal(residencial.vinculo_ativo, null);
  assert.equal(residencial.ultimo_vinculo?.id_vinculo, idVinculo);
  assert.equal(residencial.ultimo_vinculo?.status_vinculo, "REJEITADO");
  assert.deepEqual((await fila()).dados, []);
  const repetida = await requisitar(admin, idVinculo);
  assert.equal(repetida.status, 409);
  assert.equal(repetida.body.erro, "MEMBERSHIP_NOT_PENDING");
  assert.equal((await auditorias(idVinculo)).length, 1);
  assert.equal(await prisma.usuario.count({ where: { id_usuario: idMorador } }), 1);
  assert.equal(await prisma.condomino.count({ where: { id_condomino: idMorador } }), 1);
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/condominios`, { headers: cabecalhos })).status, 200);
});

test("cross-tenant não revela dados ou estado nem grava auditoria, mesmo com query forjada", async () => {
  for (const status of ["PENDENTE", "ATIVO"] as const) {
    const { vinculo } = await criarMorador(status, condominioB);
    const resposta = await requisitar(admin, vinculo.id_vinculo, { query: `?id_condominio=${condominioA}&super_admin=true` });
    assert.equal(resposta.status, 403);
    assert.deepEqual(resposta.body, { erro: "FORBIDDEN_CROSS_TENANT", mensagem: "Acesso restrito ao próprio condomínio." });
    await confirmarSemAlteracao(vinculo);
  }
});

test("super admin sem vínculo rejeita pendência de outro condomínio", async () => {
  const { vinculo } = await criarMorador("PENDENTE", condominioB);
  const resposta = await requisitar(superAdmin, vinculo.id_vinculo);
  assert.equal(resposta.status, 200);
  assert.deepEqual(await vinculoAtual(vinculo.id_vinculo), { ...vinculo, status_vinculo: "REJEITADO", aprovado_por: superAdmin });
  assert.equal((await auditorias(vinculo.id_vinculo))[0].id_ator, superAdmin);
});

test("UUID inválido retorna 400 e UUID válido inexistente retorna 404", async () => {
  const invalido = await requisitar(admin, "abc");
  assert.equal(invalido.status, 400);
  assert.equal(invalido.body.erro, "VALIDATION_ERROR");
  const inexistente = await requisitar(admin, randomUUID());
  assert.equal(inexistente.status, 404);
  assert.equal(inexistente.body.erro, "MEMBERSHIP_NOT_FOUND");
});

test("body inesperado é rejeitado, inclusive ator, status, privilégios, motivo e datas", async () => {
  const { vinculo } = await criarMorador();
  for (const body of [{ status_vinculo: "REJEITADO", aprovado_por: superAdmin }, { rejeitado_por: superAdmin, id_admin: superAdmin },
    { admin_condominio: false }, { motivo: "Não definido no contrato" }, { data_fim: "2026-10-15" }, {}, []]) {
    const resposta = await requisitar(admin, vinculo.id_vinculo, { body });
    assert.equal(resposta.status, 400);
    assert.equal(resposta.body.erro, "VALIDATION_ERROR");
  }
  await confirmarSemAlteracao(vinculo);
});

for (const status of ["ATIVO", "REJEITADO", "SUSPENSO", "ENCERRADO"] as const) {
  test(`${status} não pode ser rejeitado e não cria auditoria`, async () => {
    const { vinculo } = await criarMorador(status);
    const resposta = await requisitar(superAdmin, vinculo.id_vinculo);
    assert.equal(resposta.status, 409);
    assert.equal(resposta.body.erro, "MEMBERSHIP_NOT_PENDING");
    await confirmarSemAlteracao(vinculo);
  });
}

test("outro ATIVO não bloqueia rejeição e é preservado integralmente", async () => {
  const morador = await criarMorador("ATIVO", condominioB, true);
  const pendente = await prisma.vinculo_condominio.create({ data: { id_condomino: morador.id, id_condominio: condominioA, moradia: "Apto 102" } });
  assert.equal((await requisitar(admin, pendente.id_vinculo)).status, 200);
  assert.deepEqual(await vinculoAtual(pendente.id_vinculo), { ...pendente, status_vinculo: "REJEITADO", aprovado_por: admin });
  await confirmarSemAlteracao(morador.vinculo);
  const resposta = await fetch(`${base}/vinculos/me`, { headers: await headers(morador.id) });
  const dados = (await resposta.json() as SituacaoResidencial).dados;
  assert.equal(dados.vinculo_ativo?.id_vinculo, morador.vinculo.id_vinculo);
  assert.equal(dados.solicitacao_pendente, null);
  assert.equal(dados.ultimo_vinculo, null); // Mantém a prioridade já existente para o vínculo ativo.
});

for (const campo of ["data_aprovacao", "data_inicio", "data_fim", "admin_condominio"] as const) {
  test(`pendência inconsistente em ${campo} não é corrigida silenciosamente`, async () => {
    const { vinculo } = await criarMorador();
    const alteracoes = campo === "admin_condominio" ? { admin_condominio: true } : { [campo]: new Date() };
    const antes = await prisma.vinculo_condominio.update({ where: { id_vinculo: vinculo.id_vinculo }, data: alteracoes });
    const resposta = await requisitar(admin, vinculo.id_vinculo);
    assert.equal(resposta.status, 409);
    assert.equal(resposta.body.erro, "MEMBERSHIP_INCONSISTENT");
    await confirmarSemAlteracao(antes);
  });
}

function interceptarTransacao(transformar: (tx: Prisma.TransactionClient) => Prisma.TransactionClient) {
  const original = prisma.$transaction;
  Reflect.set(prisma, "$transaction", async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, opcoes: object) =>
    original.call(prisma, (tx) => callback(transformar(tx)), opcoes));
  return () => { Reflect.set(prisma, "$transaction", original); };
}

for (const concorrente of ["rejeitar", "aprovar"] as const) {
  test(`rejeitar/${concorrente} concorrentes: 200 + 409, um estado final e uma auditoria`, async () => {
    const { vinculo } = await criarMorador();
    let chegaram = 0;
    let liberar: () => void = () => {};
    const barreira = new Promise<void>((resolve) => { liberar = resolve; });
    const restaurar = interceptarTransacao((tx) => new Proxy(tx, { get(target, propriedade, receiver) {
      if (propriedade !== "vinculo_condominio") return Reflect.get(target, propriedade, receiver);
      return new Proxy(target.vinculo_condominio, { get(delegate, metodo, receptor) {
        if (metodo !== "updateMany") return Reflect.get(delegate, metodo, receptor);
        return async (args: Prisma.vinculo_condominioUpdateManyArgs) => {
          if (++chegaram === 2) liberar();
          await barreira;
          return delegate.updateMany(args);
        };
      } });
    } }));
    try {
      const resultados = await Promise.all([requisitar(admin, vinculo.id_vinculo), requisitar(superAdmin, vinculo.id_vinculo, { acao: concorrente })]);
      assert.deepEqual(resultados.map((item) => item.status).sort(), [200, 409]);
      assert.equal(resultados.find((item) => item.status === 409)?.body.erro, "MEMBERSHIP_NOT_PENDING");
      const vencedor = resultados.find((item) => item.status === 200)!;
      const final = await vinculoAtual(vinculo.id_vinculo);
      assert.equal(final.status_vinculo, vencedor.body.dados.status_vinculo);
      const registros = await auditorias(vinculo.id_vinculo);
      assert.equal(registros.length, 1);
      assert.equal(registros[0].acao, final.status_vinculo === "ATIVO" ? "APPROVE_MEMBERSHIP" : "REJECT_MEMBERSHIP");
      assert.equal(registros[0].id_ator, final.aprovado_por);
      assert.ok(["ATIVO", "REJEITADO"].includes(final.status_vinculo));
      if (final.status_vinculo === "REJEITADO") {
        assert.equal(final.data_aprovacao, null);
        assert.equal(final.data_inicio, null);
        assert.equal(final.data_fim, null);
      }
    } finally { restaurar(); }
    assert.equal(chegaram, 2);
  });
}

test("falha da auditoria reverte REJEITADO para PENDENTE na transação real", async () => {
  const { vinculo } = await criarMorador();
  let tentouAuditoria = false;
  const restaurar = interceptarTransacao((tx) => new Proxy(tx, { get(target, propriedade, receiver) {
    if (propriedade !== "auditoria") return Reflect.get(target, propriedade, receiver);
    return new Proxy(target.auditoria, { get(delegate, metodo, receptor) {
      if (metodo !== "create") return Reflect.get(delegate, metodo, receptor);
      return () => { tentouAuditoria = true; throw new Error("Falha controlada na auditoria"); };
    } });
  } }));
  try {
    const resposta = await requisitar(admin, vinculo.id_vinculo);
    assert.equal(resposta.status, 500);
    assert.deepEqual(resposta.body, { erro: "INTERNAL_ERROR", mensagem: "Erro interno do servidor." });
  } finally { restaurar(); }
  assert.equal(tentouAuditoria, true);
  await confirmarSemAlteracao(vinculo);
});

test("conta global suspensa não rejeita, inclusive admin e super admin", async () => {
  const { vinculo } = await criarMorador();
  for (const ator of [admin, superAdmin]) {
    await prisma.usuario.update({ where: { id_usuario: ator }, data: { status_conta: "SUSPENSA" } });
    try {
      const resposta = await requisitar(ator, vinculo.id_vinculo);
      assert.equal(resposta.status, 403);
      assert.equal(resposta.body.erro, "ACCOUNT_SUSPENDED");
    } finally { await prisma.usuario.update({ where: { id_usuario: ator }, data: { status_conta: "ATIVA" } }); }
  }
  await confirmarSemAlteracao(vinculo);
});
