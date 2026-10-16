import assert from "node:assert/strict";
import { after, afterEach, mock, test } from "node:test";
import type { Request, Response } from "express";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { Prisma as TiposPrisma } from "../src/generated/prisma/client.js";

// Ambiente isolado: os testes não usam credenciais reais nem acessam serviços externos.
process.env.DATABASE_URL = "postgresql://teste:teste@localhost:5432/teste";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.SUPABASE_URL = "https://teste.supabase.co";
process.env.SUPABASE_SECRET_KEY = "chave-apenas-para-testes";

const { prisma } = await import("../src/lib/prisma.js");
const { supabaseAdmin } = await import("../src/lib/supabase.js");
const { assinarImagensProdutos } = await import("../src/lib/storage.js");
const { Prisma } = await import("../src/generated/prisma/client.js");
const { listarProdutosQuerySchema } = await import("../src/modules/produtos/produto.schema.js");
const { listarVitrineProdutos } = await import("../src/modules/produtos/produto.service.js");
const { listarProdutosController } = await import("../src/modules/produtos/produto.controller.js");
const { autenticar } = await import("../src/middlewares/autenticar.js");
const { validarQuery } = await import("../src/middlewares/validar.js");
const { errorHandler } = await import("../src/middlewares/error-handler.js");
const { ErroDominio } = await import("../src/lib/erro-dominio.js");

const idUsuario = "10000000-0000-4000-8000-000000000001";
const idCondominio = "20000000-0000-4000-8000-000000000001";
const idCategoria = "30000000-0000-4000-8000-000000000001";
const vinculo = { id_vinculo: "40000000-0000-4000-8000-000000000001", id_condominio: idCondominio, admin_condominio: false };
const auth = { id_usuario: idUsuario, super_admin: false, vinculo_ativo: vinculo };
const chaves = await generateKeyPair("ES256");
const chavePublica = { ...await exportJWK(chaves.publicKey), kid: "teste", alg: "ES256", use: "sig" };

const restaurarMetodos: (() => void)[] = [];
function simularMetodo<T extends (...args: never[]) => unknown>(objeto: object, nome: string, implementacao: T) {
  const original: unknown = Reflect.get(objeto, nome);
  const simulado = mock.fn(implementacao);
  // Delegates Prisma são proxies; mock.method não encontra seus descriptors de métodos.
  Reflect.set(objeto, nome, simulado);
  restaurarMetodos.push(() => { Reflect.set(objeto, nome, original); });
  return simulado;
}

function restaurarMocks() {
  for (const restaurar of restaurarMetodos.splice(0).reverse()) restaurar();
  mock.restoreAll();
}
afterEach(restaurarMocks);
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

test("query aplica defaults, trim, UUIDs, limite 100 e normaliza o filtro legado de categoria", () => {
  assert.deepEqual(listarProdutosQuerySchema.parse({}), { pagina: 1, limite: 20 });
  assert.deepEqual(listarProdutosQuerySchema.parse({ pagina: "2", limite: "100", busca: "  pão  ", id_categoria: idCategoria, id_condominio: idCondominio }),
    { pagina: 2, limite: 100, busca: "pão", id_categoria: idCategoria, id_condominio: idCondominio });
  assert.deepEqual(listarProdutosQuerySchema.parse({ categoria: idCategoria }), { pagina: 1, limite: 20, id_categoria: idCategoria });
  assert.equal(listarProdutosQuerySchema.parse({ id_categoria: idCategoria, categoria: idCategoria }).id_categoria, idCategoria);
  assert.equal(listarProdutosQuerySchema.parse({ busca: "   " }).busca, undefined);
  assert.equal(listarProdutosQuerySchema.parse({ busca: "" }).busca, undefined);
  for (const query of [
    { pagina: "0" }, { pagina: "abc" }, { pagina: "1.5" }, { pagina: "1e2" }, { limite: "101" }, { limite: "0" }, { limite: "" },
    { limite: ["20", "50"] }, { categoria: "invalida" }, { id_categoria: "abc" }, { busca: ["a", "b"] }, { busca: "a".repeat(141) },
    { id_condominio: "abc" }, { id_condominio: [idCondominio, idCondominio] }, { pagina: "2147483647", limite: "100" },
    { id_produto: idUsuario }, { id_categoria: idCategoria, categoria: idUsuario },
  ]) {
    assert.equal(listarProdutosQuerySchema.safeParse(query).success, false, JSON.stringify(query));
  }
});

