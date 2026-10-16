import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, mock, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { Prisma, status_vinculo_enum } from "../src/generated/prisma/client.js";
import type { MeusProdutos, ResultadoCriacaoProduto, ResultadoEdicaoProduto, VitrineProdutos } from "../src/modules/produtos/produto.model.js";

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
const { simularStorageAssinatura } = await import("./storage-assinatura.fake.js");
simularStorageAssinatura();
const { app } = await import("../src/app.js");
const chaves = await generateKeyPair("ES256");
const jwk = { ...await exportJWK(chaves.publicKey), kid: "editar-produto-teste", alg: "ES256", use: "sig" };
const servidor = createServer(app);
const condominioA = randomUUID();
const condominioB = randomUUID();
const categoriaA = randomUUID();
const categoriaB = randomUUID();
const categoriaInativa = randomUUID();
let base: string;
let morador: Awaited<ReturnType<typeof criarMorador>>;
let vizinho: Awaited<ReturnType<typeof criarMorador>>;
let admin: Awaited<ReturnType<typeof criarMorador>>;
let moradorB: Awaited<ReturnType<typeof criarMorador>>;
let superAdmin: string;
let produtoBase: Awaited<ReturnType<typeof criarProduto>>;

async function criarMorador(status: status_vinculo_enum = "ATIVO", idCondominio: string = condominioA, administrador = false) {
  const id = randomUUID();
  await prisma.usuario.create({ data: { id_usuario: id, email: `${id}@exemplo.com` } });
  await prisma.condomino.create({ data: {
    id_condomino: id, nome_completo: "Morador Edição",
    cpf: String(randomInt(0, 100_000_000_000)).padStart(11, "0"), data_nascimento: new Date("2000-05-20T00:00:00Z"),
  } });
  const vinculo = await prisma.vinculo_condominio.create({ data: {
    id_condomino: id, id_condominio: idCondominio, status_vinculo: status,
    admin_condominio: administrador, moradia: "Apto 101",
  } });
  return { id, vinculo };
}

async function criarProduto(idVinculo: string, alteracoes: Partial<Prisma.produtoUncheckedCreateInput> = {}) {
  return prisma.produto.create({ data: {
    id_vinculo_vendedor: idVinculo, id_categoria: categoriaA, nome_produto: "Bolo", descricao: "Caseiro",
    preco: "10.00", estoque: 5, created_at: new Date("2020-01-01T00:00:00Z"), updated_at: new Date("2020-01-01T00:00:00Z"), ...alteracoes,
  } });
}

async function headers(id: string, forjarPrivilegios = false) {
  const token = await new SignJWT(forjarPrivilegios ? { super_admin: true, user_metadata: { super_admin: true } } : {})
    .setProtectedHeader({ alg: "ES256", kid: jwk.kid }).setSubject(id)
    .setIssuer("https://teste.supabase.co/auth/v1").setAudience("authenticated").setExpirationTime("5m").sign(chaves.privateKey);
  return { Authorization: `Bearer ${token}` };
}

async function solicitar(idUsuario: string, idProduto: string, dados: unknown, query = "") {
  return fetch(`${base}/produtos/${idProduto}${query}`, {
    method: "PATCH", headers: { ...await headers(idUsuario), "Content-Type": "application/json" }, body: JSON.stringify(dados),
  });
}

async function editar(idUsuario: string, idProduto: string, dados: unknown) {
  const resposta = await solicitar(idUsuario, idProduto, dados);
  const resultado = await resposta.json() as ResultadoEdicaoProduto;
  assert.equal(resposta.status, 200, JSON.stringify(resultado));
  assert.deepEqual(Object.keys(resultado), ["dados"]);
  assert.deepEqual(Object.keys(resultado.dados).sort(), ["id_produto", "nome_produto", "descricao", "preco", "estoque", "ativo", "created_at", "updated_at", "categoria"].sort());
  assert.deepEqual(Object.keys(resultado.dados.categoria).sort(), ["id_categoria", "nome", "ativo"].sort());
  assert.match(resultado.dados.preco, /^\d+\.\d{2}$/);
  assert.equal(new Date(resultado.dados.created_at).toISOString(), resultado.dados.created_at);
  assert.equal(new Date(resultado.dados.updated_at).toISOString(), resultado.dados.updated_at);
  return resultado.dados;
}

