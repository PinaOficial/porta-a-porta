import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Client } from "pg";
import { setTimeout as esperar } from "node:timers/promises";
import { after, before, mock, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { Prisma, status_vinculo_enum } from "../src/generated/prisma/client.js";
import type { ResultadoAprovacaoVinculo, SituacaoResidencial } from "../src/modules/vinculos/vinculo.model.js";

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
const jwk = { ...await exportJWK(chaves.publicKey), kid: "aprovacao-teste", alg: "ES256", use: "sig" };
const condominioA = randomUUID();
const condominioB = randomUUID();
const servidor = createServer(app);
let base: string;
let admin: string;
let superAdmin: string;

async function criarMorador(status: status_vinculo_enum = "PENDENTE", idCondominio: string = condominioA, administrador = false) {
  const id = randomUUID();
  await prisma.usuario.create({ data: { id_usuario: id, email: `${id}@exemplo.com` } });
  await prisma.condomino.create({ data: {
    id_condomino: id, nome_completo: "Morador da Aprovação",
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

async function requisitar(id: string, idVinculo: string, opcoes: { body?: unknown; query?: string; forjarAdmin?: boolean } = {}) {
  const resposta = await fetch(`${base}/admin/vinculos/${idVinculo}/aprovar${opcoes.query ?? ""}`, {
    method: "PATCH", headers: { ...await headers(id, opcoes.forjarAdmin), ...(opcoes.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(opcoes.body !== undefined ? { body: JSON.stringify(opcoes.body) } : {}),
  });
  return { status: resposta.status, body: await resposta.json() };
}

async function vinculoAtual(idVinculo: string) {
  return prisma.vinculo_condominio.findUniqueOrThrow({ where: { id_vinculo: idVinculo } });
}
async function auditorias(idVinculo: string) {
  return prisma.auditoria.findMany({ where: { entidade_id: idVinculo, acao: "APPROVE_MEMBERSHIP" } });
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
    { id_condominio: condominioA, nome_residencial: "Residencial Aprovação A", cep: "70000000", endereco: "Rua A" },
    { id_condominio: condominioB, nome_residencial: "Residencial Aprovação B", cep: "70000001", endereco: "Rua B" },
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
    const resposta = await fetch(`${base}/admin/vinculos/${vinculo.id_vinculo}/aprovar`, { method: "PATCH", headers: cabecalhos });
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

test("fluxo HTTP onboarding → aprovação local → vínculo ativo e saída da fila, com auditoria única", async () => {
  const idMorador = randomUUID();
  const cabecalhos = { ...await headers(idMorador), "Content-Type": "application/json" };
  const onboarding = await fetch(`${base}/onboarding`, { method: "POST", headers: cabecalhos, body: JSON.stringify({
    nome_completo: "Maria da Silva", cpf: String(randomInt(0, 100_000_000_000)).padStart(11, "0"),
    data_nascimento: "2000-05-20", id_condominio: condominioA, moradia: "Bloco B - Apto 302",
  }) });
  assert.equal(onboarding.status, 201);
  const idVinculo = (await onboarding.json()).dados.id_vinculo as string;
  const antes = await vinculoAtual(idVinculo);
  const situacaoAntes = await fetch(`${base}/vinculos/me`, { headers: cabecalhos });
  const dadosAntes = (await situacaoAntes.json() as SituacaoResidencial).dados;
  assert.equal(dadosAntes.vinculo_ativo, null);
  assert.equal(dadosAntes.solicitacao_pendente?.id_vinculo, idVinculo);
  const inicio = Date.now();
  const resposta = await requisitar(admin, idVinculo);
  assert.equal(resposta.status, 200);
  const dados = (resposta.body as ResultadoAprovacaoVinculo).dados;
  assert.equal(dados.id_vinculo, idVinculo);
  assert.equal(dados.status_vinculo, "ATIVO");
  assert.equal(dados.admin_condominio, false);
  assert.equal(dados.data_aprovacao, dados.data_inicio);
  assert.ok(Date.parse(dados.data_aprovacao) >= inicio && Date.parse(dados.data_aprovacao) <= Date.now());
  assert.deepEqual(dados.morador, { id_condomino: idMorador, nome_completo: "Maria da Silva" });
  assert.deepEqual(dados.condominio, { id_condominio: condominioA, nome_residencial: "Residencial Aprovação A" });
  assert.doesNotMatch(JSON.stringify(resposta.body), /cpf|data_nascimento|email|aprovado_por|metadata|status_conta|token|admin_atualizado/);
  const depois = await vinculoAtual(idVinculo);
  assert.deepEqual(depois, { ...antes, status_vinculo: "ATIVO", data_aprovacao: new Date(dados.data_aprovacao), data_inicio: new Date(dados.data_inicio), aprovado_por: admin });
  const registros = await auditorias(idVinculo);
  assert.equal(registros.length, 1);
  assert.deepEqual(registros[0], {
    id_auditoria: registros[0].id_auditoria, id_ator: admin, acao: "APPROVE_MEMBERSHIP", entidade: "vinculo_condominio",
    entidade_id: idVinculo, id_condominio: condominioA, created_at: depois.data_aprovacao,
    metadata: { status_anterior: "PENDENTE", status_novo: "ATIVO" },
  });
  const situacaoDepois = await fetch(`${base}/vinculos/me`, { headers: cabecalhos });
  const dadosDepois = (await situacaoDepois.json() as SituacaoResidencial).dados;
  assert.equal(dadosDepois.vinculo_ativo?.id_vinculo, idVinculo);
  assert.equal(dadosDepois.vinculo_ativo?.status_vinculo, "ATIVO");
  assert.equal(dadosDepois.solicitacao_pendente, null);
  const fila = await fetch(`${base}/admin/vinculos/pendentes?busca=Maria%20da%20Silva&limite=100`, { headers: await headers(admin) });
  assert.equal(fila.status, 200);
  assert.ok(!(await fila.json()).dados.some((item: { id_vinculo: string }) => item.id_vinculo === idVinculo));
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/condominios`, { headers: cabecalhos })).status, 200);
});

test("cross-tenant retorna 403 antes de revelar estado, ignora autoridade forjada na query e não grava auditoria", async () => {
  for (const status of ["PENDENTE", "ATIVO"] as const) {
    const { vinculo } = await criarMorador(status, condominioB);
    const resposta = await requisitar(admin, vinculo.id_vinculo, { query: `?id_condominio=${condominioA}&super_admin=true&aprovado_por=${superAdmin}` });
    assert.equal(resposta.status, 403);
    assert.deepEqual(resposta.body, { erro: "FORBIDDEN_CROSS_TENANT", mensagem: "Acesso restrito ao próprio condomínio." });
    await confirmarSemAlteracao(vinculo);
  }
});

test("super admin sem vínculo aprova outro condomínio e não promove o morador", async () => {
  const { vinculo } = await criarMorador("PENDENTE", condominioB);
  const resposta = await requisitar(superAdmin, vinculo.id_vinculo);
  assert.equal(resposta.status, 200);
  assert.equal(resposta.body.dados.admin_condominio, false);
  assert.equal((await vinculoAtual(vinculo.id_vinculo)).aprovado_por, superAdmin);
  assert.equal((await auditorias(vinculo.id_vinculo))[0].id_ator, superAdmin);
});

test("UUID inválido retorna 400; UUID válido inexistente retorna 404", async () => {
  const invalido = await requisitar(admin, "abc");
  assert.equal(invalido.status, 400);
  assert.equal(invalido.body.erro, "VALIDATION_ERROR");
  const inexistente = await requisitar(admin, randomUUID());
  assert.equal(inexistente.status, 404);
  assert.equal(inexistente.body.erro, "MEMBERSHIP_NOT_FOUND");
});

test("body é rejeitado, inclusive status, ator, privilégios e datas forjados", async () => {
  const { vinculo } = await criarMorador();
  for (const body of [{ status_vinculo: "ATIVO", admin_condominio: true, aprovado_por: superAdmin }, { id_admin: superAdmin }, { data_aprovacao: "2000-01-01" }, {}, []]) {
    const resposta = await requisitar(admin, vinculo.id_vinculo, { body });
    assert.equal(resposta.status, 400);
    assert.equal(resposta.body.erro, "VALIDATION_ERROR");
  }
  await confirmarSemAlteracao(vinculo);
});

for (const status of ["ATIVO", "REJEITADO", "SUSPENSO", "ENCERRADO"] as const) {
  test(`${status} retorna 409 MEMBERSHIP_NOT_PENDING e não gera auditoria`, async () => {
    const { vinculo } = await criarMorador(status);
    const resposta = await requisitar(admin, vinculo.id_vinculo);
    assert.equal(resposta.status, 409);
    assert.equal(resposta.body.erro, "MEMBERSHIP_NOT_PENDING");
    await confirmarSemAlteracao(vinculo);
  });
}

test("outro vínculo ATIVO é tratado como transferência pelo admin do destino e super admin", async () => {
  for (const ator of [admin, superAdmin]) {
    const morador = await criarMorador("ATIVO", condominioB);
    const pendente = await prisma.vinculo_condominio.create({ data: { id_condomino: morador.id, id_condominio: condominioA, moradia: "Apto 102" } });
    const resposta = await requisitar(ator, pendente.id_vinculo);
    assert.equal(resposta.status, 200);
    assert.equal((await vinculoAtual(pendente.id_vinculo)).status_vinculo, "ATIVO");
    assert.equal((await vinculoAtual(morador.vinculo.id_vinculo)).status_vinculo, "ENCERRADO");
    assert.equal((await auditorias(pendente.id_vinculo)).length, 1);
  }
});

// Interceptar somente o ponto desejado; transação e queries continuam reais no PostgreSQL.
function interceptarTransacao(transformar: (tx: Prisma.TransactionClient) => Prisma.TransactionClient) {
  const original = prisma.$transaction;
  Reflect.set(prisma, "$transaction", async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, opcoes: object) =>
    original.call(prisma, (tx) => callback(transformar(tx)), opcoes));
  return () => { Reflect.set(prisma, "$transaction", original); };
}
function interceptarAtualizacao(tx: Prisma.TransactionClient, antes: () => Promise<void>) {
  return new Proxy(tx, { get(target, propriedade, receiver) {
    if (propriedade !== "vinculo_condominio") return Reflect.get(target, propriedade, receiver);
    return new Proxy(target.vinculo_condominio, { get(delegate, metodo, receptor) {
      if (metodo !== "updateMany") return Reflect.get(delegate, metodo, receptor);
      return async (args: Prisma.vinculo_condominioUpdateManyArgs) => { await antes(); return delegate.updateMany(args); };
    } });
  } });
}

test("duas aprovações concorrentes disputam o mesmo PENDENTE: 200 + 409 e uma única auditoria", async () => {
  const { vinculo, id } = await criarMorador();
  let chegaram = 0;
  let liberar: () => void = () => {};
  const barreira = new Promise<void>((resolve) => { liberar = resolve; });
  const restaurar = interceptarTransacao((tx) => interceptarAtualizacao(tx, async () => {
    if (++chegaram === 2) liberar();
    await barreira;
  }));
  try {
    const resultados = await Promise.all([requisitar(admin, vinculo.id_vinculo), requisitar(superAdmin, vinculo.id_vinculo)]);
    assert.deepEqual(resultados.map((item) => item.status).sort(), [200, 409]);
    assert.equal(resultados.find((item) => item.status === 409)?.body.erro, "MEMBERSHIP_NOT_PENDING");
  } finally { restaurar(); }
  assert.equal(chegaram, 2);
  assert.equal(await prisma.vinculo_condominio.count({ where: { id_condomino: id, status_vinculo: "ATIVO" } }), 1);
  const registros = await auditorias(vinculo.id_vinculo);
  assert.equal(registros.length, 1);
  assert.equal(registros[0].id_ator, (await vinculoAtual(vinculo.id_vinculo)).aprovado_por);
});

test("índice real de único ATIVO protege corrida após pré-checagem e P2002 vira 409", async () => {
  const { vinculo, id } = await criarMorador();
  let ativoCriado: string | undefined;
  const restaurar = interceptarTransacao((tx) => interceptarAtualizacao(tx, async () => {
    const ativo = await prisma.vinculo_condominio.create({ data: { id_condomino: id, id_condominio: condominioB, moradia: "Apto 202", status_vinculo: "ATIVO" } });
    ativoCriado = ativo.id_vinculo;
  }));
  try {
    const resposta = await requisitar(admin, vinculo.id_vinculo);
    assert.equal(resposta.status, 409);
    assert.equal(resposta.body.erro, "ACTIVE_MEMBERSHIP_ALREADY_EXISTS");
  } finally { restaurar(); }
  await confirmarSemAlteracao(vinculo);
  assert.ok(ativoCriado);
  assert.equal((await vinculoAtual(ativoCriado)).status_vinculo, "ATIVO");
});

test("falha na auditoria causa rollback real da aprovação e preserva PENDENTE", async () => {
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

test("conta global suspensa não aprova mesmo com autoridade administrativa", async () => {
  const { vinculo } = await criarMorador();
  for (const ator of [admin, superAdmin]) {
    await prisma.usuario.update({ where: { id_usuario: ator }, data: { status_conta: "SUSPENSA" } });
    try {
      const resposta = await requisitar(ator, vinculo.id_vinculo);
      assert.equal(resposta.status, 403);
      assert.equal(resposta.body.erro, "ACCOUNT_SUSPENDED");
    } finally {
      await prisma.usuario.update({ where: { id_usuario: ator }, data: { status_conta: "ATIVA" } });
    }
  }
  await confirmarSemAlteracao(vinculo);
});

// Prompt 21: exercita as rotas reais, reutilizando o script de integração existente.
let categoriaTransferencia: string;
before(async () => {
  categoriaTransferencia = (await prisma.categoria_produto.create({ data: { nome: `Transferência ${randomUUID()}` } })).id_categoria;
});
async function chamar(caminho: string, ator: string, metodo = "GET", body?: unknown) {
  const r = await fetch(`${base}${caminho}`, {
    method: metodo, headers: { ...await headers(ator), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json() };
}
async function solicitarMudanca(ator: string, destino: string = condominioA, extras: object = {}) {
  return chamar("/vinculos/transferencia", ator, "POST", { id_condominio: destino, moradia: "  Nova moradia  ", ...extras });
}
async function cenarioTransferencia(administrador = false, origem: string = condominioB) {
  const pessoa = await criarMorador("ATIVO", origem, administrador);
  const produto = await prisma.produto.create({ data: {
    id_vinculo_vendedor: pessoa.vinculo.id_vinculo, id_categoria: categoriaTransferencia,
    nome_produto: "Produto histórico", descricao: "Não mover de vínculo", preco: "10.00", estoque: 10,
  } });
  const r = await solicitarMudanca(pessoa.id); assert.equal(r.status, 201);
  return { pessoa, produto, pendente: await vinculoAtual(r.body.dados.id_vinculo) };
}
async function criarPedidoNoVinculo(pessoa: Awaited<ReturnType<typeof criarMorador>>, papel: "comprador" | "vendedor", status = "SOLICITADO") {
  const outra = await criarMorador("ATIVO", pessoa.vinculo.id_condominio);
  const vendedor = papel === "vendedor" ? pessoa : outra;
  const comprador = papel === "comprador" ? pessoa : outra;
  const produto = await prisma.produto.create({ data: {
    id_vinculo_vendedor: vendedor.vinculo.id_vinculo, id_categoria: categoriaTransferencia,
    nome_produto: "Pedido da transferência", descricao: "Teste", preco: "12.00", estoque: 10,
  } });
  const r = await chamar("/pedidos", comprador.id, "POST", { id_produto: produto.id_produto, quantidade: 2, hora_combinada: "2099-01-01T00:00:00Z" });
  assert.equal(r.status, 201);
  if (status !== "SOLICITADO") {
    if (["ACEITO", "CONCLUIDO"].includes(status)) assert.equal((await chamar(`/pedidos/${r.body.dados.id_pedido}/status`, vendedor.id, "PATCH", { status: "ACEITO" })).status, 200);
    if (status !== "ACEITO") assert.equal((await chamar(`/pedidos/${r.body.dados.id_pedido}/status`, status === "CANCELADO" ? comprador.id : vendedor.id, "PATCH", { status })).status, 200);
  }
  return { pedido: r.body.dados, produto, comprador, vendedor };
}
async function estadoTransferencia(idPessoa: string) {
  const vinculos = await prisma.vinculo_condominio.findMany({ where: { id_condomino: idPessoa }, orderBy: { id_vinculo: "asc" } });
  return {
    vinculos,
    produtos: await prisma.produto.findMany({ where: { id_vinculo_vendedor: { in: vinculos.map((v) => v.id_vinculo) } }, orderBy: { id_produto: "asc" } }),
    auditoria: await prisma.auditoria.findMany({ where: { entidade_id: { in: vinculos.map((v) => v.id_vinculo) } }, orderBy: { id_auditoria: "asc" } }),
  };
}

test("solicitação permite ATIVO + PENDENTE, mantém produtos e aparece em /me", async () => {
  const { pessoa, produto, pendente } = await cenarioTransferencia();
  assert.equal(pendente.status_vinculo, "PENDENTE"); assert.equal(pendente.admin_condominio, false);
  assert.equal(pendente.moradia, "Nova moradia");
  assert.equal(pendente.data_inicio, null); assert.equal(pendente.data_aprovacao, null);
  assert.deepEqual(await vinculoAtual(pessoa.vinculo.id_vinculo), pessoa.vinculo);
  assert.deepEqual(await prisma.produto.findUnique({ where: { id_produto: produto.id_produto } }), produto);
  const me = await chamar("/vinculos/me", pessoa.id);
  assert.equal(me.body.dados.vinculo_ativo.id_vinculo, pessoa.vinculo.id_vinculo);
  assert.equal(me.body.dados.solicitacao_pendente.id_vinculo, pendente.id_vinculo);
  const repetida = await solicitarMudanca(pessoa.id);
  assert.equal(repetida.status, 409); assert.equal(repetida.body.erro, "MEMBERSHIP_PENDING");
});

test("solicitação valida estado atual/destino/body e não bloqueia último admin com pedidos abertos", async () => {
  const origem = randomUUID();
  await prisma.condominio.create({ data: { id_condominio: origem, nome_residencial: "Origem isolada", cep: "70000000", endereco: "Rua" } });
  const pessoa = await criarMorador("ATIVO", origem, true);
  await criarPedidoNoVinculo(pessoa, "comprador");
  const mesmo = await solicitarMudanca(pessoa.id, origem); assert.equal(mesmo.status, 409); assert.equal(mesmo.body.erro, "SAME_CONDOMINIUM");
  const inexistente = await solicitarMudanca(pessoa.id, randomUUID()); assert.equal(inexistente.status, 404); assert.equal(inexistente.body.erro, "CONDOMINIUM_NOT_FOUND");
  const inativo = await prisma.condominio.create({ data: { nome_residencial: "Destino inativo", cep: "70000000", endereco: "Rua", ativo: false } });
  const negado = await solicitarMudanca(pessoa.id, inativo.id_condominio); assert.equal(negado.status, 409); assert.equal(negado.body.erro, "CONDOMINIUM_INACTIVE");
  for (const body of [{ id_condominio: "abc", moradia: "Nova" }, { id_condominio: condominioA, moradia: " " }, { id_condominio: condominioA, moradia: "a".repeat(81) }, { id_condominio: condominioA, moradia: "Nova", admin_condominio: true }, { id_condominio: condominioA, moradia: "Nova", id_condomino: superAdmin }]) {
    assert.equal((await chamar("/vinculos/transferencia", pessoa.id, "POST", body)).status, 400);
  }
  for (const status of ["PENDENTE", "REJEITADO", "SUSPENSO", "ENCERRADO"] as const) {
    const semAtivo = await criarMorador(status);
    assert.equal((await solicitarMudanca(semAtivo.id)).status, 403);
  }
  assert.equal((await solicitarMudanca(pessoa.id)).status, 201);
});

test("duas solicitações simultâneas criam uma PENDENTE e retornam erro estável para a outra", async () => {
  const pessoa = await criarMorador("ATIVO", condominioB);
  const respostas = await Promise.all([solicitarMudanca(pessoa.id), solicitarMudanca(pessoa.id)]);
  assert.deepEqual(respostas.map((r) => r.status).sort(), [201, 409]);
  assert.equal(respostas.find((r) => r.status === 409)!.body.erro, "MEMBERSHIP_PENDING");
  assert.equal(await prisma.vinculo_condominio.count({ where: { id_condomino: pessoa.id, status_vinculo: "PENDENTE" } }), 1);
  assert.equal((await vinculoAtual(pessoa.vinculo.id_vinculo)).status_vinculo, "ATIVO");
});

for (const papel of ["comprador", "vendedor"] as const) {
  for (const status of ["SOLICITADO", "ACEITO"]) {
    test(`transferência bloqueia pedido ${status} como ${papel}, inclusive para super admin`, async () => {
      const { pessoa, pendente } = await cenarioTransferencia();
      await criarPedidoNoVinculo(pessoa, papel, status);
      const antes = await estadoTransferencia(pessoa.id);
      for (const ator of [admin, superAdmin]) {
        const r = await requisitar(ator, pendente.id_vinculo);
        assert.equal(r.status, 409); assert.equal(r.body.erro, "OPEN_ORDERS_BLOCK_TRANSFER");
      }
      assert.deepEqual(await estadoTransferencia(pessoa.id), antes);
    });
  }
}

test("somente pedidos terminais permitem transferência e preservam pedidos/histórico/chat/imagens", async () => {
  const { pessoa, produto, pendente } = await cenarioTransferencia();
  const pedidos: Awaited<ReturnType<typeof criarPedidoNoVinculo>>[] = [];
  for (const status of ["RECUSADO", "CANCELADO", "CONCLUIDO"]) pedidos.push(await criarPedidoNoVinculo(pessoa, "vendedor", status));
  const conversa = await prisma.conversa.findUniqueOrThrow({ where: { id_pedido: pedidos[0].pedido.id_pedido } });
  assert.equal((await chamar(`/pedidos/${pedidos[0].pedido.id_pedido}/chat/messages`, pessoa.id, "POST", { conteudo: "Histórico preservado" })).status, 201);
  const imagem = await prisma.produto_imagem.create({ data: { id_produto: produto.id_produto, storage_path: `transferencia/${randomUUID()}.png` } });
  const lerHistorico = () => prisma.pedido.findMany({ where: { id_pedido: { in: pedidos.map((p) => p.pedido.id_pedido) } }, orderBy: { id_pedido: "asc" }, include: {
    pedido_status_historico: { orderBy: { id_historico: "asc" } }, conversa: { include: { conversa_participante: true, mensagem: true } },
  } });
  const historico = await lerHistorico();
  const r = await requisitar(admin, pendente.id_vinculo); assert.equal(r.status, 200);
  const antigo = await vinculoAtual(pessoa.vinculo.id_vinculo); const novo = await vinculoAtual(pendente.id_vinculo);
  assert.equal(antigo.status_vinculo, "ENCERRADO"); assert.ok(antigo.data_fim);
  assert.equal(novo.status_vinculo, "ATIVO"); assert.equal(novo.admin_condominio, false); assert.equal(novo.data_fim, null);
  assert.equal(novo.aprovado_por, admin); assert.equal(novo.data_inicio!.toISOString(), antigo.data_fim.toISOString());
  const produtos = await prisma.produto.findMany({ where: { id_vinculo_vendedor: pessoa.vinculo.id_vinculo } });
  assert.ok(produtos.length >= 4); assert.ok(produtos.every((p) => !p.ativo && p.id_vinculo_vendedor === pessoa.vinculo.id_vinculo));
  assert.equal(await prisma.produto.count({ where: { id_vinculo_vendedor: novo.id_vinculo } }), 0);
  assert.deepEqual(await lerHistorico(), historico);
  assert.deepEqual(await prisma.produto_imagem.findUnique({ where: { id_imagem: imagem.id_imagem } }), imagem);
  assert.equal((await chamar(`/pedidos/${conversa.id_pedido}/chat`, pessoa.id)).body.dados[0].conteudo, "Histórico preservado");
  assert.equal((await chamar("/pedidos/me", pessoa.id)).body.dados.length, 3);
  const registros = await auditorias(novo.id_vinculo); assert.equal(registros.length, 1);
  assert.deepEqual(registros[0].metadata, { status_anterior: "PENDENTE", status_novo: "ATIVO", transferencia: true, id_vinculo_antigo: antigo.id_vinculo, id_vinculo_novo: novo.id_vinculo, status_antigo_anterior: "ATIVO", status_antigo_novo: "ENCERRADO" });
});

test("último admin bloqueia aprovação local, permite intervenção super admin e não herda privilégio", async () => {
  const origem = randomUUID();
  await prisma.condominio.create({ data: { id_condominio: origem, nome_residencial: "Último admin", cep: "70000000", endereco: "Rua" } });
  const { pessoa, pendente } = await cenarioTransferencia(true, origem);
  const antes = await estadoTransferencia(pessoa.id);
  const local = await requisitar(admin, pendente.id_vinculo); assert.equal(local.status, 409); assert.equal(local.body.erro, "LAST_ACTIVE_ADMIN");
  assert.deepEqual(await estadoTransferencia(pessoa.id), antes);
  assert.equal((await requisitar(superAdmin, pendente.id_vinculo)).status, 200);
  assert.equal((await vinculoAtual(pendente.id_vinculo)).admin_condominio, false);
  assert.equal((await vinculoAtual(pessoa.vinculo.id_vinculo)).status_vinculo, "ENCERRADO");
});

test("admin com substituto pode transferir, mas dois admins concorrentes não esvaziam o condomínio", async () => {
  const origem = randomUUID();
  await prisma.condominio.create({ data: { id_condominio: origem, nome_residencial: "Dois admins", cep: "70000000", endereco: "Rua" } });
  const um = await cenarioTransferencia(true, origem); const dois = await cenarioTransferencia(true, origem);
  const respostas = await Promise.all([requisitar(admin, um.pendente.id_vinculo), requisitar(admin, dois.pendente.id_vinculo)]);
  assert.deepEqual(respostas.map((r) => r.status).sort(), [200, 409]);
  assert.equal(respostas.find((r) => r.status === 409)!.body.erro, "LAST_ACTIVE_ADMIN");
  assert.equal(await prisma.vinculo_condominio.count({ where: { id_condominio: origem, status_vinculo: "ATIVO", admin_condominio: true } }), 1);
});

test("double-click de aprovação de transferência só produz uma troca e uma auditoria", async () => {
  const { pessoa, pendente } = await cenarioTransferencia();
  const respostas = await Promise.all([requisitar(admin, pendente.id_vinculo), requisitar(superAdmin, pendente.id_vinculo)]);
  assert.deepEqual(respostas.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await auditorias(pendente.id_vinculo)).length, 1);
  assert.equal(await prisma.vinculo_condominio.count({ where: { id_condomino: pessoa.id, status_vinculo: "ATIVO" } }), 1);
});

test("aprovação de transferência exige admin do destino e revalida destino ativo", async () => {
  const { pessoa, pendente } = await cenarioTransferencia();
  const adminOrigem = await criarMorador("ATIVO", condominioB, true);
  const r = await requisitar(adminOrigem.id, pendente.id_vinculo); assert.equal(r.status, 403); assert.equal(r.body.erro, "FORBIDDEN_CROSS_TENANT");
  const antes = await estadoTransferencia(pessoa.id);
  await prisma.condominio.update({ where: { id_condominio: condominioA }, data: { ativo: false } });
  try { const r = await requisitar(admin, pendente.id_vinculo); assert.equal(r.status, 409); assert.equal(r.body.erro, "CONDOMINIUM_INACTIVE"); }
  finally { await prisma.condominio.update({ where: { id_condominio: condominioA }, data: { ativo: true } }); }
  assert.deepEqual(await estadoTransferencia(pessoa.id), antes);
});

for (const etapa of ["encerrar", "ativar", "auditoria"] as const) {
  test(`transferência reverte todos os efeitos quando falha ao ${etapa}`, async () => {
    const { pessoa, pendente } = await cenarioTransferencia();
    const antes = await estadoTransferencia(pessoa.id);
    const restaurar = interceptarTransacao((tx) => new Proxy(tx, { get(target, propriedade, receiver) {
      if (etapa === "auditoria" && propriedade === "auditoria") return new Proxy(target.auditoria, { get(delegate, metodo, receptor) {
        return metodo === "create" ? () => { throw new Error("Falha na auditoria"); } : Reflect.get(delegate, metodo, receptor);
      } });
      if (etapa !== "auditoria" && propriedade === "vinculo_condominio") return new Proxy(target.vinculo_condominio, { get(delegate, metodo, receptor) {
        if (metodo !== "updateMany") return Reflect.get(delegate, metodo, receptor);
        return (args: Prisma.vinculo_condominioUpdateManyArgs) => {
          if (args.data.status_vinculo === (etapa === "encerrar" ? "ENCERRADO" : "ATIVO")) throw new Error("Falha na troca de vínculo");
          return delegate.updateMany(args);
        };
      } });
      return Reflect.get(target, propriedade, receiver);
    } }));
    const log = mock.method(console, "error", () => {});
    try { assert.equal((await requisitar(admin, pendente.id_vinculo)).status, 500); }
    finally { restaurar(); log.mock.restore(); }
    assert.deepEqual(await estadoTransferencia(pessoa.id), antes);
  });
}

async function observarBloqueio(client: Client) {
  for (let i = 0; i < 120; i++) {
    const r = await client.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()");
    if (r.rows[0].n > 0) return;
    await esperar(15);
  }
  throw new Error("A transação concorrente não aguardou o lock esperado");
}
function sinal() {
  let resolver!: () => void;
  const promessa = new Promise<void>((resolve) => { resolver = resolve; });
  return { promessa, resolver };
}
async function aguardarSinal(promessa: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([promessa, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Barreira não alcançada")), 2500); })]);
  } finally { if (timer) clearTimeout(timer); }
}

for (const papel of ["comprador", "vendedor"] as const) {
  for (const primeiro of ["pedido", "transferencia"] as const) {
    test(`corrida com novo pedido como ${papel}: ${primeiro} obtém lock primeiro`, async () => {
      const { pessoa, produto, pendente } = await cenarioTransferencia();
      const outra = await criarMorador("ATIVO", condominioB);
      const produtoPedido = papel === "vendedor" ? produto : await prisma.produto.create({ data: {
        id_vinculo_vendedor: outra.vinculo.id_vinculo, id_categoria: categoriaTransferencia,
        nome_produto: "Corrida", descricao: "Teste de locks", preco: "10.00", estoque: 10,
      } });
      const comprador = papel === "comprador" ? pessoa : outra;
      const chegou = sinal(); const liberar = sinal(); let interceptado = false;
      const restaurar = interceptarTransacao((tx) => new Proxy(tx, { get(target, propriedade, receiver) {
        if (propriedade !== "$queryRaw") return Reflect.get(target, propriedade, receiver);
        return async (strings: TemplateStringsArray, ...valores: unknown[]) => {
          const resultado = await target.$queryRaw(strings, ...valores);
          const consulta = strings.join("?");
          if (!interceptado && valores.includes(pessoa.vinculo.id_vinculo)
            && consulta.includes(primeiro === "pedido" ? "FOR SHARE" : "FOR UPDATE")) {
            interceptado = true; chegou.resolver(); await liberar.promessa;
          }
          return resultado;
        };
      } }));
      const client = new Client({ connectionString: urlTeste }); await client.connect();
      let pedidoPromessa: ReturnType<typeof chamar> | undefined; let aprovacaoPromessa: ReturnType<typeof requisitar> | undefined;
      const pedir = () => chamar("/pedidos", comprador.id, "POST", { id_produto: produtoPedido.id_produto, quantidade: 1, hora_combinada: "2099-01-01T00:00:00Z" });
      try {
        if (primeiro === "pedido") pedidoPromessa = pedir(); else aprovacaoPromessa = requisitar(admin, pendente.id_vinculo);
        await aguardarSinal(chegou.promessa);
        if (primeiro === "pedido") aprovacaoPromessa = requisitar(admin, pendente.id_vinculo); else pedidoPromessa = pedir();
        await observarBloqueio(client);
        liberar.resolver();
        const [pedido, aprovacao] = await Promise.all([pedidoPromessa!, aprovacaoPromessa!]);
        if (primeiro === "pedido") {
          assert.equal(pedido.status, 201); assert.equal(aprovacao.status, 409); assert.equal(aprovacao.body.erro, "OPEN_ORDERS_BLOCK_TRANSFER");
          assert.equal((await vinculoAtual(pessoa.vinculo.id_vinculo)).status_vinculo, "ATIVO");
          assert.equal((await vinculoAtual(pendente.id_vinculo)).status_vinculo, "PENDENTE");
        } else {
          assert.equal(aprovacao.status, 200); assert.equal(pedido.status, papel === "comprador" ? 403 : 409);
          assert.equal(pedido.body.erro, papel === "comprador" ? "MEMBERSHIP_REQUIRED" : "PRODUCT_UNAVAILABLE");
          assert.equal(await prisma.pedido.count({ where: { id_produto: produtoPedido.id_produto } }), 0);
        }
      } finally { liberar.resolver(); restaurar(); await client.end(); await Promise.allSettled([pedidoPromessa, aprovacaoPromessa].filter(Boolean)); }
    });
  }
}

test("GET admin/vinculos deriva tenant, filtra por enum/nome/moradia e usa dados[] com paginacao na raiz", async () => {
  const marca = randomUUID();
  const pessoas = [];
  for (const [index, status] of (["ATIVO", "PENDENTE", "SUSPENSO", "ENCERRADO", "REJEITADO"] as const).entries()) {
    const pessoa = await criarMorador(status, index % 2 ? condominioB : condominioA);
    await prisma.condomino.update({ where: { id_condomino: pessoa.id }, data: { nome_completo: `${marca} Pessoa ${index}` } });
    await prisma.vinculo_condominio.update({ where: { id_vinculo: pessoa.vinculo.id_vinculo }, data: { moradia: `${marca} Moradia ${index}`, data_solicitacao: new Date("2020-01-01") } });
    pessoas.push(pessoa);
  }
  const antes = await prisma.auditoria.count();
  const local = await chamar(`/admin/vinculos?busca=${marca}&limite=100`, admin); assert.equal(local.status, 200);
  assert.equal(local.body.paginacao.total, 3);
  assert.ok(local.body.dados.every((v: { condominio: { id_condominio: string } }) => v.condominio.id_condominio === condominioA));
  const negado = await chamar(`/admin/vinculos?id_condominio=${condominioB}`, admin); assert.equal(negado.status, 403); assert.equal(negado.body.erro, "FORBIDDEN_CROSS_TENANT");
  for (const pagina of [1, 2, 3, 4]) {
    const r = await chamar(`/admin/vinculos?busca=${marca}&pagina=${pagina}&limite=2`, superAdmin); assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.dados)); assert.deepEqual(Object.keys(r.body).sort(), ["dados", "paginacao"]);
    assert.deepEqual(r.body.paginacao, { pagina, limite: 2, total: 5, total_paginas: 3 });
    const esperados = pessoas.map((p) => p.vinculo.id_vinculo).sort().slice((pagina - 1) * 2, pagina * 2);
    assert.deepEqual(r.body.dados.map((v: { id_vinculo: string }) => v.id_vinculo), esperados);
    for (const v of r.body.dados) {
      assert.deepEqual(Object.keys(v).sort(), ["id_vinculo", "status_vinculo", "moradia", "admin_condominio", "data_solicitacao", "data_inicio", "morador", "condominio"].sort());
      assert.deepEqual(Object.keys(v.morador).sort(), ["id_usuario", "nome_completo"]);
    }
    assert.doesNotMatch(JSON.stringify(r.body), /cpf|email|data_nascimento|status_conta|storage_path/);
  }
  const filtrado = await chamar(`/admin/vinculos?busca=${marca}&id_condominio=${condominioB}`, superAdmin); assert.equal(filtrado.body.paginacao.total, 2);
  for (const pessoa of pessoas) {
    const r = await chamar(`/admin/vinculos?busca=${marca}&status=${pessoa.vinculo.status_vinculo}`, superAdmin);
    assert.equal(r.body.paginacao.total, 1); assert.equal(r.body.dados[0].morador.id_usuario, pessoa.id);
  }
  const moradia = await chamar(`/admin/vinculos?busca=${encodeURIComponent(`${marca} Moradia 0`)}`, superAdmin); assert.equal(moradia.body.paginacao.total, 1);
  for (const query of ["pagina=0", "limite=101", "status=ATIVA", "status=ATIVO&status=PENDENTE", "pagina=2147483647&limite=100", "cpf=123"]) assert.equal((await chamar(`/admin/vinculos?${query}`, superAdmin)).status, 400);
  assert.equal((await chamar("/admin/vinculos", pessoas[0].id)).status, 403);
  assert.equal(await prisma.auditoria.count(), antes);
});

test("promoção/rebaixamento altera metadata e auditoria somente em mudança real; local não age sobre si ou outro tenant", async () => {
  const pessoa = await criarMorador("ATIVO");
  const antes = await vinculoAtual(pessoa.vinculo.id_vinculo);
  const caminho = `/admin/vinculos/${pessoa.vinculo.id_vinculo}/admin`;
  assert.equal((await chamar(caminho, admin, "PATCH", { admin_condominio: true })).status, 200);
  const promovido = await vinculoAtual(pessoa.vinculo.id_vinculo);
  assert.equal(promovido.admin_condominio, true); assert.equal(promovido.admin_atualizado_por, admin); assert.ok(promovido.admin_atualizado_em);
  assert.deepEqual(promovido, { ...antes, admin_condominio: true, admin_atualizado_por: admin, admin_atualizado_em: promovido.admin_atualizado_em });
  let logs = await prisma.auditoria.findMany({ where: { entidade_id: promovido.id_vinculo, acao: "UPDATE_MEMBERSHIP_ADMIN" } });
  assert.equal(logs.length, 1); assert.deepEqual(logs[0].metadata, { admin_anterior: false, admin_novo: true });
  assert.equal(logs[0].created_at.toISOString(), promovido.admin_atualizado_em!.toISOString());
  assert.equal((await chamar(caminho, admin, "PATCH", { admin_condominio: true })).status, 200);
  assert.deepEqual(await vinculoAtual(promovido.id_vinculo), promovido);
  assert.equal((await prisma.auditoria.count({ where: { entidade_id: promovido.id_vinculo, acao: "UPDATE_MEMBERSHIP_ADMIN" } })), 1);
  const proprio = await chamar(caminho, pessoa.id, "PATCH", { admin_condominio: false }); assert.equal(proprio.status, 403); assert.equal(proprio.body.erro, "SELF_ADMIN_CHANGE_FORBIDDEN");
  assert.equal((await chamar(caminho, admin, "PATCH", { admin_condominio: false })).status, 200);
  logs = await prisma.auditoria.findMany({ where: { entidade_id: promovido.id_vinculo, acao: "UPDATE_MEMBERSHIP_ADMIN" } }); assert.equal(logs.length, 2);
  assert.ok(logs.some((l) => JSON.stringify(l.metadata) === JSON.stringify({ admin_novo: false, admin_anterior: true }) || (l.metadata as { admin_novo: boolean }).admin_novo === false));
  const outra = await criarMorador("ATIVO", condominioB);
  assert.equal((await chamar(`/admin/vinculos/${outra.vinculo.id_vinculo}/admin`, admin, "PATCH", { admin_condominio: true })).status, 403);
  assert.equal((await chamar(`/admin/vinculos/${outra.vinculo.id_vinculo}/admin`, superAdmin, "PATCH", { admin_condominio: true })).status, 200);
  for (const status of ["PENDENTE", "REJEITADO", "SUSPENSO", "ENCERRADO"] as const) {
    const alvo = await criarMorador(status);
    const r = await chamar(`/admin/vinculos/${alvo.vinculo.id_vinculo}/admin`, superAdmin, "PATCH", { admin_condominio: true }); assert.equal(r.status, 409); assert.equal(r.body.erro, "MEMBERSHIP_NOT_ACTIVE");
    assert.deepEqual(await vinculoAtual(alvo.vinculo.id_vinculo), alvo.vinculo);
  }
  for (const body of [{}, { admin_condominio: "true" }, { admin_condominio: 1 }, { admin_condominio: true, admin_atualizado_por: superAdmin }]) assert.equal((await chamar(caminho, admin, "PATCH", body)).status, 400);
  assert.equal((await chamar("/admin/vinculos/invalido/admin", admin, "PATCH", { admin_condominio: true })).status, 400);
  assert.equal((await chamar(`/admin/vinculos/${randomUUID()}/admin`, admin, "PATCH", { admin_condominio: true })).status, 404);
});

test("promoções concorrentes idempotentes produzem uma única auditoria", async () => {
  const pessoa = await criarMorador("ATIVO");
  const caminho = `/admin/vinculos/${pessoa.vinculo.id_vinculo}/admin`;
  const respostas = await Promise.all([chamar(caminho, admin, "PATCH", { admin_condominio: true }), chamar(caminho, superAdmin, "PATCH", { admin_condominio: true })]);
  assert.deepEqual(respostas.map((r) => r.status), [200, 200]);
  assert.equal(await prisma.auditoria.count({ where: { entidade_id: pessoa.vinculo.id_vinculo, acao: "UPDATE_MEMBERSHIP_ADMIN" } }), 1);
});

test("status global somente por super admin bloqueia o mesmo token e preserva vínculos/produtos/pedidos/chat", async () => {
  const { pessoa, pendente } = await cenarioTransferencia();
  const pedido = await criarPedidoNoVinculo(pessoa, "comprador");
  const caminho = `/admin/usuarios/${pessoa.id}/status`;
  const historicoAntes = await prisma.pedido.findUnique({ where: { id_pedido: pedido.pedido.id_pedido }, include: { pedido_status_historico: true, conversa: { include: { conversa_participante: true, mensagem: true } } } });
  const antes = await estadoTransferencia(pessoa.id); const tokenAntes = await headers(pessoa.id);
  assert.equal((await chamar(caminho, admin, "PATCH", { status_conta: "SUSPENSA" })).status, 403);
  const suspender = await chamar(caminho, superAdmin, "PATCH", { status_conta: "SUSPENSA" }); assert.equal(suspender.status, 200);
  assert.deepEqual(suspender.body, { dados: { id_usuario: pessoa.id, status_conta: "SUSPENSA" } });
  const suspenso = await prisma.usuario.findUniqueOrThrow({ where: { id_usuario: pessoa.id } }); assert.equal(suspenso.status_conta, "SUSPENSA");
  assert.deepEqual(await estadoTransferencia(pessoa.id), antes);
  const negado = await fetch(`${base}/vinculos/me`, { headers: tokenAntes }); assert.equal(negado.status, 403); assert.equal((await negado.json()).erro, "ACCOUNT_SUSPENDED");
  assert.equal((await chamar(caminho, superAdmin, "PATCH", { status_conta: "SUSPENSA" })).status, 200);
  assert.deepEqual(await prisma.usuario.findUnique({ where: { id_usuario: pessoa.id } }), suspenso);
  assert.equal(await prisma.auditoria.count({ where: { entidade_id: pessoa.id, acao: "UPDATE_USER_STATUS" } }), 1);
  assert.equal((await chamar(caminho, superAdmin, "PATCH", { status_conta: "ATIVA" })).status, 200);
  assert.equal((await fetch(`${base}/vinculos/me`, { headers: tokenAntes })).status, 200);
  assert.deepEqual(await estadoTransferencia(pessoa.id), antes);
  assert.deepEqual(await prisma.pedido.findUnique({ where: { id_pedido: pedido.pedido.id_pedido }, include: { pedido_status_historico: true, conversa: { include: { conversa_participante: true, mensagem: true } } } }), historicoAntes);
  assert.equal((await vinculoAtual(pendente.id_vinculo)).status_vinculo, "PENDENTE");
  const logs = await prisma.auditoria.findMany({ where: { entidade_id: pessoa.id, acao: "UPDATE_USER_STATUS" } }); assert.equal(logs.length, 2);
  assert.ok(logs.every((l) => l.id_condominio === null && l.id_ator === superAdmin));
  assert.ok(logs.some((l) => (l.metadata as { status_anterior: string }).status_anterior === "ATIVA"));
  assert.doesNotMatch(JSON.stringify(logs.map((l) => l.metadata)), /cpf|email|data_nascimento/);
});

test("reativação global não reativa vínculos suspensos/encerrados; body estrito e inexistência", async () => {
  for (const status of ["SUSPENSO", "ENCERRADO"] as const) {
    const pessoa = await criarMorador(status);
    for (const status_conta of ["SUSPENSA", "ATIVA"]) assert.equal((await chamar(`/admin/usuarios/${pessoa.id}/status`, superAdmin, "PATCH", { status_conta })).status, 200);
    assert.deepEqual(await vinculoAtual(pessoa.vinculo.id_vinculo), pessoa.vinculo);
  }
  for (const body of [{}, { status_conta: "SUSPENSO" }, { status_conta: "ATIVA", status_vinculo: "ATIVO" }, { status_conta: "SUSPENSA", super_admin: false }]) assert.equal((await chamar(`/admin/usuarios/${admin}/status`, superAdmin, "PATCH", body)).status, 400);
  assert.equal((await chamar("/admin/usuarios/invalido/status", superAdmin, "PATCH", { status_conta: "ATIVA" })).status, 400);
  const r = await chamar(`/admin/usuarios/${randomUUID()}/status`, superAdmin, "PATCH", { status_conta: "ATIVA" }); assert.equal(r.status, 404); assert.equal(r.body.erro, "USER_NOT_FOUND");
});

for (const tipo of ["admin", "conta"] as const) {
  test(`falha de auditoria reverte alteração de ${tipo}`, async () => {
    const pessoa = await criarMorador("ATIVO");
    const vinculoAntes = await vinculoAtual(pessoa.vinculo.id_vinculo);
    const contaAntes = await prisma.usuario.findUnique({ where: { id_usuario: pessoa.id } });
    const restaurar = interceptarTransacao((tx) => new Proxy(tx, { get(target, propriedade, receiver) {
      if (propriedade !== "auditoria") return Reflect.get(target, propriedade, receiver);
      return new Proxy(target.auditoria, { get(delegate, metodo, receptor) {
        return metodo === "create" ? () => { throw new Error("Falha controlada"); } : Reflect.get(delegate, metodo, receptor);
      } });
    } }));
    const log = mock.method(console, "error", () => {});
    try {
      const caminho = tipo === "admin" ? `/admin/vinculos/${pessoa.vinculo.id_vinculo}/admin` : `/admin/usuarios/${pessoa.id}/status`;
      assert.equal((await chamar(caminho, superAdmin, "PATCH", tipo === "admin" ? { admin_condominio: true } : { status_conta: "SUSPENSA" })).status, 500);
    } finally { restaurar(); log.mock.restore(); }
    assert.deepEqual(await vinculoAtual(pessoa.vinculo.id_vinculo), vinculoAntes);
    assert.deepEqual(await prisma.usuario.findUnique({ where: { id_usuario: pessoa.id } }), contaAntes);
    assert.equal(await prisma.auditoria.count({ where: { entidade_id: { in: [pessoa.id, pessoa.vinculo.id_vinculo] } } }), 0);
  });
}

test("todas as rotas novas exigem token válido e rejeitam conta global suspensa", async () => {
  const { pessoa, pendente } = await cenarioTransferencia();
  const semToken = await fetch(`${base}/vinculos/transferencia`, { method: "POST" }); assert.equal(semToken.status, 401);
  for (const [caminho, metodo, body] of [
    ["/admin/vinculos", "GET", undefined], [`/admin/vinculos/${pendente.id_vinculo}/admin`, "PATCH", { admin_condominio: true }], [`/admin/usuarios/${pessoa.id}/status`, "PATCH", { status_conta: "ATIVA" }],
  ] as const) assert.equal((await fetch(`${base}${caminho}`, { method: metodo })).status, 401);
  await prisma.usuario.update({ where: { id_usuario: pessoa.id }, data: { status_conta: "SUSPENSA" } });
  assert.equal((await solicitarMudanca(pessoa.id)).status, 403);
});

test("suspensões globais concorrentes são idempotentes e auditadas uma única vez", async () => {
  const pessoa = await criarMorador("ATIVO");
  const respostas = await Promise.all([1, 2].map(() => chamar(`/admin/usuarios/${pessoa.id}/status`, superAdmin, "PATCH", { status_conta: "SUSPENSA" })));
  assert.deepEqual(respostas.map((r) => r.status), [200, 200]);
  assert.equal(await prisma.auditoria.count({ where: { entidade_id: pessoa.id, acao: "UPDATE_USER_STATUS" } }), 1);
});

test("admin rebaixado durante a requisição não promove outro morador com contexto antigo", async () => {
  const ator = await criarMorador("ATIVO", condominioA, true); const alvo = await criarMorador("ATIVO");
  const chegou = sinal(); const liberar = sinal(); let interceptado = false;
  const restaurar = interceptarTransacao((tx) => new Proxy(tx, { get(target, propriedade, receiver) {
    if (propriedade !== "$queryRaw") return Reflect.get(target, propriedade, receiver);
    return async (strings: TemplateStringsArray, ...valores: unknown[]) => {
      if (!interceptado && strings.join("?").includes("pg_advisory_xact_lock")) {
        interceptado = true; chegou.resolver(); await liberar.promessa;
      }
      return target.$queryRaw(strings, ...valores);
    };
  } }));
  let operacao: ReturnType<typeof chamar> | undefined;
  try {
    operacao = chamar(`/admin/vinculos/${alvo.vinculo.id_vinculo}/admin`, ator.id, "PATCH", { admin_condominio: true });
    await aguardarSinal(chegou.promessa);
    assert.equal((await chamar(`/admin/vinculos/${ator.vinculo.id_vinculo}/admin`, superAdmin, "PATCH", { admin_condominio: false })).status, 200);
    liberar.resolver();
    const r = await operacao; assert.equal(r.status, 403); assert.equal(r.body.erro, "FORBIDDEN");
    assert.deepEqual(await vinculoAtual(alvo.vinculo.id_vinculo), alvo.vinculo);
  } finally { liberar.resolver(); restaurar(); if (operacao) await operacao; }
});

test("usuário atual expõe só identidade/nome/flags, antes do onboarding e em vínculos históricos", async () => {
  const antes = randomUUID();
  assert.deepEqual((await chamar("/usuarios/me", antes)).body, { dados: { id_usuario: antes, nome_completo: null, onboarding_realizado: false, super_admin: false } });
  for (const status of ["PENDENTE", "ATIVO", "SUSPENSO", "ENCERRADO"] as const) {
    const pessoa = await criarMorador(status);
    const r = await chamar("/usuarios/me", pessoa.id); assert.equal(r.status, 200);
    assert.deepEqual(r.body, { dados: { id_usuario: pessoa.id, nome_completo: "Morador da Aprovação", onboarding_realizado: true, super_admin: false } });
    assert.doesNotMatch(JSON.stringify(r.body), /cpf|data_nascimento|email|storage_path|status_conta/);
  }
  assert.deepEqual((await chamar("/usuarios/me", superAdmin)).body, { dados: { id_usuario: superAdmin, nome_completo: null, onboarding_realizado: true, super_admin: true } });
  assert.equal((await chamar(`/usuarios/me?id_usuario=${admin}`, superAdmin)).status, 400);
  assert.equal((await fetch(`${base}/usuarios/me`)).status, 401);
  const suspenso = await criarMorador();
  await prisma.usuario.update({ where: { id_usuario: suspenso.id }, data: { status_conta: "SUSPENSA" } });
  const r = await chamar("/usuarios/me", suspenso.id); assert.equal(r.status, 403); assert.equal(r.body.erro, "ACCOUNT_SUSPENDED");
});

test("JSON inválido e corpo excessivo recebem erro de cliente sem expor conteúdo", async () => {
  for (const [body, status, erro] of [["{\"conteudo\":\"DADO_PRIVADO", 400, "VALIDATION_ERROR"], [JSON.stringify({ conteudo: "x".repeat(1024 * 1024) }), 413, "PAYLOAD_TOO_LARGE"]] as const) {
    const r = await fetch(`${base}/onboarding`, { method: "POST", headers: { ...await headers(randomUUID()), "Content-Type": "application/json" }, body });
    assert.equal(r.status, status); const json = await r.json(); assert.equal(json.erro, erro);
    assert.doesNotMatch(JSON.stringify(json), /DADO_PRIVADO|stack|SyntaxError/);
  }
});

for (const operacao of ["criar", "editar", "ativar"] as const) {
  for (const primeiro of ["produto", "transferencia"] as const) {
    test(`transferência vs ${operacao} produto: ${primeiro} obtém lock primeiro e histórico fica inativo`, async () => {
      const { pessoa, produto, pendente } = await cenarioTransferencia();
      const chegou = sinal(); const liberar = sinal(); let interceptado = false;
      const restaurar = interceptarTransacao((tx) => new Proxy(tx, { get(target, propriedade, receiver) {
        if (propriedade !== "$queryRaw") return Reflect.get(target, propriedade, receiver);
        return async (strings: TemplateStringsArray, ...valores: unknown[]) => {
          const resultado = await target.$queryRaw(strings, ...valores);
          if (!interceptado && valores.includes(pessoa.vinculo.id_vinculo) && strings.join("?").includes(primeiro === "produto" ? "FOR SHARE" : "FOR UPDATE")) {
            interceptado = true; chegou.resolver(); await liberar.promessa;
          }
          return resultado;
        };
      } }));
      const alterar = () => operacao === "criar"
        ? chamar("/produtos", pessoa.id, "POST", { id_categoria: categoriaTransferencia, nome_produto: "Nova publicação", descricao: "Teste", preco: "12.00", estoque: 3 })
        : chamar(`/produtos/${produto.id_produto}${operacao === "ativar" ? "/status" : ""}`, pessoa.id, "PATCH", operacao === "ativar" ? { ativo: true } : { nome_produto: "Nome alterado" });
      const client = new Client({ connectionString: urlTeste }); await client.connect();
      let alteracao: ReturnType<typeof chamar> | undefined; let transferencia: ReturnType<typeof requisitar> | undefined;
      try {
        if (primeiro === "produto") alteracao = alterar(); else transferencia = requisitar(admin, pendente.id_vinculo);
        await aguardarSinal(chegou.promessa);
        if (primeiro === "produto") transferencia = requisitar(admin, pendente.id_vinculo); else alteracao = alterar();
        await observarBloqueio(client); liberar.resolver();
        const [r, t] = await Promise.all([alteracao!, transferencia!]);
        assert.equal(t.status, 200);
        assert.equal(r.status, primeiro === "transferencia" ? 403 : operacao === "criar" ? 201 : 200);
        if (primeiro === "transferencia") assert.equal(r.body.erro, "MEMBERSHIP_REQUIRED");
        const antigos = await prisma.produto.findMany({ where: { id_vinculo_vendedor: pessoa.vinculo.id_vinculo } });
        assert.ok(antigos.every((p) => !p.ativo));
        assert.equal(antigos.length, operacao === "criar" && primeiro === "produto" ? 2 : 1);
      } finally { liberar.resolver(); restaurar(); await client.end(); await Promise.allSettled([alteracao, transferencia].filter(Boolean)); }
    });
  }
}

test("fluxo A: onboarding → aprovação → vínculo ativo → vitrine e identidade disponíveis", async () => {
  const id = randomUUID();
  const r = await chamar("/onboarding", id, "POST", { nome_completo: "Nova moradora", cpf: String(randomInt(0, 100_000_000_000)).padStart(11, "0"), data_nascimento: "2000-01-01", id_condominio: condominioA, moradia: "101" });
  assert.equal(r.status, 201); assert.equal(r.body.dados.status_vinculo, "PENDENTE");
  assert.equal((await chamar("/produtos", id)).status, 403);
  assert.equal((await requisitar(admin, r.body.dados.id_vinculo)).status, 200);
  assert.equal((await chamar("/vinculos/me", id)).body.dados.vinculo_ativo.id_vinculo, r.body.dados.id_vinculo);
  assert.equal((await chamar("/usuarios/me", id)).body.dados.nome_completo, "Nova moradora");
  const vitrine = await chamar("/produtos", id); assert.equal(vitrine.status, 200); assert.ok(Array.isArray(vitrine.body.dados)); assert.ok(vitrine.body.paginacao);
});