test("validação HTTP rejeita query inválida antes do controller", () => {
  const { res, resultado } = respostaFake();
  const next = mock.fn();
  validarQuery(listarProdutosQuerySchema)({ query: { id_condominio: "abc" } } as unknown as Request, res, next);
  assert.equal(resultado.status, 400);
  assert.equal(next.mock.callCount(), 0);
  assert.equal((resultado.body as { erro: string }).erro, "VALIDATION_ERROR");
});

test("service exige vínculo do morador ou condomínio explícito do super admin antes de consultar produtos", async () => {
  const consulta = simularMetodo(prisma.produto, "findMany", () => { throw new Error("Não deve consultar produtos"); });
  for (const [contexto, codigo, status] of [
    [undefined, "UNAUTHENTICATED", 401],
    [{ id_usuario: idUsuario, super_admin: false }, "MEMBERSHIP_REQUIRED", 403],
    [{ id_usuario: idUsuario, super_admin: true }, "CONDOMINIUM_REQUIRED", 400],
    [{ ...auth, super_admin: true }, "CONDOMINIUM_REQUIRED", 400],
  ] as const) {
    await assert.rejects(listarVitrineProdutos(contexto, listarProdutosQuerySchema.parse({})), (erro: unknown) => {
      assert.ok(erro instanceof ErroDominio);
      assert.equal(erro.codigo, codigo);
      assert.equal(erro.statusHttp, status);
      return true;
    });
  }
  assert.equal(consulta.mock.callCount(), 0);
});

function simularProdutos(produtos: unknown[] = [], total = 0) {
  const listar = simularMetodo(prisma.produto, "findMany", async (_args: TiposPrisma.produtoFindManyArgs) => produtos);
  const contar = simularMetodo(prisma.produto, "count", async (_args: TiposPrisma.produtoCountArgs) => total);
  const transacao = simularMetodo(prisma, "$transaction", async (consultas: Promise<unknown>[], _opcoes: { isolationLevel: string }) => Promise.all(consultas));
  return { listar, contar, transacao };
}

function simularAssinatura() {
  const bucket = simularMetodo(supabaseAdmin.storage, "getBucket", async (_nome: string) => ({ data: { public: false }, error: null }));
  const assinar = mock.fn(async (paths: string[], _expiresIn: number) => ({
    data: [...paths].reverse().map((path) => ({ path, error: null, signedUrl: `https://storage.exemplo.com/${path}?token=ficticio` })), error: null,
  }));
  const from = simularMetodo(supabaseAdmin.storage, "from", (_nome: string) => ({ createSignedUrls: assinar }));
  return { bucket, assinar, from };
}

function produtoComImagens(imagens: { id_imagem: string; ordem: number; storage_path: string }[] = []) {
  return {
    id_produto: "50000000-0000-4000-8000-000000000001",
    nome_produto: "Bolo", descricao: "Caseiro", preco: new Prisma.Decimal("25.90"), estoque: 4,
    created_at: new Date("2026-10-15T20:00:00Z"),
    categoria_produto: { id_categoria: idCategoria, nome: "Alimentos" },
    vinculo_condominio: { id_vinculo: vinculo.id_vinculo, moradia: "Apto 101", condomino: { nome_completo: "Vendedor" } },
    produto_imagem: imagens,
  };
}

test("produto sem imagem e página vazia não chamam Storage", async () => {
  const storage = simularAssinatura();
  simularProdutos([produtoComImagens()], 1);
  const resposta = await listarVitrineProdutos(auth, listarProdutosQuerySchema.parse({}));
  assert.deepEqual(resposta.dados[0].imagens, []);
  simularProdutos([], 100);
  assert.deepEqual((await listarVitrineProdutos(auth, listarProdutosQuerySchema.parse({ pagina: "100" }))).dados, []);
  assert.equal(storage.bucket.mock.callCount(), 0);
  assert.equal(storage.from.mock.callCount(), 0);
});

