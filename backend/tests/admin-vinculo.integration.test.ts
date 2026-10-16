import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, mock, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { status_vinculo_enum } from "../src/generated/prisma/client.js";
import type { ListaVinculosPendentes } from "../src/modules/vinculos/vinculo.model.js";

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
const jwk = { ...await exportJWK(chaves.publicKey), kid: "admin-vinculos-teste", alg: "ES256", use: "sig" };
const condominioA = randomUUID();
const condominioB = randomUUID();
const marcador = randomUUID();
const servidor = createServer(app);
let base: string;
let admin: string;
let superAdmin: string;
let maria: string;
let joao: string;
let carlos: string;
let estadoInicial: unknown;
let totalAuditorias: number;
const moradoresSemAutoridade: string[] = [];

async function criarMorador(nome: string, idCondominio: string, status: status_vinculo_enum, administrador = false, moradia = "Apto 101") {
  const id = randomUUID();
  await prisma.usuario.create({ data: { id_usuario: id, email: `${id}@exemplo.com` } });
  await prisma.condomino.create({ data: {
    id_condomino: id, nome_completo: `${marcador} ${nome}`,
    cpf: String(randomInt(0, 100_000_000_000)).padStart(11, "0"), data_nascimento: new Date("2000-05-20T00:00:00Z"),
  } });
  const vinculo = await prisma.vinculo_condominio.create({ data: {
    id_condomino: id, id_condominio: idCondominio, status_vinculo: status,
    admin_condominio: administrador, moradia, data_solicitacao: new Date("2026-10-15T12:00:00Z"),
  } });
  return { id, id_vinculo: vinculo.id_vinculo };
}

async function cabecalhos(id: string, opcoes: { expirado?: boolean; assinaturaInvalida?: boolean; forjarAdmin?: boolean } = {}) {
  const token = await new SignJWT(opcoes.forjarAdmin ? { super_admin: true, admin_condominio: true, user_metadata: { super_admin: true } } : {})
    .setProtectedHeader({ alg: "ES256", kid: jwk.kid }).setSubject(id)
    .setIssuer("https://teste.supabase.co/auth/v1").setAudience("authenticated")
    .setExpirationTime(opcoes.expirado ? 1 : "5m")
    .sign(opcoes.assinaturaInvalida ? (await generateKeyPair("ES256")).privateKey : chaves.privateKey);
  return { Authorization: `Bearer ${token}` };
}

async function consultar(id: string, query = "") {
  const resposta = await fetch(`${base}/admin/vinculos/pendentes${query}`, { headers: await cabecalhos(id) });
  assert.equal(resposta.status, 200);
  const resultado = await resposta.json() as ListaVinculosPendentes;
  assert.doesNotMatch(JSON.stringify(resultado), /cpf|data_nascimento|email|senha|JWT|refresh_token|status_conta|aprovado_por|admin_atualizado/);
  for (const item of resultado.dados) {
    assert.deepEqual(Object.keys(item).sort(), ["id_vinculo", "status_vinculo", "moradia", "data_solicitacao", "morador", "condominio"].sort());
    assert.equal(item.status_vinculo, "PENDENTE");
    assert.ok(["2026-10-14T12:00:00.000Z", "2026-10-15T12:00:00.000Z"].includes(item.data_solicitacao));
  }
  return resultado;
}

