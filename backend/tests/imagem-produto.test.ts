import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, beforeEach, mock, test } from "node:test";
import type { Prisma } from "../src/generated/prisma/client.js";

process.env.DATABASE_URL = "postgresql://teste:teste@localhost:5432/teste";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.SUPABASE_URL = "https://teste.supabase.co";
process.env.SUPABASE_SECRET_KEY = "chave-apenas-para-testes";
const { prisma } = await import("../src/lib/prisma.js");
const { supabaseAdmin } = await import("../src/lib/supabase.js");
const fromReal = supabaseAdmin.storage.from;
const getBucketReal = supabaseAdmin.storage.getBucket;
const { adicionarImagemProduto } = await import("../src/modules/produtos/produto.service.js");
const idProduto = randomUUID();
const auth = { id_usuario: randomUUID(), super_admin: false, vinculo_ativo: {
  id_vinculo: randomUUID(), id_condominio: randomUUID(), admin_condominio: false,
} };
const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
const arquivo = { buffer: png, size: png.length, mimetype: "image/png" };
const restaurar: (() => void)[] = [];
function simular<T extends (...args: never[]) => unknown>(objeto: object, nome: string, fn: T) {
  const original: unknown = Reflect.get(objeto, nome);
  const simulado = mock.fn(fn);
  Reflect.set(objeto, nome, simulado);
  restaurar.push(() => { Reflect.set(objeto, nome, original); });
  return simulado;
}
const storage = {
  upload: mock.fn(async (_path: string, _buffer: Buffer, _options: { contentType: string; upsert: boolean }) => ({ data: { path: _path }, error: null })),
  remove: mock.fn(async (_paths: string[]) => ({ data: [], error: null })),
};
beforeEach(() => {
  storage.upload.mock.resetCalls(); storage.remove.mock.resetCalls();
  simular(prisma.produto, "findFirst", async () => ({ id_produto: idProduto, id_categoria: randomUUID() }));
  simular(prisma.produto_imagem, "aggregate", async () => ({ _max: { ordem: null } }));
  simular(supabaseAdmin.storage, "getBucket", async () => ({ data: { public: false }, error: null }));
  simular(supabaseAdmin.storage, "from", (_bucket: string) => storage);
});
afterEach(() => { for (const fn of restaurar.splice(0).reverse()) fn(); mock.restoreAll(); });
after(async () => { await prisma.$disconnect(); });

test("service exige autenticação e vínculo antes de consultar produto ou Storage", async () => {
  const consulta = simular(prisma.produto, "findFirst", async () => null);
  for (const [contexto, codigo] of [
    [undefined, "UNAUTHENTICATED"], [{ id_usuario: auth.id_usuario, super_admin: false }, "MEMBERSHIP_REQUIRED"],
    [{ id_usuario: auth.id_usuario, super_admin: true }, "MEMBERSHIP_REQUIRED"],
  ] as const) await assert.rejects(adicionarImagemProduto(contexto, idProduto, arquivo), { codigo });
  assert.equal(consulta.mock.callCount(), 0);
  assert.equal(storage.upload.mock.callCount(), 0);
});

test("consulta restringe ao vínculo ativo e alheio/inexistente não chega ao Storage", async () => {
  const consulta = simular(prisma.produto, "findFirst", async (_args: Prisma.produtoFindFirstArgs) => null);
  await assert.rejects(adicionarImagemProduto(auth, idProduto, arquivo), { codigo: "PRODUCT_NOT_FOUND", statusHttp: 404 });
  assert.deepEqual(consulta.mock.calls[0].arguments[0].where, { id_produto: idProduto, id_vinculo_vendedor: auth.vinculo_ativo.id_vinculo });
  assert.equal(storage.upload.mock.callCount(), 0);
});

