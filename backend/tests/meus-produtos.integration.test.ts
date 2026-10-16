import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createServer, request } from "node:http";
import { after, before, mock, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { Prisma, status_vinculo_enum } from "../src/generated/prisma/client.js";
import type { MeusProdutos, ResultadoCriacaoProduto, VitrineProdutos } from "../src/modules/produtos/produto.model.js";

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
const jwk = { ...await exportJWK(chaves.publicKey), kid: "meus-produtos-teste", alg: "ES256", use: "sig" };
const servidor = createServer(app);
const condominioA = randomUUID();
const condominioB = randomUUID();
const categoriaAlimentos = randomUUID();
const categoriaUtensilios = randomUUID();
const categoriaInativa = randomUUID();
let base: string;
let morador: Awaited<ReturnType<typeof criarMorador>>;
let vizinho: Awaited<ReturnType<typeof criarMorador>>;
let admin: Awaited<ReturnType<typeof criarMorador>>;
let moradorB: Awaited<ReturnType<typeof criarMorador>>;
let superAdmin: string;
let produtos: Awaited<ReturnType<typeof criarProduto>>[];
let alheios: Awaited<ReturnType<typeof criarProduto>>[];

async function criarMorador(status: status_vinculo_enum = "ATIVO", idCondominio: string = condominioA, administrador = false) {
  const id = randomUUID();
  await prisma.usuario.create({ data: { id_usuario: id, email: `${id}@exemplo.com` } });
  await prisma.condomino.create({ data: {
    id_condomino: id, nome_completo: "Morador Meus Produtos",
    cpf: String(randomInt(0, 100_000_000_000)).padStart(11, "0"), data_nascimento: new Date("2000-05-20T00:00:00Z"),
  } });
  const vinculo = await prisma.vinculo_condominio.create({ data: {
    id_condomino: id, id_condominio: idCondominio, status_vinculo: status,
    admin_condominio: administrador, moradia: "Apto 101",
  } });
  return { id, vinculo };
}

async function criarProduto(idVinculo: string, idCategoria: string, nome: string, alteracoes: Partial<Prisma.produtoUncheckedCreateInput> = {}) {
  return prisma.produto.create({ data: {
    id_vinculo_vendedor: idVinculo, id_categoria: idCategoria, nome_produto: nome,
    descricao: "Caseiro fresco", preco: "25.90", estoque: 4,
    created_at: new Date("2026-10-15T20:00:00Z"), ...alteracoes,
  } });
}

async function headers(id: string, forjarPrivilegios = false) {
  const token = await new SignJWT(forjarPrivilegios ? { super_admin: true, user_metadata: { super_admin: true } } : {})
    .setProtectedHeader({ alg: "ES256", kid: jwk.kid }).setSubject(id)
    .setIssuer("https://teste.supabase.co/auth/v1").setAudience("authenticated").setExpirationTime("5m").sign(chaves.privateKey);
  return { Authorization: `Bearer ${token}` };
}

async function consultar(id: string, query = "") {
  const resposta = await fetch(`${base}/produtos/me${query}`, { headers: await headers(id) });
  assert.equal(resposta.status, 200);
  const resultado = await resposta.json() as MeusProdutos;
  assert.deepEqual(Object.keys(resultado).sort(), ["dados", "paginacao"]);
  for (const produto of resultado.dados) {
    assert.deepEqual(Object.keys(produto).sort(), ["id_produto", "nome_produto", "descricao", "preco", "estoque", "ativo", "created_at", "updated_at", "categoria", "imagens"].sort());
    assert.deepEqual(Object.keys(produto.categoria).sort(), ["id_categoria", "nome", "ativo"].sort());
    assert.match(produto.preco, /^\d+\.\d{2}$/);
    assert.equal(new Date(produto.created_at).toISOString(), produto.created_at);
    assert.equal(new Date(produto.updated_at).toISOString(), produto.updated_at);
  }
  return resultado;
}

before(async () => {
  const fetchOriginal = globalThis.fetch;
  mock.method(globalThis, "fetch", async (...args: Parameters<typeof fetch>) =>
    String(args[0]) === "https://teste.supabase.co/auth/v1/.well-known/jwks.json"
      ? new globalThis.Response(JSON.stringify({ keys: [jwk] }), { status: 200 }) : fetchOriginal(...args));
  await prisma.condominio.createMany({ data: [
    { id_condominio: condominioA, nome_residencial: "Meus Produtos A", cep: "70000000", endereco: "Rua A" },
    { id_condominio: condominioB, nome_residencial: "Meus Produtos B", cep: "70000001", endereco: "Rua B" },
  ] });
  await prisma.categoria_produto.createMany({ data: [
    { id_categoria: categoriaAlimentos, nome: `Alimentos ${randomUUID()}` },
    { id_categoria: categoriaUtensilios, nome: `Utensílios ${randomUUID()}` },
    { id_categoria: categoriaInativa, nome: `Inativa ${randomUUID()}`, ativo: false },
  ] });
  morador = await criarMorador();
  vizinho = await criarMorador();
  admin = await criarMorador("ATIVO", condominioA, true);
  moradorB = await criarMorador("ATIVO", condominioB);
  superAdmin = randomUUID();
  await prisma.usuario.create({ data: { id_usuario: superAdmin, email: `${superAdmin}@exemplo.com` } });
  await prisma.super_admin.create({ data: { id_super_admin: superAdmin } });
  produtos = [
    await criarProduto(morador.vinculo.id_vinculo, categoriaAlimentos, "Bolo de cenoura"),
    await criarProduto(morador.vinculo.id_vinculo, categoriaAlimentos, "Bolo pausado", { ativo: false, preco: "12.30" }),
    await criarProduto(morador.vinculo.id_vinculo, categoriaUtensilios, "Caneca", { estoque: 0, created_at: new Date("2026-10-14T20:00:00Z") }),
    await criarProduto(morador.vinculo.id_vinculo, categoriaInativa, "Livro antigo", { created_at: new Date("2026-10-13T20:00:00Z") }),
    await criarProduto(morador.vinculo.id_vinculo, categoriaInativa, "Peça antiga", { ativo: false, created_at: new Date("2026-10-12T20:00:00Z") }),
    await criarProduto(morador.vinculo.id_vinculo, categoriaAlimentos, "Doce especial", { descricao: "Bolo de baunilha caseiro", created_at: new Date("2026-10-11T20:00:00Z") }),
  ].sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || a.id_produto.localeCompare(b.id_produto));
  alheios = [
    await criarProduto(vizinho.vinculo.id_vinculo, categoriaAlimentos, "Bolo Especial", { descricao: "Exclusivo de outro vendedor" }),
    await criarProduto(moradorB.vinculo.id_vinculo, categoriaAlimentos, "Bolo Especial", { descricao: "Exclusivo de outro condomínio" }),
  ];
  await criarProduto(admin.vinculo.id_vinculo, categoriaAlimentos, "Produto do administrador");
  for (const produto of [...produtos, ...alheios]) {
    await prisma.produto_imagem.create({ data: { id_produto: produto.id_produto, storage_path: `privado/${randomUUID()}.png` } });
  }
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
  for (const cabecalhos of [{}, { Authorization: "Bearer invalido" }] as Record<string, string>[]) {
    const resposta = await fetch(`${base}/produtos/me`, { headers: cabecalhos });
    assert.equal(resposta.status, 401);
    assert.equal((await resposta.json()).erro, "UNAUTHENTICATED");
  }
});

