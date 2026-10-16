import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, mock, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { status_vinculo_enum } from "../src/generated/prisma/client.js";
import type { ResultadoCriacaoProduto, VitrineProdutos } from "../src/modules/produtos/produto.model.js";

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
const jwk = { ...await exportJWK(chaves.publicKey), kid: "criar-produto-teste", alg: "ES256", use: "sig" };
const servidor = createServer(app);
const condominioA = randomUUID();
const condominioB = randomUUID();
const categoria = randomUUID();
const categoriaInativa = randomUUID();
const nomeCategoria = `Alimentação ${randomUUID()}`;
const body = { id_categoria: categoria, nome_produto: "Bolo", descricao: "Caseiro", preco: "25.90", estoque: 4 };
let base: string;
let morador: Awaited<ReturnType<typeof criarMorador>>;
let vizinho: Awaited<ReturnType<typeof criarMorador>>;
let admin: Awaited<ReturnType<typeof criarMorador>>;
let moradorB: Awaited<ReturnType<typeof criarMorador>>;
let superAdmin: string;

async function criarMorador(status: status_vinculo_enum = "ATIVO", idCondominio = condominioA, administrador = false) {
  const id = randomUUID();
  await prisma.usuario.create({ data: { id_usuario: id, email: `${id}@exemplo.com` } });
  await prisma.condomino.create({ data: {
    id_condomino: id, nome_completo: "Morador Cadastro",
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
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function postar(id: string, dados: unknown = body, query = "") {
  return fetch(`${base}/produtos${query}`, { method: "POST", headers: await headers(id), body: JSON.stringify(dados) });
}

async function publicar(id: string, dados: unknown = body, query = "") {
  const resposta = await postar(id, dados, query);
  assert.equal(resposta.status, 201);
  const resultado = await resposta.json() as ResultadoCriacaoProduto;
  assert.deepEqual(Object.keys(resultado), ["dados"]);
  assert.deepEqual(Object.keys(resultado.dados).sort(), ["id_produto", "nome_produto", "descricao", "preco", "estoque", "ativo", "created_at", "categoria"].sort());
  assert.deepEqual(Object.keys(resultado.dados.categoria).sort(), ["id_categoria", "nome"]);
  assert.match(resultado.dados.preco, /^\d+\.\d{2}$/);
  assert.equal(new Date(resultado.dados.created_at).toISOString(), resultado.dados.created_at);
  assert.equal(resultado.dados.ativo, true);
  return resultado.dados;
}

async function listar(id: string, idCategoria: string = categoria) {
  const resposta = await fetch(`${base}/produtos?id_categoria=${idCategoria}`, { headers: await headers(id) });
  assert.equal(resposta.status, 200);
  return (await resposta.json() as VitrineProdutos).dados;
}

before(async () => {
  const fetchOriginal = globalThis.fetch;
  mock.method(globalThis, "fetch", async (...args: Parameters<typeof fetch>) =>
    String(args[0]) === "https://teste.supabase.co/auth/v1/.well-known/jwks.json"
      ? new globalThis.Response(JSON.stringify({ keys: [jwk] }), { status: 200 }) : fetchOriginal(...args));
  await prisma.condominio.createMany({ data: [
    { id_condominio: condominioA, nome_residencial: "Cadastro A", cep: "70000000", endereco: "Rua A" },
    { id_condominio: condominioB, nome_residencial: "Cadastro B", cep: "70000001", endereco: "Rua B" },
  ] });
  await prisma.categoria_produto.createMany({ data: [
    { id_categoria: categoria, nome: nomeCategoria },
    { id_categoria: categoriaInativa, nome: `Inativa ${randomUUID()}`, ativo: false },
  ] });
  morador = await criarMorador();
  vizinho = await criarMorador();
  admin = await criarMorador("ATIVO", condominioA, true);
  moradorB = await criarMorador("ATIVO", condominioB);
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

test("sem token ou token inválido retorna 401 antes de validar body", async () => {
  const antes = await prisma.produto.count();
  for (const cabecalhos of [{}, { Authorization: "Bearer invalido" }] as Record<string, string>[]) {
    const resposta = await fetch(`${base}/produtos`, {
      method: "POST", headers: { ...cabecalhos, "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(resposta.status, 401);
    assert.equal((await resposta.json()).erro, "UNAUTHENTICATED");
  }
  assert.equal(await prisma.produto.count(), antes);
});

test("sem onboarding, sem vínculo, estados não ativos e super admin recebem 403 sem gravar", async () => {
  const semVinculo = randomUUID();
  await prisma.usuario.create({ data: { id_usuario: semVinculo, email: `${semVinculo}@exemplo.com` } });
  const ids = [randomUUID(), semVinculo, superAdmin];
  for (const status of ["PENDENTE", "REJEITADO", "SUSPENSO", "ENCERRADO"] as const) ids.push((await criarMorador(status, condominioA, true)).id);
  const antes = await prisma.produto.count();
  for (const id of ids) {
    const resposta = await fetch(`${base}/produtos`, { method: "POST", headers: await headers(id, true), body: "{}" });
    assert.equal(resposta.status, 403);
    assert.equal((await resposta.json()).erro, "MEMBERSHIP_REQUIRED");
  }
  assert.equal(await prisma.produto.count(), antes);
  // A permissão ampla de leitura do super admin foi preservada.
  assert.equal((await fetch(`${base}/categorias`, { headers: await headers(superAdmin) })).status, 200);
});

test("conta global suspensa bloqueia morador ativo e super admin", async () => {
  for (const id of [morador.id, superAdmin]) {
    const antes = await prisma.produto.count();
    await prisma.usuario.update({ where: { id_usuario: id }, data: { status_conta: "SUSPENSA" } });
    try {
      const resposta = await postar(id);
      assert.equal(resposta.status, 403);
      assert.equal((await resposta.json()).erro, "ACCOUNT_SUSPENDED");
      assert.equal(await prisma.produto.count(), antes);
    } finally {
      await prisma.usuario.update({ where: { id_usuario: id }, data: { status_conta: "ATIVA" } });
    }
  }
});

test("201 usa vínculo autenticado e defaults sem criar imagem, auditoria, pedido ou conversa", async () => {
  const antes = await Promise.all([prisma.produto.count(), prisma.produto_imagem.count(), prisma.auditoria.count(), prisma.pedido.count(), prisma.conversa.count()]);
  const inicio = Date.now();
  const produto = await publicar(morador.id, { ...body, nome_produto: "  Bolo de cenoura  ", descricao: "  Caseiro fresco  " });
  assert.equal(produto.nome_produto, "Bolo de cenoura");
  assert.equal(produto.descricao, "Caseiro fresco");
  assert.equal(produto.preco, "25.90");
  assert.deepEqual(produto.categoria, { id_categoria: categoria, nome: nomeCategoria });
  const salvo = await prisma.produto.findUniqueOrThrow({ where: { id_produto: produto.id_produto } });
  assert.equal(salvo.id_vinculo_vendedor, morador.vinculo.id_vinculo);
  assert.equal(salvo.ativo, true);
  assert.equal(salvo.preco.toFixed(2), "25.90");
  assert.ok(salvo.created_at.getTime() >= inicio - 1000);
  assert.ok(salvo.updated_at.getTime() >= inicio - 1000);
  assert.deepEqual(await Promise.all([prisma.produto.count(), prisma.produto_imagem.count(), prisma.auditoria.count(), prisma.pedido.count(), prisma.conversa.count()]), [antes[0] + 1, ...antes.slice(1)]);
  assert.ok((await listar(morador.id)).some((item) => item.id_produto === produto.id_produto));
  assert.ok((await listar(vizinho.id)).some((item) => item.id_produto === produto.id_produto));
  assert.ok(!(await listar(moradorB.id)).some((item) => item.id_produto === produto.id_produto));
});

test("admin local cria produto próprio e categoria global pode ser usada em outro condomínio", async () => {
  for (const pessoa of [admin, moradorB]) {
    const produto = await publicar(pessoa.id);
    const salvo = await prisma.produto.findUniqueOrThrow({ where: { id_produto: produto.id_produto } });
    assert.equal(salvo.id_vinculo_vendedor, pessoa.vinculo.id_vinculo);
    assert.equal(salvo.id_categoria, categoria);
  }
});

test("categoria inexistente retorna 404 e inativa retorna 409 sem criar nem reativar", async () => {
  const antes = await prisma.produto.count();
  for (const [id, status, codigo] of [[randomUUID(), 404, "CATEGORY_NOT_FOUND"], [categoriaInativa, 409, "CATEGORY_INACTIVE"]] as const) {
    const resposta = await postar(morador.id, { ...body, id_categoria: id });
    assert.equal(resposta.status, status);
    assert.equal((await resposta.json()).erro, codigo);
  }
  assert.equal(await prisma.produto.count(), antes);
  assert.equal((await prisma.categoria_produto.findUniqueOrThrow({ where: { id_categoria: categoriaInativa } })).ativo, false);
});

test("body inválido retorna 400 sem gravar, incluindo preço, estoque e campos obrigatórios", async () => {
  const antes = await prisma.produto.count();
  for (const alteracao of [
    { id_categoria: "invalido" }, { nome_produto: "   " }, { nome_produto: "x".repeat(141) }, { descricao: "  " },
    { preco: "0.00" }, { preco: "-10" }, { preco: "10.999" }, { preco: "10000000000.00" }, { preco: "25,90" },
    { preco: 25.9 }, { estoque: -1 }, { estoque: 1.5 }, { estoque: "1" }, { estoque: 2_147_483_648 },
  ]) {
    const resposta = await postar(morador.id, { ...body, ...alteracao });
    assert.equal(resposta.status, 400, JSON.stringify(alteracao));
    assert.equal((await resposta.json()).erro, "VALIDATION_ERROR");
  }
  for (const dados of [{}, []]) {
    const resposta = await postar(morador.id, dados);
    assert.equal(resposta.status, 400);
    assert.equal((await resposta.json()).erro, "VALIDATION_ERROR");
  }
  assert.equal(await prisma.produto.count(), antes);
});

test("campos extras de autoridade e imagens são rejeitados sem criar produto", async () => {
  const antes = await prisma.produto.count();
  for (const extra of [
    { id_vinculo_vendedor: moradorB.vinculo.id_vinculo }, { id_condominio: condominioB }, { ativo: false },
    { id_produto: randomUUID() }, { id_usuario: moradorB.id }, { created_at: new Date().toISOString() },
    { updated_at: new Date().toISOString() }, { imagens: [] }, { storage_path: "forjado/imagem.png" },
  ]) {
    const resposta = await postar(morador.id, { ...body, ...extra });
    assert.equal(resposta.status, 400, JSON.stringify(extra));
    assert.equal((await resposta.json()).erro, "VALIDATION_ERROR");
  }
  assert.equal(await prisma.produto.count(), antes);
});

test("UUIDs na query não influenciam vendedor nem condomínio", async () => {
  const produto = await publicar(morador.id, body, `?id_vinculo_vendedor=${moradorB.vinculo.id_vinculo}&id_condominio=${condominioB}`);
  const salvo = await prisma.produto.findUniqueOrThrow({ where: { id_produto: produto.id_produto } });
  assert.equal(salvo.id_vinculo_vendedor, morador.vinculo.id_vinculo);
  assert.ok(!(await listar(moradorB.id)).some((item) => item.id_produto === produto.id_produto));
});

test("estoque zero é válido e permanece visível na vitrine", async () => {
  const produto = await publicar(morador.id, { ...body, estoque: 0 });
  assert.equal(produto.estoque, 0);
  assert.equal((await listar(morador.id)).find((item) => item.id_produto === produto.id_produto)?.estoque, 0);
});

test("preço preserva centavos do mínimo ao máximo e responde com duas casas", async () => {
  for (const [preco, esperado] of [["1", "1.00"], ["1.5", "1.50"], ["0.01", "0.01"], ["9999999999.99", "9999999999.99"]]) {
    const produto = await publicar(morador.id, { ...body, preco });
    assert.equal(produto.preco, esperado);
    assert.equal((await prisma.produto.findUniqueOrThrow({ where: { id_produto: produto.id_produto } })).preco.toFixed(2), esperado);
  }
});

test("suspensão administrativa posterior oculta produto sem mudar produto.ativo e impede nova publicação", async () => {
  const vendedor = await criarMorador();
  const produto = await publicar(vendedor.id);
  assert.ok((await listar(vizinho.id)).some((item) => item.id_produto === produto.id_produto));
  const suspensao = await fetch(`${base}/admin/vinculos/${vendedor.vinculo.id_vinculo}/suspender`, {
    method: "PATCH", headers: { Authorization: (await headers(admin.id)).Authorization },
  });
  assert.equal(suspensao.status, 200);
  assert.ok(!(await listar(vizinho.id)).some((item) => item.id_produto === produto.id_produto));
  assert.equal((await prisma.produto.findUniqueOrThrow({ where: { id_produto: produto.id_produto } })).ativo, true);
  const antes = await prisma.produto.count();
  const resposta = await postar(vendedor.id);
  assert.equal(resposta.status, 403);
  assert.equal((await resposta.json()).erro, "MEMBERSHIP_REQUIRED");
  assert.equal(await prisma.produto.count(), antes);
});

test("categoria posteriormente inativada oculta produto, preserva histórico e bloqueia novas criações", async () => {
  const novaCategoria = await prisma.categoria_produto.create({ data: { nome: `Histórico ${randomUUID()}` } });
  const produto = await publicar(morador.id, { ...body, id_categoria: novaCategoria.id_categoria });
  await prisma.categoria_produto.update({ where: { id_categoria: novaCategoria.id_categoria }, data: { ativo: false } });
  assert.deepEqual(await listar(vizinho.id, novaCategoria.id_categoria), []);
  assert.equal((await prisma.produto.findUniqueOrThrow({ where: { id_produto: produto.id_produto } })).ativo, true);
  const resposta = await postar(morador.id, { ...body, id_categoria: novaCategoria.id_categoria });
  assert.equal(resposta.status, 409);
  assert.equal((await resposta.json()).erro, "CATEGORY_INACTIVE");
});

test("nomes repetidos são permitidos sem limite artificial de 15 produtos", async () => {
  const vendedor = await criarMorador();
  await prisma.produto.createMany({ data: Array.from({ length: 15 }, () => ({ ...body, id_vinculo_vendedor: vendedor.vinculo.id_vinculo })) });
  await publicar(vendedor.id);
  await publicar(vendedor.id);
  assert.equal(await prisma.produto.count({ where: { id_vinculo_vendedor: vendedor.vinculo.id_vinculo } }), 17);
});
