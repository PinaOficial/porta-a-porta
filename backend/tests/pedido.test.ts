import assert from "node:assert/strict";
import { after, afterEach, mock, test } from "node:test";

process.env.DATABASE_URL = "postgresql://teste:teste@localhost:5432/teste";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.SUPABASE_URL = "https://teste.supabase.co";
process.env.SUPABASE_SECRET_KEY = "chave-apenas-para-testes";
const { prisma } = await import("../src/lib/prisma.js");
const { criarPedido } = await import("../src/modules/pedidos/pedido.service.js");
const { criarPedidoBodySchema } = await import("../src/modules/pedidos/pedido.schema.js");
const idProduto = "10000000-0000-4000-8000-000000000001";
const body = { id_produto: idProduto, quantidade: 2, hora_combinada: "2099-01-01T12:00:00Z" };
const auth = { id_usuario: "20000000-0000-4000-8000-000000000001", super_admin: false, vinculo_ativo: {
  id_vinculo: "30000000-0000-4000-8000-000000000001", id_condominio: "40000000-0000-4000-8000-000000000001", admin_condominio: false,
} };
const restaurar: (() => void)[] = [];
function simularTransacao(fn: () => Promise<never>) {
  const original = prisma.$transaction;
  const simulado = mock.fn(fn);
  Reflect.set(prisma, "$transaction", simulado);
  restaurar.push(() => { Reflect.set(prisma, "$transaction", original); });
  return simulado;
}
afterEach(() => { for (const fn of restaurar.splice(0).reverse()) fn(); mock.restoreAll(); mock.timers.reset(); });
after(async () => { await prisma.$disconnect(); });

test("body estrito normaliza UUID, suporta INTEGER completo e transforma horários com timezone em instantes", () => {
  const dados = criarPedidoBodySchema.parse({ ...body, id_produto: idProduto.toUpperCase(), quantidade: 2_147_483_647 });
  assert.equal(dados.quantidade, 2_147_483_647);
  assert.equal(dados.id_produto, idProduto);
  const offset = criarPedidoBodySchema.parse({ ...body, hora_combinada: "2099-01-01T09:00:00-03:00" });
  assert.equal(offset.hora_combinada.toISOString(), dados.hora_combinada.toISOString());
});

test("quantidade rejeita coerção, zero, negativo, decimal e overflow técnico", () => {
  for (const quantidade of [0, -1, 1.5, "2", 2_147_483_648, NaN, Infinity, null, true]) {
    assert.equal(criarPedidoBodySchema.safeParse({ ...body, quantidade }).success, false, String(quantidade));
  }
});

test("body rejeita ausência, UUID inválido, datas impossíveis, horário local e campos de autoridade", () => {
  for (const alteracao of [{ id_produto: "abc" }, { hora_combinada: "2099-01-01T12:00:00" }, { hora_combinada: "2099-02-30T12:00:00Z" }, { hora_combinada: "invalida" }]) {
    assert.equal(criarPedidoBodySchema.safeParse({ ...body, ...alteracao }).success, false);
  }
  for (const campo of Object.keys(body)) {
    const incompleto: Record<string, unknown> = { ...body }; delete incompleto[campo];
    assert.equal(criarPedidoBodySchema.safeParse(incompleto).success, false);
  }
  for (const campo of ["id_pedido", "id_vinculo_comprador", "id_vinculo_vendedor", "id_condominio", "preco", "valor_pedido", "status_pedido", "hora_solicitacao", "ultima_atualizacao", "id_conversa", "participantes"]) {
    assert.equal(criarPedidoBodySchema.safeParse({ ...body, [campo]: "forjado" }).success, false, campo);
  }
});

test("sem autenticação ou vínculo, inclusive super admin, não abre transação", async () => {
  const tx = simularTransacao(async () => { throw new Error("Não consultar"); });
  for (const [contexto, codigo] of [[undefined, "UNAUTHENTICATED"], [{ id_usuario: auth.id_usuario, super_admin: false }, "MEMBERSHIP_REQUIRED"], [{ id_usuario: auth.id_usuario, super_admin: true }, "MEMBERSHIP_REQUIRED"]] as const) {
    await assert.rejects(criarPedido(contexto, criarPedidoBodySchema.parse(body)), { codigo });
  }
  assert.equal(tx.mock.callCount(), 0);
});

