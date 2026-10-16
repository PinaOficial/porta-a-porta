import assert from "node:assert/strict";
import { after, afterEach, mock, test } from "node:test";
import type { Request, Response } from "express";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { Prisma } from "../src/generated/prisma/client.js";
import type { buscarUsuarioParaAutenticacao } from "../src/modules/usuarios/usuario.repository.js";

process.env.DATABASE_URL = "postgresql://teste:teste@localhost:5432/teste";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.SUPABASE_URL = "https://teste.supabase.co";
process.env.SUPABASE_SECRET_KEY = "chave-apenas-para-testes";

const { prisma } = await import("../src/lib/prisma.js");
const { autenticar } = await import("../src/middlewares/autenticar.js");
const { validarQuery } = await import("../src/middlewares/validar.js");
const { errorHandler } = await import("../src/middlewares/error-handler.js");
const { ErroDominio } = await import("../src/lib/erro-dominio.js");
const { listarCondominiosQuerySchema } = await import("../src/modules/condominios/condominio.schema.js");
const { listarCondominiosController } = await import("../src/modules/condominios/condominio.controller.js");
const { listarCondominiosDisponiveis } = await import("../src/modules/condominios/condominio.service.js");

const idUsuario = "10000000-0000-4000-8000-000000000001";
const usuarioNormal = { id_usuario: idUsuario, status_conta: "ATIVA", super_admin: null } as const;
const condominio = {
  id_condominio: "20000000-0000-4000-8000-000000000001",
  nome_residencial: "Residencial Exemplo", cep: "72000000", endereco: "Rua Exemplo, 10",
};
const chaves = await generateKeyPair("ES256");
const chavePublica = { ...await exportJWK(chaves.publicKey), kid: "teste", alg: "ES256", use: "sig" };
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

function respostaFake() {
  const resultado: { status: number; body?: unknown } = { status: 200 };
  const res = {
    locals: {},
    status(status: number) { resultado.status = status; return this; },
    json(body: unknown) { resultado.body = body; return this; },
  } as unknown as Response;
  return { res, resultado };
}

async function autenticarUsuario(usuario: Awaited<ReturnType<typeof buscarUsuarioParaAutenticacao>>) {
  const token = await new SignJWT({ super_admin: true, user_metadata: { super_admin: true } })
    .setProtectedHeader({ alg: "ES256", kid: "teste" })
    .setSubject(idUsuario).setIssuer("https://teste.supabase.co/auth/v1")
    .setAudience("authenticated").setExpirationTime("1m").sign(chaves.privateKey);
  mock.method(globalThis, "fetch", async (url: string | URL | globalThis.Request) => {
    assert.equal(String(url), "https://teste.supabase.co/auth/v1/.well-known/jwks.json");
    return new globalThis.Response(JSON.stringify({ keys: [chavePublica] }), { status: 200 });
  });
  const buscarUsuario = simularMetodo(prisma.usuario, "findUnique", async (_args: Prisma.usuarioFindUniqueArgs) => usuario);
  const buscarVinculo = simularMetodo(prisma.vinculo_condominio, "findFirst", async (_args: Prisma.vinculo_condominioFindFirstArgs) => null);
  const req = {
    headers: { authorization: `Bearer ${token}` }, query: {},
    body: { id_usuario: "identidade-forjada", super_admin: true, admin_condominio: true },
  } as unknown as Request;
  const { res, resultado } = respostaFake();
  const next = mock.fn();
  await autenticar(req, res, next);
  return { req, res, resultado, erro: next.mock.calls[0].arguments[0] as unknown, buscarUsuario, buscarVinculo };
}

function simularCondominios(dados = [condominio], total = dados.length) {
  const listar = simularMetodo(prisma.condominio, "findMany", async (_args: Prisma.condominioFindManyArgs) => dados);
  const contar = simularMetodo(prisma.condominio, "count", async (_args: Prisma.condominioCountArgs) => total);
  simularMetodo(prisma, "$transaction", async (consultas: Promise<unknown>[]) => Promise.all(consultas));
  return { listar, contar };
}

test("JWT válido antes do onboarding preenche sub e permite listar condomínios", async () => {
  const { req, res, resultado, erro, buscarUsuario, buscarVinculo } = await autenticarUsuario(null);
  assert.equal(erro, undefined);
  assert.deepEqual(req.auth, { id_usuario: idUsuario, super_admin: false });
  assert.deepEqual(buscarUsuario.mock.calls[0].arguments[0].where, { id_usuario: idUsuario });
  assert.equal(buscarVinculo.mock.callCount(), 0);
  simularCondominios();
  const next = mock.fn();
  validarQuery(listarCondominiosQuerySchema)(req, res, next);
  assert.equal(next.mock.callCount(), 1);
  await listarCondominiosController(req, res as Parameters<typeof listarCondominiosController>[1]);
  assert.equal(resultado.status, 200);
  assert.deepEqual(resultado.body, {
    dados: [condominio], paginacao: { pagina: 1, limite: 20, total: 1, total_paginas: 1 },
  });
});

test("usuário cadastrado sem vínculo ATIVO pode listar condomínios e metadata não concede privilégios", async () => {
  const { req, erro, buscarVinculo } = await autenticarUsuario(usuarioNormal);
  assert.equal(erro, undefined);
  assert.deepEqual(req.auth, { id_usuario: idUsuario, super_admin: false });
  assert.deepEqual(buscarVinculo.mock.calls[0].arguments[0].where, { id_condomino: idUsuario, status_vinculo: "ATIVO" });
  simularCondominios();
  assert.equal((await listarCondominiosDisponiveis(req.auth, listarCondominiosQuerySchema.parse({}))).dados.length, 1);
});

