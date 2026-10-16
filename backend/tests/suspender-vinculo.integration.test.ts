import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, mock, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { Prisma, status_vinculo_enum } from "../src/generated/prisma/client.js";
import type { ResultadoSuspensaoVinculo, SituacaoResidencial } from "../src/modules/vinculos/vinculo.model.js";

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
const jwk = { ...await exportJWK(chaves.publicKey), kid: "suspensao-teste", alg: "ES256", use: "sig" };
const condominioA = randomUUID();
const condominioB = randomUUID();
const servidor = createServer(app);
let base: string;
let admin: string;
let superAdmin: string;

async function criarMorador(status: status_vinculo_enum = "ATIVO", idCondominio = condominioA, administrador = false) {
  const id = randomUUID();
  await prisma.usuario.create({ data: { id_usuario: id, email: `${id}@exemplo.com` } });
  await prisma.condomino.create({ data: {
    id_condomino: id, nome_completo: "Morador da Suspensão",
    cpf: String(randomInt(0, 100_000_000_000)).padStart(11, "0"), data_nascimento: new Date("2000-05-20T00:00:00Z"),
  } });
  const vinculo = await prisma.vinculo_condominio.create({ data: {
    id_condomino: id, id_condominio: idCondominio, status_vinculo: status,
    admin_condominio: administrador, moradia: "Bloco B - Apto 302",
    data_solicitacao: new Date("2026-10-01T20:00:00Z"),
    ...(status === "ATIVO" ? {
      data_aprovacao: new Date("2026-10-02T12:00:00Z"), data_inicio: new Date("2026-10-02T12:00:00Z"), aprovado_por: superAdmin,
    } : {}),
    ...(administrador ? { admin_atualizado_por: superAdmin, admin_atualizado_em: new Date("2026-10-02T13:00:00Z") } : {}),
  } });
  return { id, vinculo };
}

async function headers(id: string, forjarAdmin = false) {
  const token = await new SignJWT({ email: `${id}@exemplo.com`, ...(forjarAdmin ? { super_admin: true, user_metadata: { admin_condominio: true } } : {}) })
    .setProtectedHeader({ alg: "ES256", kid: jwk.kid }).setSubject(id)
    .setIssuer("https://teste.supabase.co/auth/v1").setAudience("authenticated").setExpirationTime("5m").sign(chaves.privateKey);
  return { Authorization: `Bearer ${token}` };
}

async function requisitar(id: string, idVinculo: string, opcoes: { acao?: "aprovar" | "rejeitar" | "suspender"; body?: unknown; query?: string; forjarAdmin?: boolean } = {}) {
  const resposta = await fetch(`${base}/admin/vinculos/${idVinculo}/${opcoes.acao ?? "suspender"}${opcoes.query ?? ""}`, {
    method: "PATCH", headers: { ...await headers(id, opcoes.forjarAdmin), ...(opcoes.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(opcoes.body !== undefined ? { body: JSON.stringify(opcoes.body) } : {}),
  });
  return { status: resposta.status, body: await resposta.json() };
}

async function vinculoAtual(idVinculo: string) {
  return prisma.vinculo_condominio.findUniqueOrThrow({ where: { id_vinculo: idVinculo } });
}
async function auditorias(idVinculo: string) {
  return prisma.auditoria.findMany({ where: { entidade_id: idVinculo, acao: "SUSPEND_MEMBERSHIP" } });
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
    { id_condominio: condominioA, nome_residencial: "Residencial Suspensão A", cep: "70000000", endereco: "Rua A" },
    { id_condominio: condominioB, nome_residencial: "Residencial Suspensão B", cep: "70000001", endereco: "Rua B" },
  ] });
  superAdmin = randomUUID();
  await prisma.usuario.create({ data: { id_usuario: superAdmin, email: `${superAdmin}@exemplo.com` } });
  await prisma.super_admin.create({ data: { id_super_admin: superAdmin } });
  admin = (await criarMorador("ATIVO", condominioA, true)).id;
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
    const resposta = await fetch(`${base}/admin/vinculos/${vinculo.id_vinculo}/suspender`, { method: "PATCH", headers: cabecalhos });
    assert.equal(resposta.status, 401);
    assert.equal((await resposta.json()).erro, "UNAUTHENTICATED");
  }
  await confirmarSemAlteracao(vinculo);
});

test("morador comum, PENDENTE e ex-admin sem ATIVO recebem 403, inclusive com claims forjadas", async () => {
  const { vinculo } = await criarMorador();
  for (const status of ["ATIVO", "PENDENTE", "REJEITADO", "SUSPENSO", "ENCERRADO"] as const) {
    const ator = await criarMorador(status, condominioA, status !== "ATIVO");
    const resposta = await requisitar(ator.id, vinculo.id_vinculo, { forjarAdmin: true });
    assert.equal(resposta.status, 403);
    assert.equal(resposta.body.erro, "FORBIDDEN");
  }
  await confirmarSemAlteracao(vinculo);
});

