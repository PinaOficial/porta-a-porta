import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, mock, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { Prisma } from "../src/generated/prisma/client.js";

const conexao = new URL(process.env.ONBOARDING_TEST_DATABASE_URL || "http://ausente.invalid");
if (conexao.protocol !== "postgresql:" || !["127.0.0.1", "localhost"].includes(conexao.hostname) || conexao.pathname !== "/porta_onboarding_teste") {
  throw new Error("Integração exige PostgreSQL local descartável porta_onboarding_teste.");
}
process.env.DATABASE_URL = conexao.toString();
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.SUPABASE_URL = "https://teste.supabase.co";
process.env.SUPABASE_SECRET_KEY = "chave-apenas-para-testes";
const { prisma } = await import("../src/lib/prisma.js");
const { app } = await import("../src/app.js");
const chaves = await generateKeyPair("ES256");
const jwk = { ...await exportJWK(chaves.publicKey), kid: "criar-condominio", alg: "ES256", use: "sig" };
const tag = randomUUID(), superAdmin = randomUUID();
const body = { nome_residencial: `Novo ${tag}`, cep: "72000000", endereco: "Rua Fictícia, 10" };
const servidor = createServer(app);
let base: string, morador: string, adminA: string, adminB: string, historico: unknown;
const condominiosAntigos = [randomUUID(), randomUUID()];
async function headers(id: string) {
  const token = await new SignJWT({ email: `${id}@exemplo.test`, super_admin: true, role: "super_admin", user_metadata: { super_admin: true, admin_condominio: true } })
    .setProtectedHeader({ alg: "ES256", kid: jwk.kid }).setSubject(id).setIssuer("https://teste.supabase.co/auth/v1")
    .setAudience("authenticated").setExpirationTime("5m").sign(chaves.privateKey);
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}
async function chamar(path: string, id?: string, method = "POST", dados: unknown = body) {
  return fetch(`${base}${path}`, { method, headers: id ? await headers(id) : { "Content-Type": "application/json" }, ...(method !== "GET" && dados !== undefined ? { body: JSON.stringify(dados) } : {}) });
}
async function criarMorador(condominio: string, admin = false) {
  const id = randomUUID();
  await prisma.usuario.create({ data: { id_usuario: id, email: `${id}@exemplo.test` } });
  await prisma.condomino.create({ data: { id_condomino: id, nome_completo: "Morador fictício", cpf: String(randomInt(0, 100_000_000_000)).padStart(11, "0"), data_nascimento: new Date("2000-01-01") } });
  await prisma.vinculo_condominio.create({ data: { id_condomino: id, id_condominio: condominio, moradia: "Apto 1", status_vinculo: "ATIVO", admin_condominio: admin } });
  return id;
}
before(async () => {
  const original = globalThis.fetch;
  mock.method(globalThis, "fetch", async (...args: Parameters<typeof fetch>) => String(args[0]) === "https://teste.supabase.co/auth/v1/.well-known/jwks.json" ? Response.json({ keys: [jwk] }) : original(...args));
  await prisma.usuario.create({ data: { id_usuario: superAdmin, email: `${superAdmin}@exemplo.test` } });
  await prisma.super_admin.create({ data: { id_super_admin: superAdmin } });
  for (const id_condominio of condominiosAntigos) await prisma.condominio.create({ data: { ...body, id_condominio, nome_residencial: `Histórico ${id_condominio}` } });
  morador = await criarMorador(condominiosAntigos[0]!); adminA = await criarMorador(condominiosAntigos[0]!, true); adminB = await criarMorador(condominiosAntigos[1]!, true);
  historico = await prisma.vinculo_condominio.findMany({ where: { id_condominio: { in: condominiosAntigos } }, orderBy: { id_vinculo: "asc" } });
  await new Promise<void>(resolve => servidor.listen(0, "127.0.0.1", resolve));
  const endereco = servidor.address(); assert.ok(endereco && typeof endereco === "object"); base = `http://127.0.0.1:${endereco.port}/api`;
});
after(async () => {
  try { assert.deepEqual(await prisma.vinculo_condominio.findMany({ where: { id_condominio: { in: condominiosAntigos } }, orderBy: { id_vinculo: "asc" } }), historico); }
  finally { servidor.closeAllConnections(); await new Promise<void>(resolve => servidor.close(() => resolve())); mock.restoreAll(); await prisma.$disconnect(); }
});
test("401 sem JWT/inválido; 403 morador e admins de dois tenants, mesmo com claims/body forjados", async () => {
  const antes = [await prisma.condominio.count(), await prisma.auditoria.count()];
  for (const id of [undefined, morador, adminA, adminB]) {
    const resposta = await chamar("/admin/condominios", id, "POST", { ...body, super_admin: true, admin_condominio: true, id_usuario: superAdmin });
    assert.equal(resposta.status, id ? 403 : 401); assert.equal((await resposta.json()).erro, id ? "FORBIDDEN" : "UNAUTHENTICATED");
  }
  const invalido = await fetch(`${base}/admin/condominios`, { method: "POST", headers: { Authorization: "Bearer invalido" } });
  assert.equal(invalido.status, 401);
  assert.deepEqual([await prisma.condominio.count(), await prisma.auditoria.count()], antes);
});
test("super suspenso recebe ACCOUNT_SUSPENDED, sem gravar", async () => {
  await prisma.usuario.update({ where: { id_usuario: superAdmin }, data: { status_conta: "SUSPENSA" } });
  const antes = await prisma.condominio.count();
  try { const r = await chamar("/admin/condominios", superAdmin); assert.equal(r.status, 403); assert.equal((await r.json()).erro, "ACCOUNT_SUSPENDED"); }
  finally { await prisma.usuario.update({ where: { id_usuario: superAdmin }, data: { status_conta: "ATIVA" } }); }
  assert.equal(await prisma.condominio.count(), antes);
});
test("400 em JSON inválido, campos inválidos e extras; nenhuma escrita", async () => {
  const antes = [await prisma.condominio.count(), await prisma.auditoria.count()];
  for (const dados of [{ ...body, nome_residencial: " " }, { ...body, cep: "72000-000" }, { ...body, endereco: " " }, ...["ativo", "id_condominio", "admin_condominio"].map(campo => ({ ...body, [campo]: true }))]) {
    const r = await chamar("/admin/condominios", superAdmin, "POST", dados); assert.equal(r.status, 400); assert.equal((await r.json()).erro, "VALIDATION_ERROR");
  }
  const jsonInvalido = await fetch(`${base}/admin/condominios`, { method: "POST", headers: await headers(superAdmin), body: "{" });
  assert.equal(jsonInvalido.status, 400); assert.equal((await jsonInvalido.json()).erro, "VALIDATION_ERROR");
  assert.deepEqual([await prisma.condominio.count(), await prisma.auditoria.count()], antes);
});
test("201 cria exatamente condomínio + auditoria, defaults reais e GET por busca; aceita CEP/nome repetidos", async () => {
  const antes = [await prisma.condominio.count(), await prisma.auditoria.count(), await prisma.usuario.count(), await prisma.condomino.count(), await prisma.vinculo_condominio.count(), await prisma.super_admin.count(), await prisma.produto.count(), await prisma.pedido.count()];
  const r = await chamar("/admin/condominios", superAdmin, "POST", { ...body, nome_residencial: ` ${body.nome_residencial} `, endereco: ` ${body.endereco} ` }); assert.equal(r.status, 201);
  const { dados } = await r.json();
  assert.match(dados.id_condominio, /^[0-9a-f-]{36}$/); assert.equal(dados.ativo, true); assert.equal(dados.created_at, new Date(dados.created_at).toISOString());
  assert.deepEqual(Object.keys(dados).sort(), ["id_condominio", "nome_residencial", "cep", "endereco", "ativo", "created_at"].sort());
  const gravado = await prisma.condominio.findUniqueOrThrow({ where: { id_condominio: dados.id_condominio } });
  assert.deepEqual(dados, { ...gravado, created_at: gravado.created_at.toISOString() });
  const auditoria = await prisma.auditoria.findFirstOrThrow({ where: { entidade_id: dados.id_condominio } });
  assert.equal(auditoria.id_ator, superAdmin); assert.equal(auditoria.acao, "CREATE_CONDOMINIUM"); assert.equal(auditoria.entidade, "condominio"); assert.equal(auditoria.id_condominio, dados.id_condominio); assert.deepEqual(auditoria.metadata, { ativo: true });
  assert.deepEqual([await prisma.condominio.count(), await prisma.auditoria.count(), await prisma.usuario.count(), await prisma.condomino.count(), await prisma.vinculo_condominio.count(), await prisma.super_admin.count(), await prisma.produto.count(), await prisma.pedido.count()], antes.map((n, i) => n + (i < 2 ? 1 : 0)));
  const lista = await chamar(`/condominios?busca=${encodeURIComponent(tag)}`, superAdmin, "GET"); assert.equal(lista.status, 200); assert.equal((await lista.json()).dados[0].id_condominio, dados.id_condominio);
  assert.equal((await chamar("/admin/condominios", superAdmin, "POST", { ...body, endereco: "Outro endereço" })).status, 201);
});
for (const entidade of ["condominio", "auditoria"] as const) test(`falha em ${entidade} retorna 500 sanitizado e rollback PostgreSQL real`, async () => {
  const antes = [await prisma.condominio.count(), await prisma.auditoria.count()];
  const original = prisma.$transaction;
  Reflect.set(prisma, "$transaction", (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, opcoes: object) => original.call(prisma, tx => callback(new Proxy(tx, {
    get(target, prop, receiver) {
      if (prop !== entidade) return Reflect.get(target, prop, receiver);
      return new Proxy(target[entidade], { get(delegate, metodo, receptor) { return metodo === "create" ? () => { throw new Error("Detalhe privado simulado"); } : Reflect.get(delegate, metodo, receptor); } });
    },
  })), opcoes));
  try { const r = await chamar("/admin/condominios", superAdmin); assert.equal(r.status, 500); assert.deepEqual(await r.json(), { erro: "INTERNAL_ERROR", mensagem: "Erro interno do servidor." }); }
  finally { Reflect.set(prisma, "$transaction", original); }
  assert.deepEqual([await prisma.condominio.count(), await prisma.auditoria.count()], antes);
});
test("novo destino: onboarding PENDENTE → primeiro aprovado sem admin → promoção explícita → local continua proibido", async () => {
  const criado = (await (await chamar("/admin/condominios", superAdmin, "POST", { ...body, nome_residencial: `Ciclo ${tag}` })).json()).dados;
  const id = randomUUID();
  const r = await chamar("/onboarding", id, "POST", { nome_completo: "Primeiro morador fictício", cpf: String(randomInt(0, 100_000_000_000)).padStart(11, "0"), data_nascimento: "2000-01-01", id_condominio: criado.id_condominio, moradia: "Apto 1" });
  assert.equal(r.status, 201); const vinculo = (await r.json()).dados;
  assert.equal(vinculo.status_vinculo, "PENDENTE"); assert.equal(vinculo.admin_condominio, false);
  const autorizado = await headers(superAdmin);
  const aprovado = await fetch(`${base}/admin/vinculos/${vinculo.id_vinculo}/aprovar`, { method: "PATCH", headers: { Authorization: autorizado.Authorization } });
  // Decisões de vínculo não aceitam body.
  assert.equal(aprovado.status, 200); assert.equal((await aprovado.json()).dados.admin_condominio, false);
  const promovido = await chamar(`/admin/vinculos/${vinculo.id_vinculo}/admin`, superAdmin, "PATCH", { admin_condominio: true }); assert.equal(promovido.status, 200);
  const antes = [await prisma.condominio.count(), await prisma.auditoria.count()];
  assert.equal((await chamar("/admin/condominios", id)).status, 403);
  assert.deepEqual([await prisma.condominio.count(), await prisma.auditoria.count()], antes);
});
