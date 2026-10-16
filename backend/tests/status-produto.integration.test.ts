import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, mock, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { Prisma, status_vinculo_enum } from "../src/generated/prisma/client.js";
import type { MeusProdutos, ResultadoEdicaoProduto, VitrineProdutos } from "../src/modules/produtos/produto.model.js";

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
const jwk = { ...await exportJWK(chaves.publicKey), kid: "status-produto-teste", alg: "ES256", use: "sig" };
const servidor = createServer(app);
const condominioA = randomUUID();
const condominioB = randomUUID();
const categoriaAtiva = randomUUID();
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
    id_condomino: id, nome_completo: "Morador Status",
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
    id_vinculo_vendedor: idVinculo, id_categoria: categoriaAtiva, nome_produto: "Bolo", descricao: "Caseiro",
    preco: "25.90", estoque: 4, created_at: new Date("2020-01-01T00:00:00Z"), updated_at: new Date("2020-01-01T00:00:00Z"), ...alteracoes,
  } });
}

async function headers(id: string, forjarPrivilegios = false) {
  const token = await new SignJWT(forjarPrivilegios ? { super_admin: true, user_metadata: { super_admin: true } } : {})
    .setProtectedHeader({ alg: "ES256", kid: jwk.kid }).setSubject(id)
    .setIssuer("https://teste.supabase.co/auth/v1").setAudience("authenticated").setExpirationTime("5m").sign(chaves.privateKey);
  return { Authorization: `Bearer ${token}` };
}

async function solicitar(idUsuario: string, idProduto: string, dados: unknown, query = "") {
  return fetch(`${base}/produtos/${idProduto}/status${query}`, {
    method: "PATCH", headers: { ...await headers(idUsuario), "Content-Type": "application/json" }, body: JSON.stringify(dados),
  });
}

async function definirStatus(idUsuario: string, idProduto: string, ativo: boolean) {
  const resposta = await solicitar(idUsuario, idProduto, { ativo });
  const resultado = await resposta.json() as ResultadoEdicaoProduto;
  assert.equal(resposta.status, 200, JSON.stringify(resultado));
  assert.deepEqual(Object.keys(resultado), ["dados"]);
  assert.deepEqual(Object.keys(resultado.dados).sort(), ["id_produto", "nome_produto", "descricao", "preco", "estoque", "ativo", "created_at", "updated_at", "categoria"].sort());
  assert.deepEqual(Object.keys(resultado.dados.categoria).sort(), ["id_categoria", "nome", "ativo"].sort());
  assert.equal(resultado.dados.ativo, ativo);
  assert.equal(new Date(resultado.dados.updated_at).toISOString(), resultado.dados.updated_at);
  assert.equal(new Date(resultado.dados.created_at).toISOString(), resultado.dados.created_at);
  assert.match(resultado.dados.preco, /^\d+\.\d{2}$/);
  return resultado.dados;
}

async function consultar(idUsuario: string, rota: string) {
  const resposta = await fetch(`${base}/produtos${rota}`, { headers: await headers(idUsuario) });
  assert.equal(resposta.status, 200);
  return await resposta.json() as MeusProdutos | VitrineProdutos;
}

async function confirmarCamposPreservados(antes: Awaited<ReturnType<typeof criarProduto>>, ativo: boolean) {
  const depois = await prisma.produto.findUniqueOrThrow({ where: { id_produto: antes.id_produto } });
  assert.equal(depois.ativo, ativo);
  assert.deepEqual({ ...depois, ativo: antes.ativo, updated_at: antes.updated_at }, antes);
}