test("horário passado é regra de domínio 422 antes de abrir a transação", async () => {
  const tx = simularTransacao(async () => { throw new Error("Não consultar"); });
  await assert.rejects(criarPedido(auth, criarPedidoBodySchema.parse({ ...body, hora_combinada: "2000-01-01T00:00:00Z" })), { codigo: "INVALID_SCHEDULE_TIME", statusHttp: 422 });
  assert.equal(tx.mock.callCount(), 0);
});

test("hora combinada exatamente igual à solicitação é permitida, sem antecedência artificial", async () => {
  const instante = new Date("2099-01-01T12:00:00Z");
  mock.timers.enable({ apis: ["Date"], now: instante });
  const sentinel = new Error("Transação alcançada");
  const tx = simularTransacao(async () => { throw sentinel; });
  await assert.rejects(criarPedido(auth, criarPedidoBodySchema.parse(body)), (erro: unknown) => erro === sentinel);
  assert.equal(tx.mock.callCount(), 1);
});

const { listarMeusPedidos } = await import("../src/modules/pedidos/pedido.service.js");
const { listarMeusPedidosQuerySchema } = await import("../src/modules/pedidos/pedido.schema.js");
const { Prisma } = await import("../src/generated/prisma/client.js");
import type { Prisma as TiposPrisma } from "../src/generated/prisma/client.js";

function simularMetodo<T extends (...args: never[]) => unknown>(objeto: object, nome: string, fn: T) {
  const original: unknown = Reflect.get(objeto, nome);
  const simulado = mock.fn(fn);
  Reflect.set(objeto, nome, simulado);
  restaurar.push(() => { Reflect.set(objeto, nome, original); });
  return simulado;
}
function simularHistorico(pedidos: unknown[] = [], total = pedidos.length) {
  simularMetodo(prisma, "$transaction", async (acao: (tx: TiposPrisma.TransactionClient) => Promise<unknown>, _opcoes: { isolationLevel: string }) => acao(prisma));
  const perfil = simularMetodo(prisma.condomino, "findUnique", async (_args: TiposPrisma.condominoFindUniqueArgs) => ({ id_condomino: auth.id_usuario }));
  const vinculos = simularMetodo(prisma.vinculo_condominio, "findMany", async (_args: TiposPrisma.vinculo_condominioFindManyArgs) => [{ id_vinculo: auth.vinculo_ativo.id_vinculo }]);
  const listar = simularMetodo(prisma.pedido, "findMany", async (_args: TiposPrisma.pedidoFindManyArgs) => pedidos);
  const contar = simularMetodo(prisma.pedido, "count", async (_args: TiposPrisma.pedidoCountArgs) => total);
  return { perfil, vinculos, listar, contar };
}

test("query de meus pedidos aplica defaults, limites, papéis exatos e enum introspectado", () => {
  assert.deepEqual(listarMeusPedidosQuerySchema.parse({}), { pagina: 1, limite: 20 });
  for (const status of ["SOLICITADO", "ACEITO", "RECUSADO", "CANCELADO", "CONCLUIDO"]) {
    assert.deepEqual(listarMeusPedidosQuerySchema.parse({ pagina: "2", limite: "100", papel: "venda", status }), { pagina: 2, limite: 100, papel: "venda", status });
  }
  for (const query of [
    { pagina: "0" }, { pagina: "1.5" }, { pagina: "1e2" }, { pagina: "abc" }, { limite: "0" }, { limite: "101" }, { limite: ["1", "2"] },
    { pagina: "2147483647", limite: "100" }, { papel: "admin" }, { papel: "todos" }, { papel: "comprador" }, { papel: ["compra", "venda"] },
    { status: "PENDENTE" }, { status: "EM_PREPARO" }, { status: "ENTREGUE" }, { status: "solicitado" }, { status: ["SOLICITADO", "ACEITO"] },
    { id_usuario: auth.id_usuario }, { id_vinculo: auth.vinculo_ativo.id_vinculo }, { id_condominio: auth.vinculo_ativo.id_condominio },
  ]) assert.equal(listarMeusPedidosQuerySchema.safeParse(query).success, false, JSON.stringify(query));
});

