import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";
import type { Request, Response } from "express";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { Prisma } from "../src/generated/prisma/client.js";
import type { ResultadoOnboarding } from "../src/modules/usuarios/usuario.model.js";
import type { ContextoAutenticado } from "../src/types/auth.js";

// Nunca usar DATABASE_URL do projeto: esta suíte grava apenas no banco descartável local.
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
const { realizarOnboarding } = await import("../src/modules/usuarios/usuario.service.js");
const { onboardingBodySchema } = await import("../src/modules/usuarios/usuario.schema.js");
const { realizarOnboardingController } = await import("../src/modules/usuarios/usuario.controller.js");
const { autenticar } = await import("../src/middlewares/autenticar.js");
const { listarCondominiosDisponiveis } = await import("../src/modules/condominios/condominio.service.js");
const { ErroDominio } = await import("../src/lib/erro-dominio.js");
const ativo = randomUUID();
const inativo = randomUUID();

before(async () => {
  await prisma.condominio.createMany({ data: [
    { id_condominio: ativo, nome_residencial: "Residencial Teste", cep: "72000000", endereco: "Rua Teste", ativo: true },
    { id_condominio: inativo, nome_residencial: "Residencial Inativo", cep: "72000001", endereco: "Rua Teste", ativo: false },
  ] });
});
after(async () => { mock.restoreAll(); await prisma.$disconnect(); });

function identidade(): ContextoAutenticado {
  const id = randomUUID();
  return { id_usuario: id, email: `${id}@exemplo.com`, super_admin: false };
}

function payload(cpf = String(randomInt(0, 100_000_000_000)).padStart(11, "0"), idCondominio = ativo) {
  return onboardingBodySchema.parse({
    nome_completo: "  Maria da Silva  ", cpf, data_nascimento: "2000-05-20",
    id_condominio: idCondominio, moradia: "  Bloco B - Apto 302  ",
  });
}

async function confirmarSemRegistros(idUsuario: string) {
  assert.equal(await prisma.usuario.count({ where: { id_usuario: idUsuario } }), 0);
  assert.equal(await prisma.condomino.count({ where: { id_condomino: idUsuario } }), 0);
  assert.equal(await prisma.vinculo_condominio.count({ where: { id_condomino: idUsuario } }), 0);
}

const erroEsperado = (codigo: string, status: number) => (erro: unknown) =>
  erro instanceof ErroDominio && erro.codigo === codigo && erro.statusHttp === status;

test("controller retorna 201 e banco guarda identidade, e-mail normalizado, CPF e vínculo pendente juntos", async () => {
  const auth = { ...identidade(), email: `  MARIA_${randomUUID()}@EXEMPLO.COM  ` };
  const cpf = String(randomInt(0, 100_000_000_000)).padStart(11, "0");
  const dados = payload(cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4"));
  let status = 0;
  let resposta: ResultadoOnboarding | undefined;
  const res = {
    status(valor: number) { status = valor; return this; },
    json(valor: ResultadoOnboarding) { resposta = valor; return this; },
  } as unknown as Response<ResultadoOnboarding>;
  await realizarOnboardingController({ auth, body: dados } as unknown as Parameters<typeof realizarOnboardingController>[0], res);
  assert.equal(status, 201);
  assert.ok(resposta);
  assert.deepEqual(resposta.dados, {
    id_usuario: auth.id_usuario, nome_completo: "Maria da Silva", id_vinculo: resposta.dados.id_vinculo,
    id_condominio: ativo, moradia: "Bloco B - Apto 302", status_vinculo: "PENDENTE", admin_condominio: false,
  });
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id_usuario: auth.id_usuario } });
  const condomino = await prisma.condomino.findUniqueOrThrow({ where: { id_condomino: auth.id_usuario } });
  const vinculo = await prisma.vinculo_condominio.findFirstOrThrow({ where: { id_condomino: auth.id_usuario } });
  assert.equal(usuario.email, auth.email.trim().toLowerCase());
  assert.equal(usuario.status_conta, "ATIVA");
  assert.equal(condomino.id_condomino, usuario.id_usuario);
  assert.equal(condomino.cpf, cpf);
  assert.equal(condomino.data_nascimento.toISOString(), "2000-05-20T00:00:00.000Z");
  assert.equal(vinculo.status_vinculo, "PENDENTE");
  assert.equal(vinculo.admin_condominio, false);
  for (const campo of ["data_aprovacao", "data_inicio", "data_fim", "aprovado_por", "admin_atualizado_por", "admin_atualizado_em"] as const) {
    assert.equal(vinculo[campo], null);
  }
  assert.doesNotMatch(JSON.stringify(resposta), /cpf|data_nascimento|email|token|senha|secret/);
  await assert.rejects(realizarOnboarding(auth, dados), erroEsperado("ONBOARDING_ALREADY_COMPLETED", 409));
  assert.equal(await prisma.vinculo_condominio.count({ where: { id_condomino: auth.id_usuario } }), 1);

  const segundo = identidade();
  await assert.rejects(realizarOnboarding(segundo, dados), erroEsperado("CPF_ALREADY_REGISTERED", 409));
  await confirmarSemRegistros(segundo.id_usuario);
});

