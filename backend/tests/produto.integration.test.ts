import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, mock, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { Prisma, status_vinculo_enum } from "../src/generated/prisma/client.js";
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
const { simularStorageAssinatura } = await import("./storage-assinatura.fake.js");
const storage = simularStorageAssinatura();
const { app } = await import("../src/app.js");
const chaves = await generateKeyPair("ES256");
const jwk = { ...await exportJWK(chaves.publicKey), kid: "vitrine-teste", alg: "ES256", use: "sig" };
const condominioA = randomUUID();
const condominioB = randomUUID();
const condominioInativo = randomUUID();
const condominioVazio = randomUUID();
const categoriaAlimentos = randomUUID();
const categoriaUtensilios = randomUUID();
const categoriaInativa = randomUUID();
const servidor = createServer(app);
let base: string;
let morador: string;
let admin: string;
let superAdmin: string;
let vendedor: Awaited<ReturnType<typeof criarMorador>>;
let bolo: Awaited<ReturnType<typeof criarProduto>>;
let pao: Awaited<ReturnType<typeof criarProduto>>;
let caneca: Awaited<ReturnType<typeof criarProduto>>;
let proprio: Awaited<ReturnType<typeof criarProduto>>;
let produtoB: Awaited<ReturnType<typeof criarProduto>>;
let visiveisA: Awaited<ReturnType<typeof criarProduto>>[];

async function criarMorador(status: status_vinculo_enum = "ATIVO", idCondominio = condominioA, administrador = false) {
  const id = randomUUID();
  await prisma.usuario.create({ data: { id_usuario: id, email: `${id}@exemplo.com` } });
  await prisma.condomino.create({ data: {
    id_condomino: id, nome_completo: "Morador da Vitrine",
    cpf: String(randomInt(0, 100_000_000_000)).padStart(11, "0"), data_nascimento: new Date("2000-05-20T00:00:00Z"),
  } });
  const vinculo = await prisma.vinculo_condominio.create({ data: {
    id_condomino: id, id_condominio: idCondominio, status_vinculo: status,
    admin_condominio: administrador, moradia: "Bloco B - Apto 302",
  } });
  return { id, vinculo };
}

async function criarProduto(idVinculo: string, idCategoria: string, nome: string, alteracoes: Partial<Prisma.produtoUncheckedCreateInput> = {}) {
  return prisma.produto.create({ data: {
    id_vinculo_vendedor: idVinculo, id_categoria: idCategoria, nome_produto: nome,
    descricao: "Descrição de teste", preco: "25.00", estoque: 4,
    created_at: new Date("2026-10-15T20:00:00Z"), ...alteracoes,
  } });
}

async function headers(id: string, forjarAdmin = false) {
  const token = await new SignJWT(forjarAdmin ? { super_admin: true, user_metadata: { super_admin: true } } : {})
    .setProtectedHeader({ alg: "ES256", kid: jwk.kid }).setSubject(id)
    .setIssuer("https://teste.supabase.co/auth/v1").setAudience("authenticated").setExpirationTime("5m").sign(chaves.privateKey);
  return { Authorization: `Bearer ${token}` };
}

