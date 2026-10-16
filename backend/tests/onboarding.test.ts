import assert from "node:assert/strict";
import { after, afterEach, mock, test } from "node:test";
import type { Request, Response } from "express";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

process.env.DATABASE_URL = "postgresql://teste:teste@localhost:5432/teste";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.SUPABASE_URL = "https://teste.supabase.co";
process.env.SUPABASE_SECRET_KEY = "chave-apenas-para-testes";

const { prisma } = await import("../src/lib/prisma.js");
const { autenticar } = await import("../src/middlewares/autenticar.js");
const { validarBody } = await import("../src/middlewares/validar.js");
const { errorHandler } = await import("../src/middlewares/error-handler.js");
const { ErroDominio } = await import("../src/lib/erro-dominio.js");
const { onboardingBodySchema } = await import("../src/modules/usuarios/usuario.schema.js");
const { realizarOnboarding } = await import("../src/modules/usuarios/usuario.service.js");

const idUsuario = "10000000-0000-4000-8000-000000000001";
const payload = {
  nome_completo: "  Maria da Silva  ", cpf: "123.456.789-00", data_nascimento: "2000-05-20",
  id_condominio: "20000000-0000-4000-8000-000000000001", moradia: "  Bloco B - Apto 302  ",
};
const chaves = await generateKeyPair("ES256");
const chavePublica = { ...await exportJWK(chaves.publicKey), kid: "teste", alg: "ES256", use: "sig" };
const restauradores: (() => void)[] = [];

function substituirMetodo(objeto: object, nome: string, implementacao: () => Promise<null>) {
  const original: unknown = Reflect.get(objeto, nome);
  const metodo = mock.fn(implementacao);
  Reflect.set(objeto, nome, metodo);
  restauradores.push(() => { Reflect.set(objeto, nome, original); });
  return metodo;
}

afterEach(() => {
  for (const restaurar of restauradores.splice(0).reverse()) restaurar();
  mock.restoreAll();
});
after(async () => { await prisma.$disconnect(); });

function respostaFake() {
  const resultado: { status: number; body?: unknown } = { status: 200 };
  const res = {
    status(status: number) { resultado.status = status; return this; },
    json(body: unknown) { resultado.body = body; return this; },
  } as unknown as Response;
  return { res, resultado };
}

test("schema normaliza CPF e textos e preserva a data civil em UTC", () => {
  const dados = onboardingBodySchema.parse(payload);
  assert.equal(dados.cpf, "12345678900");
  assert.equal(dados.nome_completo, "Maria da Silva");
  assert.equal(dados.moradia, "Bloco B - Apto 302");
  assert.equal(dados.data_nascimento.toISOString(), "2000-05-20T00:00:00.000Z");
  assert.equal(onboardingBodySchema.parse({ ...payload, cpf: "12345678900" }).cpf, dados.cpf);
  assert.equal(onboardingBodySchema.safeParse({ ...payload, data_nascimento: "2024-02-29" }).success, true);
});

test("schema rejeita payload inválido e datas impossíveis sem impor idade ou dígitos verificadores", () => {
  for (const alteracao of [
    { nome_completo: "   " }, { nome_completo: "a".repeat(161) }, { cpf: "123" }, { cpf: 12345678900 },
    { data_nascimento: "2023-02-29" }, { data_nascimento: "2000-02-30" }, { data_nascimento: "2000-05-20T00:00:00Z" },
    { id_condominio: "nao-e-uuid" }, { moradia: "" }, { moradia: "a".repeat(81) },
  ]) assert.equal(onboardingBodySchema.safeParse({ ...payload, ...alteracao }).success, false);
  assert.equal(onboardingBodySchema.safeParse({ ...payload, cpf: "11111111111", data_nascimento: "2026-01-01" }).success, true);
});

test("schema rejeita campos de identidade, privilégios e datas definidos pelo cliente", () => {
  for (const campo of [
    "id_usuario", "email", "status_conta", "status_vinculo", "admin_condominio", "super_admin",
    "data_solicitacao", "data_aprovacao", "data_inicio", "data_fim", "aprovado_por", "admin_atualizado_por", "admin_atualizado_em",
  ]) assert.equal(onboardingBodySchema.safeParse({ ...payload, [campo]: "valor-forjado" }).success, false, campo);
});

test("validação HTTP retorna 400 sem chamar controller para payload malicioso", () => {
  const { res, resultado } = respostaFake();
  const next = mock.fn();
  validarBody(onboardingBodySchema)({ body: { ...payload, admin_condominio: true, status_vinculo: "ATIVO" } } as Request, res, next);
  assert.equal(resultado.status, 400);
  assert.equal((resultado.body as { erro: string }).erro, "VALIDATION_ERROR");
  assert.equal(next.mock.callCount(), 0);
});

for (const email of ["  MARIA@EXEMPLO.COM  ", undefined, "email-invalido"]) {
  test(`autenticação usa somente claim email validada (${email === undefined ? "ausente" : "presente"})`, async () => {
    const token = await new SignJWT(email === undefined ? {} : { email })
      .setProtectedHeader({ alg: "ES256", kid: "teste" }).setSubject(idUsuario)
      .setIssuer("https://teste.supabase.co/auth/v1").setAudience("authenticated")
      .setExpirationTime("1m").sign(chaves.privateKey);
    mock.method(globalThis, "fetch", async () => new globalThis.Response(JSON.stringify({ keys: [chavePublica] }), { status: 200 }));
    substituirMetodo(prisma.usuario, "findUnique", async () => null);
    const req = { headers: { authorization: `Bearer ${token}` }, body: { email: "forjado@exemplo.com" } } as Request;
    const next = mock.fn();
    await autenticar(req, respostaFake().res, next);
    assert.equal(next.mock.calls[0].arguments[0], undefined);
    assert.equal(req.auth?.id_usuario, idUsuario);
    assert.equal(req.auth?.email, email === "  MARIA@EXEMPLO.COM  " ? "maria@exemplo.com" : undefined);
  });
}

test("service nega sem autenticação, super admin e identidade sem e-mail utilizável", async () => {
  const consulta = substituirMetodo(prisma.usuario, "findUnique", async () => null);
  for (const [auth, codigo, status] of [
    [undefined, "UNAUTHENTICATED", 401],
    [{ id_usuario: idUsuario, super_admin: true }, "SUPER_ADMIN_CANNOT_ONBOARD", 403],
    [{ id_usuario: idUsuario, super_admin: false }, "AUTH_EMAIL_REQUIRED", 403],
  ] as const) {
    await assert.rejects(realizarOnboarding(auth, onboardingBodySchema.parse(payload)), (erro: unknown) =>
      erro instanceof ErroDominio && erro.codigo === codigo && erro.statusHttp === status);
  }
  assert.equal(consulta.mock.callCount(), 1);
});

test("erros inesperados não expõem dados pessoais em logs ou JSON", () => {
  const log = mock.method(console, "error", () => {});
  const { res, resultado } = respostaFake();
  const erro = new Error("cpf=12345678900 data_nascimento=2000-05-20 JWT-completo DATABASE_URL segredo");
  errorHandler(erro, {} as Request, res, mock.fn());
  assert.equal(resultado.status, 500);
  assert.deepEqual(log.mock.calls[0].arguments, [{ evento: "INTERNAL_ERROR", tipo: "Error" }]);
  assert.doesNotMatch(JSON.stringify(resultado.body), /12345678900|2000-05-20|JWT-completo|DATABASE_URL|segredo|stack/);
});
