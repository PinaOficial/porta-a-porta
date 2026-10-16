import assert from "node:assert/strict";
import { after, afterEach, beforeEach, mock, test } from "node:test";
import type { Prisma as TiposPrisma } from "../src/generated/prisma/client.js";

process.env.DATABASE_URL = "postgresql://teste:teste@localhost:5432/teste";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.SUPABASE_URL = "https://teste.supabase.co";
process.env.SUPABASE_SECRET_KEY = "chave-apenas-para-testes";
const { prisma } = await import("../src/lib/prisma.js");
const { Prisma } = await import("../src/generated/prisma/client.js");
const { ErroDominio } = await import("../src/lib/erro-dominio.js");
const { criarProdutoBodySchema, editarProdutoBodySchema, produtoParamsSchema } = await import("../src/modules/produtos/produto.schema.js");
const { editarProduto } = await import("../src/modules/produtos/produto.service.js");
const idProduto = "10000000-0000-4000-8000-000000000001";
const idCategoria = "20000000-0000-4000-8000-000000000001";
const auth = {
  id_usuario: "30000000-0000-4000-8000-000000000001", super_admin: false,
  vinculo_ativo: { id_vinculo: "40000000-0000-4000-8000-000000000001", id_condominio: "50000000-0000-4000-8000-000000000001", admin_condominio: false },
};
const produto = {
  id_produto: idProduto, nome_produto: "Bolo", descricao: "Caseiro", preco: new Prisma.Decimal("25.90"), estoque: 4, ativo: false,
  created_at: new Date("2026-10-14T20:00:00Z"), updated_at: new Date("2026-10-15T20:00:00Z"),
  categoria_produto: { id_categoria: idCategoria, nome: "Antiga", ativo: false },
};
const restaurar: (() => void)[] = [];
function simular<T extends (...args: never[]) => unknown>(objeto: object, nome: string, implementacao: T) {
  const original: unknown = Reflect.get(objeto, nome);
  const simulado = mock.fn(implementacao);
  Reflect.set(objeto, nome, simulado);
  restaurar.push(() => { Reflect.set(objeto, nome, original); });
  return simulado;
}
beforeEach(() => {
  simular(prisma, "$transaction", async (acao: (tx: TiposPrisma.TransactionClient) => Promise<unknown>) => acao(prisma));
  simular(prisma, "$queryRaw", async () => [{ id_vinculo: auth.vinculo_ativo!.id_vinculo, id_condomino: auth.id_usuario, id_condominio: auth.vinculo_ativo!.id_condominio, status_vinculo: "ATIVO" }]);
});
afterEach(() => { for (const fn of restaurar.splice(0).reverse()) fn(); });
after(async () => { await prisma.$disconnect(); });

test("params exige UUID e PATCH aceita subconjunto não vazio sem preencher campos omitidos", () => {
  assert.deepEqual(produtoParamsSchema.parse({ id: idProduto }), { id: idProduto });
  assert.equal(produtoParamsSchema.safeParse({ id: "abc" }).success, false);
  assert.deepEqual(editarProdutoBodySchema.parse({ nome_produto: "  Novo nome  " }), { nome_produto: "Novo nome" });
  assert.deepEqual(editarProdutoBodySchema.parse({ estoque: 0 }), { estoque: 0 });
  for (const dados of [{}, { nome_produto: undefined }, [], null, undefined]) {
    assert.equal(editarProdutoBodySchema.safeParse(dados).success, false);
  }
});

test("PATCH reutiliza todas as regras de criação e rejeita campos proibidos", () => {
  const completo = { id_categoria: idCategoria, nome_produto: "Bolo", descricao: "Caseiro", preco: "25.90", estoque: 4 };
  assert.deepEqual(editarProdutoBodySchema.parse(completo), criarProdutoBodySchema.parse(completo));
  for (const dados of [
    { nome_produto: " " }, { nome_produto: "x".repeat(141) }, { descricao: "  " }, { descricao: null },
    { preco: "0" }, { preco: "0.00" }, { preco: "-1" }, { preco: "10.999" }, { preco: "25,90" }, { preco: 25.9 }, { preco: "10000000000.00" },
    { estoque: -1 }, { estoque: 1.5 }, { estoque: "1" }, { estoque: 2_147_483_648 }, { id_categoria: "abc" },
  ]) assert.equal(editarProdutoBodySchema.safeParse(dados).success, false, JSON.stringify(dados));
  for (const campo of ["id_produto", "id_vinculo_vendedor", "id_condominio", "id_usuario", "ativo", "created_at", "updated_at", "storage_path", "imagens"]) {
    assert.equal(editarProdutoBodySchema.safeParse({ nome_produto: "Novo", [campo]: "forjado" }).success, false, campo);
  }
});

test("service exige vínculo ativo antes de consultar ownership inclusive para super admin", async () => {
  const consulta = simular(prisma.produto, "findFirst", () => { throw new Error("Não deve consultar"); });
  for (const [contexto, codigo, status] of [
    [undefined, "UNAUTHENTICATED", 401],
    [{ id_usuario: auth.id_usuario, super_admin: false }, "MEMBERSHIP_REQUIRED", 403],
    [{ id_usuario: auth.id_usuario, super_admin: true }, "MEMBERSHIP_REQUIRED", 403],
  ] as const) {
    await assert.rejects(editarProduto(contexto, idProduto, { estoque: 0 }), (erro: unknown) => {
      assert.ok(erro instanceof ErroDominio);
      assert.equal(erro.codigo, codigo);
      assert.equal(erro.statusHttp, status);
      return true;
    });
  }
  assert.equal(consulta.mock.callCount(), 0);
});

