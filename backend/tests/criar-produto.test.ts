import type { Prisma as TiposPrisma } from "../src/generated/prisma/client.js";
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, mock, test } from "node:test";
import type { ContextoAutenticado } from "../src/types/auth.js";

process.env.DATABASE_URL = "postgresql://teste:teste@localhost:5432/teste";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.SUPABASE_URL = "https://teste.supabase.co";
process.env.SUPABASE_SECRET_KEY = "chave-apenas-para-testes";

const { prisma } = await import("../src/lib/prisma.js");
const { Prisma } = await import("../src/generated/prisma/client.js");
const { ErroDominio } = await import("../src/lib/erro-dominio.js");
const { criarProdutoBodySchema } = await import("../src/modules/produtos/produto.schema.js");
const { cadastrarProduto } = await import("../src/modules/produtos/produto.service.js");
const idCategoria = "10000000-0000-4000-8000-000000000001";
const auth: ContextoAutenticado = {
  id_usuario: "20000000-0000-4000-8000-000000000001", super_admin: false,
  vinculo_ativo: {
    id_vinculo: "30000000-0000-4000-8000-000000000001",
    id_condominio: "40000000-0000-4000-8000-000000000001", admin_condominio: false,
  },
};
const body = { id_categoria: idCategoria, nome_produto: "Bolo", descricao: "Caseiro", preco: "25.90", estoque: 4 };
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

test("body aceita limites do banco, trim, estoque zero e descrição longa", () => {
  const descricao = "x".repeat(10_000);
  const dados = criarProdutoBodySchema.parse({ ...body, nome_produto: ` ${"x".repeat(140)} `, descricao: ` ${descricao} `, estoque: 0 });
  assert.equal(dados.nome_produto.length, 140);
  assert.equal(dados.descricao, descricao);
  assert.equal(dados.estoque, 0);
  assert.equal(criarProdutoBodySchema.parse({ ...body, estoque: 2_147_483_647 }).estoque, 2_147_483_647);
});

test("preço aceita somente string decimal positiva compatível com NUMERIC(12,2)", () => {
  for (const preco of ["1", "1.5", "1.50", "0.01", "25.90", "9999999999.99", "0001.50"]) {
    assert.equal(criarProdutoBodySchema.safeParse({ ...body, preco }).success, true, preco);
  }
  for (const preco of ["0", "0.00", "0.0", "0000.00", "-10", "25,90", "25.999", "abc", "10000000000.00", "1e2", "1.", ".01", " 25.90 ", "Infinity", "NaN", "", 25.9, null, {}, []]) {
    assert.equal(criarProdutoBodySchema.safeParse({ ...body, preco }).success, false, JSON.stringify(preco));
  }
});

test("body rejeita campos inválidos, ausentes e campos extras de autoridade ou imagens", () => {
  for (const alteracao of [
    { id_categoria: "invalido" }, { id_categoria: null }, { nome_produto: "   " }, { nome_produto: "x".repeat(141) },
    { descricao: "  " }, { descricao: null }, { estoque: -1 }, { estoque: 1.5 }, { estoque: "1" }, { estoque: 2_147_483_648 },
  ]) assert.equal(criarProdutoBodySchema.safeParse({ ...body, ...alteracao }).success, false, JSON.stringify(alteracao));
  for (const campo of Object.keys(body)) {
    const incompleto: Record<string, unknown> = { ...body };
    delete incompleto[campo];
    assert.equal(criarProdutoBodySchema.safeParse(incompleto).success, false, campo);
  }
  for (const campo of ["id_produto", "id_vinculo_vendedor", "id_condominio", "id_usuario", "ativo", "created_at", "updated_at", "imagem", "imagens", "arquivo", "base64", "storage_path", "url"]) {
    assert.equal(criarProdutoBodySchema.safeParse({ ...body, [campo]: "forjado" }).success, false, campo);
  }
});

test("service exige vínculo real inclusive para super admin antes de qualquer consulta", async () => {
  const consulta = simular(prisma.categoria_produto, "findUnique", () => { throw new Error("Não deve consultar"); });
  const gravacao = simular(prisma.produto, "create", () => { throw new Error("Não deve criar"); });
  for (const [contexto, codigo, status] of [
    [undefined, "UNAUTHENTICATED", 401],
    [{ id_usuario: auth.id_usuario, super_admin: false }, "MEMBERSHIP_REQUIRED", 403],
    [{ id_usuario: auth.id_usuario, super_admin: true }, "MEMBERSHIP_REQUIRED", 403],
  ] as const) {
    await assert.rejects(cadastrarProduto(contexto, body), (erro: unknown) => {
      assert.ok(erro instanceof ErroDominio);
      assert.equal(erro.codigo, codigo);
      assert.equal(erro.statusHttp, status);
      return true;
    });
  }
  assert.equal(consulta.mock.callCount(), 0);
  assert.equal(gravacao.mock.callCount(), 0);
});

test("categoria inexistente ou inativa impede gravação com erro estável", async () => {
  const gravacao = simular(prisma.produto, "create", () => { throw new Error("Não deve criar"); });
  for (const [categoria, codigo, status] of [[null, "CATEGORY_NOT_FOUND", 404], [{ id_categoria: idCategoria, ativo: false }, "CATEGORY_INACTIVE", 409]] as const) {
    simular(prisma.categoria_produto, "findUnique", async () => categoria);
    await assert.rejects(cadastrarProduto(auth, body), (erro: unknown) => {
      assert.ok(erro instanceof ErroDominio);
      assert.equal(erro.codigo, codigo);
      assert.equal(erro.statusHttp, status);
      return true;
    });
  }
  assert.equal(gravacao.mock.callCount(), 0);
});

test("service usa vínculo autenticado e Decimal sem perda de centavos até o preço máximo", async () => {
  simular(prisma.categoria_produto, "findUnique", async () => ({ id_categoria: idCategoria, ativo: true }));
  const gravacao = simular(prisma.produto, "create", async (args: { data: { preco: InstanceType<typeof Prisma.Decimal> } }) => ({
    id_produto: "50000000-0000-4000-8000-000000000001", nome_produto: body.nome_produto, descricao: body.descricao,
    preco: args.data.preco, estoque: body.estoque, ativo: true, created_at: new Date("2026-10-15T22:00:00Z"),
    categoria_produto: { id_categoria: idCategoria, nome: "Alimentação" },
  }));
  for (const [preco, esperado] of [["1", "1.00"], ["1.5", "1.50"], ["0.01", "0.01"], ["9999999999.99", "9999999999.99"]]) {
    const resultado = await cadastrarProduto(auth, { ...body, preco });
    assert.equal(resultado.dados.preco, esperado);
    assert.equal(resultado.dados.created_at, "2026-10-15T22:00:00.000Z");
    assert.deepEqual(Object.keys(resultado.dados).sort(), ["id_produto", "nome_produto", "descricao", "preco", "estoque", "ativo", "created_at", "categoria"].sort());
  }
  for (const chamada of gravacao.mock.calls) {
    assert.equal((chamada.arguments[0].data as unknown as { id_vinculo_vendedor: string }).id_vinculo_vendedor, auth.vinculo_ativo!.id_vinculo);
    assert.ok(chamada.arguments[0].data.preco instanceof Prisma.Decimal);
  }
});