test("assina paths deduplicados da página em um lote e associa por path preservando ordem", async () => {
  const storage = simularAssinatura();
  const imagens = [0, 1, 2].map((ordem) => ({ id_imagem: `imagem-${ordem}`, ordem, storage_path: `privado/${ordem}.png` }));
  const { listar } = simularProdutos([produtoComImagens(imagens), { ...produtoComImagens([imagens[0]]), id_produto: "outro" }], 50);
  const consultaImagem = simularMetodo(prisma.produto_imagem, "findMany", () => { throw new Error("N+1 proibido"); });
  const resposta = await listarVitrineProdutos(auth, listarProdutosQuerySchema.parse({ pagina: "2", limite: "2" }));
  assert.equal(listar.mock.callCount(), 1);
  assert.equal(consultaImagem.mock.callCount(), 0);
  assert.equal(storage.assinar.mock.callCount(), 1);
  assert.deepEqual(storage.assinar.mock.calls[0].arguments, [imagens.map((i) => i.storage_path), 600]);
  assert.equal(storage.bucket.mock.calls[0].arguments[0], "product-images");
  assert.equal(storage.from.mock.calls[0].arguments[0], "product-images");
  assert.deepEqual(resposta.dados[0].imagens, imagens.map((i) => ({
    id_imagem: i.id_imagem, ordem: i.ordem, url: `https://storage.exemplo.com/${i.storage_path}?token=ficticio`, expires_in: 600,
  })));
  assert.doesNotMatch(JSON.stringify(resposta), /storage_path/);
});

test("falha individual, path ausente e resposta incompleta omitem só a imagem afetada sem logar erro bruto", async () => {
  simularAssinatura();
  const log = mock.method(console, "error", () => {});
  const imagens = [0, 1, 2].map((ordem) => ({ id_imagem: `imagem-${ordem}`, ordem, storage_path: `privado/${ordem}.png` }));
  simularProdutos([produtoComImagens(imagens)], 1);
  simularMetodo(supabaseAdmin.storage, "from", () => ({ createSignedUrls: async () => ({ error: null, data: [
    { path: imagens[1].storage_path, error: null, signedUrl: "https://storage.exemplo.com/valida" },
    { path: imagens[0].storage_path, error: "erro contendo secret e CPF", signedUrl: "https://invalida" },
    { path: "path-nao-solicitado", error: null, signedUrl: "https://alheia" },
  ] }) }));
  const resposta = await listarVitrineProdutos(auth, listarProdutosQuerySchema.parse({}));
  assert.deepEqual(resposta.dados[0].imagens, [{ id_imagem: "imagem-1", ordem: 1, url: "https://storage.exemplo.com/valida", expires_in: 600 }]);
  assert.equal(log.mock.callCount(), 2);
  assert.doesNotMatch(JSON.stringify(log.mock.calls), /secret|CPF|https/);
});

test("falha operacional total retorna produto com imagens vazias e log técnico seguro", async () => {
  simularAssinatura();
  const log = mock.method(console, "error", () => {});
  simularMetodo(supabaseAdmin.storage, "from", () => ({ createSignedUrls: async () => ({ data: null, error: { message: "secret CPF JWT" } }) }));
  simularProdutos([produtoComImagens([{ id_imagem: "imagem", ordem: 0, storage_path: "privado/foto.png" }])], 1);
  const resposta = await listarVitrineProdutos(auth, listarProdutosQuerySchema.parse({}));
  assert.deepEqual(resposta.dados[0].imagens, []);
  assert.equal(resposta.dados[0].preco, "25.90");
  assert.deepEqual(log.mock.calls[0].arguments, [{ evento: "IMAGE_SIGNING_FAILED", causa: "STORAGE_SIGNING_UNAVAILABLE" }]);
});

test("bucket público, ausente ou inacessível impede assinatura", async () => {
  const storage = simularAssinatura();
  mock.method(console, "error", () => {});
  for (const resultado of [
    { data: { public: true }, error: null }, { data: null, error: null }, { data: null, error: { message: "secret" } },
  ]) {
    simularMetodo(supabaseAdmin.storage, "getBucket", async () => resultado);
    assert.equal((await assinarImagensProdutos(["privado/foto.png"])).size, 0);
  }
  assert.equal(storage.assinar.mock.callCount(), 0);
});

test("erros inesperados de programação propagam sem catch genérico", async () => {
  simularAssinatura();
  const erro = new TypeError("Bug de programação");
  simularMetodo(supabaseAdmin.storage, "from", () => ({ createSignedUrls: async () => { throw erro; } }));
  await assert.rejects(assinarImagensProdutos(["privado/foto.png"]), (recebido: unknown) => recebido === erro);
});