test("ownership restringe a leitura e falha antes de consultar categoria ou atualizar", async () => {
  const consulta = simular(prisma.produto, "findFirst", async (_args: TiposPrisma.produtoFindFirstArgs) => null);
  const categoria = simular(prisma.categoria_produto, "findUnique", () => { throw new Error("Não deve consultar categoria"); });
  const atualizar = simular(prisma.produto, "update", () => { throw new Error("Não deve atualizar"); });
  await assert.rejects(editarProduto(auth, idProduto, { id_categoria: idCategoria }), { codigo: "PRODUCT_NOT_FOUND", statusHttp: 404 });
  assert.deepEqual(consulta.mock.calls[0].arguments[0], {
    where: { id_produto: idProduto, id_vinculo_vendedor: auth.vinculo_ativo.id_vinculo }, select: { id_produto: true, id_categoria: true },
  });
  assert.equal(categoria.mock.callCount(), 0);
  assert.equal(atualizar.mock.callCount(), 0);
});

test("categoria explícita inexistente ou inativa reutiliza os erros do cadastro sem atualizar", async () => {
  simular(prisma.produto, "findFirst", async () => ({ id_produto: idProduto }));
  const atualizar = simular(prisma.produto, "update", () => { throw new Error("Não deve atualizar"); });
  for (const [categoria, codigo, statusHttp] of [[null, "CATEGORY_NOT_FOUND", 404], [{ id_categoria: idCategoria, ativo: false }, "CATEGORY_INACTIVE", 409]] as const) {
    simular(prisma.categoria_produto, "findUnique", async () => categoria);
    await assert.rejects(editarProduto(auth, idProduto, { id_categoria: idCategoria }), { codigo, statusHttp });
  }
  assert.equal(atualizar.mock.callCount(), 0);
});

test("update preserva ownership, só envia campos presentes, aceita zero e não valida categoria omitida", async () => {
  simular(prisma.produto, "findFirst", async () => ({ id_produto: idProduto }));
  const categoria = simular(prisma.categoria_produto, "findUnique", () => { throw new Error("Categoria omitida não deve ser consultada"); });
  const atualizar = simular(prisma.produto, "update", async (_args: TiposPrisma.produtoUpdateArgs) => ({ ...produto, estoque: 0 }));
  const resultado = await editarProduto(auth, idProduto, { estoque: 0 });
  const consulta = atualizar.mock.calls[0].arguments[0];
  assert.deepEqual(consulta.where, { id_produto: idProduto, id_vinculo_vendedor: auth.vinculo_ativo.id_vinculo });
  assert.deepEqual(consulta.data, { estoque: 0 });
  assert.equal(categoria.mock.callCount(), 0);
  assert.equal(resultado.dados.estoque, 0);
  assert.equal(resultado.dados.ativo, false);
  assert.equal(resultado.dados.categoria.ativo, false);
  assert.equal(resultado.dados.preco, "25.90");
  assert.equal(resultado.dados.updated_at, "2026-10-15T20:00:00.000Z");
});

test("preço é Decimal exato e DTO reutiliza a forma de meus produtos", async () => {
  simular(prisma.produto, "findFirst", async () => ({ id_produto: idProduto }));
  const atualizar = simular(prisma.produto, "update", async (_args: TiposPrisma.produtoUpdateArgs) => ({ ...produto, preco: new Prisma.Decimal("9999999999.99") }));
  const resultado = await editarProduto(auth, idProduto, { preco: "9999999999.99" });
  const alteracoes = atualizar.mock.calls[0].arguments[0].data;
  assert.deepEqual(Object.keys(alteracoes), ["preco"]);
  assert.ok(alteracoes.preco instanceof Prisma.Decimal);
  assert.equal(alteracoes.preco.toFixed(2), "9999999999.99");
  assert.equal(resultado.dados.preco, "9999999999.99");
  assert.deepEqual(Object.keys(resultado.dados).sort(), ["id_produto", "nome_produto", "descricao", "preco", "estoque", "ativo", "created_at", "updated_at", "categoria"].sort());
});

test("P2025 no update final vira 404 e erros inesperados continuam sendo propagados", async () => {
  simular(prisma.produto, "findFirst", async () => ({ id_produto: idProduto }));
  for (const codigo of ["P2025", "P2003"]) {
    const falha = new Prisma.PrismaClientKnownRequestError("Falha simulada", { code: codigo, clientVersion: "7.0.0" });
    simular(prisma.produto, "update", async () => { throw falha; });
    await assert.rejects(editarProduto(auth, idProduto, { estoque: 0 }), (erro: unknown) => {
      if (codigo === "P2025") {
        assert.ok(erro instanceof ErroDominio);
        assert.equal(erro.codigo, "PRODUCT_NOT_FOUND");
        assert.equal(erro.statusHttp, 404);
      } else assert.equal(erro, falha);
      return true;
    });
  }
});