test("histórico exige identidade e perfil, sem conceder acesso global a super admin", async () => {
  const tx = simularTransacao(async () => { throw new Error("Não consultar"); });
  await assert.rejects(listarMeusPedidos(undefined, listarMeusPedidosQuerySchema.parse({})), { codigo: "UNAUTHENTICATED" });
  assert.equal(tx.mock.callCount(), 0);
  const { vinculos, listar } = simularHistorico();
  simularMetodo(prisma.condomino, "findUnique", async () => null);
  for (const contexto of [{ id_usuario: auth.id_usuario, super_admin: false }, { id_usuario: auth.id_usuario, super_admin: true }]) {
    await assert.rejects(listarMeusPedidos(contexto, listarMeusPedidosQuerySchema.parse({})), { codigo: "CONDOMINO_PROFILE_REQUIRED", statusHttp: 403 });
  }
  assert.equal(vinculos.mock.callCount(), 0); assert.equal(listar.mock.callCount(), 0);
});

test("consulta resolve todos os vínculos da identidade e aplica ownership e status no banco", async () => {
  const { perfil, listar, contar } = simularHistorico([], 7);
  const antigo = "50000000-0000-4000-8000-000000000001";
  const vinculos = simularMetodo(prisma.vinculo_condominio, "findMany", async (_args: TiposPrisma.vinculo_condominioFindManyArgs) => [{ id_vinculo: antigo }, { id_vinculo: auth.vinculo_ativo.id_vinculo }]);
  const resposta = await listarMeusPedidos(auth, listarMeusPedidosQuerySchema.parse({ status: "CONCLUIDO", pagina: "2", limite: "2" }));
  const ids = [antigo, auth.vinculo_ativo.id_vinculo];
  const where = { OR: [{ id_vinculo_comprador: { in: ids } }, { produto: { is: { id_vinculo_vendedor: { in: ids } } } }], status_pedido: "CONCLUIDO" };
  assert.deepEqual(listar.mock.calls[0].arguments[0].where, where);
  assert.deepEqual(contar.mock.calls[0].arguments[0].where, where);
  assert.deepEqual(perfil.mock.calls[0].arguments[0], { where: { id_condomino: auth.id_usuario }, select: { id_condomino: true } });
  assert.deepEqual(vinculos.mock.calls[0].arguments[0], { where: { id_condomino: auth.id_usuario }, select: { id_vinculo: true } });
  assert.equal(listar.mock.calls[0].arguments[0].skip, 2); assert.equal(listar.mock.calls[0].arguments[0].take, 2);
  assert.deepEqual(resposta.paginacao, { pagina: 2, limite: 2, total: 7, total_paginas: 4 });
});

test("sem vínculo ativo usa todos os vínculos sem filtro de status/condomínio; papel restringe apenas a perspectiva", async () => {
  const { vinculos, listar, contar } = simularHistorico();
  for (const papel of ["compra", "venda"] as const) {
    await listarMeusPedidos({ id_usuario: auth.id_usuario, super_admin: false }, listarMeusPedidosQuerySchema.parse({ papel }));
    const where = papel === "compra" ? { id_vinculo_comprador: { in: [auth.vinculo_ativo.id_vinculo] } }
      : { produto: { is: { id_vinculo_vendedor: { in: [auth.vinculo_ativo.id_vinculo] } } } };
    assert.deepEqual(listar.mock.calls.at(-1)!.arguments[0].where, where);
    assert.deepEqual(contar.mock.calls.at(-1)!.arguments[0].where, where);
  }
  assert.deepEqual(vinculos.mock.calls[0].arguments[0], { where: { id_condomino: auth.id_usuario }, select: { id_vinculo: true } });
});