test("JPEG/PNG/WEBP usam extensão por MIME, UUID, bucket privado e upsert=false", async () => {
  const criar = simular(prisma.produto_imagem, "create", async (args: Prisma.produto_imagemCreateArgs) => ({
    id_imagem: randomUUID(), id_produto: idProduto, ordem: args.data.ordem, created_at: new Date("2026-10-15T20:00:00Z"),
  }));
  const bucket = simular(supabaseAdmin.storage, "from", (_bucket: string) => storage);
  const paths: string[] = [];
  for (const [mimetype, buffer, extensao] of [
    ["image/jpeg", Buffer.from("ffd8ffe00000", "hex"), "jpg"], ["image/png", png, "png"],
    ["image/webp", Buffer.from("524946460000000057454250", "hex"), "webp"],
  ] as const) {
    const resultado = await adicionarImagemProduto(auth, idProduto, { buffer, size: buffer.length, mimetype });
    const chamada = storage.upload.mock.calls.at(-1)!.arguments;
    assert.match(chamada[0], new RegExp(`^produtos/${idProduto}/[a-f0-9-]{36}\\.${extensao}$`));
    assert.equal(chamada[1], buffer);
    assert.deepEqual(chamada[2], { contentType: mimetype, upsert: false });
    assert.deepEqual(criar.mock.calls.at(-1)!.arguments[0].data, { id_produto: idProduto, storage_path: chamada[0], ordem: 0 });
    assert.deepEqual(Object.keys(resultado.dados).sort(), ["id_imagem", "id_produto", "ordem", "created_at"].sort());
    assert.equal(resultado.dados.created_at, "2026-10-15T20:00:00.000Z");
    paths.push(chamada[0]);
  }
  assert.equal(new Set(paths).size, 3);
  assert.ok(bucket.mock.calls.every((chamada) => chamada.arguments[0] === "product-images"));
});

test("usa max(ordem)+1 mesmo com lacunas e consulta somente o produto", async () => {
  const maior = simular(prisma.produto_imagem, "aggregate", async (_args: Prisma.Produto_imagemAggregateArgs) => ({ _max: { ordem: 7 } }));
  const criar = simular(prisma.produto_imagem, "create", async (args: Prisma.produto_imagemCreateArgs) => ({ id_imagem: randomUUID(), id_produto: idProduto, ordem: args.data.ordem, created_at: new Date() }));
  await adicionarImagemProduto(auth, idProduto, arquivo);
  assert.deepEqual(maior.mock.calls[0].arguments[0], { where: { id_produto: idProduto }, _max: { ordem: true } });
  assert.equal(criar.mock.calls[0].arguments[0].data.ordem, 8);
});

test("arquivo ausente/vazio, excessivo, MIME proibido ou assinatura incompatível falham antes do upload", async () => {
  for (const [imagem, codigo] of [
    [undefined, "IMAGE_REQUIRED"], [{ ...arquivo, buffer: Buffer.alloc(0), size: 0 }, "IMAGE_REQUIRED"],
    [{ ...arquivo, size: 5 * 1024 * 1024 + 1 }, "IMAGE_TOO_LARGE"],
    [{ ...arquivo, mimetype: "image/svg+xml" }, "IMAGE_TYPE_NOT_ALLOWED"],
    [{ buffer: Buffer.from("%PDF-malicioso"), size: 14, mimetype: "image/jpeg" }, "IMAGE_TYPE_NOT_ALLOWED"],
  ] as const) await assert.rejects(adicionarImagemProduto(auth, idProduto, imagem), { codigo });
  assert.equal(storage.upload.mock.callCount(), 0);
});

test("limite SMALLINT é tratado antes do Storage sem inventar limite de quantidade", async () => {
  simular(prisma.produto_imagem, "aggregate", async () => ({ _max: { ordem: 32767 } }));
  await assert.rejects(adicionarImagemProduto(auth, idProduto, arquivo), { codigo: "IMAGE_ORDER_EXHAUSTED", statusHttp: 409 });
  assert.equal(storage.upload.mock.callCount(), 0);
});

test("bucket ausente, público ou consulta indisponível impede upload/insert", async () => {
  const criar = simular(prisma.produto_imagem, "create", () => { throw new Error("Não inserir"); });
  for (const resultado of [{ data: { public: true }, error: null }, { data: null, error: { message: "secret" } }]) {
    simular(supabaseAdmin.storage, "getBucket", async () => resultado);
    await assert.rejects(adicionarImagemProduto(auth, idProduto, arquivo), { codigo: "IMAGE_UPLOAD_FAILED" });
  }
  simular(supabaseAdmin.storage, "getBucket", async () => { throw new Error("provedor secreto"); });
  await assert.rejects(adicionarImagemProduto(auth, idProduto, arquivo), { codigo: "IMAGE_UPLOAD_FAILED" });
  assert.equal(storage.upload.mock.callCount(), 0);
  assert.equal(criar.mock.callCount(), 0);
});

