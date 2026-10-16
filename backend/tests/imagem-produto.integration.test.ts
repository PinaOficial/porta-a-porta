import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, mock, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { Prisma, status_vinculo_enum } from "../src/generated/prisma/client.js";
import type { ResultadoUploadImagem } from "../src/modules/produtos/produto.model.js";

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
const { supabaseAdmin } = await import("../src/lib/supabase.js");
// Storage simulado; multipart, JWT/JWKS, Express e PostgreSQL são exercitados de verdade.
const objetos = new Map<string, Buffer>();
const enviados: { path: string; contentType: string; upsert: boolean }[] = [];
const removidos: string[][] = [];
let falharUpload = false;
let falharRemocao = false;
let bucketPublico = false;
const getBucketOriginal = supabaseAdmin.storage.getBucket;
const fromOriginal = supabaseAdmin.storage.from;
Reflect.set(supabaseAdmin.storage, "getBucket", async (nome: string) => {
  assert.equal(nome, "product-images");
  return { data: { public: bucketPublico }, error: null };
});
Reflect.set(supabaseAdmin.storage, "from", (nome: string) => {
  assert.equal(nome, "product-images");
  return {
    createSignedUrls: async (paths: string[], expiresIn: number) => {
      assert.equal(expiresIn, 600);
      return { error: null, data: paths.map((path) => ({ path,
        error: objetos.has(path) ? null : "Object not found",
        signedUrl: objetos.has(path) ? `https://storage.exemplo.com/${path}?token=ficticio` : null,
      })) };
    },
    upload: async (path: string, buffer: Buffer, options: { contentType: string; upsert: boolean }) => {
      enviados.push({ path, ...options });
      assert.equal(options.upsert, false);
      assert.equal(objetos.has(path), false);
      if (falharUpload) return { data: null, error: { message: "provedor com secret" } };
      objetos.set(path, Buffer.from(buffer));
      return { data: { path }, error: null };
    },
    remove: async (paths: string[]) => {
      removidos.push(paths);
      if (falharRemocao) return { data: null, error: { message: "secret" } };
      for (const path of paths) objetos.delete(path);
      return { data: [], error: null };
    },
  };
});
const { app } = await import("../src/app.js");
const chaves = await generateKeyPair("ES256");
const jwk = { ...await exportJWK(chaves.publicKey), kid: "imagem-produto-teste", alg: "ES256", use: "sig" };
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
  Reflect.set(supabaseAdmin.storage, "getBucket", getBucketOriginal);
  Reflect.set(supabaseAdmin.storage, "from", fromOriginal);
  await prisma.$disconnect();
});

// Assinaturas mínimas bastam para testar a checagem básica, sem afirmar decodificação completa.
const amostras = {
  "image/jpeg": Buffer.from("ffd8ffe000004a46494600", "hex"),
  "image/png": Buffer.from("89504e470d0a1a0a00000000", "hex"),
  "image/webp": Buffer.from("524946460000000057454250", "hex"),
};
function formulario(mime = "image/png", buffer: Buffer = amostras["image/png"], nome = "foto.png", campo = "imagem") {
  const form = new FormData();
  form.append(campo, new Blob([new Uint8Array(buffer)], { type: mime }), nome);
  return form;
}
async function solicitar(id: string, produto: string = produtoBase.id_produto, form = formulario()) {
  return fetch(`${base}/produtos/${produto}/imagens`, { method: "POST", headers: await headers(id, true), body: form });
}
async function confirmarErro(resposta: globalThis.Response, status: number, codigo: string) {
  assert.equal(resposta.status, status);
  const json = await resposta.json();
  assert.equal(json.erro, codigo);
  assert.equal(JSON.stringify(json).includes("secret"), false);
}
async function semEfeito(acao: () => Promise<void>) {
  const antes = { imagens: await prisma.produto_imagem.count(), objetos: objetos.size, uploads: enviados.length };
  await acao();
  assert.equal(await prisma.produto_imagem.count(), antes.imagens);
  assert.equal(objetos.size, antes.objetos);
  assert.equal(enviados.length, antes.uploads);
}

test("sem token e token inválido são barrados antes do multipart", async () => {
  await semEfeito(async () => {
    for (const cabecalhos of [{}, { Authorization: "Bearer invalido" }] as Record<string, string>[]) {
      const resposta = await fetch(`${base}/produtos/${produtoBase.id_produto}/imagens`, {
        method: "POST", headers: { ...cabecalhos, "Content-Type": "multipart/form-data" }, body: "malformado",
      });
      await confirmarErro(resposta, 401, "UNAUTHENTICATED");
    }
  });
});

