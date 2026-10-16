import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, mock, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { status_vinculo_enum } from "../src/generated/prisma/client.js";
import type { CategoriasVitrine } from "../src/modules/categorias/categoria.model.js";
import type { VitrineProdutos } from "../src/modules/produtos/produto.model.js";

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
const jwk = { ...await exportJWK(chaves.publicKey), kid: "categorias-teste", alg: "ES256", use: "sig" };
const servidor = createServer(app);
const condominioA = randomUUID();
const condominioB = randomUUID();
const categorias = ["Alimentação", "Bazar", "Serviços"].map((nome) => ({ id_categoria: randomUUID(), nome: `${nome} ${randomUUID()}` }));
const inativa = { id_categoria: randomUUID(), nome: `Inativa ${randomUUID()}`, ativo: false };
let base: string;
let morador: Awaited<ReturnType<typeof criarMorador>>;
let admin: Awaited<ReturnType<typeof criarMorador>>;
let superAdmin: string;

async function criarMorador(status: status_vinculo_enum = "ATIVO", idCondominio = condominioA, administrador = false) {
  const id = randomUUID();
  await prisma.usuario.create({ data: { id_usuario: id, email: `${id}@exemplo.com` } });
  await prisma.condomino.create({ data: {
    id_condomino: id, nome_completo: "Morador Categorias",
    cpf: String(randomInt(0, 100_000_000_000)).padStart(11, "0"), data_nascimento: new Date("2000-05-20T00:00:00Z"),
  } });
  const vinculo = await prisma.vinculo_condominio.create({ data: {
    id_condomino: id, id_condominio: idCondominio, status_vinculo: status,
    admin_condominio: administrador, moradia: "Apto 101",
  } });
  return { id, vinculo };
}

async function headers(id: string, forjarPrivilegios = false) {
  const token = await new SignJWT(forjarPrivilegios ? { super_admin: true, user_metadata: { super_admin: true } } : {})
    .setProtectedHeader({ alg: "ES256", kid: jwk.kid }).setSubject(id)
    .setIssuer("https://teste.supabase.co/auth/v1").setAudience("authenticated").setExpirationTime("5m").sign(chaves.privateKey);
  return { Authorization: `Bearer ${token}` };
}

async function consultar(id: string, query = "") {
  const resposta = await fetch(`${base}/categorias${query}`, { headers: await headers(id) });
  assert.equal(resposta.status, 200);
  const resultado = await resposta.json() as CategoriasVitrine;
  assert.deepEqual(Object.keys(resultado), ["dados"]);
  for (const categoria of resultado.dados) assert.deepEqual(Object.keys(categoria).sort(), ["id_categoria", "nome"]);
  return resultado;
}