test("erro retornado ou lançado pelo upload não insere registro nem remove objetos anteriores", async () => {
  const criar = simular(prisma.produto_imagem, "create", () => { throw new Error("Não inserir"); });
  for (const implementar of [async () => ({ data: null, error: { message: "credencial secreta" } }), async () => { throw new Error("JWT secreto"); }]) {
    simular(storage, "upload", implementar);
    await assert.rejects(adicionarImagemProduto(auth, idProduto, arquivo), { codigo: "IMAGE_UPLOAD_FAILED", statusHttp: 500 });
  }
  assert.equal(criar.mock.callCount(), 0);
  assert.equal(storage.remove.mock.callCount(), 0);
});

test("falha do DB remove apenas o objeto recém-enviado e retorna erro controlado", async () => {
  simular(prisma.produto_imagem, "create", async () => { throw new Error("DB com dados pessoais"); });
  await assert.rejects(adicionarImagemProduto(auth, idProduto, arquivo), { codigo: "IMAGE_PERSISTENCE_FAILED", statusHttp: 500 });
  assert.deepEqual(storage.remove.mock.calls[0].arguments[0], [storage.upload.mock.calls[0].arguments[0]]);
});

test("falha retornada ou lançada pela compensação registra só identificadores e causa resumida", async () => {
  simular(prisma.produto_imagem, "create", async () => { throw new Error("CPF secreto"); });
  const log = mock.method(console, "error", () => undefined);
  for (const implementar of [async () => ({ data: null, error: { message: "secret" } }), async () => { throw new Error("JWT secreto"); }]) {
    simular(storage, "remove", implementar);
    await assert.rejects(adicionarImagemProduto(auth, idProduto, arquivo), { codigo: "IMAGE_PERSISTENCE_FAILED" });
    assert.deepEqual(log.mock.calls.at(-1)!.arguments, [{ evento: "IMAGE_CLEANUP_FAILED", id_produto: idProduto,
      storage_path: storage.upload.mock.calls.at(-1)!.arguments[0], causa: "IMAGE_PERSISTENCE_FAILED" }]);
  }
});

const { excluirImagemProduto } = await import("../src/modules/produtos/produto.service.js");
const { excluirImagemProdutoParamsSchema, excluirImagemProdutoQuerySchema } = await import("../src/modules/produtos/produto.schema.js");
const idImagem = randomUUID();
const pathImagem = "legado/caminho-exato-sem-reconstrucao.png";

function simularImagemParaExcluir() {
  const buscar = simular(prisma.produto_imagem, "findFirst", async (_args: Prisma.produto_imagemFindFirstArgs) => ({ id_imagem: idImagem, storage_path: pathImagem }));
  const excluir = simular(prisma.produto_imagem, "delete", async (_args: Prisma.produto_imagemDeleteArgs) => ({ id_imagem: idImagem }));
  return { buscar, excluir };
}

test("params de exclusão validam os dois UUIDs, normalizam caixa e rejeitam campos extras", () => {
  assert.deepEqual(excluirImagemProdutoParamsSchema.parse({ id: idProduto.toUpperCase(), idImagem: idImagem.toUpperCase() }), { id: idProduto, idImagem });
  for (const params of [{ id: "abc", idImagem }, { id: idProduto, idImagem: "abc" }, { id: idProduto }, { id: idProduto, idImagem, storage_path: pathImagem }]) {
    assert.equal(excluirImagemProdutoParamsSchema.safeParse(params).success, false);
  }
  assert.equal(excluirImagemProdutoQuerySchema.safeParse({}).success, true);
  for (const campo of ["storage_path", "id_usuario", "id_vinculo_vendedor", "id_condominio"]) {
    assert.equal(excluirImagemProdutoQuerySchema.safeParse({ [campo]: "forjado" }).success, false);
  }
});