test("SDK instalado envia lote e TTL reais e converte signedURL em signedUrl por path", async () => {
  const chamadas = mock.method(globalThis, "fetch", async (input: string | URL | globalThis.Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/bucket/product-images")) {
      return new globalThis.Response(JSON.stringify({ id: "product-images", name: "product-images", public: false }));
    }
    assert.ok(url.endsWith("/object/sign/product-images"));
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), { paths: ["privado/foto.png"], expiresIn: 600 });
    return new globalThis.Response(JSON.stringify([{ path: "privado/foto.png", error: null, signedURL: "/object/sign/product-images/privado/foto.png?token=ficticio" }]));
  });
  const urls = await assinarImagensProdutos(["privado/foto.png"]);
  assert.equal(chamadas.mock.callCount(), 2);
  assert.equal(urls.get("privado/foto.png"), "https://teste.supabase.co/storage/v1/object/sign/product-images/privado/foto.png?token=ficticio");
});

test("SDK transforma falhas HTTP e de rede em resultado operacional sem quebrar listagem", async () => {
  const log = mock.method(console, "error", () => {});
  for (const falha of ["http", "rede"]) {
    const transporte = mock.method(globalThis, "fetch", async (input: string | URL | globalThis.Request) => {
      if (String(input).endsWith("/bucket/product-images")) return new globalThis.Response(JSON.stringify({ public: false }));
      if (falha === "rede") throw new Error("Falha de rede com dados sensíveis");
      return new globalThis.Response(JSON.stringify({ message: "Falha operacional com dados sensíveis" }), { status: 503 });
    });
    assert.equal((await assinarImagensProdutos(["privado/foto.png"])).size, 0);
    transporte.mock.restore();
  }
  assert.equal(log.mock.callCount(), 2);
  assert.doesNotMatch(JSON.stringify(log.mock.calls), /sensíveis/);
});

test("autorização nega tenant e super admin sem vínculo antes de qualquer chamada Storage", async () => {
  const storage = simularAssinatura();
  const { listarMeusProdutos } = await import("../src/modules/produtos/produto.service.js");
  const { listarMeusProdutosQuerySchema } = await import("../src/modules/produtos/produto.schema.js");
  await assert.rejects(listarVitrineProdutos(auth, listarProdutosQuerySchema.parse({ id_condominio: idUsuario })));
  await assert.rejects(listarMeusProdutos({ id_usuario: idUsuario, super_admin: true }, listarMeusProdutosQuerySchema.parse({})));
  assert.equal(storage.bucket.mock.callCount(), 0);
  assert.equal(storage.assinar.mock.callCount(), 0);
});

test("consulta e contagem combinam tenant, categoria ativa e busca nome/descrição com os mesmos filtros", async () => {
  const { listar, contar, transacao } = simularProdutos([], 51);
  const filtros = listarProdutosQuerySchema.parse({ categoria: idCategoria, busca: "PÃO", pagina: "2", limite: "20" });
  const vitrine = await listarVitrineProdutos(auth, filtros);
  const consulta = listar.mock.calls[0].arguments[0];
  assert.deepEqual(consulta.where, {
    ativo: true,
    categoria_produto: { is: { ativo: true } },
    vinculo_condominio: { is: { status_vinculo: "ATIVO", id_condominio: idCondominio } },
    id_categoria: idCategoria,
    OR: [
      { nome_produto: { contains: "PÃO", mode: "insensitive" } },
      { descricao: { contains: "PÃO", mode: "insensitive" } },
    ],
  });
  assert.deepEqual(contar.mock.calls[0].arguments[0].where, consulta.where);
  assert.equal(consulta.skip, 20);
  assert.equal(consulta.take, 20);
  assert.deepEqual(consulta.orderBy, [{ created_at: "desc" }, { id_produto: "asc" }]);
  assert.deepEqual(consulta.select?.vinculo_condominio, { select: { id_vinculo: true, moradia: true, condomino: { select: { nome_completo: true } } } });
  assert.deepEqual(consulta.select?.produto_imagem, { select: { id_imagem: true, storage_path: true, ordem: true }, orderBy: [{ ordem: "asc" }, { id_imagem: "asc" }] });
  assert.deepEqual(transacao.mock.calls[0].arguments[1], { isolationLevel: "RepeatableRead" });
  assert.deepEqual(vitrine.paginacao, { pagina: 2, limite: 20, total: 51, total_paginas: 3 });
});

