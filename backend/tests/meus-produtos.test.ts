import assert from "node:assert/strict";
import { after, afterEach, mock, test } from "node:test";
import type { Prisma as TiposPrisma } from "../src/generated/prisma/client.js";

process.env.DATABASE_URL = "postgresql://teste:teste@localhost:5432/teste";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.SUPABASE_URL = "https://teste.supabase.co";
process.env.SUPABASE_SECRET_KEY = "chave-apenas-para-testes";
const { prisma } = await import("../src/lib/prisma.js");
const { Prisma } = await import("../src/generated/prisma/client.js");
const { ErroDominio } = await import("../src/lib/erro-dominio.js");
const { listarMeusProdutosQuerySchema } = await import("../src/modules/produtos/produto.schema.js");
const { listarMeusProdutos } = await import("../src/modules/produtos/produto.service.js");
const idCategoria = "10000000-0000-4000-8000-000000000001";
const auth = {
  id_usuario: "20000000-0000-4000-8000-000000000001", super_admin: false,
  vinculo_ativo: { id_vinculo: "30000000-0000-4000-8000-000000000001", id_condominio: "40000000-0000-4000-8000-000000000001", admin_condominio: false },
};
const restaurar: (() => void)[] = [];
function simular<T extends (...args: never[]) => unknown>(objeto: object, nome: string, implementacao: T) {
  const original: unknown = Reflect.get(objeto, nome);
  const simulado = mock.fn(implementacao);
  Reflect.set(objeto, nome, simulado);
  restaurar.push(() => { Reflect.set(objeto, nome, original); });
  return simulado;
}
afterEach(() => { for (const fn of restaurar.splice(0).reverse()) fn(); });
after(async () => { await prisma.$disconnect(); });

function simularProdutos(produtos: unknown[] = [], total = 0) {
  const listar = simular(prisma.produto, "findMany", async (_args: TiposPrisma.produtoFindManyArgs) => produtos);
  const contar = simular(prisma.produto, "count", async (_args: TiposPrisma.produtoCountArgs) => total);
  const transacao = simular(prisma, "$transaction", async (consultas: Promise<unknown>[], _opcoes: { isolationLevel: string }) => Promise.all(consultas));
  return { listar, contar, transacao };
}

test("query reutiliza defaults e limites e interpreta false sem coerção genérica", () => {
  assert.deepEqual(listarMeusProdutosQuerySchema.parse({}), { pagina: 1, limite: 20 });
  assert.deepEqual(listarMeusProdutosQuerySchema.parse({ ativo: "false", busca: "  bolo  ", id_categoria: idCategoria, pagina: "2", limite: "100" }),
    { ativo: false, busca: "bolo", id_categoria: idCategoria, pagina: 2, limite: 100 });
  assert.equal(listarMeusProdutosQuerySchema.parse({ ativo: "true" }).ativo, true);
  assert.equal(listarMeusProdutosQuerySchema.parse({ busca: "   " }).busca, undefined);
});

test("query rejeita booleanos ambíguos, paginação inválida, overflow e autoridade enviada pelo cliente", () => {
  for (const query of [
    { ativo: "1" }, { ativo: "sim" }, { ativo: "yes" }, { ativo: "abc" }, { ativo: "TRUE" }, { ativo: "" }, { ativo: true }, { ativo: ["true", "false"] },
    { pagina: "0" }, { pagina: "-1" }, { pagina: "1.5" }, { pagina: "1e2" }, { limite: "101" }, { limite: "0" }, { limite: ["1", "2"] },
    { pagina: "2147483647", limite: "100" }, { id_categoria: "abc" }, { id_categoria: [idCategoria] }, { busca: "x".repeat(141) },
    { id_vinculo_vendedor: auth.vinculo_ativo.id_vinculo }, { id_usuario: auth.id_usuario }, { id_condominio: auth.vinculo_ativo.id_condominio }, { categoria: idCategoria },
  ]) assert.equal(listarMeusProdutosQuerySchema.safeParse(query).success, false, JSON.stringify(query));
});