test("exclusão exige auth/vínculo, inclusive super admin, antes de produto, imagem ou Storage", async () => {
  const produto = simular(prisma.produto, "findFirst", async () => null);
  const { buscar, excluir } = simularImagemParaExcluir();
  for (const [contexto, codigo] of [
    [undefined, "UNAUTHENTICATED"], [{ id_usuario: auth.id_usuario, super_admin: false }, "MEMBERSHIP_REQUIRED"],
    [{ id_usuario: auth.id_usuario, super_admin: true }, "MEMBERSHIP_REQUIRED"],
  ] as const) await assert.rejects(excluirImagemProduto(contexto, idProduto, idImagem), { codigo });
  assert.equal(produto.mock.callCount(), 0);
  assert.equal(buscar.mock.callCount(), 0);
  assert.equal(excluir.mock.callCount(), 0);
  assert.equal(storage.remove.mock.callCount(), 0);
});

test("exclusão de produto inexistente/alheio não consulta imagem ou Storage e restringe vínculo", async () => {
  const produto = simular(prisma.produto, "findFirst", async (_args: Prisma.produtoFindFirstArgs) => null);
  const { buscar, excluir } = simularImagemParaExcluir();
  await assert.rejects(excluirImagemProduto(auth, idProduto, idImagem), { codigo: "PRODUCT_NOT_FOUND", statusHttp: 404 });
  assert.deepEqual(produto.mock.calls[0].arguments[0].where, { id_produto: idProduto, id_vinculo_vendedor: auth.vinculo_ativo.id_vinculo });
  assert.equal(buscar.mock.callCount(), 0);
  assert.equal(excluir.mock.callCount(), 0);
  assert.equal(storage.remove.mock.callCount(), 0);
});

test("imagem inexistente ou de outro produto usa IMAGE_NOT_FOUND antes do Storage", async () => {
  const { excluir } = simularImagemParaExcluir();
  const buscar = simular(prisma.produto_imagem, "findFirst", async (_args: Prisma.produto_imagemFindFirstArgs) => null);
  await assert.rejects(excluirImagemProduto(auth, idProduto, idImagem), { codigo: "IMAGE_NOT_FOUND", statusHttp: 404 });
  assert.deepEqual(buscar.mock.calls[0].arguments[0], { where: { id_imagem: idImagem, id_produto: idProduto }, select: { id_imagem: true, storage_path: true } });
  assert.equal(excluir.mock.callCount(), 0);
  assert.equal(storage.remove.mock.callCount(), 0);
});

test("remove path exato e somente depois deleta registro limitado à imagem e produto", async () => {
  simularImagemParaExcluir();
  const eventos: string[] = [];
  const remover = simular(storage, "remove", async (paths: string[]) => { eventos.push("storage"); assert.deepEqual(paths, [pathImagem]); return { data: [], error: null }; });
  const excluir = simular(prisma.produto_imagem, "delete", async (args: Prisma.produto_imagemDeleteArgs) => {
    eventos.push("db");
    assert.deepEqual(args.where, { id_imagem: idImagem, id_produto: idProduto });
    return { id_imagem: idImagem };
  });
  const bucket = simular(supabaseAdmin.storage, "from", (nome: string) => { assert.equal(nome, "product-images"); return storage; });
  assert.equal(await excluirImagemProduto(auth, idProduto, idImagem), undefined);
  assert.deepEqual(eventos, ["storage", "db"]);
  assert.equal(remover.mock.callCount(), 1);
  assert.equal(excluir.mock.callCount(), 1);
  assert.equal(bucket.mock.callCount(), 1);
});

test("falha retornada ou lançada pelo Storage preserva registro e retorna erro controlado", async () => {
  const { excluir } = simularImagemParaExcluir();
  for (const fn of [async () => ({ data: null, error: { message: "JWT e CPF secretos" } }), async () => { throw new Error("secret DB"); }]) {
    simular(storage, "remove", fn);
    await assert.rejects(excluirImagemProduto(auth, idProduto, idImagem), { codigo: "IMAGE_DELETE_FAILED", statusHttp: 500, message: "Não foi possível excluir a imagem." });
  }
  assert.equal(excluir.mock.callCount(), 0);
});

test("objeto ausente permite limpar DB com [] sem erro ou NoSuchKey explícito", async () => {
  const { excluir } = simularImagemParaExcluir();
  for (const resultado of [ { data: [], error: null }, { data: null, error: { status: 404, statusCode: "NoSuchKey" } } ]) {
    simular(storage, "remove", async () => resultado);
    await excluirImagemProduto(auth, idProduto, idImagem);
  }
  assert.equal(excluir.mock.callCount(), 2);
});