test("sem onboarding, estados não ativos e super admin recebem 403, inclusive tentando impersonation", async () => {
  const ids = [randomUUID(), superAdmin];
  for (const status of ["PENDENTE", "REJEITADO", "SUSPENSO", "ENCERRADO"] as const) ids.push((await criarMorador(status, condominioA, true)).id);
  for (const id of ids) {
    const resposta = await fetch(`${base}/produtos/me?id_vinculo_vendedor=${morador.vinculo.id_vinculo}`, { headers: await headers(id, true) });
    assert.equal(resposta.status, 403);
    assert.equal((await resposta.json()).erro, "MEMBERSHIP_REQUIRED");
  }
});

test("conta global suspensa continua bloqueada mesmo com vínculo ativo", async () => {
  await prisma.usuario.update({ where: { id_usuario: morador.id }, data: { status_conta: "SUSPENSA" } });
  try {
    const resposta = await fetch(`${base}/produtos/me`, { headers: await headers(morador.id) });
    assert.equal(resposta.status, 403);
    assert.equal((await resposta.json()).erro, "ACCOUNT_SUSPENDED");
  } finally {
    await prisma.usuario.update({ where: { id_usuario: morador.id }, data: { status_conta: "ATIVA" } });
  }
});

test("vendedor sem produtos e categoria UUID inexistente retornam coleção vazia", async () => {
  const vazio = await criarMorador();
  const esperado = { dados: [], paginacao: { pagina: 1, limite: 20, total: 0, total_paginas: 0 } };
  assert.deepEqual(await consultar(vazio.id), esperado);
  assert.deepEqual(await consultar(morador.id, `?id_categoria=${randomUUID()}`), esperado);
});