test("onboarding → aprovação → suspensão local preserva histórico, conta global e privacidade", async () => {
  const idMorador = randomUUID();
  const cabecalhos = { ...await headers(idMorador), "Content-Type": "application/json" };
  const onboarding = await fetch(`${base}/onboarding`, { method: "POST", headers: cabecalhos, body: JSON.stringify({
    nome_completo: "Maria da Silva", cpf: String(randomInt(0, 100_000_000_000)).padStart(11, "0"),
    data_nascimento: "2000-05-20", id_condominio: condominioA, moradia: "Bloco B - Apto 302",
  }) });
  assert.equal(onboarding.status, 201);
  const idVinculo = (await onboarding.json()).dados.id_vinculo as string;
  assert.equal((await requisitar(superAdmin, idVinculo, { acao: "aprovar" })).status, 200);
  const antes = await vinculoAtual(idVinculo);
  const usuarioAntes = await prisma.usuario.findUniqueOrThrow({ where: { id_usuario: idMorador } });
  const inicio = Date.now();
  const resposta = await requisitar(admin, idVinculo.toUpperCase(), { query: `?id_admin=${superAdmin}&suspenso_por=${superAdmin}` });
  assert.equal(resposta.status, 200);
  const dados = (resposta.body as ResultadoSuspensaoVinculo).dados;
  assert.deepEqual(dados, {
    id_vinculo: idVinculo, status_vinculo: "SUSPENSO", moradia: antes.moradia, admin_condominio: false,
    data_solicitacao: antes.data_solicitacao.toISOString(), data_aprovacao: antes.data_aprovacao!.toISOString(),
    data_inicio: antes.data_inicio!.toISOString(), data_fim: null,
    condominio: { id_condominio: condominioA, nome_residencial: "Residencial Suspensão A" },
    morador: { id_condomino: idMorador, nome_completo: "Maria da Silva" },
  });
  assert.doesNotMatch(JSON.stringify(resposta.body), /cpf|data_nascimento|email|JWT|token|aprovado_por|metadata|status_conta|admin_atualizado/);
  assert.deepEqual(await vinculoAtual(idVinculo), { ...antes, status_vinculo: "SUSPENSO" });
  assert.deepEqual(await prisma.usuario.findUniqueOrThrow({ where: { id_usuario: idMorador } }), usuarioAntes);
  assert.equal(usuarioAntes.status_conta, "ATIVA");
  const registros = await auditorias(idVinculo);
  assert.equal(registros.length, 1);
  assert.deepEqual(registros[0], {
    id_auditoria: registros[0].id_auditoria, id_ator: admin, acao: "SUSPEND_MEMBERSHIP", entidade: "vinculo_condominio",
    entidade_id: idVinculo, id_condominio: condominioA, created_at: registros[0].created_at,
    metadata: { status_anterior: "ATIVO", status_novo: "SUSPENSO" },
  });
  assert.ok(registros[0].created_at.getTime() >= inicio && registros[0].created_at.getTime() <= Date.now());
  const situacao = await fetch(`${base}/vinculos/me`, { headers: cabecalhos });
  assert.equal(situacao.status, 200);
  const residencial = (await situacao.json() as SituacaoResidencial).dados;
  assert.equal(residencial.vinculo_ativo, null);
  assert.equal(residencial.solicitacao_pendente, null);
  assert.equal(residencial.ultimo_vinculo?.id_vinculo, idVinculo);
  assert.equal(residencial.ultimo_vinculo?.status_vinculo, "SUSPENSO");
  const repetida = await requisitar(admin, idVinculo);
  assert.equal(repetida.status, 409);
  assert.equal(repetida.body.erro, "MEMBERSHIP_NOT_ACTIVE");
  assert.equal((await auditorias(idVinculo)).length, 1);
  assert.equal((await fetch(`${base}/condominios`, { headers: cabecalhos })).status, 200);
  assert.equal((await fetch(`${base}/health`)).status, 200);
});

test("cross-tenant retorna 403 antes de revelar estado, mesmo com condomínio e autoridade forjados", async () => {
  for (const status of ["ATIVO", "PENDENTE"] as const) {
    const { vinculo } = await criarMorador(status, condominioB);
    const resposta = await requisitar(admin, vinculo.id_vinculo, { query: `?id_condominio=${condominioA}&super_admin=true` });
    assert.equal(resposta.status, 403);
    assert.deepEqual(resposta.body, { erro: "FORBIDDEN_CROSS_TENANT", mensagem: "Acesso restrito ao próprio condomínio." });
    await confirmarSemAlteracao(vinculo);
  }
});