test("404 genérico, bucket ausente e falha de permissão não são tratados como objeto ausente", async () => {
  const { excluir } = simularImagemParaExcluir();
  for (const error of [
    { status: 404, statusCode: "404" }, { status: 404, statusCode: "NoSuchBucket" },
    { status: 404, statusCode: "TenantNotFound" }, { status: 403, statusCode: "AccessDenied" },
    { status: 500, statusCode: "NoSuchKey" },
  ]) {
    simular(storage, "remove", async () => ({ data: null, error }));
    await assert.rejects(excluirImagemProduto(auth, idProduto, idImagem), { codigo: "IMAGE_DELETE_FAILED" });
  }
  assert.equal(excluir.mock.callCount(), 0);
});

test("bucket público/ausente/inacessível bloqueia exclusão antes de remove e delete", async () => {
  const { excluir } = simularImagemParaExcluir();
  for (const bucket of [ { data: { public: true }, error: null }, { data: null, error: { message: "secret" } }, { data: null, error: null } ]) {
    simular(supabaseAdmin.storage, "getBucket", async () => bucket);
    await assert.rejects(excluirImagemProduto(auth, idProduto, idImagem), { codigo: "IMAGE_DELETE_FAILED" });
  }
  assert.equal(storage.remove.mock.callCount(), 0);
  assert.equal(excluir.mock.callCount(), 0);
});

test("DB falha após Storage: não finge sucesso, não recria arquivo e registra contexto seguro", async () => {
  simularImagemParaExcluir();
  simular(prisma.produto_imagem, "delete", async () => { throw new Error("DATABASE_URL, JWT, CPF e secret"); });
  const log = mock.method(console, "error", () => {});
  await assert.rejects(excluirImagemProduto(auth, idProduto, idImagem), { codigo: "IMAGE_DELETE_FAILED", statusHttp: 500 });
  assert.equal(storage.remove.mock.callCount(), 1);
  assert.equal(storage.upload.mock.callCount(), 0);
  assert.deepEqual(log.mock.calls[0].arguments, [{ evento: "IMAGE_DELETE_INCONSISTENCY", id_produto: idProduto,
    id_imagem: idImagem, storage_path: pathImagem, causa: "IMAGE_RECORD_DELETE_FAILED" }]);
});


test("SDK instalado envia DELETE com um path e reconhece []/NoSuchKey sem aceitar erro 404 genérico", async () => {
  simularImagemParaExcluir();
  simular(supabaseAdmin.storage, "from", fromReal.bind(supabaseAdmin.storage));
  simular(supabaseAdmin.storage, "getBucket", getBucketReal.bind(supabaseAdmin.storage));
  const excluir = simular(prisma.produto_imagem, "delete", async () => ({ id_imagem: idImagem }));
  for (const modo of ["ausente", "NoSuchKey", "NoSuchBucket", "rede"]) {
    const transporte = mock.method(globalThis, "fetch", async (input: string | URL | globalThis.Request, init?: RequestInit) => {
      if (String(input).endsWith("/bucket/product-images")) return new globalThis.Response(JSON.stringify({ public: false }));
      assert.equal(String(input), "https://teste.supabase.co/storage/v1/object/product-images");
      assert.equal(init?.method, "DELETE");
      // A API chama o campo de prefixes, mas os valores são nomes exatos de objetos.
      assert.deepEqual(JSON.parse(String(init?.body)), { prefixes: [pathImagem] });
      if (modo === "rede") throw new TypeError("Falha de rede secreta");
      return modo === "ausente" ? new globalThis.Response("[]")
        : new globalThis.Response(JSON.stringify({ code: modo, message: "Mensagem secreta" }), { status: 404 });
    });
    if (["ausente", "NoSuchKey"].includes(modo)) await excluirImagemProduto(auth, idProduto, idImagem);
    else await assert.rejects(excluirImagemProduto(auth, idProduto, idImagem), { codigo: "IMAGE_DELETE_FAILED" });
    transporte.mock.restore();
  }
  assert.equal(excluir.mock.callCount(), 2);
});