async function consultar(id: string, rota: string) {
  const resposta = await fetch(`${base}/produtos${rota}`, { headers: await headers(id) });
  assert.equal(resposta.status, 200);
  return await resposta.json() as MeusProdutos | VitrineProdutos;
}

before(async () => {
  const fetchOriginal = globalThis.fetch;
  mock.method(globalThis, "fetch", async (...args: Parameters<typeof fetch>) =>
    String(args[0]) === "https://teste.supabase.co/auth/v1/.well-known/jwks.json"
      ? new globalThis.Response(JSON.stringify({ keys: [jwk] }), { status: 200 }) : fetchOriginal(...args));
  await prisma.condominio.createMany({ data: [
    { id_condominio: condominioA, nome_residencial: "Edição A", cep: "70000000", endereco: "Rua A" },
    { id_condominio: condominioB, nome_residencial: "Edição B", cep: "70000001", endereco: "Rua B" },
  ] });
  await prisma.categoria_produto.createMany({ data: [
    { id_categoria: categoriaA, nome: `Alimentos ${randomUUID()}` },
    { id_categoria: categoriaB, nome: `Utensílios ${randomUUID()}` },
    { id_categoria: categoriaInativa, nome: `Inativa ${randomUUID()}`, ativo: false },
  ] });
  morador = await criarMorador();
  vizinho = await criarMorador();
  admin = await criarMorador("ATIVO", condominioA, true);
  moradorB = await criarMorador("ATIVO", condominioB);
  superAdmin = randomUUID();
  await prisma.usuario.create({ data: { id_usuario: superAdmin, email: `${superAdmin}@exemplo.com` } });
  await prisma.super_admin.create({ data: { id_super_admin: superAdmin } });
  produtoBase = await criarProduto(morador.vinculo.id_vinculo);
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

test("sem token ou token inválido retorna 401 sem alterar produto", async () => {
  for (const cabecalhos of [{}, { Authorization: "Bearer invalido" }] as Record<string, string>[]) {
    const resposta = await fetch(`${base}/produtos/${produtoBase.id_produto}`, {
      method: "PATCH", headers: { ...cabecalhos, "Content-Type": "application/json" }, body: '{"estoque":0}',
    });
    assert.equal(resposta.status, 401);
    assert.equal((await resposta.json()).erro, "UNAUTHENTICATED");
  }
  assert.deepEqual(await prisma.produto.findUnique({ where: { id_produto: produtoBase.id_produto } }), produtoBase);
});

test("sem onboarding, vínculos não ativos e super admin recebem 403 mesmo forjando privilégios", async () => {
  const ids = [randomUUID(), superAdmin];
  for (const status of ["PENDENTE", "REJEITADO", "SUSPENSO", "ENCERRADO"] as const) ids.push((await criarMorador(status)).id);
  for (const id of ids) {
    const resposta = await fetch(`${base}/produtos/${produtoBase.id_produto}`, {
      method: "PATCH", headers: { ...await headers(id, true), "Content-Type": "application/json" }, body: '{"estoque":0}',
    });
    assert.equal(resposta.status, 403);
    assert.equal((await resposta.json()).erro, "MEMBERSHIP_REQUIRED");
  }
  assert.deepEqual(await prisma.produto.findUnique({ where: { id_produto: produtoBase.id_produto } }), produtoBase);
});

test("conta global suspensa continua bloqueada", async () => {
  await prisma.usuario.update({ where: { id_usuario: morador.id }, data: { status_conta: "SUSPENSA" } });
  try {
    const resposta = await solicitar(morador.id, produtoBase.id_produto, { estoque: 0 });
    assert.equal(resposta.status, 403);
    assert.equal((await resposta.json()).erro, "ACCOUNT_SUSPENDED");
  } finally {
    await prisma.usuario.update({ where: { id_usuario: morador.id }, data: { status_conta: "ATIVA" } });
  }
});

test("UUID inválido, body vazio, valores inválidos e campos proibidos retornam 400 sem gravação", async () => {
  for (const id of ["abc", "me"]) {
    const resposta = await solicitar(morador.id, id, { estoque: 0 });
    assert.equal(resposta.status, 400);
    assert.equal((await resposta.json()).erro, "VALIDATION_ERROR");
  }
  for (const dados of [
    {}, [], { nome_produto: "  " }, { nome_produto: "x".repeat(141) }, { descricao: " " }, { descricao: null },
    { preco: "0" }, { preco: "0.00" }, { preco: "-1" }, { preco: "10.999" }, { preco: "25,90" }, { preco: "10000000000.00" }, { preco: 25.9 },
    { estoque: -1 }, { estoque: 1.5 }, { estoque: "1" }, { estoque: 2_147_483_648 }, { id_categoria: "abc" },
    ...["id_produto", "id_vinculo_vendedor", "id_condominio", "id_usuario", "ativo", "created_at", "updated_at", "storage_path", "imagens"].map((campo) => ({ nome_produto: "Novo", [campo]: "forjado" })),
  ]) {
    const resposta = await solicitar(morador.id, produtoBase.id_produto, dados);
    assert.equal(resposta.status, 400, JSON.stringify(dados));
    assert.equal((await resposta.json()).erro, "VALIDATION_ERROR");
  }
  assert.deepEqual(await prisma.produto.findUnique({ where: { id_produto: produtoBase.id_produto } }), produtoBase);
});

test("PATCH de nome preserva omitidos, vínculo, ativo e created_at e usa o trigger updated_at", async () => {
  const produto = await criarProduto(morador.vinculo.id_vinculo);
  const imagem = await prisma.produto_imagem.create({ data: { id_produto: produto.id_produto, storage_path: `privado/${randomUUID()}.png` } });
  const auditorias = await prisma.auditoria.count();
  const resultado = await editar(morador.id, produto.id_produto, { nome_produto: "  Bolo grande  " });
  const salvo = await prisma.produto.findUniqueOrThrow({ where: { id_produto: produto.id_produto } });
  assert.equal(resultado.nome_produto, "Bolo grande");
  assert.ok(salvo.updated_at > produto.updated_at);
  assert.deepEqual({ ...salvo, nome_produto: produto.nome_produto, updated_at: produto.updated_at }, produto);
  assert.deepEqual(await prisma.produto_imagem.findUnique({ where: { id_imagem: imagem.id_imagem } }), imagem);
  assert.equal(await prisma.auditoria.count(), auditorias);
});

test("preço parcial preserva nome, descrição, categoria e estoque com Decimal exato", async () => {
  const produto = await criarProduto(morador.vinculo.id_vinculo);
  for (const [preco, esperado] of [["20.00", "20.00"], ["1.5", "1.50"], ["0.01", "0.01"], ["9999999999.99", "9999999999.99"]]) {
    const resultado = await editar(morador.id, produto.id_produto, { preco });
    assert.equal(resultado.preco, esperado);
    const salvo = await prisma.produto.findUniqueOrThrow({ where: { id_produto: produto.id_produto } });
    assert.equal(salvo.preco.toFixed(2), esperado);
    assert.deepEqual({ ...salvo, preco: produto.preco, updated_at: produto.updated_at }, produto);
  }
});

test("estoque zero é aplicado sem limpar outros campos", async () => {
  const produto = await criarProduto(morador.vinculo.id_vinculo);
  assert.equal((await editar(morador.id, produto.id_produto, { estoque: 0 })).estoque, 0);
  const salvo = await prisma.produto.findUniqueOrThrow({ where: { id_produto: produto.id_produto } });
  assert.deepEqual({ ...salvo, estoque: produto.estoque, updated_at: produto.updated_at }, produto);
});

test("produto inativo pode ser editado e continua fora da vitrine", async () => {
  const produto = await criarProduto(morador.vinculo.id_vinculo, { ativo: false });
  const resultado = await editar(morador.id, produto.id_produto, { preco: "30.00" });
  assert.equal(resultado.ativo, false);
  assert.ok(!(await consultar(morador.id, "?limite=100")).dados.some((item) => item.id_produto === produto.id_produto));
  const meuProduto = (await consultar(morador.id, "/me?limite=100")).dados.find((item) => item.id_produto === produto.id_produto);
  assert.equal(meuProduto?.preco, "30.00");
});

test("inexistente e alheio no mesmo ou outro condomínio retornam o mesmo 404 inclusive para admin", async () => {
  const alheios = [await criarProduto(vizinho.vinculo.id_vinculo), await criarProduto(moradorB.vinculo.id_vinculo)];
  let erroEsperado: unknown;
  for (const idUsuario of [morador.id, admin.id]) {
    for (const idProduto of [randomUUID(), ...alheios.map((item) => item.id_produto)]) {
      const resposta = await solicitar(idUsuario, idProduto, { id_categoria: categoriaInativa });
      assert.equal(resposta.status, 404);
      const erro = await resposta.json();
      assert.equal(erro.erro, "PRODUCT_NOT_FOUND");
      if (erroEsperado === undefined) erroEsperado = erro;
      else assert.deepEqual(erro, erroEsperado);
    }
  }
  for (const produto of alheios) assert.deepEqual(await prisma.produto.findUnique({ where: { id_produto: produto.id_produto } }), produto);
});

test("admin local pode editar apenas seu próprio anúncio", async () => {
  const produto = await criarProduto(admin.vinculo.id_vinculo);
  assert.equal((await editar(admin.id, produto.id_produto, { descricao: "  Descrição revisada  " })).descricao, "Descrição revisada");
  const resposta = await solicitar(admin.id, produtoBase.id_produto, { nome_produto: "Alheio" });
  assert.equal(resposta.status, 404);
  assert.equal((await resposta.json()).erro, "PRODUCT_NOT_FOUND");
});

test("produto de vínculo histórico da mesma pessoa não pode ser editado pelo vínculo atual", async () => {
  const antigo = await prisma.vinculo_condominio.create({ data: { id_condomino: morador.id, id_condominio: condominioB, status_vinculo: "ENCERRADO", moradia: "Antiga" } });
  const produto = await criarProduto(antigo.id_vinculo);
  const resposta = await solicitar(morador.id, produto.id_produto, { estoque: 0 });
  assert.equal(resposta.status, 404);
  assert.equal((await resposta.json()).erro, "PRODUCT_NOT_FOUND");
  assert.deepEqual(await prisma.produto.findUnique({ where: { id_produto: produto.id_produto } }), produto);
});

test("categoria explicitamente enviada precisa existir e estar ativa sem alterar produto em falhas", async () => {
  const produto = await criarProduto(morador.vinculo.id_vinculo);
  for (const [idCategoria, status, codigo] of [[randomUUID(), 404, "CATEGORY_NOT_FOUND"], [categoriaInativa, 409, "CATEGORY_INACTIVE"]] as const) {
    const resposta = await solicitar(morador.id, produto.id_produto, { id_categoria: idCategoria, nome_produto: "Não salvar" });
    assert.equal(resposta.status, status);
    assert.equal((await resposta.json()).erro, codigo);
    assert.deepEqual(await prisma.produto.findUnique({ where: { id_produto: produto.id_produto } }), produto);
  }
});

test("categoria atual inativa permite editar outro campo, mas reenviar a mesma categoria retorna 409", async () => {
  const produto = await criarProduto(morador.vinculo.id_vinculo, { id_categoria: categoriaInativa });
  const resultado = await editar(morador.id, produto.id_produto, { preco: "40.00" });
  assert.equal(resultado.categoria.id_categoria, categoriaInativa);
  assert.equal(resultado.categoria.ativo, false);
  const antes = await prisma.produto.findUniqueOrThrow({ where: { id_produto: produto.id_produto } });
  const resposta = await solicitar(morador.id, produto.id_produto, { id_categoria: categoriaInativa });
  assert.equal(resposta.status, 409);
  assert.equal((await resposta.json()).erro, "CATEGORY_INACTIVE");
  assert.deepEqual(await prisma.produto.findUnique({ where: { id_produto: produto.id_produto } }), antes);
});

test("POST seguido de PATCH completo reflete novos dados e novo filtro de categoria em me e na vitrine", async () => {
  const criacao = await fetch(`${base}/produtos`, {
    method: "POST", headers: { ...await headers(morador.id), "Content-Type": "application/json" },
    body: JSON.stringify({ id_categoria: categoriaA, nome_produto: "Publicado", descricao: "Inicial", preco: "10.00", estoque: 5 }),
  });
  assert.equal(criacao.status, 201);
  const criado = await criacao.json() as ResultadoCriacaoProduto;
  const resultado = await editar(morador.id, criado.dados.id_produto, {
    id_categoria: categoriaB, nome_produto: "  Novo nome  ", descricao: "  Revisado  ", preco: "29.90", estoque: 0,
  });
  assert.equal(resultado.nome_produto, "Novo nome");
  assert.equal(resultado.descricao, "Revisado");
  assert.equal(resultado.categoria.id_categoria, categoriaB);
  assert.equal(resultado.ativo, true);
  assert.equal(resultado.created_at, criado.dados.created_at);
  const meus = (await consultar(morador.id, "/me?limite=100")).dados.find((item) => item.id_produto === resultado.id_produto);
  assert.deepEqual(meus, { ...resultado, imagens: [] });
  assert.ok(!(await consultar(morador.id, `?id_categoria=${categoriaA}&limite=100`)).dados.some((item) => item.id_produto === resultado.id_produto));
  const vitrine = (await consultar(morador.id, `?id_categoria=${categoriaB}&limite=100`)).dados.find((item) => item.id_produto === resultado.id_produto);
  assert.equal(vitrine?.nome_produto, "Novo nome");
  assert.equal(vitrine?.preco, "29.90");
  assert.equal(vitrine?.estoque, 0);
});

test("UUIDs de vendedor e condomínio na query não autorizam edição alheia", async () => {
  const produto = await criarProduto(moradorB.vinculo.id_vinculo);
  const resposta = await solicitar(morador.id, produto.id_produto, { estoque: 0 }, `?id_vinculo_vendedor=${moradorB.vinculo.id_vinculo}&id_condominio=${condominioB}`);
  assert.equal(resposta.status, 404);
  assert.equal((await resposta.json()).erro, "PRODUCT_NOT_FOUND");
  assert.deepEqual(await prisma.produto.findUnique({ where: { id_produto: produto.id_produto } }), produto);
});

test("suspensão do vendedor impede editar sem apagar ou modificar produto", async () => {
  const vendedor = await criarMorador();
  const produto = await criarProduto(vendedor.vinculo.id_vinculo);
  const suspensao = await fetch(`${base}/admin/vinculos/${vendedor.vinculo.id_vinculo}/suspender`, { method: "PATCH", headers: await headers(admin.id) });
  assert.equal(suspensao.status, 200);
  const resposta = await solicitar(vendedor.id, produto.id_produto, { estoque: 0 });
  assert.equal(resposta.status, 403);
  assert.equal((await resposta.json()).erro, "MEMBERSHIP_REQUIRED");
  assert.deepEqual(await prisma.produto.findUnique({ where: { id_produto: produto.id_produto } }), produto);
});