before(async () => {
  const fetchOriginal = globalThis.fetch;
  mock.method(globalThis, "fetch", async (...args: Parameters<typeof fetch>) =>
    String(args[0]) === "https://teste.supabase.co/auth/v1/.well-known/jwks.json"
      ? new globalThis.Response(JSON.stringify({ keys: [jwk] }), { status: 200 })
      : fetchOriginal(...args));
  await prisma.condominio.createMany({ data: [
    { id_condominio: condominioA, nome_residencial: "Condomínio A", cep: "70000000", endereco: "Rua A" },
    { id_condominio: condominioB, nome_residencial: "Condomínio B", cep: "70000001", endereco: "Rua B" },
  ] });
  admin = (await criarMorador("Admin", condominioA, "ATIVO", true)).id;
  maria = (await criarMorador("Maria", condominioA, "PENDENTE", false, "Bloco B - Apto 302")).id_vinculo;
  joao = (await criarMorador("João", condominioA, "PENDENTE")).id_vinculo;
  carlos = (await criarMorador("Carlos", condominioB, "PENDENTE")).id_vinculo;
  await prisma.vinculo_condominio.update({ where: { id_vinculo: carlos }, data: { data_solicitacao: new Date("2026-10-14T12:00:00Z") } });
  // Mesmo admin_condominio=true no histórico/PENDENTE não concede autoridade.
  for (const status of ["ATIVO", "PENDENTE", "REJEITADO", "SUSPENSO", "ENCERRADO"] as const) {
    moradoresSemAutoridade.push((await criarMorador(`Sem autoridade ${status}`, condominioA, status, status !== "ATIVO")).id);
  }
  superAdmin = randomUUID();
  await prisma.usuario.create({ data: { id_usuario: superAdmin, email: `${superAdmin}@exemplo.com` } });
  await prisma.super_admin.create({ data: { id_super_admin: superAdmin } });
  estadoInicial = await prisma.vinculo_condominio.findMany({ where: { id_condominio: { in: [condominioA, condominioB] } }, orderBy: { id_vinculo: "asc" } });
  totalAuditorias = await prisma.auditoria.count();
  servidor.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { servidor.once("listening", resolve); servidor.once("error", reject); });
  const endereco = servidor.address();
  assert.ok(endereco && typeof endereco === "object");
  base = `http://127.0.0.1:${endereco.port}/api`;
});

after(async () => {
  try {
    assert.deepEqual(await prisma.vinculo_condominio.findMany({ where: { id_condominio: { in: [condominioA, condominioB] } }, orderBy: { id_vinculo: "asc" } }), estadoInicial);
    assert.equal(await prisma.auditoria.count(), totalAuditorias);
  } finally {
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
    mock.restoreAll();
    await prisma.$disconnect();
  }
});

test("HTTP sem token ou com token inválido, expirado ou assinatura inválida retorna 401", async () => {
  const casos = [
    {}, { Authorization: "Bearer token-invalido" },
    await cabecalhos(admin, { expirado: true }), await cabecalhos(admin, { assinaturaInvalida: true }),
  ];
  for (const headers of casos) {
    const resposta = await fetch(`${base}/admin/vinculos/pendentes`, { headers });
    assert.equal(resposta.status, 401);
    assert.equal((await resposta.json()).erro, "UNAUTHENTICATED");
  }
});

test("morador comum, admin histórico/PENDENTE e identidade sem onboarding recebem 403 mesmo forjando claims", async () => {
  for (const id of [...moradoresSemAutoridade, randomUUID()]) {
    const resposta = await fetch(`${base}/admin/vinculos/pendentes`, { headers: await cabecalhos(id, { forjarAdmin: true }) });
    assert.equal(resposta.status, 403);
    assert.equal((await resposta.json()).erro, "FORBIDDEN");
  }
});

test("admin local recebe exclusivamente PENDENTES de A e aceita filtro igual", async () => {
  const resultado = await consultar(admin);
  assert.ok(resultado.dados.some((item) => item.id_vinculo === maria));
  assert.ok(resultado.dados.some((item) => item.id_vinculo === joao));
  assert.ok(resultado.dados.every((item) => item.condominio.id_condominio === condominioA));
  assert.ok(!resultado.dados.some((item) => item.id_vinculo === carlos));
  assert.deepEqual(await consultar(admin, `?id_condominio=${condominioA.toUpperCase()}`), resultado);
});

test("admin local não amplia escopo usando query de outro condomínio", async () => {
  const resposta = await fetch(`${base}/admin/vinculos/pendentes?id_condominio=${condominioB}`, { headers: await cabecalhos(admin) });
  assert.equal(resposta.status, 403);
  assert.equal((await resposta.json()).erro, "FORBIDDEN_CROSS_TENANT");
});