test("select carrega relações em lote e não inclui mensagens, imagens, preço atual ou dados pessoais", async () => {
  const { listar, contar } = simularHistorico();
  const historico = simularMetodo(prisma.pedido_status_historico, "findMany", async () => { throw new Error("N+1"); });
  const produtos = simularMetodo(prisma.produto, "findUnique", async () => { throw new Error("N+1"); });
  await listarMeusPedidos(auth, listarMeusPedidosQuerySchema.parse({}));
  const query = listar.mock.calls[0].arguments[0];
  assert.deepEqual(query.orderBy, [{ hora_solicitacao: "desc" }, { id_pedido: "desc" }]);
  assert.deepEqual(query.select?.pedido_status_historico, { select: { status_anterior: true, status_novo: true, motivo: true, created_at: true }, orderBy: [{ created_at: "asc" }, { id_historico: "asc" }] });
  assert.deepEqual(query.select?.conversa, { select: { status_conversa: true } });
  assert.doesNotMatch(JSON.stringify(query.select), /cpf|data_nascimento|email|status_conta|mensagem|produto_imagem|preco|estoque/);
  assert.equal(listar.mock.callCount(), 1); assert.equal(contar.mock.callCount(), 1);
  assert.equal(historico.mock.callCount(), 0); assert.equal(produtos.mock.callCount(), 0);
});

test("DTO mantém valor congelado e contraparte histórica; conversa ausente não cria dados nem derruba a página", async () => {
  const data = new Date("2026-10-15T20:00:00Z");
  simularHistorico([{
    id_pedido: "pedido", id_vinculo_comprador: auth.vinculo_ativo.id_vinculo, quantidade: 2, valor_pedido: new Prisma.Decimal("50.00"), status_pedido: "CONCLUIDO",
    hora_solicitacao: data, hora_combinada: data, ultima_atualizacao: data,
    produto: { id_produto: idProduto, nome_produto: "Nome atual", vinculo_condominio: { moradia: "A antiga", condomino: { nome_completo: "Vendedor" } } },
    vinculo_condominio: { moradia: "B antiga", condomino: { nome_completo: "Comprador" }, condominio: { id_condominio: "condominio-historico", nome_residencial: "Antigo" } },
    pedido_status_historico: [{ status_anterior: null, status_novo: "SOLICITADO", motivo: null, created_at: data }], conversa: null,
  }]);
  const log = mock.method(console, "warn", () => {});
  const resultado = await listarMeusPedidos(auth, listarMeusPedidosQuerySchema.parse({}));
  assert.equal(resultado.dados[0].valor_pedido, "50.00");
  assert.equal(resultado.dados[0].papel_usuario, "COMPRADOR");
  assert.deepEqual(resultado.dados[0].contraparte, { nome_completo: "Vendedor", moradia: "A antiga" });
  assert.deepEqual(resultado.dados[0].chat, { disponivel: false, status_conversa: null });
  assert.equal(resultado.dados[0].historico[0].created_at, data.toISOString());
  assert.deepEqual(log.mock.calls[0].arguments, [{ evento: "ORDER_CHAT_UNAVAILABLE", id_pedido: "pedido" }]);
  assert.doesNotMatch(JSON.stringify(resultado), /id_vinculo|id_condomino|id_usuario/);
});

test("perfil sem vínculos retorna lista vazia e não consulta pedidos", async () => {
  const { listar, contar } = simularHistorico();
  simularMetodo(prisma.vinculo_condominio, "findMany", async () => []);
  const resposta = await listarMeusPedidos(auth, listarMeusPedidosQuerySchema.parse({}));
  assert.deepEqual(resposta, { dados: [], paginacao: { pagina: 1, limite: 20, total: 0, total_paginas: 0 } });
  assert.equal(listar.mock.callCount(), 0); assert.equal(contar.mock.callCount(), 0);
});

const { atualizarStatusPedidoBodySchema, pedidoParamsSchema } = await import("../src/modules/pedidos/pedido.schema.js");
const { criarMensagemBodySchema, listarMensagensQuerySchema } = await import("../src/modules/chat/chat.schema.js");
const { listarMensagensDaConversa, inserirMensagem } = await import("../src/modules/chat/chat.repository.js");

