import assert from "node:assert/strict";
import { after, afterEach, beforeEach, mock, test } from "node:test";
import type { Prisma as TiposPrisma } from "../src/generated/prisma/client.js";

process.env.DATABASE_URL = "postgresql://teste:teste@localhost:5432/teste";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.SUPABASE_URL = "https://teste.supabase.co";
process.env.SUPABASE_SECRET_KEY = "chave-apenas-para-testes";
const { prisma } = await import("../src/lib/prisma.js");
const { Prisma } = await import("../src/generated/prisma/client.js");
const { alterarStatusProdutoBodySchema } = await import("../src/modules/produtos/produto.schema.js");
const { alterarStatusProduto } = await import("../src/modules/produtos/produto.service.js");
const idProduto = "10000000-0000-4000-8000-000000000001";
const idCategoria = "20000000-0000-4000-8000-000000000001";
const auth = {
  id_usuario: "30000000-0000-4000-8000-000000000001", super_admin: false,
  vinculo_ativo: { id_vinculo: "40000000-0000-4000-8000-000000000001", id_condominio: "50000000-0000-4000-8000-000000000001", admin_condominio: false },
};
const produto = {
  id_produto: idProduto, nome_produto: "Bolo", descricao: "Caseiro", preco: new Prisma.Decimal("25.90"), estoque: 0, ativo: false,
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

test("body exige exclusivamente ativo boolean real sem coerção ou valor padrão", () => {
  assert.deepEqual(alterarStatusProdutoBodySchema.parse({ ativo: true }), { ativo: true });
  assert.deepEqual(alterarStatusProdutoBodySchema.parse({ ativo: false }), { ativo: false });
  for (const dados of [{}, [], null, undefined, ...["true", "false", "sim", 1, 0, null].map((ativo) => ({ ativo }))]) {
    assert.equal(alterarStatusProdutoBodySchema.safeParse(dados).success, false);
  }
  for (const campo of ["preco", "estoque", "nome_produto", "descricao", "id_categoria", "id_produto", "id_vinculo_vendedor", "id_usuario", "id_condominio", "created_at", "updated_at", "imagens", "storage_path"]) {
    assert.equal(alterarStatusProdutoBodySchema.safeParse({ ativo: false, [campo]: "extra" }).success, false, campo);
  }
});

test("sem autenticação ou vínculo ativo o service não consulta produtos inclusive para super admin", async () => {
  const consultar = simular(prisma.produto, "findFirst", () => { throw new Error("Não deve consultar"); });
  for (const [contexto, codigo, statusHttp] of [
    [undefined, "UNAUTHENTICATED", 401],
    [{ id_usuario: auth.id_usuario, super_admin: false }, "MEMBERSHIP_REQUIRED", 403],
    [{ id_usuario: auth.id_usuario, super_admin: true }, "MEMBERSHIP_REQUIRED", 403],
  ] as const) await assert.rejects(alterarStatusProduto(contexto, idProduto, true), { codigo, statusHttp });
  assert.equal(consultar.mock.callCount(), 0);
});

test("ownership é filtrado antes da categoria e produto alheio ou inexistente recebe 404", async () => {
  const consultar = simular(prisma.produto, "findFirst", async (_args: TiposPrisma.produtoFindFirstArgs) => null);
  const categoria = simular(prisma.categoria_produto, "findUnique", () => { throw new Error("Não deve consultar categoria"); });
  const atualizar = simular(prisma.produto, "update", () => { throw new Error("Não deve atualizar"); });
  await assert.rejects(alterarStatusProduto(auth, idProduto, true), { codigo: "PRODUCT_NOT_FOUND", statusHttp: 404 });
  assert.deepEqual(consultar.mock.calls[0].arguments[0], {
    where: { id_produto: idProduto, id_vinculo_vendedor: auth.vinculo_ativo.id_vinculo },
    select: { id_produto: true, id_categoria: true },
  });
  assert.equal(categoria.mock.callCount(), 0);
  assert.equal(atualizar.mock.callCount(), 0);
});

test("ativação exige categoria existente e ativa antes de gravar", async () => {
  simular(prisma.produto, "findFirst", async () => ({ id_produto: idProduto, id_categoria: idCategoria }));
  const atualizar = simular(prisma.produto, "update", () => { throw new Error("Não deve atualizar"); });
  for (const [categoria, codigo, statusHttp] of [[null, "CATEGORY_NOT_FOUND", 404], [{ id_categoria: idCategoria, ativo: false }, "CATEGORY_INACTIVE", 409]] as const) {
    simular(prisma.categoria_produto, "findUnique", async () => categoria);
    await assert.rejects(alterarStatusProduto(auth, idProduto, true), { codigo, statusHttp });
  }
  assert.equal(atualizar.mock.callCount(), 0);
});

test("desativação não valida categoria, grava só ativo e preserva DTO, estoque zero e Decimal", async () => {
  simular(prisma.produto, "findFirst", async () => ({ id_produto: idProduto, id_categoria: idCategoria }));
  const categoria = simular(prisma.categoria_produto, "findUnique", () => { throw new Error("Não deve validar categoria"); });
  const atualizar = simular(prisma.produto, "update", async (_args: TiposPrisma.produtoUpdateArgs) => produto);
  const resultado = await alterarStatusProduto(auth, idProduto, false);
  const consulta = atualizar.mock.calls[0].arguments[0];
  assert.deepEqual(consulta.where, { id_produto: idProduto, id_vinculo_vendedor: auth.vinculo_ativo.id_vinculo });
  assert.deepEqual(consulta.data, { ativo: false });
  assert.equal(categoria.mock.callCount(), 0);
  assert.deepEqual(resultado.dados, {
    id_produto: idProduto, nome_produto: "Bolo", descricao: "Caseiro", preco: "25.90", estoque: 0, ativo: false,
    created_at: "2026-10-14T20:00:00.000Z", updated_at: "2026-10-15T20:00:00.000Z",
    categoria: { id_categoria: idCategoria, nome: "Antiga", ativo: false },
  });
});

test("ativação consulta a categoria do produto e não usa estoque como requisito", async () => {
  simular(prisma.produto, "findFirst", async () => ({ id_produto: idProduto, id_categoria: idCategoria }));
  const categoria = simular(prisma.categoria_produto, "findUnique", async (_args: TiposPrisma.categoria_produtoFindUniqueArgs) => ({ id_categoria: idCategoria, ativo: true }));
  const atualizar = simular(prisma.produto, "update", async (_args: TiposPrisma.produtoUpdateArgs) => ({ ...produto, ativo: true, categoria_produto: { ...produto.categoria_produto, ativo: true } }));
  const resultado = await alterarStatusProduto(auth, idProduto, true);
  assert.deepEqual(categoria.mock.calls[0].arguments[0].where, { id_categoria: idCategoria });
  assert.deepEqual(atualizar.mock.calls[0].arguments[0].data, { ativo: true });
  assert.equal(resultado.dados.ativo, true);
  assert.equal(resultado.dados.estoque, 0);
});

test("P2025 na escrita final vira PRODUCT_NOT_FOUND e outros erros não são mascarados", async () => {
  simular(prisma.produto, "findFirst", async () => ({ id_produto: idProduto, id_categoria: idCategoria }));
  for (const code of ["P2025", "P2003"]) {
    const falha = new Prisma.PrismaClientKnownRequestError("Falha simulada", { code, clientVersion: "7.0.0" });
    simular(prisma.produto, "update", async () => { throw falha; });
    await assert.rejects(alterarStatusProduto(auth, idProduto, false), (erro: unknown) => {
      if (code === "P2025") assert.deepEqual({ codigo: (erro as { codigo: string }).codigo, statusHttp: (erro as { statusHttp: number }).statusHttp }, { codigo: "PRODUCT_NOT_FOUND", statusHttp: 404 });
      else assert.equal(erro, falha);
      return true;
    });
  }
});