test("super admin sem vínculo lista globalmente e pode filtrar por condomínio", async () => {
  const global = await consultar(superAdmin, `?busca=${marcador}`);
  assert.ok(global.dados.some((item) => item.id_vinculo === maria));
  assert.ok(global.dados.some((item) => item.id_vinculo === carlos));
  const filtrado = await consultar(superAdmin, `?id_condominio=${condominioB}`);
  assert.deepEqual(filtrado.dados.map((item) => item.id_vinculo), [carlos]);
  assert.deepEqual(filtrado.paginacao, { pagina: 1, limite: 20, total: 1, total_paginas: 1 });
});

test("fila vazia e condomínio inexistente retornam 200 e total_paginas zero", async () => {
  for (const query of [`?busca=ausente-${randomUUID()}`, `?id_condominio=${randomUUID()}`]) {
    assert.deepEqual(await consultar(superAdmin, query), { dados: [], paginacao: { pagina: 1, limite: 20, total: 0, total_paginas: 0 } });
  }
});

test("paginação usa contagem filtrada e ordenação por data e UUID, inclusive página fora do total", async () => {
  const todos = await consultar(superAdmin, `?busca=${marcador}`);
  const ids = todos.dados.map((item) => item.id_vinculo);
  assert.equal(ids[0], carlos);
  assert.deepEqual(ids.slice(1), [...ids.slice(1)].sort());
  const segunda = await consultar(superAdmin, `?busca=${marcador}&pagina=2&limite=2`);
  assert.deepEqual(segunda.dados, todos.dados.slice(2, 4));
  assert.deepEqual(segunda.paginacao, { pagina: 2, limite: 2, total: ids.length, total_paginas: Math.ceil(ids.length / 2) });
  const distante = await consultar(superAdmin, `?busca=${marcador}&pagina=100&limite=2`);
  assert.deepEqual(distante.dados, []);
  assert.equal(distante.paginacao.total, ids.length);
});

test("query inválida retorna 400 com VALIDATION_ERROR", async () => {
  for (const query of ["limite=101", "pagina=0", "pagina=abc", "limite=-5", "id_condominio=qualquer-coisa", "limite=1&limite=2", "super_admin=true"]) {
    const resposta = await fetch(`${base}/admin/vinculos/pendentes?${query}`, { headers: await cabecalhos(admin) });
    assert.equal(resposta.status, 400);
    assert.equal((await resposta.json()).erro, "VALIDATION_ERROR");
  }
});

test("busca por nome e moradia respeita caixa, trim e tenant; busca vazia não filtra", async () => {
  assert.deepEqual((await consultar(admin, "?busca=%20mARIA%20")).dados.map((item) => item.id_vinculo), [maria]);
  assert.deepEqual((await consultar(admin, "?busca=apto%20302")).dados.map((item) => item.id_vinculo), [maria]);
  assert.deepEqual((await consultar(admin, "?busca=Carlos")).dados, []);
  assert.deepEqual(await consultar(admin, "?busca=%20%20"), await consultar(admin));
});

test("conta global suspensa mantém 403 inclusive para admin e super admin", async () => {
  for (const id of [admin, superAdmin]) {
    await prisma.usuario.update({ where: { id_usuario: id }, data: { status_conta: "SUSPENSA" } });
    try {
      const resposta = await fetch(`${base}/admin/vinculos/pendentes`, { headers: await cabecalhos(id) });
      assert.equal(resposta.status, 403);
      assert.equal((await resposta.json()).erro, "ACCOUNT_SUSPENDED");
    } finally {
      await prisma.usuario.update({ where: { id_usuario: id }, data: { status_conta: "ATIVA" } });
    }
  }
});

test("health, condomínios e vínculo atual continuam acessíveis", async () => {
  assert.equal((await fetch(`${base}/health`)).status, 200);
  for (const rota of ["condominios", "vinculos/me"]) {
    assert.equal((await fetch(`${base}/${rota}`, { headers: await cabecalhos(admin) })).status, 200);
  }
});