test("status valida UUID e body estrito, trim e limite de motivo sem aceitar SOLICITADO", () => {
  assert.deepEqual(pedidoParamsSchema.parse({ id: idProduto.toUpperCase() }), { id: idProduto });
  assert.equal(pedidoParamsSchema.safeParse({ id: "invalido" }).success, false);
  assert.deepEqual(atualizarStatusPedidoBodySchema.parse({ status: "ACEITO", motivo: "  Pode buscar  " }), { status: "ACEITO", motivo: "Pode buscar" });
  assert.equal(atualizarStatusPedidoBodySchema.safeParse({ status: "RECUSADO", motivo: "a".repeat(255) }).success, true);
  for (const dados of [{}, { status: "SOLICITADO" }, { status: "aceito" }, { status: "ACEITO", motivo: null }, { status: "ACEITO", motivo: 1 }, { status: "ACEITO", motivo: "a".repeat(256) }, { status: "ACEITO", alterado_por: "forjado" }]) {
    assert.equal(atualizarStatusPedidoBodySchema.safeParse(dados).success, false);
  }
});

test("chat valida conteúdo de 1 a 1000 caracteres após trim e impede remetente/identidade no body", () => {
  assert.deepEqual(criarMensagemBodySchema.parse({ conteudo: "  Olá!\n " }), { conteudo: "Olá!" });
  assert.equal(criarMensagemBodySchema.safeParse({ conteudo: "a".repeat(1000) }).success, true);
  for (const dados of [{}, { conteudo: "" }, { conteudo: " \n\t " }, { conteudo: 1 }, { conteudo: null }, { conteudo: "a".repeat(1001) }, { conteudo: "Olá", id_remetente: auth.id_usuario }, { conteudo: "Olá", id_conversa: idProduto }]) {
    assert.equal(criarMensagemBodySchema.safeParse(dados).success, false);
  }
});

test("paginação do chat usa default 50, máximo 100 e valida overflow, campos desconhecidos e repetidos", () => {
  assert.deepEqual(listarMensagensQuerySchema.parse({}), { pagina: 1, limite: 50 });
  assert.deepEqual(listarMensagensQuerySchema.parse({ pagina: "2", limite: "100" }), { pagina: 2, limite: 100 });
  for (const dados of [{ pagina: "0" }, { pagina: "abc" }, { pagina: "1.5" }, { pagina: "2147483647", limite: "100" }, { limite: "0" }, { limite: "101" }, { pagina: ["1", "2"] }, { status: "ATIVA" }, { id_usuario: auth.id_usuario }]) {
    assert.equal(listarMensagensQuerySchema.safeParse(dados).success, false, JSON.stringify(dados));
  }
});

test("listagem do chat carrega nomes em lote com count no mesmo filtro; envio usa default de data", async () => {
  const listar = simularMetodo(prisma.mensagem, "findMany", async (_args: TiposPrisma.mensagemFindManyArgs) => []);
  const contar = simularMetodo(prisma.mensagem, "count", async (_args: TiposPrisma.mensagemCountArgs) => 3);
  await listarMensagensDaConversa(prisma, "conversa", 2, 2);
  const consulta = listar.mock.calls[0].arguments[0];
  assert.equal(consulta.where, contar.mock.calls[0].arguments[0].where);
  assert.deepEqual(consulta.where, { id_conversa: "conversa" });
  assert.deepEqual(consulta.orderBy, [{ created_at: "asc" }, { id_mensagem: "asc" }]);
  assert.equal(consulta.skip, 2); assert.equal(consulta.take, 2);
  assert.doesNotMatch(JSON.stringify(consulta.select), /cpf|email|data_nascimento|storage_path/);
  const inserir = simularMetodo(prisma.mensagem, "create", async (_args: TiposPrisma.mensagemCreateArgs) => ({}));
  await inserirMensagem(prisma, "conversa", auth.id_usuario, "Olá!");
  assert.deepEqual(inserir.mock.calls[0].arguments[0].data, { id_conversa: "conversa", id_remetente: auth.id_usuario, conteudo: "Olá!" });
});