before(async () => {
  const fetchOriginal = globalThis.fetch;
  mock.method(globalThis, "fetch", async (...args: Parameters<typeof fetch>) =>
    String(args[0]) === "https://teste.supabase.co/auth/v1/.well-known/jwks.json"
      ? new globalThis.Response(JSON.stringify({ keys: [jwk] }), { status: 200 }) : fetchOriginal(...args));
  await prisma.condominio.createMany({ data: [
    { id_condominio: condominioA, nome_residencial: "Status A", cep: "70000000", endereco: "Rua A" },
    { id_condominio: condominioB, nome_residencial: "Status B", cep: "70000001", endereco: "Rua B" },
  ] });
  await prisma.categoria_produto.createMany({ data: [
    { id_categoria: categoriaAtiva, nome: `Alimentos ${randomUUID()}` },
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

test("sem token ou token inválido retorna 401 sem gravar", async () => {
  for (const cabecalhos of [{}, { Authorization: "Bearer invalido" }] as Record<string, string>[]) {
    const resposta = await fetch(`${base}/produtos/${produtoBase.id_produto}/status`, {
      method: "PATCH", headers: { ...cabecalhos, "Content-Type": "application/json" }, body: '{"ativo":false}',
    });
    assert.equal(resposta.status, 401);
    assert.equal((await resposta.json()).erro, "UNAUTHENTICATED");
  }
  assert.deepEqual(await prisma.produto.findUnique({ where: { id_produto: produtoBase.id_produto } }), produtoBase);
});

test("sem onboarding, vínculos não ativos e super admin recebem 403 mesmo com privilégios forjados", async () => {
  const ids = [randomUUID(), superAdmin];
  for (const status of ["PENDENTE", "REJEITADO", "SUSPENSO", "ENCERRADO"] as const) ids.push((await criarMorador(status)).id);
  for (const id of ids) {
    const resposta = await fetch(`${base}/produtos/${produtoBase.id_produto}/status`, {
      method: "PATCH", headers: { ...await headers(id, true), "Content-Type": "application/json" }, body: '{"ativo":false}',
    });
    assert.equal(resposta.status, 403);
    assert.equal((await resposta.json()).erro, "MEMBERSHIP_REQUIRED");
  }
  assert.deepEqual(await prisma.produto.findUnique({ where: { id_produto: produtoBase.id_produto } }), produtoBase);
});

test("conta global suspensa é bloqueada antes da alteração", async () => {
  await prisma.usuario.update({ where: { id_usuario: morador.id }, data: { status_conta: "SUSPENSA" } });
  try {
    const resposta = await solicitar(morador.id, produtoBase.id_produto, { ativo: false });
    assert.equal(resposta.status, 403);
    assert.equal((await resposta.json()).erro, "ACCOUNT_SUSPENDED");
  } finally {
    await prisma.usuario.update({ where: { id_usuario: morador.id }, data: { status_conta: "ATIVA" } });
  }
});

test("UUID inválido, body vazio, booleanos falsos por coerção e campos extras retornam 400", async () => {
  const uuidInvalido = await solicitar(morador.id, "abc", { ativo: false });
  assert.equal(uuidInvalido.status, 400);
  assert.equal((await uuidInvalido.json()).erro, "VALIDATION_ERROR");
  for (const dados of [
    {}, [], { ativo: "true" }, { ativo: "false" }, { ativo: 1 }, { ativo: 0 }, { ativo: "sim" }, { ativo: null },
    ...["preco", "estoque", "id_categoria", "nome_produto", "descricao", "id_vinculo_vendedor", "id_usuario", "id_condominio", "id_produto", "created_at", "updated_at", "storage_path", "imagens"].map((campo) => ({ ativo: false, [campo]: "extra" })),
  ]) {
    const resposta = await solicitar(morador.id, produtoBase.id_produto, dados);
    assert.equal(resposta.status, 400, JSON.stringify(dados));
    assert.equal((await resposta.json()).erro, "VALIDATION_ERROR");
  }
  assert.deepEqual(await prisma.produto.findUnique({ where: { id_produto: produtoBase.id_produto } }), produtoBase);
});

test("desativação preserva todos os campos e datas de criação e atualiza updated_at pelo trigger", async () => {
  const produto = await criarProduto(morador.vinculo.id_vinculo);
  const resultado = await definirStatus(morador.id, produto.id_produto, false);
  assert.ok(new Date(resultado.updated_at) > produto.updated_at);
  await confirmarCamposPreservados(produto, false);
  assert.ok(!(await consultar(morador.id, "?limite=100")).dados.some((item) => item.id_produto === produto.id_produto));
  for (const rota of ["/me?limite=100", "/me?ativo=false&limite=100"]) {
    assert.ok((await consultar(morador.id, rota)).dados.some((item) => item.id_produto === produto.id_produto));
  }
});

test("ativação de produto próprio volta à vitrine do condomínio e preserva dados", async () => {
  const produto = await criarProduto(morador.vinculo.id_vinculo, { ativo: false });
  await definirStatus(morador.id, produto.id_produto, true);
  await confirmarCamposPreservados(produto, true);
  for (const id of [morador.id, vizinho.id]) assert.ok((await consultar(id, "?limite=100")).dados.some((item) => item.id_produto === produto.id_produto));
  assert.ok(!(await consultar(moradorB.id, "?limite=100")).dados.some((item) => item.id_produto === produto.id_produto));
  assert.ok((await consultar(morador.id, "/me?ativo=true&limite=100")).dados.some((item) => item.id_produto === produto.id_produto));
});

test("chamadas repetidas true e false são idempotentes e retornam 200", async () => {
  for (const ativo of [true, false]) {
    const produto = await criarProduto(morador.vinculo.id_vinculo, { ativo });
    for (let tentativa = 0; tentativa < 2; tentativa++) await definirStatus(morador.id, produto.id_produto, ativo);
    await confirmarCamposPreservados(produto, ativo);
  }
});

test("categoria inativa permite desativar ou confirmar estado inativo", async () => {
  for (const ativo of [true, false]) {
    const produto = await criarProduto(morador.vinculo.id_vinculo, { ativo, id_categoria: categoriaInativa });
    const resultado = await definirStatus(morador.id, produto.id_produto, false);
    assert.equal(resultado.categoria.ativo, false);
    await confirmarCamposPreservados(produto, false);
  }
});

test("categoria inativa bloqueia ativo=true mesmo se o produto já estiver ativo e não muda nenhum campo", async () => {
  for (const ativo of [true, false]) {
    const produto = await criarProduto(morador.vinculo.id_vinculo, { ativo, id_categoria: categoriaInativa });
    const resposta = await solicitar(morador.id, produto.id_produto, { ativo: true });
    assert.equal(resposta.status, 409);
    assert.equal((await resposta.json()).erro, "CATEGORY_INACTIVE");
    assert.deepEqual(await prisma.produto.findUnique({ where: { id_produto: produto.id_produto } }), produto);
  }
});

test("estoque zero permite ativação e desativação sem reposição ou desconto", async () => {
  const produto = await criarProduto(morador.vinculo.id_vinculo, { estoque: 0, ativo: false });
  for (const ativo of [true, false]) {
    assert.equal((await definirStatus(morador.id, produto.id_produto, ativo)).estoque, 0);
    await confirmarCamposPreservados(produto, ativo);
  }
});

test("produto inexistente ou alheio no mesmo e em outro condomínio retorna o mesmo 404 inclusive para admin", async () => {
  const produtos = [await criarProduto(vizinho.vinculo.id_vinculo, { id_categoria: categoriaInativa }), await criarProduto(moradorB.vinculo.id_vinculo)];
  let erroEsperado: unknown;
  for (const idUsuario of [morador.id, admin.id]) {
    for (const idProduto of [randomUUID(), ...produtos.map((produto) => produto.id_produto)]) {
      const resposta = await solicitar(idUsuario, idProduto, { ativo: true });
      assert.equal(resposta.status, 404);
      const erro = await resposta.json();
      assert.equal(erro.erro, "PRODUCT_NOT_FOUND");
      if (erroEsperado === undefined) erroEsperado = erro;
      else assert.deepEqual(erro, erroEsperado);
    }
  }
  for (const produto of produtos) assert.deepEqual(await prisma.produto.findUnique({ where: { id_produto: produto.id_produto } }), produto);
});

test("admin local pode mudar status somente do próprio anúncio", async () => {
  const produto = await criarProduto(admin.vinculo.id_vinculo);
  await definirStatus(admin.id, produto.id_produto, false);
  await confirmarCamposPreservados(produto, false);
});

test("produtos do vínculo histórico da mesma pessoa continuam protegidos", async () => {
  const antigo = await prisma.vinculo_condominio.create({ data: { id_condomino: morador.id, id_condominio: condominioB, status_vinculo: "ENCERRADO", moradia: "Antiga" } });
  const produto = await criarProduto(antigo.id_vinculo);
  const resposta = await solicitar(morador.id, produto.id_produto, { ativo: false });
  assert.equal(resposta.status, 404);
  assert.equal((await resposta.json()).erro, "PRODUCT_NOT_FOUND");
  assert.deepEqual(await prisma.produto.findUnique({ where: { id_produto: produto.id_produto } }), produto);
});

test("query não permite escolher vendedor nem condomínio", async () => {
  const produto = await criarProduto(moradorB.vinculo.id_vinculo);
  const resposta = await solicitar(morador.id, produto.id_produto, { ativo: false }, `?id_vinculo_vendedor=${moradorB.vinculo.id_vinculo}&id_condominio=${condominioB}`);
  assert.equal(resposta.status, 404);
  assert.equal((await resposta.json()).erro, "PRODUCT_NOT_FOUND");
  assert.deepEqual(await prisma.produto.findUnique({ where: { id_produto: produto.id_produto } }), produto);
});

test("mudança de estado preserva imagens, pedidos, histórico, conversa e auditoria", async () => {
  const produto = await criarProduto(morador.vinculo.id_vinculo);
  // Apenas fixtures no banco descartável; nenhuma API de pedidos/chat/imagens é implementada.
  const imagem = await prisma.produto_imagem.create({ data: { id_produto: produto.id_produto, storage_path: `privado/${randomUUID()}.png` } });
  const pedido = await prisma.pedido.create({ data: {
    id_produto: produto.id_produto, id_vinculo_comprador: vizinho.vinculo.id_vinculo, quantidade: 1,
    valor_pedido: "25.90", hora_combinada: new Date("2026-10-16T20:00:00Z"),
  } });
  const historico = await prisma.pedido_status_historico.create({ data: { id_pedido: pedido.id_pedido, status_novo: "SOLICITADO", alterado_por: vizinho.id } });
  const conversa = await prisma.conversa.create({ data: { id_pedido: pedido.id_pedido } });
  const auditorias = await prisma.auditoria.count();
  for (const ativo of [false, true]) await definirStatus(morador.id, produto.id_produto, ativo);
  assert.deepEqual(await prisma.produto_imagem.findUnique({ where: { id_imagem: imagem.id_imagem } }), imagem);
  assert.deepEqual(await prisma.pedido.findUnique({ where: { id_pedido: pedido.id_pedido } }), pedido);
  assert.deepEqual(await prisma.pedido_status_historico.findUnique({ where: { id_historico: historico.id_historico } }), historico);
  assert.deepEqual(await prisma.conversa.findUnique({ where: { id_conversa: conversa.id_conversa } }), conversa);
  assert.equal(await prisma.auditoria.count(), auditorias);
  await confirmarCamposPreservados(produto, true);
});

test("categoria pode ser corrigida pela edição de conteúdo antes de ativar sem misturar contratos", async () => {
  const produto = await criarProduto(morador.vinculo.id_vinculo, { ativo: false, id_categoria: categoriaInativa });
  const edicao = await fetch(`${base}/produtos/${produto.id_produto}`, {
    method: "PATCH", headers: { ...await headers(morador.id), "Content-Type": "application/json" }, body: JSON.stringify({ id_categoria: categoriaAtiva }),
  });
  assert.equal(edicao.status, 200);
  assert.equal((await edicao.json()).dados.ativo, false);
  await definirStatus(morador.id, produto.id_produto, true);
  assert.ok((await consultar(morador.id, "?limite=100")).dados.some((item) => item.id_produto === produto.id_produto));
});

test("suspensão posterior bloqueia alterações sem apagar produto", async () => {
  const vendedor = await criarMorador();
  const produto = await criarProduto(vendedor.vinculo.id_vinculo);
  const suspensao = await fetch(`${base}/admin/vinculos/${vendedor.vinculo.id_vinculo}/suspender`, { method: "PATCH", headers: await headers(admin.id) });
  assert.equal(suspensao.status, 200);
  const resposta = await solicitar(vendedor.id, produto.id_produto, { ativo: false });
  assert.equal(resposta.status, 403);
  assert.equal((await resposta.json()).erro, "MEMBERSHIP_REQUIRED");
  assert.deepEqual(await prisma.produto.findUnique({ where: { id_produto: produto.id_produto } }), produto);
});

test("update final no PostgreSQL mantém ownership mesmo sem a leitura prévia do service", async () => {
  const { atualizarStatusProdutoDoVinculo } = await import("../src/modules/produtos/produto.repository.js");
  const produto = await criarProduto(vizinho.vinculo.id_vinculo);
  await assert.rejects(atualizarStatusProdutoDoVinculo(produto.id_produto, morador.vinculo.id_vinculo, false), { code: "P2025" });
  assert.deepEqual(await prisma.produto.findUnique({ where: { id_produto: produto.id_produto } }), produto);
});