test("condomínio inexistente e inativo retornam 404 sem gravações", async () => {
  for (const idCondominio of [randomUUID(), inativo]) {
    const auth = identidade();
    await assert.rejects(realizarOnboarding(auth, payload(undefined, idCondominio)), erroEsperado("CONDOMINIO_NOT_FOUND", 404));
    await confirmarSemRegistros(auth.id_usuario);
  }
});

test("e-mail duplicado ignora caixa e trata underscore como caractere literal", async () => {
  const auth = { ...identidade(), email: `maria_${randomUUID()}@exemplo.com` };
  await realizarOnboarding(auth, payload());
  const duplicado = { ...identidade(), email: auth.email.toUpperCase() };
  await assert.rejects(realizarOnboarding(duplicado, payload()), erroEsperado("EMAIL_ALREADY_REGISTERED", 409));
  await confirmarSemRegistros(duplicado.id_usuario);
  const outro = { ...identidade(), email: auth.email.replace("maria_", "mariaX") };
  await realizarOnboarding(outro, payload());
});

test("falha inesperada na terceira inserção causa rollback de usuario e condomino", async () => {
  const auth = identidade();
  const original = prisma.$transaction;
  const falha = new Error("falha controlada");
  Reflect.set(prisma, "$transaction", async (callback: (tx: Prisma.TransactionClient) => Promise<ResultadoOnboarding>) =>
    original.call(prisma, async (tx) => {
      const criarOriginal = tx.vinculo_condominio.create;
      Reflect.set(tx.vinculo_condominio, "create", () => { throw falha; });
      try { return await callback(tx); }
      finally { Reflect.set(tx.vinculo_condominio, "create", criarOriginal); }
    }));
  try {
    await assert.rejects(realizarOnboarding(auth, payload()), (erro: unknown) => erro === falha);
  } finally {
    Reflect.set(prisma, "$transaction", original);
  }
  await confirmarSemRegistros(auth.id_usuario);
});

test("constraint desconhecida mantém erro interno e faz rollback", async () => {
  const auth = identidade();
  const moradiaInvalida = payload();
  // Ignorar somente neste teste o schema para provocar o limite VARCHAR real do PostgreSQL.
  moradiaInvalida.moradia = "a".repeat(81);
  await assert.rejects(realizarOnboarding(auth, moradiaInvalida), (erro: unknown) => !(erro instanceof ErroDominio));
  await confirmarSemRegistros(auth.id_usuario);
});

async function concorrer(operacoes: (() => Promise<ResultadoOnboarding>)[]) {
  const original = prisma.$transaction;
  let chegaram = 0;
  let liberar: () => void = () => {};
  const barreira = new Promise<void>((resolve) => { liberar = resolve; });
  // Ambas as requisições passam pelas verificações amigáveis antes de disputar as constraints reais.
  Reflect.set(prisma, "$transaction", async (callback: (tx: Prisma.TransactionClient) => Promise<ResultadoOnboarding>) => {
    if (++chegaram === operacoes.length) liberar();
    await barreira;
    return original.call(prisma, callback);
  });
  try {
    return await Promise.allSettled(operacoes.map((operacao) => operacao()));
  } finally {
    Reflect.set(prisma, "$transaction", original);
  }
}