test("service nega ausência de vínculo inclusive para super admin antes de consultar produtos", async () => {
  const consulta = simular(prisma.produto, "findMany", () => { throw new Error("Não deve consultar"); });
  for (const [contexto, codigo, status] of [
    [undefined, "UNAUTHENTICATED", 401],
    [{ id_usuario: auth.id_usuario, super_admin: false }, "MEMBERSHIP_REQUIRED", 403],
    [{ id_usuario: auth.id_usuario, super_admin: true }, "MEMBERSHIP_REQUIRED", 403],
  ] as const) {
    await assert.rejects(listarMeusProdutos(contexto, listarMeusProdutosQuerySchema.parse({})), (erro: unknown) => {
      assert.ok(erro instanceof ErroDominio);
      assert.equal(erro.codigo, codigo);
      assert.equal(erro.statusHttp, status);
      return true;
    });
  }
  assert.equal(consulta.mock.callCount(), 0);
});

test("consulta e count restringem vínculo no banco e combinam busca, categoria e ativo=false no mesmo snapshot", async () => {
  const { listar, contar, transacao } = simularProdutos([], 7);
  const resposta = await listarMeusProdutos(auth, listarMeusProdutosQuerySchema.parse({ ativo: "false", busca: " bolo ", id_categoria: idCategoria, pagina: "2", limite: "2" }));
  const consulta = listar.mock.calls[0].arguments[0];
  assert.deepEqual(consulta.where, {
    id_vinculo_vendedor: auth.vinculo_ativo.id_vinculo, id_categoria: idCategoria, ativo: false,
    OR: [{ nome_produto: { contains: "bolo", mode: "insensitive" } }, { descricao: { contains: "bolo", mode: "insensitive" } }],
  });
  assert.equal(contar.mock.calls[0].arguments[0].where, consulta.where);
  assert.deepEqual(consulta.orderBy, [{ created_at: "desc" }, { id_produto: "asc" }]);
  assert.equal(consulta.skip, 2);
  assert.equal(consulta.take, 2);
  assert.deepEqual(consulta.select, {
    id_produto: true, nome_produto: true, descricao: true, preco: true, estoque: true, created_at: true, updated_at: true, ativo: true,
    categoria_produto: { select: { id_categoria: true, nome: true, ativo: true } },
    produto_imagem: { select: { id_imagem: true, storage_path: true, ordem: true }, orderBy: [{ ordem: "asc" }, { id_imagem: "asc" }] },
  });
  assert.deepEqual(transacao.mock.calls[0].arguments[1], { isolationLevel: "RepeatableRead" });
  assert.deepEqual(resposta.paginacao, { pagina: 2, limite: 2, total: 7, total_paginas: 4 });
});

test("sem filtro ativo consulta somente o vínculo e mantém lista vazia como 200 lógico", async () => {
  const { listar, contar } = simularProdutos();
  assert.deepEqual(await listarMeusProdutos(auth, listarMeusProdutosQuerySchema.parse({})), {
    dados: [], paginacao: { pagina: 1, limite: 20, total: 0, total_paginas: 0 },
  });
  assert.deepEqual(listar.mock.calls[0].arguments[0].where, { id_vinculo_vendedor: auth.vinculo_ativo.id_vinculo });
  assert.deepEqual(contar.mock.calls[0].arguments[0].where, { id_vinculo_vendedor: auth.vinculo_ativo.id_vinculo });
});

test("DTO mantém produto e categoria inativos, estoque zero, Decimal e datas ISO sem dados pessoais", async () => {
  simularProdutos([{
    id_produto: "50000000-0000-4000-8000-000000000001", nome_produto: "Bolo", descricao: "Caseiro",
    preco: new Prisma.Decimal("9999999999.99"), estoque: 0, ativo: false,
    created_at: new Date("2026-10-14T20:00:00Z"), updated_at: new Date("2026-10-15T20:00:00Z"),
    categoria_produto: { id_categoria: idCategoria, nome: "Antiga", ativo: false },
    produto_imagem: [],
  }], 1);
  const resposta = await listarMeusProdutos(auth, listarMeusProdutosQuerySchema.parse({}));
  assert.deepEqual(resposta.dados, [{
    id_produto: "50000000-0000-4000-8000-000000000001", nome_produto: "Bolo", descricao: "Caseiro",
    preco: "9999999999.99", estoque: 0, ativo: false,
    created_at: "2026-10-14T20:00:00.000Z", updated_at: "2026-10-15T20:00:00.000Z",
    categoria: { id_categoria: idCategoria, nome: "Antiga", ativo: false },
    imagens: [],
  }]);
});