test("lista ativos e inativos, categoria inativa e estoque zero somente do vínculo atual", async () => {
  const resultado = await consultar(morador.id);
  assert.deepEqual(resultado.dados.map((item) => item.id_produto), produtos.map((item) => item.id_produto));
  assert.deepEqual(resultado.paginacao, { pagina: 1, limite: 20, total: 6, total_paginas: 1 });
  assert.ok(resultado.dados.some((item) => !item.ativo));
  assert.ok(resultado.dados.some((item) => item.estoque === 0));
  assert.ok(resultado.dados.some((item) => !item.categoria.ativo));
  for (const alheio of alheios) assert.ok(!resultado.dados.some((item) => item.id_produto === alheio.id_produto));
});

test("ativo=true e ativo=false restringem itens e totais sem ocultar categoria inativa", async () => {
  for (const ativo of [true, false]) {
    const resultado = await consultar(morador.id, `?ativo=${ativo}`);
    const esperados = produtos.filter((item) => item.ativo === ativo);
    assert.deepEqual(resultado.dados.map((item) => item.id_produto), esperados.map((item) => item.id_produto));
    assert.equal(resultado.paginacao.total, esperados.length);
    assert.ok(resultado.dados.some((item) => !item.categoria.ativo));
  }
});

test("query inválida, repetida e campos de autoridade retornam 400", async () => {
  for (const query of [
    "ativo=1", "ativo=sim", "ativo=yes", "ativo=abc", "ativo=TRUE", "ativo=", "ativo=true&ativo=false",
    "pagina=0", "pagina=1.5", "pagina=-1", "pagina=1e2", "limite=0", "limite=101", "limite=1&limite=2",
    "pagina=2147483647&limite=100", "id_categoria=abc", `busca=${"x".repeat(141)}`,
    `id_vinculo_vendedor=${vizinho.vinculo.id_vinculo}`, `id_vinculo=${vizinho.vinculo.id_vinculo}`,
    `id_usuario=${vizinho.id}`, `id_condominio=${condominioB}`, `categoria=${categoriaAlimentos}`,
  ]) {
    const resposta = await fetch(`${base}/produtos/me?${query}`, { headers: await headers(morador.id) });
    assert.equal(resposta.status, 400, query);
    assert.equal((await resposta.json()).erro, "VALIDATION_ERROR");
  }
});

test("busca com trim e sem diferenciar caixa encontra nome e descrição sem escapar ownership", async () => {
  const resultado = await consultar(morador.id, "?busca=%20%20BOLO%20%20");
  assert.deepEqual(resultado.dados.map((item) => item.id_produto), produtos.filter((item) => item.nome_produto.toLowerCase().includes("bolo") || item.descricao.toLowerCase().includes("bolo")).map((item) => item.id_produto));
  assert.deepEqual((await consultar(morador.id, "?busca=Bolo%20Especial")).dados, []);
  assert.deepEqual(await consultar(morador.id, "?busca=%20%20"), await consultar(morador.id));
});