async function consultar(id: string, query = "") {
  const resposta = await fetch(`${base}/produtos${query}`, { headers: await headers(id) });
  assert.equal(resposta.status, 200);
  const resultado = await resposta.json() as VitrineProdutos;
  assert.doesNotMatch(JSON.stringify(resultado), /cpf|data_nascimento|email|status_conta|JWT|refresh_token|storage_path|id_usuario|id_condomino|SUPABASE_SECRET_KEY/);
  for (const item of resultado.dados) {
    assert.match(item.preco, /^\d+\.\d{2}$/);
    assert.equal(new Date(item.created_at).toISOString(), item.created_at);
    assert.deepEqual(Object.keys(item.vendedor).sort(), ["id_vinculo", "nome_completo", "moradia"].sort());
    for (const imagem of item.imagens) {
      assert.match(imagem.url, /^https:\/\/storage\.exemplo\.com\//);
      assert.equal(imagem.expires_in, 600);
      assert.deepEqual(Object.keys(imagem).sort(), ["expires_in", "id_imagem", "ordem", "url"]);
    }
  }
  return resultado;
}

before(async () => {
  const fetchOriginal = globalThis.fetch;
  mock.method(globalThis, "fetch", async (...args: Parameters<typeof fetch>) =>
    String(args[0]) === "https://teste.supabase.co/auth/v1/.well-known/jwks.json"
      ? new globalThis.Response(JSON.stringify({ keys: [jwk] }), { status: 200 }) : fetchOriginal(...args));
  await prisma.condominio.createMany({ data: [
    { id_condominio: condominioA, nome_residencial: "Vitrine A", cep: "70000000", endereco: "Rua A" },
    { id_condominio: condominioB, nome_residencial: "Vitrine B", cep: "70000001", endereco: "Rua B" },
    { id_condominio: condominioInativo, nome_residencial: "Vitrine Inativa", cep: "70000002", endereco: "Rua C", ativo: false },
    { id_condominio: condominioVazio, nome_residencial: "Vitrine Vazia", cep: "70000003", endereco: "Rua D" },
  ] });
  await prisma.categoria_produto.createMany({ data: [
    { id_categoria: categoriaAlimentos, nome: `Alimentos ${randomUUID()}` },
    { id_categoria: categoriaUtensilios, nome: `Utensílios ${randomUUID()}` },
    { id_categoria: categoriaInativa, nome: `Inativa ${randomUUID()}`, ativo: false },
  ] });
  const residente = await criarMorador();
  morador = residente.id;
  admin = (await criarMorador("ATIVO", condominioA, true)).id;
  vendedor = await criarMorador();
  const vendedorB = await criarMorador("ATIVO", condominioB);
  superAdmin = randomUUID();
  await prisma.usuario.create({ data: { id_usuario: superAdmin, email: `${superAdmin}@exemplo.com` } });
  await prisma.super_admin.create({ data: { id_super_admin: superAdmin } });
  bolo = await criarProduto(vendedor.vinculo.id_vinculo, categoriaAlimentos, "Bolo de cenoura", { descricao: "Caseiro fresco" });
  pao = await criarProduto(vendedor.vinculo.id_vinculo, categoriaAlimentos, "Pão artesanal", { descricao: "Receita de fermentação natural", preco: "12.30", estoque: 0 });
  caneca = await criarProduto(vendedor.vinculo.id_vinculo, categoriaUtensilios, "Caneca", { descricao: "Cerâmica para café", preco: "9.90", created_at: new Date("2026-10-14T20:00:00Z") });
  proprio = await criarProduto(residente.vinculo.id_vinculo, categoriaAlimentos, "Anúncio próprio", { preco: "1.05", created_at: new Date("2026-10-13T20:00:00Z") });
  produtoB = await criarProduto(vendedorB.vinculo.id_vinculo, categoriaAlimentos, "Exclusivo de B", { descricao: "Segredo do outro tenant", created_at: new Date("2026-10-16T20:00:00Z") });
  await prisma.produto_imagem.create({ data: { id_produto: bolo.id_produto, storage_path: `privado/${randomUUID()}.png`, ordem: 0 } });
  await criarProduto(vendedor.vinculo.id_vinculo, categoriaAlimentos, "Produto desativado", { ativo: false });
  await criarProduto(vendedor.vinculo.id_vinculo, categoriaInativa, "Categoria desativada");
  for (const status of ["PENDENTE", "REJEITADO", "SUSPENSO", "ENCERRADO"] as const) {
    const historico = await criarMorador(status);
    await criarProduto(historico.vinculo.id_vinculo, categoriaAlimentos, `Vendedor ${status}`);
    if (status === "ENCERRADO") {
      // O vínculo atual da pessoa em B não pode tornar visível o produto do vínculo histórico de A.
      await prisma.vinculo_condominio.create({ data: { id_condomino: historico.id, id_condominio: condominioB, moradia: "Apto 202", status_vinculo: "ATIVO" } });
    }
  }
  visiveisA = [bolo, pao, caneca, proprio].sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || a.id_produto.localeCompare(b.id_produto));
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

test("sem token ou token inválido retorna 401", async () => {
  const casos: Record<string, string>[] = [{}, { Authorization: "Bearer invalido" }];
  for (const cabecalhos of casos) {
    const resposta = await fetch(`${base}/produtos`, { headers: cabecalhos });
    assert.equal(resposta.status, 401);
    assert.equal((await resposta.json()).erro, "UNAUTHENTICATED");
  }
});

test("sem onboarding e vínculos PENDENTE/REJEITADO/SUSPENSO/ENCERRADO recebem 403 mesmo forjando privilégios", async () => {
  const ids = [randomUUID()];
  for (const status of ["PENDENTE", "REJEITADO", "SUSPENSO", "ENCERRADO"] as const) ids.push((await criarMorador(status)).id);
  for (const id of ids) {
    const resposta = await fetch(`${base}/produtos?id_condominio=${condominioB}`, { headers: await headers(id, true) });
    assert.equal(resposta.status, 403);
    assert.equal((await resposta.json()).erro, "MEMBERSHIP_REQUIRED");
  }
});

test("morador e admin local recebem a mesma vitrine, incluindo próprio anúncio e estoque zero", async () => {
  const resultado = await consultar(morador);
  assert.deepEqual(resultado.dados.map((item) => item.id_produto), visiveisA.map((item) => item.id_produto));
  assert.deepEqual(resultado.paginacao, { pagina: 1, limite: 20, total: 4, total_paginas: 1 });
  assert.deepEqual(await consultar(admin), resultado);
  assert.equal(resultado.dados.find((item) => item.id_produto === pao.id_produto)?.estoque, 0);
  assert.ok(resultado.dados.some((item) => item.id_produto === proprio.id_produto));
  const cardBolo = resultado.dados.find((item) => item.id_produto === bolo.id_produto)!;
  assert.equal(cardBolo.preco, "25.00");
  assert.deepEqual(cardBolo.vendedor, { id_vinculo: vendedor.vinculo.id_vinculo, nome_completo: "Morador da Vitrine", moradia: "Bloco B - Apto 302" });
  assert.equal(cardBolo.imagens.length, 1);
  assert.match(cardBolo.imagens[0].url, /^https:\/\/storage\.exemplo\.com\//);
  assert.deepEqual(resultado.dados.find((item) => item.id_produto === pao.id_produto)!.imagens, []);
});

test("query do próprio condomínio é aceita; outro condomínio retorna 403 para morador e admin", async () => {
  assert.deepEqual(await consultar(morador, `?id_condominio=${condominioA.toUpperCase()}`), await consultar(morador));
  for (const id of [morador, admin]) {
    const resposta = await fetch(`${base}/produtos?id_condominio=${condominioB}`, { headers: await headers(id) });
    assert.equal(resposta.status, 403);
    assert.equal((await resposta.json()).erro, "FORBIDDEN_CROSS_TENANT");
  }
});

test("super admin exige seleção explícita e consulta somente a vitrine selecionada", async () => {
  const semCondominio = await fetch(`${base}/produtos`, { headers: await headers(superAdmin) });
  assert.equal(semCondominio.status, 400);
  assert.equal((await semCondominio.json()).erro, "CONDOMINIUM_REQUIRED");
  assert.deepEqual(await consultar(superAdmin, `?id_condominio=${condominioA}`), await consultar(morador));
  const resultadoB = await consultar(superAdmin, `?id_condominio=${condominioB}`);
  assert.deepEqual(resultadoB.dados.map((item) => item.id_produto), [produtoB.id_produto]);
});

test("super admin recebe 404 para condomínio inexistente ou inativo", async () => {
  for (const id of [randomUUID(), condominioInativo]) {
    const resposta = await fetch(`${base}/produtos?id_condominio=${id}`, { headers: await headers(superAdmin) });
    assert.equal(resposta.status, 404);
    assert.equal((await resposta.json()).erro, "CONDOMINIO_NOT_FOUND");
  }
});

test("busca por nome e descrição normaliza trim/caixa e não escapa do tenant nem com categoria", async () => {
  assert.deepEqual((await consultar(morador, "?busca=%20bOLO%20")).dados.map((item) => item.id_produto), [bolo.id_produto]);
  assert.deepEqual((await consultar(morador, "?busca=NATURAL")).dados.map((item) => item.id_produto), [pao.id_produto]);
  for (const busca of [produtoB.nome_produto, produtoB.descricao]) {
    const resultado = await consultar(morador, `?busca=${encodeURIComponent(busca)}&id_categoria=${categoriaAlimentos}`);
    assert.deepEqual(resultado.dados, []);
    assert.equal(resultado.paginacao.total, 0);
  }
  assert.deepEqual(await consultar(morador, "?busca=%20%20"), await consultar(morador));
});

test("categoria e busca combinam com AND; alias legado preserva compatibilidade", async () => {
  const utensilios = await consultar(morador, `?id_categoria=${categoriaUtensilios}`);
  assert.deepEqual(utensilios.dados.map((item) => item.id_produto), [caneca.id_produto]);
  assert.deepEqual(await consultar(morador, `?categoria=${categoriaUtensilios}`), utensilios);
  assert.deepEqual((await consultar(morador, `?id_categoria=${categoriaUtensilios}&busca=bolo`)).dados, []);
  assert.deepEqual((await consultar(morador, `?id_categoria=${categoriaAlimentos}&busca=natural`)).dados.map((item) => item.id_produto), [pao.id_produto]);
});

test("paginação usa ordenação por criação e UUID, total filtrado e limite até 100", async () => {
  const segunda = await consultar(morador, "?pagina=2&limite=2");
  assert.deepEqual(segunda.dados.map((item) => item.id_produto), visiveisA.slice(2, 4).map((item) => item.id_produto));
  assert.deepEqual(segunda.paginacao, { pagina: 2, limite: 2, total: 4, total_paginas: 2 });
  const alem = await consultar(morador, "?pagina=10&limite=2");
  assert.deepEqual(alem.dados, []);
  assert.equal(alem.paginacao.total, 4);
  assert.equal((await consultar(morador, "?limite=100")).dados.length, 4);
});

test("busca vazia de resultados, categoria inexistente/inativa e vitrine vazia retornam 200 com totais zero", async () => {
  for (const query of [`?busca=${randomUUID()}`, `?id_categoria=${randomUUID()}`, `?id_categoria=${categoriaInativa}`]) {
    assert.deepEqual(await consultar(morador, query), { dados: [], paginacao: { pagina: 1, limite: 20, total: 0, total_paginas: 0 } });
  }
  assert.deepEqual(await consultar(superAdmin, `?id_condominio=${condominioVazio}`), { dados: [], paginacao: { pagina: 1, limite: 20, total: 0, total_paginas: 0 } });
});

test("queries inválidas, repetidas, desconhecidas e filtros conflitantes retornam 400", async () => {
  for (const query of ["pagina=0", "pagina=abc", "limite=0", "limite=101", "id_categoria=abc", "id_condominio=abc",
    "limite=1&limite=2", `id_produto=${produtoB.id_produto}`, `id_categoria=${categoriaAlimentos}&categoria=${categoriaUtensilios}`]) {
    const resposta = await fetch(`${base}/produtos?${query}`, { headers: await headers(morador) });
    assert.equal(resposta.status, 400);
    assert.equal((await resposta.json()).erro, "VALIDATION_ERROR");
  }
});

test("consulta da vitrine não altera produtos, imagens, vínculos, categorias ou auditoria", async () => {
  async function estado() {
    return Promise.all([
      prisma.produto.findMany({ orderBy: { id_produto: "asc" } }),
      prisma.produto_imagem.findMany({ orderBy: { id_imagem: "asc" } }),
      prisma.vinculo_condominio.findMany({ orderBy: { id_vinculo: "asc" } }),
      prisma.categoria_produto.findMany({ orderBy: { id_categoria: "asc" } }),
      prisma.auditoria.count(),
    ]);
  }
  const antes = await estado();
  await consultar(morador);
  await consultar(superAdmin, `?id_condominio=${condominioB}&busca=tenant`);
  assert.deepEqual(await estado(), antes);
});

test("conta global suspensa mantém 403 inclusive para super admin", async () => {
  for (const id of [morador, superAdmin]) {
    await prisma.usuario.update({ where: { id_usuario: id }, data: { status_conta: "SUSPENSA" } });
    try {
      const resposta = await fetch(`${base}/produtos?id_condominio=${condominioA}`, { headers: await headers(id) });
      assert.equal(resposta.status, 403);
      assert.equal((await resposta.json()).erro, "ACCOUNT_SUSPENDED");
    } finally { await prisma.usuario.update({ where: { id_usuario: id }, data: { status_conta: "ATIVA" } }); }
  }
});

test("suspensão real do vendedor remove produto da vitrine sem desativá-lo e nega acesso ao vendedor", async () => {
  const vizinho = await criarMorador();
  const nome = `Dinâmico ${randomUUID()}`;
  const produto = await criarProduto(vizinho.vinculo.id_vinculo, categoriaAlimentos, nome);
  const query = `?busca=${encodeURIComponent(nome)}`;
  assert.deepEqual((await consultar(morador, query)).dados.map((item) => item.id_produto), [produto.id_produto]);
  const suspensao = await fetch(`${base}/admin/vinculos/${vizinho.vinculo.id_vinculo}/suspender`, { method: "PATCH", headers: await headers(admin) });
  assert.equal(suspensao.status, 200);
  assert.deepEqual((await consultar(morador, query)).dados, []);
  assert.deepEqual(await prisma.produto.findUniqueOrThrow({ where: { id_produto: produto.id_produto } }), produto);
  const negada = await fetch(`${base}/produtos`, { headers: await headers(vizinho.id) });
  assert.equal(negada.status, 403);
  assert.equal((await negada.json()).erro, "MEMBERSHIP_REQUIRED");
});

test("Storage recebe apenas imagens autorizadas, excluindo outro tenant, vendedor suspenso, produto e categoria inativos", async () => {
  const idCondominio = randomUUID();
  await prisma.condominio.create({ data: { id_condominio: idCondominio, nome_residencial: "Assinatura isolada", cep: "70000000", endereco: "Rua" } });
  const residente = await criarMorador("ATIVO", idCondominio);
  const suspenso = await criarMorador("SUSPENSO", idCondominio);
  const autorizado = await criarProduto(residente.vinculo.id_vinculo, categoriaAlimentos, "Autorizado");
  const excluidos = [
    await criarProduto(residente.vinculo.id_vinculo, categoriaAlimentos, "Inativo", { ativo: false }),
    await criarProduto(residente.vinculo.id_vinculo, categoriaInativa, "Categoria inativa"),
    await criarProduto(suspenso.vinculo.id_vinculo, categoriaAlimentos, "Suspenso"),
    produtoB,
  ];
  const pathPermitido = `privado/${randomUUID()}.png`;
  await prisma.produto_imagem.create({ data: { id_produto: autorizado.id_produto, storage_path: pathPermitido } });
  for (const produto of excluidos) {
    await prisma.produto_imagem.create({ data: { id_produto: produto.id_produto, storage_path: `privado/${randomUUID()}.png` } });
  }
  const antes = storage.assinar.mock.callCount();
  const resultado = await consultar(residente.id);
  assert.deepEqual(resultado.dados.map((p) => p.id_produto), [autorizado.id_produto]);
  assert.equal(storage.assinar.mock.callCount(), antes + 1);
  assert.deepEqual(storage.assinar.mock.calls.at(-1)!.arguments, [[pathPermitido], 600]);
});

test("imagens são ordenadas por ordem e UUID, com lote único somente da página", async () => {
  const idCategoria = randomUUID();
  await prisma.categoria_produto.create({ data: { id_categoria: idCategoria, nome: `Imagens ${randomUUID()}` } });
  const primeiro = await criarProduto(vendedor.vinculo.id_vinculo, idCategoria, "Primeiro", { created_at: new Date("2026-10-15T21:00:00Z") });
  const segundo = await criarProduto(vendedor.vinculo.id_vinculo, idCategoria, "Segundo");
  for (const ordem of [2, 0, 1, 1]) {
    await prisma.produto_imagem.create({ data: { id_produto: primeiro.id_produto, storage_path: `privado/${randomUUID()}.png`, ordem } });
  }
  await prisma.produto_imagem.create({ data: { id_produto: segundo.id_produto, storage_path: `privado/${randomUUID()}.png` } });
  const imagens = await prisma.produto_imagem.findMany({ where: { id_produto: primeiro.id_produto }, orderBy: [{ ordem: "asc" }, { id_imagem: "asc" }] });
  const antes = storage.assinar.mock.callCount();
  const resultado = await consultar(morador, `?id_categoria=${idCategoria}&limite=1`);
  assert.equal(storage.assinar.mock.callCount(), antes + 1);
  assert.deepEqual(storage.assinar.mock.calls.at(-1)!.arguments, [imagens.map((i) => i.storage_path), 600]);
  assert.deepEqual(resultado.dados[0].imagens.map((i) => i.id_imagem), imagens.map((i) => i.id_imagem));
  assert.deepEqual(resultado.dados[0].imagens.map((i) => i.ordem), [0, 1, 1, 2]);
  assert.equal(resultado.paginacao.total, 2);
  const chamadas = storage.assinar.mock.callCount();
  assert.deepEqual((await consultar(morador, `?id_categoria=${idCategoria}&pagina=3&limite=1`)).dados, []);
  assert.equal(storage.assinar.mock.callCount(), chamadas);
});

test("path órfão é omitido sem remover registro, produto ou imagem válida", async () => {
  const produto = await criarProduto(vendedor.vinculo.id_vinculo, categoriaAlimentos, `Órfão ${randomUUID()}`);
  const ausente = await prisma.produto_imagem.create({ data: { id_produto: produto.id_produto, storage_path: `privado/${randomUUID()}.png` } });
  const valida = await prisma.produto_imagem.create({ data: { id_produto: produto.id_produto, storage_path: `privado/${randomUUID()}.png`, ordem: 1 } });
  storage.ausentes.add(ausente.storage_path);
  const log = mock.method(console, "error", () => {});
  try {
    const resultado = await consultar(morador, `?busca=${encodeURIComponent(produto.nome_produto)}`);
    assert.equal(resultado.dados.length, 1);
    assert.deepEqual(resultado.dados[0].imagens.map((i) => i.id_imagem), [valida.id_imagem]);
    assert.equal(log.mock.callCount(), 1);
    assert.deepEqual(await prisma.produto_imagem.findUnique({ where: { id_imagem: ausente.id_imagem } }), ausente);
    assert.deepEqual(await prisma.produto.findUnique({ where: { id_produto: produto.id_produto } }), produto);
  } finally {
    storage.ausentes.delete(ausente.storage_path);
    log.mock.restore();
  }
});

async function detalhe(idProduto: string, ator: string = morador, query = "") {
  const r = await fetch(`${base}/produtos/${idProduto}${query}`, { headers: await headers(ator) });
  return { status: r.status, body: await r.json() };
}
test("detalhe por ID permite recarregar produto com imagens assinadas e campos mínimos", async () => {
  const r = await detalhe(bolo.id_produto); assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body), ["dados"]);
  assert.equal(r.body.dados.id_produto, bolo.id_produto); assert.equal(r.body.dados.preco, "25.00");
  assert.equal(r.body.dados.imagens[0].expires_in, 600);
  assert.equal((await detalhe(pao.id_produto)).body.dados.estoque, 0);
  assert.doesNotMatch(JSON.stringify(r.body), /cpf|data_nascimento|email|storage_path|id_condomino|id_usuario/);
  assert.equal((await detalhe("invalido")).status, 400);
  assert.equal((await detalhe(bolo.id_produto, morador, "?pagina=1")).status, 400);
  assert.equal((await detalhe(bolo.id_produto, morador, `?id_condominio=${condominioB}`)).status, 403);
  assert.equal((await detalhe(randomUUID())).status, 404);
  assert.equal((await detalhe(produtoB.id_produto)).status, 404);
  assert.equal((await fetch(`${base}/produtos/${bolo.id_produto}`)).status, 401);
});

test("detalhe admite inativo/categoria inativa somente do vínculo próprio atual, sem ampliar super admin", async () => {
  const inativo = await criarProduto(vendedor.vinculo.id_vinculo, categoriaInativa, "Edição por ID", { ativo: false });
  assert.equal((await detalhe(inativo.id_produto, vendedor.id)).status, 200);
  assert.equal((await detalhe(inativo.id_produto)).status, 404);
  assert.equal((await detalhe(inativo.id_produto, superAdmin, `?id_condominio=${condominioA}`)).status, 404);
  assert.equal((await detalhe(bolo.id_produto, superAdmin)).status, 400);
  assert.equal((await detalhe(bolo.id_produto, superAdmin, `?id_condominio=${condominioA}`)).status, 200);
  assert.equal((await detalhe(bolo.id_produto, superAdmin, `?id_condominio=${condominioB}`)).status, 404);
  assert.equal((await detalhe(bolo.id_produto, superAdmin, `?id_condominio=${condominioInativo}`)).status, 404);
  const antigo = await criarMorador("ENCERRADO");
  const historico = await criarProduto(antigo.vinculo.id_vinculo, categoriaAlimentos, "Vínculo anterior");
  await prisma.vinculo_condominio.create({ data: { id_condomino: antigo.id, id_condominio: condominioA, moradia: "Nova", status_vinculo: "ATIVO" } });
  assert.equal((await detalhe(historico.id_produto, antigo.id)).status, 404);
  const suspenso = await criarMorador("SUSPENSO");
  assert.equal((await detalhe(bolo.id_produto, suspenso.id)).status, 403);
  await prisma.usuario.update({ where: { id_usuario: suspenso.id }, data: { status_conta: "SUSPENSA" } });
  const negado = await detalhe(bolo.id_produto, suspenso.id); assert.equal(negado.status, 403); assert.equal(negado.body.erro, "ACCOUNT_SUSPENDED");
});