test("sem onboarding, vínculos não ativos e super admin recebem 403 antes do arquivo", async () => {
  const ids: string[] = [randomUUID(), superAdmin];
  for (const status of ["PENDENTE", "REJEITADO", "SUSPENSO", "ENCERRADO"] as const) ids.push((await criarMorador(status)).id);
  await semEfeito(async () => {
    for (const id of ids) await confirmarErro(await solicitar(id), 403, "MEMBERSHIP_REQUIRED");
  });
});

test("conta suspensa bloqueia o upload", async () => {
  await prisma.usuario.update({ where: { id_usuario: morador.id }, data: { status_conta: "SUSPENSA" } });
  try { await semEfeito(async () => { await confirmarErro(await solicitar(morador.id), 403, "ACCOUNT_SUSPENDED"); }); }
  finally { await prisma.usuario.update({ where: { id_usuario: morador.id }, data: { status_conta: "ATIVA" } }); }
});

test("UUID inválido é barrado antes de consultar produto e de processar multipart malformado", async () => {
  const original = prisma.produto.findFirst;
  const consulta = mock.fn(() => { throw new Error("Não deve consultar produto"); });
  Reflect.set(prisma.produto, "findFirst", consulta);
  try {
    await semEfeito(async () => {
      const resposta = await fetch(`${base}/produtos/abc/imagens`, { method: "POST", headers: {
        ...await headers(morador.id), "Content-Type": "multipart/form-data",
      }, body: "sem boundary" });
      await confirmarErro(resposta, 400, "VALIDATION_ERROR");
    });
    assert.equal(consulta.mock.callCount(), 0);
  } finally { Reflect.set(prisma.produto, "findFirst", original); }
});

test("inexistente/alheio em ambos condomínios tem 404 uniforme inclusive para admin", async () => {
  const produtos = [await criarProduto(vizinho.vinculo.id_vinculo), await criarProduto(moradorB.vinculo.id_vinculo)];
  let esperado: unknown;
  await semEfeito(async () => {
    for (const ator of [morador, admin]) for (const id of [randomUUID(), ...produtos.map((p) => p.id_produto)]) {
      const resposta = await solicitar(ator.id, id);
      assert.equal(resposta.status, 404);
      const erro = await resposta.json();
      assert.equal(erro.erro, "PRODUCT_NOT_FOUND");
      if (!esperado) esperado = erro;
      else assert.deepEqual(erro, esperado);
    }
  });
});

test("produto do vínculo histórico da mesma pessoa não pode receber imagem", async () => {
  const antigo = await prisma.vinculo_condominio.create({ data: {
    id_condomino: morador.id, id_condominio: condominioB, status_vinculo: "ENCERRADO", moradia: "Antiga",
  } });
  const produto = await criarProduto(antigo.id_vinculo);
  await semEfeito(async () => { await confirmarErro(await solicitar(morador.id, produto.id_produto), 404, "PRODUCT_NOT_FOUND"); });
});

test("JPEG/PNG/WEBP persistem três paths únicos com ordem 0/1/2 e DTO mínimo", async () => {
  const produto = await criarProduto(morador.vinculo.id_vinculo);
  let ordem = 0;
  for (const [mime, buffer] of Object.entries(amostras)) {
    const resposta = await solicitar(morador.id, produto.id_produto, formulario(mime, buffer, "../../minha foto (1).svg"));
    const json = await resposta.json() as ResultadoUploadImagem;
    assert.equal(resposta.status, 201, JSON.stringify(json));
    assert.deepEqual(Object.keys(json), ["dados"]);
    assert.deepEqual(Object.keys(json.dados).sort(), ["id_imagem", "id_produto", "ordem", "created_at"].sort());
    assert.equal(json.dados.id_produto, produto.id_produto);
    assert.equal(json.dados.ordem, ordem++);
    assert.equal(new Date(json.dados.created_at).toISOString(), json.dados.created_at);
    const imagem = await prisma.produto_imagem.findUniqueOrThrow({ where: { id_imagem: json.dados.id_imagem } });
    const extensao = mime === "image/jpeg" ? "jpg" : mime.split("/")[1];
    assert.match(imagem.storage_path, new RegExp(`^produtos/${produto.id_produto}/[a-f0-9-]{36}\\.${extensao}$`));
    assert.deepEqual(objetos.get(imagem.storage_path), buffer);
    assert.equal(enviados.at(-1)!.path, imagem.storage_path);
    assert.equal(enviados.at(-1)!.contentType, mime);
    assert.equal(enviados.at(-1)!.upsert, false);
  }
  const imagens = await prisma.produto_imagem.findMany({ where: { id_produto: produto.id_produto } });
  assert.equal(new Set(imagens.map((i) => i.storage_path)).size, 3);
  assert.deepEqual(await prisma.produto.findUnique({ where: { id_produto: produto.id_produto } }), produto);
});