test("categoria e filtros combinados usam AND com vínculo e busca", async () => {
  const categoria = await consultar(morador.id, `?id_categoria=${categoriaAlimentos}`);
  assert.deepEqual(categoria.dados.map((item) => item.id_produto), produtos.filter((item) => item.id_categoria === categoriaAlimentos).map((item) => item.id_produto));
  const combinado = await consultar(morador.id, `?ativo=false&id_categoria=${categoriaAlimentos}&busca=BOLO`);
  assert.deepEqual(combinado.dados.map((item) => item.nome_produto), ["Bolo pausado"]);
  assert.equal(combinado.paginacao.total, 1);
  assert.equal((await consultar(morador.id, `?id_categoria=${categoriaInativa}`)).paginacao.total, 2);
});

test("paginação mantém ordem estável, total filtrado e página além do fim", async () => {
  for (const pagina of [1, 2, 3, 4]) {
    const resultado = await consultar(morador.id, `?pagina=${pagina}&limite=2`);
    assert.deepEqual(resultado.dados.map((item) => item.id_produto), produtos.slice((pagina - 1) * 2, pagina * 2).map((item) => item.id_produto));
    assert.deepEqual(resultado.paginacao, { pagina, limite: 2, total: 6, total_paginas: 3 });
  }
  const filtrado = await consultar(morador.id, "?ativo=false&pagina=2&limite=1");
  assert.deepEqual(filtrado.paginacao, { pagina: 2, limite: 1, total: 2, total_paginas: 2 });
  assert.equal(filtrado.dados[0].nome_produto, "Peça antiga");
});

test("admin local enxerga somente seus próprios produtos", async () => {
  const resultado = await consultar(admin.id);
  assert.deepEqual(resultado.dados.map((item) => item.nome_produto), ["Produto do administrador"]);
  assert.equal(resultado.paginacao.total, 1);
});

test("vínculos antigos da mesma pessoa não entram na listagem atual", async () => {
  for (const status of ["ENCERRADO", "SUSPENSO"] as const) {
    const antigo = await prisma.vinculo_condominio.create({ data: {
      id_condomino: morador.id, id_condominio: condominioB, moradia: "Anterior", status_vinculo: status,
    } });
    await criarProduto(antigo.id_vinculo, categoriaAlimentos, `Bolo histórico ${status}`);
  }
  assert.deepEqual((await consultar(morador.id)).dados.map((item) => item.id_produto), produtos.map((item) => item.id_produto));
  assert.deepEqual((await consultar(morador.id, "?busca=histórico")).dados, []);
});

test("vitrine preserva suas regras enquanto meus produtos mantém anúncios e categorias inativos", async () => {
  const resposta = await fetch(`${base}/produtos`, { headers: await headers(morador.id) });
  assert.equal(resposta.status, 200);
  const vitrine = await resposta.json() as VitrineProdutos;
  const idsVitrine = new Set(vitrine.dados.map((item) => item.id_produto));
  for (const produto of produtos) {
    assert.equal(idsVitrine.has(produto.id_produto), produto.ativo && produto.id_categoria !== categoriaInativa);
  }
  assert.equal((await consultar(morador.id)).dados.length, 6);
});

test("produto criado via POST aparece em meus produtos com a mesma representação monetária", async () => {
  const vendedor = await criarMorador();
  const criacao = await fetch(`${base}/produtos`, {
    method: "POST", headers: { ...await headers(vendedor.id), "Content-Type": "application/json" },
    body: JSON.stringify({ id_categoria: categoriaAlimentos, nome_produto: "Novo anúncio", descricao: "Publicado agora", preco: "1.5", estoque: 0 }),
  });
  assert.equal(criacao.status, 201);
  const criado = await criacao.json() as ResultadoCriacaoProduto;
  const resultado = await consultar(vendedor.id);
  assert.equal(resultado.dados.length, 1);
  assert.equal(resultado.dados[0].id_produto, criado.dados.id_produto);
  assert.equal(resultado.dados[0].preco, "1.50");
});

