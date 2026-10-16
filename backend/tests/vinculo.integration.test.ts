import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, mock, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { status_vinculo_enum } from "../src/generated/prisma/client.js";
import type { SituacaoResidencial } from "../src/modules/vinculos/vinculo.model.js";

// Reutilizar o banco descartável estabelecido nos testes de onboarding, nunca o Supabase.
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
const jwk = { ...await exportJWK(chaves.publicKey), kid: "vinculos-teste", alg: "ES256", use: "sig" };
const condominioA = randomUUID();
const condominioB = randomUUID();
const servidor = createServer(app);
let base: string;

before(async () => {
  // Configurar somente o fetch de JWKS; as requisições HTTP locais continuam reais.
  const fetchOriginal = globalThis.fetch;
  mock.method(globalThis, "fetch", async (...args: Parameters<typeof fetch>) =>
    String(args[0]) === "https://teste.supabase.co/auth/v1/.well-known/jwks.json"
      ? new globalThis.Response(JSON.stringify({ keys: [jwk] }), { status: 200 })
      : fetchOriginal(...args));
  await prisma.condominio.createMany({ data: [
    { id_condominio: condominioA, nome_residencial: "Condomínio A de Teste", cep: "70000000", endereco: "Rua A" },
    { id_condominio: condominioB, nome_residencial: "Condomínio B de Teste", cep: "70000001", endereco: "Rua B" },
  ] });
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

function identidade() {
  const id = randomUUID();
  return { id, email: `${id}@exemplo.com` };
}
async function headers(auth: ReturnType<typeof identidade>) {
  const token = await new SignJWT({ email: auth.email }).setProtectedHeader({ alg: "ES256", kid: "vinculos-teste" })
    .setSubject(auth.id).setIssuer("https://teste.supabase.co/auth/v1").setAudience("authenticated")
    .setExpirationTime("2m").sign(chaves.privateKey);
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function criarMorador(statuses: status_vinculo_enum[]) {
  const auth = identidade();
  await prisma.usuario.create({ data: { id_usuario: auth.id, email: auth.email } });
  await prisma.condomino.create({ data: {
    id_condomino: auth.id, nome_completo: "Morador de Teste",
    cpf: String(randomInt(0, 100_000_000_000)).padStart(11, "0"), data_nascimento: new Date("2000-05-20T00:00:00Z"),
  } });
  for (const [indice, status] of statuses.entries()) {
    await prisma.vinculo_condominio.create({ data: {
      id_condomino: auth.id, id_condominio: status === "PENDENTE" ? condominioB : condominioA,
      moradia: `Apto ${indice + 101}`, status_vinculo: status, admin_condominio: status === "ATIVO",
      data_solicitacao: new Date(Date.UTC(2026, 9, 1 + indice)),
    } });
  }
  return auth;
}

async function consultar(auth: ReturnType<typeof identidade>, query = "") {
  const resposta = await fetch(`${base}/vinculos/me${query}`, { headers: await headers(auth) });
  assert.equal(resposta.status, 200);
  const resultado = await resposta.json() as SituacaoResidencial;
  assert.doesNotMatch(JSON.stringify(resultado), /cpf|data_nascimento|email|senha|jwt|refresh_token|SUPABASE_SECRET_KEY|DATABASE_URL|id_condomino|aprovado_por|admin_atualizado/);
  return resultado.dados;
}

test("HTTP sem token retorna 401 e health continua público", async () => {
  assert.equal((await fetch(`${base}/health`)).status, 200);
  const resposta = await fetch(`${base}/vinculos/me`);
  assert.equal(resposta.status, 401);
  assert.equal((await resposta.json()).erro, "UNAUTHENTICATED");
});

test("sem onboarding, POST onboarding e vínculo PENDENTE preservam condomínios e status residencial", async () => {
  const auth = identidade();
  assert.deepEqual(await consultar(auth), {
    onboarding_realizado: false, super_admin: false, vinculo_ativo: null, solicitacao_pendente: null, ultimo_vinculo: null,
  });
  const autorizacao = await headers(auth);
  assert.equal((await fetch(`${base}/condominios`, { headers: autorizacao })).status, 200);
  const onboarding = await fetch(`${base}/onboarding`, { method: "POST", headers: autorizacao, body: JSON.stringify({
    nome_completo: "Morador de Teste", cpf: String(randomInt(0, 100_000_000_000)).padStart(11, "0"),
    data_nascimento: "2000-05-20", id_condominio: condominioA, moradia: "Apto 302",
  }) });
  assert.equal(onboarding.status, 201);
  const situacao = await consultar(auth);
  assert.equal(situacao.onboarding_realizado, true);
  assert.equal(situacao.vinculo_ativo, null);
  assert.equal(situacao.solicitacao_pendente?.status_vinculo, "PENDENTE");
  assert.equal(situacao.ultimo_vinculo, null);
  assert.equal((await fetch(`${base}/condominios`, { headers: autorizacao })).status, 200);
});

for (const status of ["ATIVO", "REJEITADO", "SUSPENSO", "ENCERRADO"] as const) {
  test(`HTTP representa ${status}, inclusive suspensão local sem 403 global`, async () => {
    const auth = await criarMorador([status]);
    const dados = await consultar(auth);
    assert.equal(dados.onboarding_realizado, true);
    assert.equal(dados.solicitacao_pendente, null);
    const vinculo = status === "ATIVO" ? dados.vinculo_ativo : dados.ultimo_vinculo;
    assert.equal(vinculo?.status_vinculo, status);
    assert.equal(vinculo?.condominio.id_condominio, condominioA);
    assert.equal(vinculo?.data_solicitacao, "2026-10-01T00:00:00.000Z");
    if (status === "ATIVO") assert.equal(vinculo?.admin_condominio, true);
    else assert.equal(dados.vinculo_ativo, null);
  });
}

test("ATIVO + PENDENTE preserva os dois condomínios e ignora identificadores da query", async () => {
  const auth = await criarMorador(["ENCERRADO", "ATIVO", "PENDENTE"]);
  const outro = await criarMorador(["REJEITADO"]);
  const dados = await consultar(auth, `?id_usuario=${outro.id}&id_condomino=${outro.id}&id_condominio=${condominioB}&id_vinculo=${randomUUID()}`);
  assert.equal(dados.vinculo_ativo?.status_vinculo, "ATIVO");
  assert.equal(dados.vinculo_ativo?.condominio.id_condominio, condominioA);
  assert.equal(dados.solicitacao_pendente?.status_vinculo, "PENDENTE");
  assert.equal(dados.solicitacao_pendente?.condominio.id_condominio, condominioB);
  assert.equal(dados.ultimo_vinculo, null);
});

test("histórico escolhe data_solicitacao mais recente, com desempate por UUID", async () => {
  const auth = await criarMorador(["REJEITADO", "ENCERRADO", "SUSPENSO"]);
  assert.equal((await consultar(auth)).ultimo_vinculo?.status_vinculo, "SUSPENSO");
  await prisma.vinculo_condominio.updateMany({ where: { id_condomino: auth.id }, data: { data_solicitacao: new Date("2026-10-02T00:00:00Z") } });
  const esperado = await prisma.vinculo_condominio.findFirstOrThrow({ where: { id_condomino: auth.id }, orderBy: { id_vinculo: "desc" } });
  assert.equal((await consultar(auth)).ultimo_vinculo?.id_vinculo, esperado.id_vinculo);
});

test("super admin sem perfil residencial retorna estado administrativo explícito", async () => {
  const auth = identidade();
  await prisma.usuario.create({ data: { id_usuario: auth.id, email: auth.email } });
  await prisma.super_admin.create({ data: { id_super_admin: auth.id } });
  assert.deepEqual(await consultar(auth), {
    onboarding_realizado: true, super_admin: true, vinculo_ativo: null, solicitacao_pendente: null, ultimo_vinculo: null,
  });
});

test("conta global suspensa mantém 403 ACCOUNT_SUSPENDED", async () => {
  const auth = await criarMorador(["SUSPENSO"]);
  await prisma.usuario.update({ where: { id_usuario: auth.id }, data: { status_conta: "SUSPENSA" } });
  const resposta = await fetch(`${base}/vinculos/me`, { headers: await headers(auth) });
  assert.equal(resposta.status, 403);
  assert.equal((await resposta.json()).erro, "ACCOUNT_SUSPENDED");
});

test("usuario comum sem condomino retorna 500 e não repara o perfil", async () => {
  const auth = identidade();
  await prisma.usuario.create({ data: { id_usuario: auth.id, email: auth.email } });
  const resposta = await fetch(`${base}/vinculos/me`, { headers: await headers(auth) });
  assert.equal(resposta.status, 500);
  assert.equal((await resposta.json()).erro, "INTERNAL_ERROR");
  assert.equal(await prisma.condomino.count({ where: { id_condomino: auth.id } }), 0);
});