test("controller retorna card público, preço decimal e imagens preparadas sem storage_path", async () => {
  simularAssinatura();
  simularProdutos([{
    id_produto: "50000000-0000-4000-8000-000000000001",
    nome_produto: "Pão", descricao: "Pão caseiro", preco: new Prisma.Decimal("12.30"), estoque: 5,
    created_at: new Date("2026-10-15T20:00:00Z"),
    categoria_produto: { id_categoria: idCategoria, nome: "Alimentos" },
    vinculo_condominio: { id_vinculo: vinculo.id_vinculo, moradia: "Bloco B - Apto 302", condomino: { nome_completo: "Morador vendedor" } },
    produto_imagem: [{ id_imagem: "60000000-0000-4000-8000-000000000001", ordem: 0, storage_path: "privado/foto.png" }],
  }], 1);
  const { res, resultado } = respostaFake();
  res.locals.queryValidada = listarProdutosQuerySchema.parse({});
  await listarProdutosController({ auth } as Request, res as Parameters<typeof listarProdutosController>[1]);
  assert.equal(resultado.status, 200);
  const body = resultado.body as { dados: { preco: string; created_at: string; vendedor: unknown; imagens: { url: string; expires_in: number }[] }[] };
  assert.equal(body.dados[0].preco, "12.30");
  assert.equal(body.dados[0].imagens[0].url, "https://storage.exemplo.com/privado/foto.png?token=ficticio");
  assert.equal(body.dados[0].imagens[0].expires_in, 600);
  assert.equal(body.dados[0].created_at, "2026-10-15T20:00:00.000Z");
  assert.deepEqual(body.dados[0].vendedor, { id_vinculo: vinculo.id_vinculo, nome_completo: "Morador vendedor", moradia: "Bloco B - Apto 302" });
  assert.doesNotMatch(JSON.stringify(body), /cpf|data_nascimento|email|storage_path|id_condomino|id_usuario|status_conta/);
});

test("morador e admin local não ampliam escopo pela query, mas aceitam o próprio condomínio", async () => {
  const { listar } = simularProdutos();
  for (const admin_condominio of [false, true]) {
    const contexto = { ...auth, vinculo_ativo: { ...vinculo, admin_condominio } };
    await assert.rejects(listarVitrineProdutos(contexto, listarProdutosQuerySchema.parse({ id_condominio: idUsuario })), (erro: unknown) =>
      erro instanceof ErroDominio && erro.codigo === "FORBIDDEN_CROSS_TENANT" && erro.statusHttp === 403);
  }
  assert.equal(listar.mock.callCount(), 0);
  await listarVitrineProdutos(auth, listarProdutosQuerySchema.parse({ id_condominio: idCondominio }));
  assert.deepEqual(listar.mock.calls[0].arguments[0].where?.vinculo_condominio,
    { is: { status_vinculo: "ATIVO", id_condominio: idCondominio } });
});

test("super admin escolhe uma vitrine e valida o condomínio ativo com o repository existente", async () => {
  const buscar = simularMetodo(prisma.condominio, "findFirst", async (_args: TiposPrisma.condominioFindFirstArgs) => ({ id_condominio: idCondominio }));
  const { listar } = simularProdutos();
  await listarVitrineProdutos({ id_usuario: idUsuario, super_admin: true }, listarProdutosQuerySchema.parse({ id_condominio: idCondominio }));
  assert.deepEqual(buscar.mock.calls[0].arguments[0], { where: { id_condominio: idCondominio, ativo: true }, select: { id_condominio: true } });
  assert.deepEqual(listar.mock.calls[0].arguments[0].where?.vinculo_condominio,
    { is: { status_vinculo: "ATIVO", id_condominio: idCondominio } });
});

test("super admin recebe CONDOMINIO_NOT_FOUND para condomínio indisponível antes de consultar produtos", async () => {
  simularMetodo(prisma.condominio, "findFirst", async () => null);
  const { listar } = simularProdutos();
  await assert.rejects(listarVitrineProdutos({ id_usuario: idUsuario, super_admin: true }, listarProdutosQuerySchema.parse({ id_condominio: idCondominio })), (erro: unknown) =>
    erro instanceof ErroDominio && erro.codigo === "CONDOMINIO_NOT_FOUND" && erro.statusHttp === 404);
  assert.equal(listar.mock.callCount(), 0);
});

test("vitrine vazia preserva contrato de paginação e total_paginas zero", async () => {
  simularProdutos();
  assert.deepEqual(await listarVitrineProdutos(auth, listarProdutosQuerySchema.parse({})), {
    dados: [], paginacao: { pagina: 1, limite: 20, total: 0, total_paginas: 0 },
  });
});