test("produto e categoria inativos permitem upload sem mudar produto ou categoria", async () => {
  const produto = await criarProduto(morador.vinculo.id_vinculo, { ativo: false, id_categoria: categoriaInativa, estoque: 0 });
  const categoria = await prisma.categoria_produto.findUnique({ where: { id_categoria: categoriaInativa } });
  assert.equal((await solicitar(morador.id, produto.id_produto)).status, 201);
  assert.deepEqual(await prisma.produto.findUnique({ where: { id_produto: produto.id_produto } }), produto);
  assert.deepEqual(await prisma.categoria_produto.findUnique({ where: { id_categoria: categoriaInativa } }), categoria);
});

test("admin local também pode enviar imagem do próprio produto", async () => {
  const produto = await criarProduto(admin.vinculo.id_vinculo);
  assert.equal((await solicitar(admin.id, produto.id_produto)).status, 201);
});

test("SVG/PDF/HTML/octet-stream e PDF disfarçado de JPEG são recusados", async () => {
  await semEfeito(async () => {
    for (const mime of ["image/svg+xml", "application/pdf", "text/html", "application/octet-stream", "image/jpeg"]) {
      await confirmarErro(await solicitar(morador.id, produtoBase.id_produto, formulario(mime, Buffer.from("%PDF-1.5 falso"), "foto.jpg")), 415, "IMAGE_TYPE_NOT_ALLOWED");
    }
  });
});

test("arquivo maior que 5 MB é recusado pelo parser antes de Storage/DB", async () => {
  const buffer = Buffer.alloc(5 * 1024 * 1024 + 1);
  amostras["image/png"].copy(buffer);
  await semEfeito(async () => { await confirmarErro(await solicitar(morador.id, produtoBase.id_produto, formulario("image/png", buffer)), 413, "IMAGE_TOO_LARGE"); });
});

test("arquivo com exatamente 5 MB é aceito", async () => {
  const buffer = Buffer.alloc(5 * 1024 * 1024);
  amostras["image/png"].copy(buffer);
  assert.equal((await solicitar(morador.id, produtoBase.id_produto, formulario("image/png", buffer))).status, 201);
});

test("ausente, vazio, campo errado, vários arquivos e metadados extras não persistem", async () => {
  await semEfeito(async () => {
    await confirmarErro(await solicitar(morador.id, produtoBase.id_produto, new FormData()), 400, "IMAGE_REQUIRED");
    await confirmarErro(await solicitar(morador.id, produtoBase.id_produto, formulario("image/png", Buffer.alloc(0))), 400, "IMAGE_REQUIRED");
    await confirmarErro(await solicitar(morador.id, produtoBase.id_produto, formulario("image/png", amostras["image/png"], "foto.png", "foto")), 400, "VALIDATION_ERROR");
    const varios = formulario(); varios.append("imagem", new Blob([new Uint8Array(amostras["image/png"])], { type: "image/png" }), "outra.png");
    await confirmarErro(await solicitar(morador.id, produtoBase.id_produto, varios), 400, "VALIDATION_ERROR");
    for (const campo of ["id_vinculo_vendedor", "id_condominio", "storage_path", "ordem", "id_imagem"]) {
      const form = formulario(); form.append(campo, "forjado");
      await confirmarErro(await solicitar(morador.id, produtoBase.id_produto, form), 400, "VALIDATION_ERROR");
    }
    const resposta = await fetch(`${base}/produtos/${produtoBase.id_produto}/imagens`, { method: "POST", headers: await headers(morador.id) });
    await confirmarErro(resposta, 400, "IMAGE_REQUIRED");
  });
});

test("multipart malformado retorna validação controlada", async () => {
  await semEfeito(async () => {
    const resposta = await fetch(`${base}/produtos/${produtoBase.id_produto}/imagens`, { method: "POST", headers: {
      ...await headers(morador.id), "Content-Type": "multipart/form-data",
    }, body: "sem boundary" });
    await confirmarErro(resposta, 400, "VALIDATION_ERROR");
  });
});

test("bucket público bloqueia upload sem alterar sua configuração", async () => {
  bucketPublico = true;
  try { await semEfeito(async () => { await confirmarErro(await solicitar(morador.id), 500, "IMAGE_UPLOAD_FAILED"); }); }
  finally { bucketPublico = false; }
});