test("super admin vem do banco e não exige consulta de vínculo", async () => {
  const { req, erro, buscarVinculo } = await autenticarUsuario({ ...usuarioNormal, super_admin: { id_super_admin: idUsuario } });
  assert.equal(erro, undefined);
  assert.deepEqual(req.auth, { id_usuario: idUsuario, super_admin: true });
  assert.equal(buscarVinculo.mock.callCount(), 0);
  simularCondominios();
  assert.equal((await listarCondominiosDisponiveis(req.auth, listarCondominiosQuerySchema.parse({}))).dados.length, 1);
});

test("conta globalmente suspensa produz 403 ACCOUNT_SUSPENDED antes da consulta de vínculo", async () => {
  const { req, res, resultado, erro, buscarVinculo } = await autenticarUsuario({ ...usuarioNormal, status_conta: "SUSPENSA" });
  assert.ok(erro instanceof ErroDominio);
  errorHandler(erro, req, res, mock.fn());
  assert.equal(resultado.status, 403);
  assert.deepEqual(resultado.body, { erro: "ACCOUNT_SUSPENDED", mensagem: "Conta suspensa." });
  assert.equal(buscarVinculo.mock.callCount(), 0);
  assert.equal(req.auth, undefined);
});

test("query normaliza busca e paginação e rejeita limites, arrays, campos desconhecidos e overflow", () => {
  assert.deepEqual(listarCondominiosQuerySchema.parse({}), { pagina: 1, limite: 20 });
  assert.deepEqual(listarCondominiosQuerySchema.parse({ busca: "  Residencial  ", pagina: "2", limite: "50" }),
    { busca: "Residencial", pagina: 2, limite: 50 });
  for (const query of [
    { pagina: "0", limite: "999" }, { pagina: "1.5" }, { pagina: "1e2" }, { limite: "0" },
    { pagina: ["1", "2"] }, { busca: ["a", "b"] }, { busca: "a".repeat(161) }, { busca: "   " },
    { id_condominio: condominio.id_condominio }, { pagina: "2147483647", limite: "50" },
  ]) assert.equal(listarCondominiosQuerySchema.safeParse(query).success, false, JSON.stringify(query));
});

test("query inválida retorna 400 VALIDATION_ERROR antes do service", () => {
  const { res, resultado } = respostaFake();
  const next = mock.fn();
  validarQuery(listarCondominiosQuerySchema)({ query: { pagina: "0", limite: "999" } } as unknown as Request, res, next);
  assert.equal(resultado.status, 400);
  assert.equal((resultado.body as { erro: string }).erro, "VALIDATION_ERROR");
  assert.equal(next.mock.callCount(), 0);
});

test("repository seleciona apenas campos de onboarding, filtra ativos e busca e pagina a consulta e contagem", async () => {
  const { listar, contar } = simularCondominios([condominio], 51);
  const resultado = await listarCondominiosDisponiveis({ id_usuario: idUsuario, super_admin: false },
    listarCondominiosQuerySchema.parse({ busca: "RESIDENCIAL", pagina: "2", limite: "20" }));
  const consulta = listar.mock.calls[0].arguments[0];
  assert.deepEqual(consulta.where, { ativo: true, nome_residencial: { contains: "RESIDENCIAL", mode: "insensitive" } });
  assert.deepEqual(contar.mock.calls[0].arguments[0].where, consulta.where);
  assert.deepEqual(consulta.select, { id_condominio: true, nome_residencial: true, cep: true, endereco: true });
  assert.deepEqual(consulta.orderBy, [{ nome_residencial: "asc" }, { id_condominio: "asc" }]);
  assert.equal(consulta.skip, 20);
  assert.equal(consulta.take, 20);
  assert.deepEqual(resultado.paginacao, { pagina: 2, limite: 20, total: 51, total_paginas: 3 });
});

test("lista vazia retorna dados vazios e total_paginas zero", async () => {
  simularCondominios([]);
  assert.deepEqual(await listarCondominiosDisponiveis({ id_usuario: idUsuario, super_admin: false }, listarCondominiosQuerySchema.parse({})),
    { dados: [], paginacao: { pagina: 1, limite: 20, total: 0, total_paginas: 0 } });
});

test("service nega ausência de autenticação antes de consultar condomínios", async () => {
  const { listar } = simularCondominios();
  await assert.rejects(listarCondominiosDisponiveis(undefined, listarCondominiosQuerySchema.parse({})), (erro: unknown) =>
    erro instanceof ErroDominio && erro.codigo === "UNAUTHENTICATED" && erro.statusHttp === 401);
  assert.equal(listar.mock.callCount(), 0);
});

for (const authorization of [undefined, "Basic qualquer", "Bearer", "Bearer ", "Bearer token-malformado"]) {
  test(`Authorization ${authorization ?? "ausente"} retorna 401`, async () => {
    const { res, resultado } = respostaFake();
    const req = { headers: { authorization } } as Request;
    const next = mock.fn();
    await autenticar(req, res, next);
    errorHandler(next.mock.calls[0].arguments[0], req, res, mock.fn());
    assert.equal(resultado.status, 401);
    assert.equal((resultado.body as { erro: string }).erro, "UNAUTHENTICATED");
    assert.doesNotMatch(JSON.stringify(resultado.body), /stack|token-malformado/);
  });
}