test("super admin sem vínculo suspende outro condomínio e preserva admin_condominio histórico", async () => {
  const { vinculo } = await criarMorador("ATIVO", condominioB, true);
  const resposta = await requisitar(superAdmin, vinculo.id_vinculo);
  assert.equal(resposta.status, 200);
  assert.equal(resposta.body.dados.admin_condominio, true);
  assert.deepEqual(await vinculoAtual(vinculo.id_vinculo), { ...vinculo, status_vinculo: "SUSPENSO" });
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

test("body inesperado é rejeitado, inclusive status, ator, condomínio, motivo e duração", async () => {
  const { vinculo } = await criarMorador();
  for (const body of [{ status_vinculo: "SUSPENSO", id_admin: superAdmin }, { suspenso_por: superAdmin },
    { id_condominio: condominioB }, { motivo_suspensao: "Sem campo no contrato", duracao_suspensao: 10 }, {}, []]) {
    const resposta = await requisitar(admin, vinculo.id_vinculo, { body });
    assert.equal(resposta.status, 400);
    assert.equal(resposta.body.erro, "VALIDATION_ERROR");
  }
  await confirmarSemAlteracao(vinculo);
});

for (const status of ["PENDENTE", "REJEITADO", "SUSPENSO", "ENCERRADO"] as const) {
  test(`${status} não pode ser suspenso e não cria auditoria`, async () => {
    const { vinculo } = await criarMorador(status);
    const resposta = await requisitar(superAdmin, vinculo.id_vinculo);
    assert.equal(resposta.status, 409);
    assert.equal(resposta.body.erro, "MEMBERSHIP_NOT_ACTIVE");
    await confirmarSemAlteracao(vinculo);
  });
}

test("data_fim existente e datas históricas nulas são preservadas sem normalização", async () => {
  const { vinculo } = await criarMorador();
  const antes = await prisma.vinculo_condominio.update({ where: { id_vinculo: vinculo.id_vinculo }, data: {
    data_aprovacao: null, data_inicio: null, data_fim: new Date("2026-10-03T12:00:00Z"),
  } });
  const resposta = await requisitar(admin, vinculo.id_vinculo);
  assert.equal(resposta.status, 200);
  assert.equal(resposta.body.dados.data_aprovacao, null);
  assert.equal(resposta.body.dados.data_inicio, null);
  assert.equal(resposta.body.dados.data_fim, antes.data_fim!.toISOString());
  assert.deepEqual(await vinculoAtual(vinculo.id_vinculo), { ...antes, status_vinculo: "SUSPENSO" });
});

test("único admin pode suspender o próprio vínculo e perde autoridade nas próximas requisições", async () => {
  const idCondominio = randomUUID();
  await prisma.condominio.create({ data: { id_condominio: idCondominio, nome_residencial: "Admin próprio", cep: "70000002", endereco: "Rua C" } });
  const proprio = await criarMorador("ATIVO", idCondominio, true);
  const pendente = await criarMorador("PENDENTE", idCondominio);
  const resposta = await requisitar(proprio.id, proprio.vinculo.id_vinculo);
  assert.equal(resposta.status, 200);
  assert.deepEqual(await vinculoAtual(proprio.vinculo.id_vinculo), { ...proprio.vinculo, status_vinculo: "SUSPENSO" });
  assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id_usuario: proprio.id } })).status_conta, "ATIVA");
  const cabecalhos = await headers(proprio.id);
  const fila = await fetch(`${base}/admin/vinculos/pendentes`, { headers: cabecalhos });
  assert.equal(fila.status, 403);
  assert.equal((await fila.json()).erro, "FORBIDDEN");
  for (const acao of ["aprovar", "rejeitar", "suspender"] as const) {
    const negada = await requisitar(proprio.id, pendente.vinculo.id_vinculo, { acao });
    assert.equal(negada.status, 403);
    assert.equal(negada.body.erro, "FORBIDDEN");
  }
  const residencial = await fetch(`${base}/vinculos/me`, { headers: cabecalhos });
  assert.equal(residencial.status, 200);
  const dados = (await residencial.json() as SituacaoResidencial).dados;
  assert.equal(dados.vinculo_ativo, null);
  assert.equal(dados.ultimo_vinculo?.status_vinculo, "SUSPENSO");
  assert.equal(dados.ultimo_vinculo?.admin_condominio, true);
});