test("falha de upload não cria imagem no banco", async () => {
  const antes = await prisma.produto_imagem.count(); const quantidade = objetos.size;
  falharUpload = true;
  try { await confirmarErro(await solicitar(morador.id), 500, "IMAGE_UPLOAD_FAILED"); }
  finally { falharUpload = false; }
  assert.equal(await prisma.produto_imagem.count(), antes);
  assert.equal(objetos.size, quantidade);
});

test("falha real de FK após upload é compensada sem remover imagens anteriores", async () => {
  const antes = await prisma.produto_imagem.count(); const pathsAnteriores = [...objetos.keys()];
  const original = prisma.produto_imagem.create;
  Reflect.set(prisma.produto_imagem, "create", (args: Prisma.produto_imagemCreateArgs) => original({ ...args, data: {
    storage_path: args.data.storage_path, ordem: args.data.ordem, id_produto: randomUUID(),
  } }));
  try { await confirmarErro(await solicitar(morador.id), 500, "IMAGE_PERSISTENCE_FAILED"); }
  finally { Reflect.set(prisma.produto_imagem, "create", original); }
  assert.equal(await prisma.produto_imagem.count(), antes);
  assert.deepEqual([...objetos.keys()], pathsAnteriores);
  assert.deepEqual(removidos.at(-1), [enviados.at(-1)!.path]);
});

test("falha de compensação retorna erro e log técnico sem credenciais ou buffer", async () => {
  const original = prisma.produto_imagem.create;
  Reflect.set(prisma.produto_imagem, "create", async () => { throw new Error("DB com CPF secreto"); });
  const log = mock.method(console, "error", () => undefined);
  falharRemocao = true;
  const antes = await prisma.produto_imagem.count();
  try {
    await confirmarErro(await solicitar(morador.id), 500, "IMAGE_PERSISTENCE_FAILED");
    assert.deepEqual(log.mock.calls.at(-1)!.arguments, [{ evento: "IMAGE_CLEANUP_FAILED", id_produto: produtoBase.id_produto,
      storage_path: enviados.at(-1)!.path, causa: "IMAGE_PERSISTENCE_FAILED" }]);
    assert.equal(await prisma.produto_imagem.count(), antes);
    // Limpeza apenas do ambiente simulado após validar o objeto órfão esperado.
    assert.equal(objetos.has(enviados.at(-1)!.path), true);
    objetos.delete(enviados.at(-1)!.path);
  } finally { falharRemocao = false; Reflect.set(prisma.produto_imagem, "create", original); log.mock.restore(); }
});

test("suspensão posterior mantém arquivo e registro e bloqueia novo upload", async () => {
  const vendedor = await criarMorador(); const produto = await criarProduto(vendedor.vinculo.id_vinculo);
  const resposta = await solicitar(vendedor.id, produto.id_produto); assert.equal(resposta.status, 201);
  const json = await resposta.json() as ResultadoUploadImagem;
  const imagem = await prisma.produto_imagem.findUniqueOrThrow({ where: { id_imagem: json.dados.id_imagem } });
  const suspensao = await fetch(`${base}/admin/vinculos/${vendedor.vinculo.id_vinculo}/suspender`, { method: "PATCH", headers: await headers(admin.id) });
  assert.equal(suspensao.status, 200);
  await semEfeito(async () => { await confirmarErro(await solicitar(vendedor.id, produto.id_produto), 403, "MEMBERSHIP_REQUIRED"); });
  assert.deepEqual(await prisma.produto_imagem.findUnique({ where: { id_imagem: imagem.id_imagem } }), imagem);
  assert.equal(objetos.has(imagem.storage_path), true);
});