async function criarToken(opcoes: { issuer?: string; audience?: string; exp?: number | null; sub?: string; assinaturaInvalida?: boolean } = {}) {
  let jwt = new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: "teste" })
    .setSubject(opcoes.sub ?? idUsuario)
    .setIssuer(opcoes.issuer ?? "https://teste.supabase.co/auth/v1")
    .setAudience(opcoes.audience ?? "authenticated");
  if (opcoes.exp !== null) jwt = jwt.setExpirationTime(opcoes.exp ?? Math.floor(Date.now() / 1000) + 60);
  return jwt.sign(opcoes.assinaturaInvalida ? (await generateKeyPair("ES256")).privateKey : chaves.privateKey);
}

async function executarAutenticacao(token?: string, usuario = { id_usuario: idUsuario, status_conta: "ATIVA", super_admin: null as { id_super_admin: string } | null }, vinculoAtivo: typeof vinculo | null = vinculo) {
  mock.method(globalThis, "fetch", async () => new globalThis.Response(JSON.stringify({ keys: [chavePublica] }), { status: 200 }));
  const buscar = simularMetodo(prisma.usuario, "findUnique", async (_args: TiposPrisma.usuarioFindUniqueArgs) => usuario);
  const buscarVinculo = simularMetodo(prisma.vinculo_condominio, "findFirst", async (_args: TiposPrisma.vinculo_condominioFindFirstArgs) => vinculoAtivo);
  const req = { headers: token ? { authorization: `Bearer ${token}` } : {} } as Request;
  const { res } = respostaFake();
  const next = mock.fn();
  await autenticar(req, res, next);
  return { req, erro: next.mock.calls[0]?.arguments[0] as unknown, buscar, buscarVinculo };
}

test("autenticação valida JWT e resolve somente vínculo ATIVO", async () => {
  const { req, erro, buscar, buscarVinculo } = await executarAutenticacao(await criarToken());
  assert.equal(erro, undefined);
  assert.deepEqual(req.auth, auth);
  assert.deepEqual(buscar.mock.calls[0].arguments[0].where, { id_usuario: idUsuario });
  assert.deepEqual(buscarVinculo.mock.calls[0].arguments[0].where, { id_condomino: idUsuario, status_vinculo: "ATIVO" });
});

for (const [nome, opcoes] of [
  ["assinatura inválida", { assinaturaInvalida: true }],
  ["issuer incorreto", { issuer: "https://outro.supabase.co/auth/v1" }],
  ["audience incorreta", { audience: "anon" }],
  ["token expirado", { exp: 1 }],
  ["exp ausente", { exp: null }],
  ["sub inválido", { sub: "nao-e-uuid" }],
] as const) {
  test(`autenticação rejeita ${nome} antes de consultar o banco`, async () => {
    const { erro, buscar } = await executarAutenticacao(await criarToken(opcoes));
    assert.ok(erro instanceof ErroDominio);
    assert.equal(erro.codigo, "UNAUTHENTICATED");
    assert.equal(buscar.mock.callCount(), 0);
  });
}

test("autenticação nega token ausente e conta suspensa", async () => {
  const ausente = await executarAutenticacao();
  assert.ok(ausente.erro instanceof ErroDominio);
  assert.equal(ausente.erro.statusHttp, 401);
  restaurarMocks();
  const suspenso = await executarAutenticacao(await criarToken(), { id_usuario: idUsuario, status_conta: "SUSPENSA", super_admin: null });
  assert.ok(suspenso.erro instanceof ErroDominio);
  assert.equal(suspenso.erro.statusHttp, 403);
  assert.equal(suspenso.buscarVinculo.mock.callCount(), 0);
});

test("JWT válido sem vínculo não concede acesso à vitrine", async () => {
  const { req, erro } = await executarAutenticacao(await criarToken(), undefined, null);
  assert.equal(erro, undefined);
  assert.equal(req.auth?.vinculo_ativo, undefined);
  await assert.rejects(listarVitrineProdutos(req.auth, listarProdutosQuerySchema.parse({})), (erro: unknown) =>
    erro instanceof ErroDominio && erro.codigo === "MEMBERSHIP_REQUIRED");
});

test("error handler transforma erro de domínio em HTTP estável", () => {
  const { res, resultado } = respostaFake();
  errorHandler(new ErroDominio("MEMBERSHIP_REQUIRED", 403, "Vínculo necessário."), {} as Request, res, mock.fn());
  assert.equal(resultado.status, 403);
  assert.deepEqual(resultado.body, { erro: "MEMBERSHIP_REQUIRED", mensagem: "Vínculo necessário." });
});
