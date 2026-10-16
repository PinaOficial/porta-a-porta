import assert from "node:assert/strict";
import { after, afterEach, mock, test } from "node:test";

process.env.DATABASE_URL = "postgresql://teste:teste@localhost:5432/teste";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.SUPABASE_URL = "https://teste.supabase.co";
process.env.SUPABASE_SECRET_KEY = "chave-apenas-para-testes";

const { prisma } = await import("../src/lib/prisma.js");
const { ErroDominio } = await import("../src/lib/erro-dominio.js");
const { listarCategoriasDaVitrine } = await import("../src/modules/categorias/categoria.service.js");
const consultarOriginal = prisma.categoria_produto.findMany;
afterEach(() => { Reflect.set(prisma.categoria_produto, "findMany", consultarOriginal); });
after(async () => { await prisma.$disconnect(); });

test("acesso negado não consulta categorias e mantém os códigos da vitrine", async () => {
  const consulta = mock.fn(() => { throw new Error("Não deve consultar categorias"); });
  Reflect.set(prisma.categoria_produto, "findMany", consulta);
  for (const [auth, codigo, status] of [
    [undefined, "UNAUTHENTICATED", 401],
    [{ id_usuario: "usuario", super_admin: false }, "MEMBERSHIP_REQUIRED", 403],
  ] as const) {
    await assert.rejects(listarCategoriasDaVitrine(auth), (erro: unknown) => {
      assert.ok(erro instanceof ErroDominio);
      assert.equal(erro.codigo, codigo);
      assert.equal(erro.statusHttp, status);
      return true;
    });
  }
  assert.equal(consulta.mock.callCount(), 0);
});

test("morador e super admin sem vínculo consultam a mesma lista global mínima", async () => {
  const dados = [{ id_categoria: "categoria", nome: "Alimentação" }];
  const consulta = mock.fn(async () => dados);
  Reflect.set(prisma.categoria_produto, "findMany", consulta);
  const residente = {
    id_usuario: "usuario", super_admin: false,
    vinculo_ativo: { id_vinculo: "vinculo", id_condominio: "condominio", admin_condominio: false },
  };
  assert.deepEqual(await listarCategoriasDaVitrine(residente), { dados });
  assert.deepEqual(await listarCategoriasDaVitrine({ id_usuario: "super", super_admin: true }), { dados });
  assert.equal(consulta.mock.callCount(), 2);
});

test("lista vazia continua sendo uma coleção válida", async () => {
  Reflect.set(prisma.categoria_produto, "findMany", async () => []);
  assert.deepEqual(await listarCategoriasDaVitrine({ id_usuario: "super", super_admin: true }), { dados: [] });
});