test("upload preserva pedido, histórico, conversa, auditoria e contrato das leituras", async () => {
  const produto = await criarProduto(morador.vinculo.id_vinculo);
  const pedido = await prisma.pedido.create({ data: { id_produto: produto.id_produto, id_vinculo_comprador: vizinho.vinculo.id_vinculo,
    quantidade: 1, valor_pedido: "25.90", hora_combinada: new Date("2099-10-16T20:00:00Z") } });
  const historico = await prisma.pedido_status_historico.create({ data: { id_pedido: pedido.id_pedido, status_novo: "SOLICITADO", alterado_por: vizinho.id } });
  const conversa = await prisma.conversa.create({ data: { id_pedido: pedido.id_pedido } });
  const auditorias = await prisma.auditoria.count();
  assert.equal((await solicitar(morador.id, produto.id_produto)).status, 201);
  assert.deepEqual(await prisma.produto.findUnique({ where: { id_produto: produto.id_produto } }), produto);
  assert.deepEqual(await prisma.pedido.findUnique({ where: { id_pedido: pedido.id_pedido } }), pedido);
  assert.deepEqual(await prisma.pedido_status_historico.findUnique({ where: { id_historico: historico.id_historico } }), historico);
  assert.deepEqual(await prisma.conversa.findUnique({ where: { id_conversa: conversa.id_conversa } }), conversa);
  assert.equal(await prisma.auditoria.count(), auditorias);
  for (const rota of ["/produtos?limite=100", "/produtos/me?limite=100"]) {
    const resposta = await fetch(`${base}${rota}`, { headers: await headers(morador.id) });
    assert.equal(resposta.status, 200);
    const json = await resposta.json();
    const item = json.dados.find((p: { id_produto: string }) => p.id_produto === produto.id_produto);
    assert.ok(item);
    assert.equal(item.imagens.length, 1);
    assert.match(item.imagens[0].url, /^https:\/\/storage\.exemplo\.com\//);
    assert.equal(item.imagens[0].expires_in, 600);
    assert.equal(JSON.stringify(json).includes("storage_path"), false);
  }
});

async function excluirImagem(idUsuario: string, idProduto: string, idImagem: string, query = "", body?: object) {
  return fetch(`${base}/produtos/${idProduto}/imagens/${idImagem}${query}`, {
    method: "DELETE", headers: { ...await headers(idUsuario, true), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function criarImagemTeste(idProduto: string, ordem = 0) {
  const storagePath = `legado/${randomUUID()}.png`;
  const imagem = await prisma.produto_imagem.create({ data: { id_produto: idProduto, storage_path: storagePath, ordem } });
  objetos.set(storagePath, Buffer.from(amostras["image/png"]));
  return imagem;
}

async function semRemocao(acao: () => Promise<void>) {
  const antes = await prisma.produto_imagem.findMany({ orderBy: { id_imagem: "asc" } });
  const arquivos = [...objetos.entries()];
  const tentativas = removidos.length;
  await acao();
  assert.deepEqual(await prisma.produto_imagem.findMany({ orderBy: { id_imagem: "asc" } }), antes);
  assert.deepEqual([...objetos.entries()], arquivos);
  assert.equal(removidos.length, tentativas);
}

test("DELETE sem token ou com token inválido retorna 401 sem remover nada", async () => {
  await semRemocao(async () => {
    for (const cabecalhos of [{}, { Authorization: "Bearer invalido" }] as Record<string, string>[]) {
      const resposta = await fetch(`${base}/produtos/${produtoBase.id_produto}/imagens/${randomUUID()}`, { method: "DELETE", headers: cabecalhos });
      await confirmarErro(resposta, 401, "UNAUTHENTICATED");
    }
  });
});

test("DELETE nega sem onboarding, todos os vínculos não ativos e super admin sem vínculo", async () => {
  const ids = [randomUUID(), superAdmin];
  for (const status of ["PENDENTE", "REJEITADO", "SUSPENSO", "ENCERRADO"] as const) ids.push((await criarMorador(status)).id);
  await semRemocao(async () => {
    for (const id of ids) await confirmarErro(await excluirImagem(id, produtoBase.id_produto, randomUUID()), 403, "MEMBERSHIP_REQUIRED");
  });
});

test("DELETE nega conta global suspensa mesmo com vínculo ATIVO", async () => {
  const vendedor = await criarMorador();
  await prisma.usuario.update({ where: { id_usuario: vendedor.id }, data: { status_conta: "SUSPENSA" } });
  await semRemocao(async () => { await confirmarErro(await excluirImagem(vendedor.id, produtoBase.id_produto, randomUUID()), 403, "ACCOUNT_SUSPENDED"); });
});

test("DELETE valida ambos os UUIDs antes de consultar produtos/imagens ou Storage", async () => {
  const buscarOriginal = prisma.produto.findFirst;
  Reflect.set(prisma.produto, "findFirst", async () => { throw new Error("UUID inválido chegou ao repository"); });
  try {
    await semRemocao(async () => {
      for (const [produto, imagem] of [["abc", randomUUID()], [produtoBase.id_produto, "abc"]]) {
        await confirmarErro(await excluirImagem(morador.id, produto, imagem), 400, "VALIDATION_ERROR");
      }
    });
  } finally { Reflect.set(prisma.produto, "findFirst", buscarOriginal); }
});

test("DELETE rejeita body e query incluindo path e autoridade enviados pelo cliente", async () => {
  const imagem = await criarImagemTeste(produtoBase.id_produto);
  await semRemocao(async () => {
    for (const campo of ["storage_path", "id_vinculo_vendedor", "id_condominio", "id_usuario"]) {
      await confirmarErro(await excluirImagem(morador.id, produtoBase.id_produto, imagem.id_imagem, `?${campo}=forjado`), 400, "VALIDATION_ERROR");
      await confirmarErro(await excluirImagem(morador.id, produtoBase.id_produto, imagem.id_imagem, "", { [campo]: "forjado" }), 400, "VALIDATION_ERROR");
    }
  });
});

test("DELETE de produto inexistente/alheio ou outro tenant retorna PRODUCT_NOT_FOUND também para admin local", async () => {
  const produtoVizinho = await criarProduto(vizinho.vinculo.id_vinculo);
  const imagemVizinho = await criarImagemTeste(produtoVizinho.id_produto);
  const produtoB = await criarProduto(moradorB.vinculo.id_vinculo);
  const imagemB = await criarImagemTeste(produtoB.id_produto);
  await semRemocao(async () => {
    for (const usuario of [morador.id, admin.id]) {
      for (const [produto, imagem] of [[randomUUID(), randomUUID()], [produtoVizinho.id_produto, imagemVizinho.id_imagem], [produtoB.id_produto, imagemB.id_imagem]]) {
        await confirmarErro(await excluirImagem(usuario, produto, imagem), 404, "PRODUCT_NOT_FOUND");
      }
    }
  });
});

test("DELETE não alcança produto do vínculo histórico da mesma pessoa", async () => {
  const antigo = await prisma.vinculo_condominio.create({ data: { id_condomino: morador.id, id_condominio: condominioB, moradia: "Anterior", status_vinculo: "ENCERRADO" } });
  const produto = await criarProduto(antigo.id_vinculo);
  const imagem = await criarImagemTeste(produto.id_produto);
  await semRemocao(async () => { await confirmarErro(await excluirImagem(morador.id, produto.id_produto, imagem.id_imagem), 404, "PRODUCT_NOT_FOUND"); });
});

test("DELETE de imagem inexistente, de outro produto próprio ou de outro vendedor retorna IMAGE_NOT_FOUND", async () => {
  const proprio = await criarProduto(morador.vinculo.id_vinculo);
  const outro = await criarProduto(morador.vinculo.id_vinculo);
  const imagemPropria = await criarImagemTeste(outro.id_produto);
  const alheio = await criarProduto(vizinho.vinculo.id_vinculo);
  const imagemAlheia = await criarImagemTeste(alheio.id_produto);
  await semRemocao(async () => {
    for (const imagem of [randomUUID(), imagemPropria.id_imagem, imagemAlheia.id_imagem]) {
      await confirmarErro(await excluirImagem(morador.id, proprio.id_produto, imagem), 404, "IMAGE_NOT_FOUND");
    }
  });
});

test("DELETE de imagem própria ativa/inativa/categoria inativa/admin próprio retorna 204 sem body", async () => {
  for (const [vendedor, alteracoes] of [
    [morador, {}], [morador, { ativo: false }], [morador, { id_categoria: categoriaInativa }],
    [morador, { ativo: false, id_categoria: categoriaInativa }], [admin, {}],
  ] as const) {
    const produto = await criarProduto(vendedor.vinculo.id_vinculo, alteracoes);
    const imagem = await criarImagemTeste(produto.id_produto);
    const resposta = await excluirImagem(vendedor.id, produto.id_produto.toUpperCase(), imagem.id_imagem.toUpperCase());
    assert.equal(resposta.status, 204);
    assert.equal(await resposta.text(), "");
    assert.equal(objetos.has(imagem.storage_path), false);
    assert.equal(await prisma.produto_imagem.findUnique({ where: { id_imagem: imagem.id_imagem } }), null);
    assert.deepEqual(removidos.at(-1), [imagem.storage_path]);
    assert.deepEqual(await prisma.produto.findUnique({ where: { id_produto: produto.id_produto } }), produto);
    const chamadas = removidos.length;
    await confirmarErro(await excluirImagem(vendedor.id, produto.id_produto, imagem.id_imagem), 404, "IMAGE_NOT_FOUND");
    assert.equal(removidos.length, chamadas);
  }
});

test("DELETE preserva outras imagens, gaps e leituras assinadas; próximo upload usa max+1", async () => {
  const produto = await criarProduto(morador.vinculo.id_vinculo);
  const imagens = await Promise.all([0, 1, 2].map((ordem) => criarImagemTeste(produto.id_produto, ordem)));
  const [primeira, removida, ultima] = imagens;
  assert.equal((await excluirImagem(morador.id, produto.id_produto, removida.id_imagem)).status, 204);
  assert.deepEqual(await prisma.produto_imagem.findMany({ where: { id_produto: produto.id_produto }, orderBy: { ordem: "asc" } }), [primeira, ultima]);
  assert.equal(objetos.has(primeira.storage_path), true);
  assert.equal(objetos.has(ultima.storage_path), true);
  assert.equal(objetos.has(removida.storage_path), false);
  for (const rota of ["/produtos?limite=100", "/produtos/me?limite=100"]) {
    const resposta = await fetch(`${base}${rota}`, { headers: await headers(morador.id) });
    assert.equal(resposta.status, 200);
    const json = await resposta.json();
    const item = json.dados.find((p: { id_produto: string }) => p.id_produto === produto.id_produto);
    assert.deepEqual(item.imagens.map((i: { id_imagem: string }) => i.id_imagem), [primeira.id_imagem, ultima.id_imagem]);
    assert.deepEqual(item.imagens.map((i: { ordem: number }) => i.ordem), [0, 2]);
    assert.ok(item.imagens.every((i: { url: string; expires_in: number }) => i.url.includes("?token=ficticio") && i.expires_in === 600));
    assert.equal(JSON.stringify(json).includes("storage_path"), false);
  }
  const novo = await solicitar(morador.id, produto.id_produto);
  assert.equal(novo.status, 201);
  assert.equal((await novo.json()).dados.ordem, 3);
  assert.equal((await excluirImagem(morador.id, produto.id_produto, primeira.id_imagem)).status, 204);
  const restantes = await prisma.produto_imagem.findMany({ where: { id_produto: produto.id_produto }, orderBy: { ordem: "asc" } });
  assert.deepEqual(restantes.map((i) => i.ordem), [2, 3]);
});

test("DELETE com objeto já ausente recebe sucesso vazio do Storage e limpa metadados", async () => {
  const produto = await criarProduto(morador.vinculo.id_vinculo);
  const imagem = await criarImagemTeste(produto.id_produto);
  objetos.delete(imagem.storage_path);
  assert.equal((await excluirImagem(morador.id, produto.id_produto, imagem.id_imagem)).status, 204);
  assert.equal(await prisma.produto_imagem.findUnique({ where: { id_imagem: imagem.id_imagem } }), null);
});

test("DELETE com falha no Storage mantém registro e objeto", async () => {
  const imagem = await criarImagemTeste(produtoBase.id_produto);
  falharRemocao = true;
  try {
    await confirmarErro(await excluirImagem(morador.id, produtoBase.id_produto, imagem.id_imagem), 500, "IMAGE_DELETE_FAILED");
    assert.deepEqual(await prisma.produto_imagem.findUnique({ where: { id_imagem: imagem.id_imagem } }), imagem);
    assert.equal(objetos.has(imagem.storage_path), true);
  } finally { falharRemocao = false; }
});

test("DELETE bloqueia bucket público sem alterar registro ou objeto", async () => {
  const imagem = await criarImagemTeste(produtoBase.id_produto);
  bucketPublico = true;
  try {
    await semRemocao(async () => { await confirmarErro(await excluirImagem(morador.id, produtoBase.id_produto, imagem.id_imagem), 500, "IMAGE_DELETE_FAILED"); });
  } finally { bucketPublico = false; }
});

test("DELETE com falha DB após Storage retorna erro/log, omite órfão na leitura e permite retry", async () => {
  const produto = await criarProduto(morador.vinculo.id_vinculo);
  const imagem = await criarImagemTeste(produto.id_produto);
  const excluirOriginal = prisma.produto_imagem.delete;
  const log = mock.method(console, "error", () => {});
  Reflect.set(prisma.produto_imagem, "delete", async () => { throw new Error("CPF, JWT e DATABASE_URL secretos"); });
  try {
    await confirmarErro(await excluirImagem(morador.id, produto.id_produto, imagem.id_imagem), 500, "IMAGE_DELETE_FAILED");
    assert.equal(objetos.has(imagem.storage_path), false);
    assert.deepEqual(await prisma.produto_imagem.findUnique({ where: { id_imagem: imagem.id_imagem } }), imagem);
    assert.deepEqual(log.mock.calls[0].arguments, [{ evento: "IMAGE_DELETE_INCONSISTENCY", id_produto: produto.id_produto,
      id_imagem: imagem.id_imagem, storage_path: imagem.storage_path, causa: "IMAGE_RECORD_DELETE_FAILED" }]);
    const resposta = await fetch(`${base}/produtos/me?limite=100`, { headers: await headers(morador.id) });
    assert.equal(resposta.status, 200);
    const json = await resposta.json();
    assert.deepEqual(json.dados.find((p: { id_produto: string }) => p.id_produto === produto.id_produto).imagens, []);
    assert.doesNotMatch(JSON.stringify(log.mock.calls), /CPF|JWT|DATABASE_URL|secretos/);
  } finally { Reflect.set(prisma.produto_imagem, "delete", excluirOriginal); log.mock.restore(); }
  assert.equal((await excluirImagem(morador.id, produto.id_produto, imagem.id_imagem)).status, 204);
  assert.equal(await prisma.produto_imagem.findUnique({ where: { id_imagem: imagem.id_imagem } }), null);
});

test("DELETE preserva produto, outras imagens, pedido, histórico, conversa, vínculo e auditoria", async () => {
  const produto = await criarProduto(morador.vinculo.id_vinculo);
  const imagem = await criarImagemTeste(produto.id_produto);
  const outra = await criarImagemTeste(produto.id_produto, 2);
  const pedido = await prisma.pedido.create({ data: { id_produto: produto.id_produto, id_vinculo_comprador: vizinho.vinculo.id_vinculo,
    quantidade: 1, valor_pedido: "25.90", hora_combinada: new Date("2099-01-01T00:00:00Z") } });
  const historico = await prisma.pedido_status_historico.create({ data: { id_pedido: pedido.id_pedido, status_novo: "SOLICITADO", alterado_por: vizinho.id } });
  const conversa = await prisma.conversa.create({ data: { id_pedido: pedido.id_pedido } });
  const lerEstado = () => Promise.all([
    prisma.produto.findMany({ orderBy: { id_produto: "asc" } }),
    prisma.produto_imagem.findMany({ where: { NOT: { id_imagem: imagem.id_imagem } }, orderBy: { id_imagem: "asc" } }),
    prisma.pedido.findUnique({ where: { id_pedido: pedido.id_pedido } }),
    prisma.pedido_status_historico.findUnique({ where: { id_historico: historico.id_historico } }),
    prisma.conversa.findUnique({ where: { id_conversa: conversa.id_conversa } }),
    prisma.vinculo_condominio.findMany({ orderBy: { id_vinculo: "asc" } }),
    prisma.auditoria.count(),
  ]);
  const antes = await lerEstado();
  const arquivos = [...objetos.entries()].filter(([path]) => path !== imagem.storage_path);
  assert.equal((await excluirImagem(morador.id, produto.id_produto, imagem.id_imagem)).status, 204);
  assert.deepEqual(await lerEstado(), antes);
  assert.deepEqual([...objetos.entries()], arquivos);
  assert.equal(objetos.has(outra.storage_path), true);
});

test("repository de exclusão preserva associação produto/imagem mesmo chamado diretamente", async () => {
  const { excluirRegistroImagemProduto } = await import("../src/modules/produtos/produto.repository.js");
  const produto = await criarProduto(morador.vinculo.id_vinculo);
  const imagem = await criarImagemTeste(produto.id_produto);
  await assert.rejects(excluirRegistroImagemProduto(produtoBase.id_produto, imagem.id_imagem), { code: "P2025" });
  assert.deepEqual(await prisma.produto_imagem.findUnique({ where: { id_imagem: imagem.id_imagem } }), imagem);
  assert.equal(objetos.has(imagem.storage_path), true);
});

test("fluxo B: publicação HTTP → upload multipart → vitrine e detalhe com signed URL", async () => {
  const r = await fetch(`${base}/produtos`, { method: "POST", headers: { ...await headers(morador.id), "Content-Type": "application/json" }, body: JSON.stringify({ id_categoria: categoriaAtiva, nome_produto: "Fluxo de venda", descricao: "Publicado pela API", preco: "9.90", estoque: 3 }) });
  assert.equal(r.status, 201); const produto = (await r.json()).dados;
  const upload = await solicitar(morador.id, produto.id_produto); assert.equal(upload.status, 201);
  const imagem = (await upload.json()).dados;
  for (const caminho of [`/produtos?busca=${encodeURIComponent("Fluxo de venda")}`, `/produtos/${produto.id_produto}`]) {
    const resposta = await fetch(`${base}${caminho}`, { headers: await headers(vizinho.id) }); assert.equal(resposta.status, 200);
    const json = await resposta.json(); const item = Array.isArray(json.dados) ? json.dados[0] : json.dados;
    assert.equal(item.id_produto, produto.id_produto); assert.equal(item.imagens[0].id_imagem, imagem.id_imagem);
    assert.equal(item.imagens[0].expires_in, 600); assert.doesNotMatch(JSON.stringify(json), /storage_path|cpf|email|data_nascimento/);
  }
});
