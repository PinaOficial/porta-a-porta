import assert from "node:assert/strict";
import { after, test } from "node:test";
process.env.DATABASE_URL = "postgresql://teste:teste@localhost:5432/teste";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.SUPABASE_URL = "https://teste.supabase.co";
process.env.SUPABASE_SECRET_KEY = "chave-apenas-para-testes";
const { editarCondominioBodySchema: editar, statusCondominioBodySchema: status, listarCondominiosAdminQuerySchema: listar } = await import("../src/modules/condominios/condominio.schema.js");
const { listarCondominiosAdmin, obterCondominioAdmin, alterarCondominioAdmin } = await import("../src/modules/condominios/condominio-admin.service.js");
const { prisma } = await import("../src/lib/prisma.js");
after(() => prisma.$disconnect());
const versao = "a".repeat(64), id = "10000000-0000-4000-8000-000000000001";
test("edição parcial distingue omissão, vazio/null e campos protegidos", () => {
  assert.deepEqual(editar.parse({ nome_residencial: " Novo ", versao }), { nome_residencial: "Novo", versao });
  for (const dados of [{ versao }, { nome_residencial: "" }, { versao, cep: null }, { versao, endereco: " " }, { versao, cep: "12345-678" }, { versao, nome_residencial: "x".repeat(161) }, { versao, nome_residencial: "Novo", ativo: true }, { versao, nome_residencial: "Novo", id_condominio: id }]) assert.equal(editar.safeParse(dados).success, false);
});
test("estado desejado exige boolean, versão e motivo limitado", () => {
  assert.deepEqual(status.parse({ versao, ativo: false, motivo: " Revisão " }), { versao, ativo: false, motivo: "Revisão" });
  for (const dados of [{ versao, ativo: "false", motivo: "Motivo" }, { versao, ativo: false }, { versao, ativo: false, motivo: " " }, { versao, ativo: true, motivo: "x".repeat(256) }, { ativo: true, motivo: "Motivo" }, { versao, ativo: true, motivo: "Motivo", role: "super" }]) assert.equal(status.safeParse(dados).success, false);
});
test("listagem estrita valida estado, limites e overflow", () => {
  assert.deepEqual(listar.parse({}), { pagina: 1, limite: 20 });
  assert.equal(listar.parse({ ativo: "false" }).ativo, false);
  for (const dados of [{ ativo: "1" }, { ativo: ["true", "false"] }, { limite: "51" }, { pagina: "0" }, { pagina: "2147483647", limite: "50" }, { super_admin: "true" }]) assert.equal(listar.safeParse(dados).success, false);
});
test("todos os services rejeitam sem identidade/super antes de acessar DB", async () => {
  for (const auth of [undefined, { id_usuario: id, super_admin: false }, { id_usuario: id, super_admin: false, vinculo_ativo: { id_vinculo: id, id_condominio: id, admin_condominio: true } }]) {
    for (const operacao of [() => listarCondominiosAdmin(auth, listar.parse({})), () => obterCondominioAdmin(auth, id), () => alterarCondominioAdmin(auth, id, { versao, ativo: false, motivo: "Teste" })]) await assert.rejects(operacao(), { codigo: auth ? "FORBIDDEN" : "UNAUTHENTICATED" });
  }
});