test("produtos ativos, imagens, pedidos SOLICITADO/ACEITO, histórico e chat permanecem intactos", async () => {
  const vendedor = await criarMorador();
  const comprador = await criarMorador();
  const categoria = await prisma.categoria_produto.create({ data: { nome: `Suspensão ${randomUUID()}` } });
  const produto = await prisma.produto.create({ data: {
    id_vinculo_vendedor: vendedor.vinculo.id_vinculo, id_categoria: categoria.id_categoria,
    nome_produto: "Produto de teste", descricao: "Preservação na suspensão", preco: "12.50", estoque: 5,
  } });
  await prisma.produto_imagem.create({ data: { id_produto: produto.id_produto, storage_path: `teste/${randomUUID()}.png` } });
  const idsPedidos: string[] = [];
  const idsConversas: string[] = [];
  for (const status of ["SOLICITADO", "ACEITO"] as const) {
    const pedido = await prisma.pedido.create({ data: {
      id_produto: produto.id_produto, id_vinculo_comprador: comprador.vinculo.id_vinculo, quantidade: 1,
      valor_pedido: "12.50", status_pedido: status, hora_combinada: new Date(Date.now() + 3_600_000),
    } });
    idsPedidos.push(pedido.id_pedido);
    await prisma.pedido_status_historico.create({ data: { id_pedido: pedido.id_pedido, status_novo: status, alterado_por: comprador.id } });
    const conversa = await prisma.conversa.create({ data: { id_pedido: pedido.id_pedido } });
    idsConversas.push(conversa.id_conversa);
    await prisma.conversa_participante.createMany({ data: [vendedor.id, comprador.id].map((id) => ({ id_conversa: conversa.id_conversa, id_usuario: id })) });
    await prisma.mensagem.create({ data: { id_conversa: conversa.id_conversa, id_remetente: comprador.id, conteudo: "Mensagem de teste preservada." } });
  }
  async function historico() {
    return Promise.all([
      prisma.produto.findUniqueOrThrow({ where: { id_produto: produto.id_produto } }),
      prisma.produto_imagem.findMany({ where: { id_produto: produto.id_produto }, orderBy: { id_imagem: "asc" } }),
      prisma.pedido.findMany({ where: { id_pedido: { in: idsPedidos } }, orderBy: { id_pedido: "asc" } }),
      prisma.pedido_status_historico.findMany({ where: { id_pedido: { in: idsPedidos } }, orderBy: { id_historico: "asc" } }),
      prisma.conversa.findMany({ where: { id_conversa: { in: idsConversas } }, orderBy: { id_conversa: "asc" } }),
      prisma.conversa_participante.findMany({ where: { id_conversa: { in: idsConversas } }, orderBy: [{ id_conversa: "asc" }, { id_usuario: "asc" }] }),
      prisma.mensagem.findMany({ where: { id_conversa: { in: idsConversas } }, orderBy: { id_mensagem: "asc" } }),
    ]);
  }
  const antes = await historico();
  assert.equal((await requisitar(admin, vendedor.vinculo.id_vinculo)).status, 200);
  assert.deepEqual(await historico(), antes);
  assert.deepEqual(await vinculoAtual(vendedor.vinculo.id_vinculo), { ...vendedor.vinculo, status_vinculo: "SUSPENSO" });
});

function interceptarTransacao(transformar: (tx: Prisma.TransactionClient) => Prisma.TransactionClient) {
  const original = prisma.$transaction;
  Reflect.set(prisma, "$transaction", async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, opcoes: object) =>
    original.call(prisma, (tx) => callback(transformar(tx)), opcoes));
  return () => { Reflect.set(prisma, "$transaction", original); };
}

test("duas suspensões concorrentes: 200 + 409 e uma única auditoria", async () => {
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
    const resultados = await Promise.all([requisitar(admin, vinculo.id_vinculo), requisitar(superAdmin, vinculo.id_vinculo)]);
    assert.deepEqual(resultados.map((item) => item.status).sort(), [200, 409]);
    assert.equal(resultados.find((item) => item.status === 409)?.body.erro, "MEMBERSHIP_NOT_ACTIVE");
    assert.deepEqual(await vinculoAtual(vinculo.id_vinculo), { ...vinculo, status_vinculo: "SUSPENSO" });
    const registros = await auditorias(vinculo.id_vinculo);
    assert.equal(registros.length, 1);
    assert.equal(registros[0].id_ator, resultados[0].status === 200 ? admin : superAdmin);
  } finally { restaurar(); }
  assert.equal(chegaram, 2);
});

test("falha de auditoria reverte suspensão na transação real e mantém ATIVO", async () => {
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

test("conta global suspensa mantém bloqueio de admin e super admin", async () => {
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