for (const conflito of ["cpf", "email", "usuario"] as const) {
  test(`concorrência real em ${conflito} retorna 409 específico e reverte a requisição perdedora`, async () => {
    const primeira = identidade();
    const segunda = conflito === "usuario" ? primeira : identidade();
    if (conflito === "email") segunda.email = primeira.email;
    const dadosA = payload();
    const dadosB = conflito === "cpf" ? dadosA : payload();
    const resultados = await concorrer([
      () => realizarOnboarding(primeira, dadosA), () => realizarOnboarding(segunda, dadosB),
    ]);
    const rejeitados = resultados.filter((resultado) => resultado.status === "rejected");
    assert.equal(resultados.filter((resultado) => resultado.status === "fulfilled").length, 1);
    assert.equal(rejeitados.length, 1);
    const codigos = { cpf: "CPF_ALREADY_REGISTERED", email: "EMAIL_ALREADY_REGISTERED", usuario: "ONBOARDING_ALREADY_COMPLETED" };
    assert.ok(erroEsperado(codigos[conflito], 409)(rejeitados[0].reason));
    if (conflito !== "usuario") await confirmarSemRegistros(resultados[0].status === "rejected" ? primeira.id_usuario : segunda.id_usuario);
    else assert.equal(await prisma.vinculo_condominio.count({ where: { id_condomino: primeira.id_usuario } }), 1);
  });
}

test("JWT e GET condominios funcionam antes e depois do onboarding; PENDENTE continua sem vínculo ativo", async () => {
  const identidadeNova = identidade();
  const chaves = await generateKeyPair("ES256");
  const jwk = { ...await exportJWK(chaves.publicKey), kid: "integracao", alg: "ES256", use: "sig" };
  const fetchOriginal = globalThis.fetch;
  mock.method(globalThis, "fetch", async (...args: Parameters<typeof fetch>) =>
    String(args[0]) === "https://teste.supabase.co/auth/v1/.well-known/jwks.json"
      ? new globalThis.Response(JSON.stringify({ keys: [jwk] }), { status: 200 })
      : fetchOriginal(...args));
  const token = await new SignJWT({ email: identidadeNova.email }).setProtectedHeader({ alg: "ES256", kid: "integracao" })
    .setSubject(identidadeNova.id_usuario).setIssuer("https://teste.supabase.co/auth/v1").setAudience("authenticated")
    .setExpirationTime("2m").sign(chaves.privateKey);
  async function contexto() {
    const req = { headers: { authorization: `Bearer ${token}` } } as Request;
    const next = mock.fn();
    await autenticar(req, {} as Response, next);
    assert.equal(next.mock.calls[0].arguments[0], undefined);
    assert.ok(req.auth);
    assert.equal(req.auth.vinculo_ativo, undefined);
    return req.auth;
  }
  const antes = await contexto();
  assert.ok((await listarCondominiosDisponiveis(antes, { pagina: 1, limite: 20 })).dados.some((item) => item.id_condominio === ativo));
  const { app } = await import("../src/app.js");
  const servidor = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { servidor.once("listening", resolve); servidor.once("error", reject); });
  try {
    const endereco = servidor.address();
    assert.ok(endereco && typeof endereco === "object");
    const base = `http://127.0.0.1:${endereco.port}/api`;
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/onboarding`, { method: "POST" })).status, 401);
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    assert.equal((await fetch(`${base}/condominios`, { headers })).status, 200);
    const body = JSON.stringify({ ...payload(), data_nascimento: "2000-05-20" });
    const sucesso = await fetch(`${base}/onboarding`, { method: "POST", headers, body });
    assert.equal(sucesso.status, 201);
    assert.equal((await sucesso.json()).dados.status_vinculo, "PENDENTE");
    assert.equal((await fetch(`${base}/condominios`, { headers })).status, 200);
    const repetido = await fetch(`${base}/onboarding`, { method: "POST", headers, body });
    assert.equal(repetido.status, 409);
    assert.equal((await repetido.json()).erro, "ONBOARDING_ALREADY_COMPLETED");
    const malicioso = await fetch(`${base}/onboarding`, {
      method: "POST", headers, body: JSON.stringify({ ...JSON.parse(body), admin_condominio: true, status_vinculo: "ATIVO" }),
    });
    assert.equal(malicioso.status, 400);
    assert.equal((await malicioso.json()).erro, "VALIDATION_ERROR");
  } finally {
    await new Promise<void>((resolve, reject) => servidor.close((erro) => erro ? reject(erro) : resolve()));
  }
  const depois = await contexto();
  assert.ok((await listarCondominiosDisponiveis(depois, { pagina: 1, limite: 20 })).dados.some((item) => item.id_condominio === ativo));
});