before(async () => {
  const fetchOriginal = globalThis.fetch;
  mock.method(globalThis, "fetch", async (...args: Parameters<typeof fetch>) =>
    String(args[0]) === "https://teste.supabase.co/auth/v1/.well-known/jwks.json"
      ? new globalThis.Response(JSON.stringify({ keys: [jwk] }), { status: 200 }) : fetchOriginal(...args));
  await prisma.condominio.createMany({ data: [
    { id_condominio: condominioA, nome_residencial: "Categorias A", cep: "70000000", endereco: "Rua A" },
    { id_condominio: condominioB, nome_residencial: "Categorias B", cep: "70000001", endereco: "Rua B" },
  ] });
  // Fixtures exclusivas do banco temporário; nenhuma alteração no seed do projeto.
  await prisma.categoria_produto.createMany({ data: [categorias[1], categorias[2], categorias[0], inativa] });
  morador = await criarMorador();
  admin = await criarMorador("ATIVO", condominioB, true);
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

test("sem token ou com token inválido retorna 401", async () => {
  for (const cabecalhos of [{}, { Authorization: "Bearer invalido" }] as Record<string, string>[]) {
    const resposta = await fetch(`${base}/categorias`, { headers: cabecalhos });
    assert.equal(resposta.status, 401);
    assert.equal((await resposta.json()).erro, "UNAUTHENTICATED");
  }
});

test("sem onboarding, sem vínculo e vínculos não ativos recebem o mesmo erro de produtos", async () => {
  const semVinculo = randomUUID();
  await prisma.usuario.create({ data: { id_usuario: semVinculo, email: `${semVinculo}@exemplo.com` } });
  const ids = [randomUUID(), semVinculo];
  for (const status of ["PENDENTE", "REJEITADO", "SUSPENSO", "ENCERRADO"] as const) ids.push((await criarMorador(status)).id);
  for (const id of ids) {
    const resposta = await fetch(`${base}/categorias`, { headers: await headers(id, true) });
    assert.equal(resposta.status, 403);
    const erro = await resposta.json();
    assert.equal(erro.erro, "MEMBERSHIP_REQUIRED");
    const produtos = await fetch(`${base}/produtos`, { headers: await headers(id) });
    assert.equal(produtos.status, 403);
    assert.deepEqual(await produtos.json(), erro);
  }
});

test("morador, admin de outro condomínio e super admin sem vínculo recebem a mesma lista global", async () => {
  const resultado = await consultar(morador.id);
  assert.deepEqual(await consultar(admin.id), resultado);
  assert.deepEqual(await consultar(superAdmin), resultado);
  // Não depende de haver produtos nessas categorias; testa também a ordenação no PostgreSQL.
  assert.deepEqual(resultado.dados.filter((item) => categorias.some((categoria) => categoria.id_categoria === item.id_categoria)), categorias);
  assert.ok(!resultado.dados.some((item) => item.id_categoria === inativa.id_categoria));
});

test("query não implementa condomínio, paginação ou busca", async () => {
  assert.deepEqual(await consultar(morador.id, `?id_condominio=${condominioB}&pagina=999&limite=1&busca=inexistente`), await consultar(morador.id));
});

test("conta global suspensa bloqueia morador ativo e super admin", async () => {
  for (const id of [morador.id, superAdmin]) {
    await prisma.usuario.update({ where: { id_usuario: id }, data: { status_conta: "SUSPENSA" } });
    try {
      const resposta = await fetch(`${base}/categorias`, { headers: await headers(id) });
      assert.equal(resposta.status, 403);
      assert.equal((await resposta.json()).erro, "ACCOUNT_SUSPENDED");
    } finally {
      await prisma.usuario.update({ where: { id_usuario: id }, data: { status_conta: "ATIVA" } });
    }
  }
});

test("sem categorias ativas retorna 200 e dados vazios", async () => {
  const ativas = await prisma.categoria_produto.findMany({ where: { ativo: true }, select: { id_categoria: true } });
  await prisma.categoria_produto.updateMany({ where: { ativo: true }, data: { ativo: false } });
  try {
    assert.deepEqual(await consultar(morador.id), { dados: [] });
  } finally {
    await prisma.categoria_produto.updateMany({ where: { id_categoria: { in: ativas.map((item) => item.id_categoria) } }, data: { ativo: true } });
  }
});

test("UUID retornado continua funcionando como filtro de GET /api/produtos", async () => {
  const resultado = await consultar(morador.id);
  const categoria = resultado.dados.find((item) => item.id_categoria === categorias[0].id_categoria)!;
  const produto = await prisma.produto.create({ data: {
    id_vinculo_vendedor: morador.vinculo.id_vinculo, id_categoria: categoria.id_categoria,
    nome_produto: "Bolo", descricao: "Caseiro", preco: "10.00", estoque: 1,
  } });
  await prisma.produto.create({ data: {
    id_vinculo_vendedor: morador.vinculo.id_vinculo, id_categoria: categorias[1].id_categoria,
    nome_produto: "Caneca", descricao: "Cerâmica", preco: "20.00", estoque: 1,
  } });
  const resposta = await fetch(`${base}/produtos?id_categoria=${categoria.id_categoria}`, { headers: await headers(morador.id) });
  assert.equal(resposta.status, 200);
  const vitrine = await resposta.json() as VitrineProdutos;
  assert.deepEqual(vitrine.dados.map((item) => item.id_produto), [produto.id_produto]);
  assert.deepEqual(vitrine.dados[0].categoria, categoria);
});

test("health e consultas anteriores continuam disponíveis sem exigir vínculo globalmente", async () => {
  assert.equal((await fetch(`${base}/health`)).status, 200);
  for (const rota of ["condominios", "vinculos/me"]) {
    const resposta = await fetch(`${base}/${rota}`, { headers: await headers(randomUUID()) });
    assert.equal(resposta.status, 200);
  }
});