test("suspensão administrativa bloqueia meus produtos sem apagar registros", async () => {
  const vendedor = await criarMorador();
  const produto = await criarProduto(vendedor.vinculo.id_vinculo, categoriaAlimentos, "Preservado");
  assert.equal((await consultar(vendedor.id)).dados[0].id_produto, produto.id_produto);
  const suspensao = await fetch(`${base}/admin/vinculos/${vendedor.vinculo.id_vinculo}/suspender`, { method: "PATCH", headers: await headers(admin.id) });
  assert.equal(suspensao.status, 200);
  const resposta = await fetch(`${base}/produtos/me`, { headers: await headers(vendedor.id) });
  assert.equal(resposta.status, 403);
  assert.equal((await resposta.json()).erro, "MEMBERSHIP_REQUIRED");
  assert.equal((await prisma.produto.findUniqueOrThrow({ where: { id_produto: produto.id_produto } })).ativo, true);
});

test("body não é aceito como fonte alternativa de vendedor", async () => {
  const dados = JSON.stringify({ id_vinculo_vendedor: vizinho.vinculo.id_vinculo });
  const cabecalhos = await headers(morador.id);
  const resposta = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
    const req = request(`${base}/produtos/me`, {
      method: "GET", headers: { ...cabecalhos, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(dados) },
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (parte: string) => { body += parte; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end(dados);
  });
  assert.equal(resposta.status, 400);
  assert.equal(JSON.parse(resposta.body).erro, "VALIDATION_ERROR");
});

test("produtos próprios ativos, inativos e de categoria inativa recebem imagens; paths alheios não são assinados", async () => {
  const imagens = await prisma.produto_imagem.findMany({ where: { id_produto: { in: produtos.map((p) => p.id_produto) } } });
  const antes = storage.assinar.mock.callCount();
  const resultado = await consultar(morador.id);
  assert.equal(storage.assinar.mock.callCount(), antes + 1);
  assert.deepEqual(new Set(storage.assinar.mock.calls.at(-1)!.arguments[0]), new Set(imagens.map((i) => i.storage_path)));
  for (const produto of resultado.dados) {
    assert.equal(produto.imagens.length, 1);
    assert.equal(produto.imagens[0].expires_in, 600);
    assert.equal(produto.imagens[0].id_imagem, imagens.find((i) => i.id_produto === produto.id_produto)!.id_imagem);
    assert.match(produto.imagens[0].url, /^https:\/\/storage\.exemplo\.com\//);
  }
  assert.doesNotMatch(JSON.stringify(resultado), /storage_path/);
  const inativos = await consultar(morador.id, "?ativo=false");
  assert.ok(inativos.dados.length > 0);
  assert.ok(inativos.dados.every((p) => !p.ativo && p.imagens.length === 1));
});

test("listagem própria assina somente a página atual e não chama Storage em página vazia", async () => {
  const antes = storage.assinar.mock.callCount();
  const resultado = await consultar(morador.id, "?pagina=2&limite=1");
  const imagens = await prisma.produto_imagem.findMany({ where: { id_produto: resultado.dados[0].id_produto } });
  assert.equal(storage.assinar.mock.callCount(), antes + 1);
  assert.deepEqual(storage.assinar.mock.calls.at(-1)!.arguments[0], imagens.map((i) => i.storage_path));
  const chamadas = storage.assinar.mock.callCount();
  assert.deepEqual((await consultar(morador.id, "?pagina=100&limite=1")).dados, []);
  assert.equal(storage.assinar.mock.callCount(), chamadas);
});

test("várias leituras próprias não persistem signed URLs nem modificam metadados", async () => {
  const consultarMetadados = () => prisma.produto_imagem.findMany({ where: { id_produto: { in: produtos.map((p) => p.id_produto) } }, orderBy: { id_imagem: "asc" } });
  const antes = await consultarMetadados();
  for (let i = 0; i < 3; i++) await consultar(morador.id);
  assert.deepEqual(await consultarMetadados(), antes);
  assert.ok(antes.every((i) => !i.storage_path.includes("https://")));
});
