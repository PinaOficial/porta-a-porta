import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createServer, request } from "node:http";
import { after, before, mock, test } from "node:test";
import { setTimeout as esperar } from "node:timers/promises";
import { Client } from "pg";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { Prisma, status_pedido_enum, status_vinculo_enum } from "../src/generated/prisma/client.js";
import type { MeusPedidos, ResultadoCriacaoPedido } from "../src/modules/pedidos/pedido.model.js";

const urlTeste = process.env.ONBOARDING_TEST_DATABASE_URL;
if (!urlTeste) throw new Error("Configure ONBOARDING_TEST_DATABASE_URL para o PostgreSQL temporário local.");
const url = new URL(urlTeste);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/porta_onboarding_teste") throw new Error("Integração exige banco local chamado porta_onboarding_teste.");
process.env.DATABASE_URL = urlTeste;
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.SUPABASE_URL = "https://teste.supabase.co";
process.env.SUPABASE_SECRET_KEY = "chave-apenas-para-testes";
const { prisma } = await import("../src/lib/prisma.js");
const { supabaseAdmin } = await import("../src/lib/supabase.js");
const { app } = await import("../src/app.js");
const { criarPedido } = await import("../src/modules/pedidos/pedido.service.js");
const { criarPedidoBodySchema } = await import("../src/modules/pedidos/pedido.schema.js");
const servidor = createServer(app);
const chaves = await generateKeyPair("ES256");
const jwk = { ...await exportJWK(chaves.publicKey), kid: "pedido-teste", alg: "ES256", use: "sig" };
const condominioA = randomUUID();
const condominioB = randomUUID();
const categoria = randomUUID();
const categoriaInativa = randomUUID();
const futuro = "2099-01-01T12:00:00Z";
let base: string;
let comprador: Awaited<ReturnType<typeof criarMorador>>;
let vendedor: Awaited<ReturnType<typeof criarMorador>>;
let admin: Awaited<ReturnType<typeof criarMorador>>;
let outroCondominio: Awaited<ReturnType<typeof criarMorador>>;
let superAdmin: string;
let cenario: Awaited<ReturnType<typeof criarCenarioHistorico>>;
const storage = mock.method(supabaseAdmin.storage, "from", () => { throw new Error("Pedido não deve acessar Storage"); });

async function criarMorador(status: status_vinculo_enum = "ATIVO", idCondominio: string = condominioA, administrador = false) {
  const id = randomUUID();
  await prisma.usuario.create({ data: { id_usuario: id, email: `${id}@exemplo.com` } });
  await prisma.condomino.create({ data: { id_condomino: id, nome_completo: "Morador teste pedido", cpf: String(randomInt(0, 100_000_000_000)).padStart(11, "0"), data_nascimento: new Date("2000-01-01") } });
  const vinculo = await prisma.vinculo_condominio.create({ data: { id_condomino: id, id_condominio: idCondominio, status_vinculo: status, admin_condominio: administrador, moradia: "Apto 101" } });
  return { id, vinculo };
}
async function criarProduto(alteracoes: Partial<Prisma.produtoUncheckedCreateInput> = {}) {
  return prisma.produto.create({ data: { id_vinculo_vendedor: vendedor.vinculo.id_vinculo, id_categoria: categoria, nome_produto: "Bolo", descricao: "Caseiro", preco: "25.90", estoque: 10, ...alteracoes } });
}
async function headers(id: string) {
  const token = await new SignJWT({ super_admin: true, id_condominio: condominioB })
    .setProtectedHeader({ alg: "ES256", kid: jwk.kid }).setSubject(id).setIssuer("https://teste.supabase.co/auth/v1")
    .setAudience("authenticated").setExpirationTime("5m").sign(chaves.privateKey);
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}
async function solicitar(idProduto: string, quantidade = 1, idUsuario: string = comprador.id, alteracoes: object = {}) {
  return fetch(`${base}/pedidos`, { method: "POST", headers: await headers(idUsuario), body: JSON.stringify({ id_produto: idProduto, quantidade, hora_combinada: futuro, ...alteracoes }) });
}
async function confirmarErro(resposta: globalThis.Response, status: number, codigo: string) {
  assert.equal(resposta.status, status);
  const json = await resposta.json();
  assert.equal(json.erro, codigo);
  assert.doesNotMatch(JSON.stringify(json), /CPF|DATABASE_URL|SUPABASE_SECRET_KEY|storage_path|senha/);
}
async function estado(idProduto: string) {
  return {
    produto: await prisma.produto.findUnique({ where: { id_produto: idProduto } }),
    pedidos: await prisma.pedido.count(), historicos: await prisma.pedido_status_historico.count(),
    conversas: await prisma.conversa.count(), participantes: await prisma.conversa_participante.count(),
    mensagens: await prisma.mensagem.count(), auditorias: await prisma.auditoria.count(),
  };
}
async function semEfeito(idProduto: string, acao: () => Promise<void>) {
  const antes = await estado(idProduto); await acao(); assert.deepEqual(await estado(idProduto), antes);
}
async function confirmarCriado(resposta: globalThis.Response) {
  assert.equal(resposta.status, 201);
  const json = await resposta.json() as ResultadoCriacaoPedido;
  assert.deepEqual(Object.keys(json), ["dados"]);
  assert.deepEqual(Object.keys(json.dados).sort(), ["id_pedido", "id_produto", "quantidade", "valor_pedido", "status_pedido", "hora_solicitacao", "hora_combinada", "ultima_atualizacao", "produto"].sort());
  assert.doesNotMatch(JSON.stringify(json), /cpf|email|data_nascimento|id_vinculo|storage_path|id_condomino|id_usuario/);
  return json.dados;
}

before(async () => {
  const fetchOriginal = globalThis.fetch;
  mock.method(globalThis, "fetch", async (...args: Parameters<typeof fetch>) => String(args[0]) === "https://teste.supabase.co/auth/v1/.well-known/jwks.json"
    ? new globalThis.Response(JSON.stringify({ keys: [jwk] })) : fetchOriginal(...args));
  await prisma.condominio.createMany({ data: [
    { id_condominio: condominioA, nome_residencial: "Pedidos A", cep: "70000000", endereco: "Rua A" },
    { id_condominio: condominioB, nome_residencial: "Pedidos B", cep: "70000001", endereco: "Rua B" },
  ] });
  await prisma.categoria_produto.createMany({ data: [ { id_categoria: categoria, nome: `Pedido ${randomUUID()}` }, { id_categoria: categoriaInativa, nome: `Inativa ${randomUUID()}`, ativo: false } ] });
  comprador = await criarMorador(); vendedor = await criarMorador(); admin = await criarMorador("ATIVO", condominioA, true); outroCondominio = await criarMorador("ATIVO", condominioB);
  superAdmin = randomUUID();
  await prisma.usuario.create({ data: { id_usuario: superAdmin, email: `${superAdmin}@exemplo.com` } });
  await prisma.super_admin.create({ data: { id_super_admin: superAdmin } });
  cenario = await criarCenarioHistorico();
  servidor.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { servidor.once("listening", resolve); servidor.once("error", reject); });
  const endereco = servidor.address(); assert.ok(endereco && typeof endereco === "object"); base = `http://127.0.0.1:${endereco.port}/api`;
});
after(async () => {
  assert.equal(storage.mock.callCount(), 0);
  await new Promise<void>((resolve) => servidor.close(() => resolve())); mock.restoreAll(); await prisma.$disconnect();
});

test("sem token ou JWT inválido retorna 401 sem efeitos", async () => {
  const produto = await criarProduto();
  await semEfeito(produto.id_produto, async () => {
    for (const h of [{}, { Authorization: "Bearer invalido" }] as Record<string, string>[]) {
      await confirmarErro(await fetch(`${base}/pedidos`, { method: "POST", headers: h }), 401, "UNAUTHENTICATED");
    }
  });
});

test("sem onboarding, todos os vínculos não ativos e super admin recebem 403", async () => {
  const produto = await criarProduto();
  const ids = [randomUUID(), superAdmin];
  for (const status of ["PENDENTE", "REJEITADO", "SUSPENSO", "ENCERRADO"] as const) ids.push((await criarMorador(status)).id);
  await semEfeito(produto.id_produto, async () => { for (const id of ids) await confirmarErro(await solicitar(produto.id_produto, 1, id), 403, "MEMBERSHIP_REQUIRED"); });
});

test("conta global suspensa é bloqueada mesmo com vínculo ativo", async () => {
  const suspenso = await criarMorador(); const produto = await criarProduto();
  await prisma.usuario.update({ where: { id_usuario: suspenso.id }, data: { status_conta: "SUSPENSA" } });
  await semEfeito(produto.id_produto, async () => { await confirmarErro(await solicitar(produto.id_produto, 1, suspenso.id), 403, "ACCOUNT_SUSPENDED"); });
});

test("body inválido: quantidades, UUIDs, datas sem timezone/impossíveis e campos ausentes retornam 400", async () => {
  const produto = await criarProduto();
  const valido = { id_produto: produto.id_produto, quantidade: 1, hora_combinada: futuro };
  const casos: object[] = [0, -1, 1.5, "2", 2_147_483_648, null, true].map((quantidade) => ({ ...valido, quantidade }));
  casos.push({ ...valido, id_produto: "abc" }, { ...valido, hora_combinada: "2099-01-01T12:00:00" }, { ...valido, hora_combinada: "2099-02-30T12:00:00Z" });
  for (const campo of Object.keys(valido)) { const incompleto: Record<string, unknown> = { ...valido }; delete incompleto[campo]; casos.push(incompleto); }
  await semEfeito(produto.id_produto, async () => {
    for (const dados of casos) await confirmarErro(await fetch(`${base}/pedidos`, { method: "POST", headers: await headers(comprador.id), body: JSON.stringify(dados) }), 400, "VALIDATION_ERROR");
  });
});

test("campos forjados de comprador, vendedor, tenant, preço, status, horários e participantes são recusados", async () => {
  const produto = await criarProduto();
  await semEfeito(produto.id_produto, async () => {
    for (const campo of ["id_pedido", "id_vinculo_comprador", "id_vinculo_vendedor", "id_condominio", "preco", "valor_pedido", "status_pedido", "hora_solicitacao", "ultima_atualizacao", "id_conversa", "id_usuario_vendedor", "participantes"]) {
      await confirmarErro(await solicitar(produto.id_produto, 1, comprador.id, { [campo]: "forjado" }), 400, "VALIDATION_ERROR");
    }
  });
});

test("produto inexistente, compra própria e outro condomínio são negados sem alterar estoque", async () => {
  const produto = await criarProduto();
  await semEfeito(produto.id_produto, async () => {
    await confirmarErro(await solicitar(randomUUID()), 404, "PRODUCT_NOT_FOUND");
    await confirmarErro(await solicitar(produto.id_produto, 1, vendedor.id), 409, "CANNOT_BUY_OWN_PRODUCT");
    await confirmarErro(await solicitar(produto.id_produto, 1, outroCondominio.id), 403, "FORBIDDEN_CROSS_TENANT");
  });
});

test("produto inativo e vendedor PENDENTE/REJEITADO/SUSPENSO/ENCERRADO são indisponíveis", async () => {
  const inativo = await criarProduto({ ativo: false });
  await semEfeito(inativo.id_produto, async () => { await confirmarErro(await solicitar(inativo.id_produto), 409, "PRODUCT_UNAVAILABLE"); });
  for (const status of ["PENDENTE", "REJEITADO", "SUSPENSO", "ENCERRADO"] as const) {
    const morador = await criarMorador(status); const produto = await criarProduto({ id_vinculo_vendedor: morador.vinculo.id_vinculo });
    await semEfeito(produto.id_produto, async () => { await confirmarErro(await solicitar(produto.id_produto), 409, "PRODUCT_UNAVAILABLE"); });
  }
});

test("estoque insuficiente e hora passada retornam erro de domínio sem gravações", async () => {
  const produto = await criarProduto({ estoque: 3 });
  await semEfeito(produto.id_produto, async () => {
    await confirmarErro(await solicitar(produto.id_produto, 4), 409, "INSUFFICIENT_STOCK");
    await confirmarErro(await solicitar(produto.id_produto, 1, comprador.id, { hora_combinada: "2000-01-01T00:00:00Z" }), 422, "INVALID_SCHEDULE_TIME");
  });
});

test("sucesso reserva estoque, congela Decimal, histórico inicial, conversa ATIVA e dois participantes sem mensagem", async () => {
  const produto = await criarProduto(); const antes = await estado(produto.id_produto);
  const imagem = await prisma.produto_imagem.create({ data: { id_produto: produto.id_produto, storage_path: `privado/${randomUUID()}.png` } });
  const pedido = await confirmarCriado(await solicitar(produto.id_produto, 2));
  assert.equal(pedido.valor_pedido, "51.80"); assert.equal(pedido.status_pedido, "SOLICITADO");
  assert.equal(pedido.hora_solicitacao, pedido.ultima_atualizacao);
  assert.deepEqual(pedido.produto, { id_produto: produto.id_produto, nome_produto: "Bolo" });
  const persistido = await prisma.pedido.findUniqueOrThrow({ where: { id_pedido: pedido.id_pedido } });
  assert.equal(persistido.id_vinculo_comprador, comprador.vinculo.id_vinculo);
  const historicos = await prisma.pedido_status_historico.findMany({ where: { id_pedido: pedido.id_pedido } });
  assert.equal(historicos.length, 1); assert.equal(historicos[0].status_anterior, null); assert.equal(historicos[0].status_novo, "SOLICITADO");
  assert.equal(historicos[0].alterado_por, comprador.id); assert.equal(historicos[0].motivo, null);
  const conversas = await prisma.conversa.findMany({ where: { id_pedido: pedido.id_pedido }, include: { conversa_participante: true, mensagem: true } });
  assert.equal(conversas.length, 1); assert.equal(conversas[0].status_conversa, "ATIVA");
  assert.deepEqual(conversas[0].mensagem, []);
  assert.deepEqual(conversas[0].conversa_participante.map((p) => p.id_usuario).sort(), [comprador.id, vendedor.id].sort());
  const depois = await estado(produto.id_produto);
  assert.deepEqual(depois.produto, { ...produto, estoque: produto.estoque - 2, updated_at: depois.produto!.updated_at });
  assert.equal(depois.mensagens, antes.mensagens); assert.equal(depois.auditorias, antes.auditorias);
  assert.deepEqual(await prisma.produto_imagem.findUnique({ where: { id_imagem: imagem.id_imagem } }), imagem);
  const edicao = await fetch(`${base}/produtos/${produto.id_produto}`, { method: "PATCH", headers: await headers(vendedor.id), body: JSON.stringify({ preco: "30.00" }) });
  assert.equal(edicao.status, 200);
  assert.equal((await prisma.pedido.findUniqueOrThrow({ where: { id_pedido: pedido.id_pedido } })).valor_pedido.toFixed(2), "51.80");
});

test("admin local compra como morador e categoria inativa não adiciona restrição ao pedido", async () => {
  const produto = await criarProduto({ id_categoria: categoriaInativa });
  const pedido = await confirmarCriado(await solicitar(produto.id_produto, 1, admin.id));
  assert.equal((await prisma.pedido.findUniqueOrThrow({ where: { id_pedido: pedido.id_pedido } })).id_vinculo_comprador, admin.vinculo.id_vinculo);
});

test("timezone -03:00 e Z equivalentes são persistidos no mesmo instante TIMESTAMPTZ", async () => {
  const produto = await criarProduto();
  for (const hora_combinada of ["2099-01-01T09:00:00-03:00", "2099-01-01T12:00:00Z"]) {
    const pedido = await confirmarCriado(await solicitar(produto.id_produto, 1, comprador.id, { hora_combinada }));
    assert.equal(pedido.hora_combinada, "2099-01-01T12:00:00.000Z");
    assert.equal((await prisma.pedido.findUniqueOrThrow({ where: { id_pedido: pedido.id_pedido } })).hora_combinada.getTime(), new Date(futuro).getTime());
  }
});

test("limites técnicos INTEGER/NUMERIC são aceitos; overflow do total provoca rollback após reserva", async () => {
  const inteiro = await criarProduto({ preco: "0.01", estoque: 2_147_483_647 });
  assert.equal((await confirmarCriado(await solicitar(inteiro.id_produto, 2_147_483_647))).valor_pedido, "21474836.47");
  const maximo = await criarProduto({ preco: "9999999999.99", estoque: 3 });
  assert.equal((await confirmarCriado(await solicitar(maximo.id_produto))).valor_pedido, "9999999999.99");
  await semEfeito(maximo.id_produto, async () => { await confirmarErro(await solicitar(maximo.id_produto, 2), 422, "ORDER_VALUE_OUT_OF_RANGE"); });
});

for (const [estoque, quantidade] of [[1, 1], [3, 2]]) {
  test(`duas requisições concorrentes: estoque ${estoque}, quantidade ${quantidade}, uma única reserva`, async () => {
    const produto = await criarProduto({ estoque });
    const respostas = await Promise.all([solicitar(produto.id_produto, quantidade), solicitar(produto.id_produto, quantidade)]);
    assert.deepEqual(respostas.map((r) => r.status).sort(), [201, 409]);
    await confirmarCriado(respostas.find((r) => r.status === 201)!);
    await confirmarErro(respostas.find((r) => r.status === 409)!, 409, "INSUFFICIENT_STOCK");
    assert.equal((await prisma.produto.findUniqueOrThrow({ where: { id_produto: produto.id_produto } })).estoque, estoque - quantidade);
    assert.equal(await prisma.pedido.count({ where: { id_produto: produto.id_produto } }), 1);
  });
}

test("dez requisições simultâneas disputam três unidades sem estoque negativo nem pedidos incompletos", async () => {
  const produto = await criarProduto({ estoque: 3 });
  const respostas = await Promise.all(Array.from({ length: 10 }, () => solicitar(produto.id_produto)));
  assert.equal(respostas.filter((r) => r.status === 201).length, 3);
  for (const resposta of respostas) if (resposta.status !== 201) await confirmarErro(resposta, 409, "INSUFFICIENT_STOCK");
  assert.equal((await prisma.produto.findUniqueOrThrow({ where: { id_produto: produto.id_produto } })).estoque, 0);
  const pedidos = await prisma.pedido.findMany({ where: { id_produto: produto.id_produto }, include: { pedido_status_historico: true, conversa: { include: { conversa_participante: true } } } });
  assert.equal(pedidos.length, 3);
  assert.ok(pedidos.every((p) => p.pedido_status_historico.length === 1 && p.conversa?.conversa_participante.length === 2));
});

for (const etapa of ["pedido", "historico", "conversa", "participantes"] as const) {
  test(`falha real de FK em ${etapa} reverte estoque e todas as gravações da transação`, async () => {
    const produto = await criarProduto();
    const originalTx = prisma.$transaction;
    Reflect.set(prisma, "$transaction", (acao: (tx: Prisma.TransactionClient) => Promise<unknown>, opcoes: { isolationLevel: Prisma.TransactionIsolationLevel }) => originalTx.call(prisma, async (tx: Prisma.TransactionClient) => {
      let restaurar = () => {};
      if (etapa === "pedido") {
        const original = tx.pedido.create;
        Reflect.set(tx.pedido, "create", (args: Prisma.pedidoCreateArgs) => original({ ...args, data: { ...(args.data as Prisma.pedidoUncheckedCreateInput), id_produto: randomUUID() } }));
        restaurar = () => { Reflect.set(tx.pedido, "create", original); };
      }
      if (etapa === "historico") {
        const original = tx.pedido_status_historico.create;
        Reflect.set(tx.pedido_status_historico, "create", (args: Prisma.pedido_status_historicoCreateArgs) => original({ ...args, data: { ...(args.data as Prisma.pedido_status_historicoUncheckedCreateInput), alterado_por: randomUUID() } }));
        restaurar = () => { Reflect.set(tx.pedido_status_historico, "create", original); };
      }
      if (etapa === "conversa") {
        const original = tx.conversa.create;
        Reflect.set(tx.conversa, "create", (args: Prisma.conversaCreateArgs) => original({ ...args, data: { ...(args.data as Prisma.conversaUncheckedCreateInput), id_pedido: randomUUID() } }));
        restaurar = () => { Reflect.set(tx.conversa, "create", original); };
      }
      if (etapa === "participantes") {
        const original = tx.conversa_participante.createMany;
        Reflect.set(tx.conversa_participante, "createMany", (args: Prisma.conversa_participanteCreateManyArgs) => {
          assert.ok(Array.isArray(args.data));
          return original({ ...args, data: args.data.map((p, i) => i === 1 ? { ...p, id_usuario: randomUUID() } : p) });
        });
        restaurar = () => { Reflect.set(tx.conversa_participante, "createMany", original); };
      }
      try { return await acao(tx); } finally { restaurar(); }
    }, opcoes));
    const log = mock.method(console, "error", () => {});
    try {
      await semEfeito(produto.id_produto, async () => { await confirmarErro(await solicitar(produto.id_produto, 2), 500, "INTERNAL_ERROR"); });
      assert.deepEqual(log.mock.calls[0].arguments, [{ evento: "INTERNAL_ERROR", tipo: "PrismaClientKnownRequestError" }]);
    } finally { Reflect.set(prisma, "$transaction", originalTx); log.mock.restore(); }
  });
}

async function aguardarBloqueio(client: Client) {
  for (let i = 0; i < 150; i++) {
    const resultado = await client.query("SELECT count(*)::int AS quantidade FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()");
    if (resultado.rows[0].quantidade > 0) return;
    await esperar(20);
  }
  assert.fail("A requisição não alcançou o bloqueio esperado");
}

for (const alteracao of ["preco", "inativo"] as const) {
  test(`edição concorrente de ${alteracao} que vence antes da reserva é respeitada`, async () => {
    const produto = await criarProduto();
    const client = new Client({ connectionString: urlTeste }); await client.connect();
    let resposta: Promise<globalThis.Response> | undefined;
    try {
      await client.query("BEGIN");
      await client.query(alteracao === "preco" ? "UPDATE produto SET preco = 30.00 WHERE id_produto = $1" : "UPDATE produto SET ativo = false WHERE id_produto = $1", [produto.id_produto]);
      resposta = solicitar(produto.id_produto, 2);
      await aguardarBloqueio(client);
      await client.query("COMMIT");
      if (alteracao === "preco") assert.equal((await confirmarCriado(await resposta)).valor_pedido, "60.00");
      else {
        await confirmarErro(await resposta, 409, "PRODUCT_UNAVAILABLE");
        assert.equal((await prisma.produto.findUniqueOrThrow({ where: { id_produto: produto.id_produto } })).estoque, produto.estoque);
        assert.equal(await prisma.pedido.count({ where: { id_produto: produto.id_produto } }), 0);
      }
    } finally { await client.query("ROLLBACK"); await client.end(); if (resposta) await resposta; }
  });
}

for (const papel of ["comprador", "vendedor"] as const) {
  test(`suspensão concorrente do ${papel} após autenticação é detectada pela revalidação transacional`, async () => {
    const morador = await criarMorador();
    const produto = await criarProduto(papel === "vendedor" ? { id_vinculo_vendedor: morador.vinculo.id_vinculo } : {});
    const client = new Client({ connectionString: urlTeste }); await client.connect();
    let resposta: Promise<globalThis.Response> | undefined;
    try {
      await client.query("BEGIN"); await client.query("UPDATE vinculo_condominio SET status_vinculo = 'SUSPENSO' WHERE id_vinculo = $1", [morador.vinculo.id_vinculo]);
      resposta = solicitar(produto.id_produto, 1, papel === "comprador" ? morador.id : comprador.id);
      await aguardarBloqueio(client); await client.query("COMMIT");
      await confirmarErro(await resposta, papel === "comprador" ? 403 : 409, papel === "comprador" ? "MEMBERSHIP_REQUIRED" : "PRODUCT_UNAVAILABLE");
      assert.equal((await prisma.produto.findUniqueOrThrow({ where: { id_produto: produto.id_produto } })).estoque, produto.estoque);
      assert.equal(await prisma.pedido.count({ where: { id_produto: produto.id_produto } }), 0);
    } finally { await client.query("ROLLBACK"); await client.end(); if (resposta) await resposta; }
  });
}

test("service revalida identidade e condomínio do comprador no banco sem confiar no contexto antigo", async () => {
  const produto = await criarProduto();
  const auth = { id_usuario: comprador.id, super_admin: false, vinculo_ativo: { id_vinculo: comprador.vinculo.id_vinculo, id_condominio: condominioB, admin_condominio: false } };
  const pedido = await criarPedido(auth, criarPedidoBodySchema.parse({ id_produto: produto.id_produto, quantidade: 1, hora_combinada: futuro }));
  assert.equal(pedido.dados.id_produto, produto.id_produto);
  await semEfeito(produto.id_produto, async () => {
    await assert.rejects(criarPedido({ ...auth, id_usuario: vendedor.id }, criarPedidoBodySchema.parse({ id_produto: produto.id_produto, quantidade: 1, hora_combinada: futuro })), { codigo: "MEMBERSHIP_REQUIRED" });
  });
});

async function criarPedidoHistorico(idComprador: string, idProduto: string, status: status_pedido_enum = "SOLICITADO", instante = new Date("2020-01-01T00:00:00Z")) {
  const pedido = await prisma.pedido.create({ data: {
    id_vinculo_comprador: idComprador, id_produto: idProduto, quantidade: 2, valor_pedido: "50.00", status_pedido: status,
    hora_solicitacao: instante, ultima_atualizacao: instante, hora_combinada: new Date("2099-01-01T00:00:00Z"),
  } });
  const vinculoComprador = await prisma.vinculo_condominio.findUniqueOrThrow({ where: { id_vinculo: idComprador }, select: { id_condomino: true } });
  const produto = await prisma.produto.findUniqueOrThrow({ where: { id_produto: idProduto }, select: { vinculo_condominio: { select: { id_condomino: true } } } });
  await prisma.pedido_status_historico.create({ data: { id_pedido: pedido.id_pedido, status_anterior: null, status_novo: "SOLICITADO", alterado_por: vinculoComprador.id_condomino, created_at: instante } });
  const conversa = await prisma.conversa.create({ data: { id_pedido: pedido.id_pedido,
    conversa_participante: { createMany: { data: [{ id_usuario: vinculoComprador.id_condomino }, { id_usuario: produto.vinculo_condominio.id_condomino }] } },
  } });
  return { pedido, conversa };
}

async function criarCenarioHistorico() {
  const pessoa = await criarMorador("ENCERRADO");
  await prisma.vinculo_condominio.update({ where: { id_vinculo: pessoa.vinculo.id_vinculo }, data: { moradia: "Moradia antiga da pessoa" } });
  const atual = await prisma.vinculo_condominio.create({ data: { id_condomino: pessoa.id, id_condominio: condominioB, status_vinculo: "ATIVO", moradia: "Moradia atual da pessoa" } });
  const vizinhoA = await criarMorador();
  const vizinhoB = await criarMorador("ATIVO", condominioB);
  await prisma.condomino.update({ where: { id_condomino: vizinhoA.id }, data: { nome_completo: "Vizinho histórico A" } });
  await prisma.condomino.update({ where: { id_condomino: vizinhoB.id }, data: { nome_completo: "Vizinho B" } });
  await prisma.vinculo_condominio.update({ where: { id_vinculo: vizinhoA.vinculo.id_vinculo }, data: { moradia: "Apto antigo do vizinho" } });
  const produtoA = await criarProduto({ id_vinculo_vendedor: pessoa.vinculo.id_vinculo, ativo: false, id_categoria: categoriaInativa });
  const produtoB = await criarProduto({ id_vinculo_vendedor: atual.id_vinculo });
  const produtoVizinhoA = await criarProduto({ id_vinculo_vendedor: vizinhoA.vinculo.id_vinculo });
  const produtoVizinhoB = await criarProduto({ id_vinculo_vendedor: vizinhoB.vinculo.id_vinculo });
  const pedidos = [
    (await criarPedidoHistorico(pessoa.vinculo.id_vinculo, produtoVizinhoA.id_produto, "SOLICITADO")).pedido,
    (await criarPedidoHistorico(vizinhoA.vinculo.id_vinculo, produtoA.id_produto, "ACEITO")).pedido,
    (await criarPedidoHistorico(atual.id_vinculo, produtoVizinhoB.id_produto, "CONCLUIDO", new Date("2021-01-01T00:00:00Z"))).pedido,
    (await criarPedidoHistorico(vizinhoB.vinculo.id_vinculo, produtoB.id_produto, "RECUSADO", new Date("2021-01-01T00:00:00Z"))).pedido,
    (await criarPedidoHistorico(pessoa.vinculo.id_vinculo, produtoVizinhoA.id_produto, "CANCELADO")).pedido,
    (await criarPedidoHistorico(vizinhoB.vinculo.id_vinculo, produtoB.id_produto, "SOLICITADO", new Date("2022-01-01T00:00:00Z"))).pedido,
  ].sort((a, b) => b.hora_solicitacao.getTime() - a.hora_solicitacao.getTime() || b.id_pedido.localeCompare(a.id_pedido));
  // Pedidos entre terceiros nos mesmos condomínios ficam fora do ownership da pessoa.
  const alheios = [
    (await criarPedidoHistorico(vendedor.vinculo.id_vinculo, produtoVizinhoA.id_produto)).pedido,
    (await criarPedidoHistorico(outroCondominio.vinculo.id_vinculo, produtoVizinhoB.id_produto)).pedido,
  ];
  await prisma.vinculo_condominio.update({ where: { id_vinculo: vizinhoA.vinculo.id_vinculo }, data: { status_vinculo: "ENCERRADO" } });
  await prisma.vinculo_condominio.create({ data: { id_condomino: vizinhoA.id, id_condominio: condominioB, status_vinculo: "ATIVO", moradia: "Moradia atual que não deve aparecer no pedido antigo" } });
  await prisma.produto.update({ where: { id_produto: produtoVizinhoA.id_produto }, data: { ativo: false, id_categoria: categoriaInativa, preco: "999.99", nome_produto: "Nome atualizado do produto" } });
  return { pessoa, atual, vizinhoA, vizinhoB, pedidos, alheios, produtoA, produtoB, produtoVizinhoA, produtoVizinhoB };
}

async function consultarMeusPedidos(idUsuario: string, query = "") {
  const resposta = await fetch(`${base}/pedidos/me${query}`, { headers: await headers(idUsuario) });
  assert.equal(resposta.status, 200);
  const resultado = await resposta.json() as MeusPedidos;
  assert.deepEqual(Object.keys(resultado).sort(), ["dados", "paginacao"]);
  assert.doesNotMatch(JSON.stringify(resultado), /cpf|data_nascimento|email|status_conta|senha|JWT|refresh_token|SUPABASE_SECRET_KEY|storage_path|id_vinculo|id_usuario|id_condomino/);
  for (const item of resultado.dados) {
    assert.deepEqual(Object.keys(item).sort(), ["id_pedido", "papel_usuario", "quantidade", "valor_pedido", "status_pedido", "hora_solicitacao", "hora_combinada", "ultima_atualizacao", "produto", "contraparte", "condominio", "historico", "chat"].sort());
    assert.deepEqual(Object.keys(item.contraparte).sort(), ["nome_completo", "moradia"].sort());
    assert.deepEqual(Object.keys(item.produto).sort(), ["id_produto", "nome_produto"]);
    assert.match(item.valor_pedido, /^\d+\.\d{2}$/);
    assert.equal(new Date(item.hora_solicitacao).toISOString(), item.hora_solicitacao);
  }
  return resultado;
}

test("GET /pedidos/me exige JWT válido e bloqueia conta global suspensa", async () => {
  for (const h of [{}, { Authorization: "Bearer invalido" }] as Record<string, string>[]) {
    await confirmarErro(await fetch(`${base}/pedidos/me`, { headers: h }), 401, "UNAUTHENTICATED");
  }
  const pessoa = await criarMorador();
  await prisma.usuario.update({ where: { id_usuario: pessoa.id }, data: { status_conta: "SUSPENSA" } });
  await confirmarErro(await fetch(`${base}/pedidos/me`, { headers: await headers(pessoa.id) }), 403, "ACCOUNT_SUSPENDED");
});

test("GET exige perfil de condômino e não permite super admin consultar pedidos de terceiros", async () => {
  const registrado = randomUUID();
  await prisma.usuario.create({ data: { id_usuario: registrado, email: `${registrado}@exemplo.com` } });
  for (const id of [randomUUID(), registrado, superAdmin]) {
    await confirmarErro(await fetch(`${base}/pedidos/me`, { headers: await headers(id) }), 403, "CONDOMINO_PROFILE_REQUIRED");
  }
});

test("GET para perfil com vínculo ativo/pendente/rejeitado sem pedidos retorna 200 e lista vazia", async () => {
  for (const status of ["ATIVO", "PENDENTE", "REJEITADO"] as const) {
    const pessoa = await criarMorador(status);
    assert.deepEqual(await consultarMeusPedidos(pessoa.id), { dados: [], paginacao: { pagina: 1, limite: 20, total: 0, total_paginas: 0 } });
  }
});

test("GET reúne compras e vendas de todos os vínculos, sem incluir terceiros em nenhum condomínio", async () => {
  const resultado = await consultarMeusPedidos(cenario.pessoa.id);
  assert.deepEqual(resultado.dados.map((p) => p.id_pedido), cenario.pedidos.map((p) => p.id_pedido));
  assert.deepEqual(resultado.paginacao, { pagina: 1, limite: 20, total: 6, total_paginas: 1 });
  assert.ok(resultado.dados.some((p) => p.papel_usuario === "COMPRADOR"));
  assert.ok(resultado.dados.some((p) => p.papel_usuario === "VENDEDOR"));
  assert.ok(cenario.alheios.every((p) => !resultado.dados.some((item) => item.id_pedido === p.id_pedido)));
  assert.deepEqual(new Set(resultado.dados.map((p) => p.condominio.id_condominio)), new Set([condominioA, condominioB]));
});

test("papel=compra e papel=venda filtram no banco e derivam a perspectiva correta", async () => {
  const ids = new Set([cenario.pessoa.vinculo.id_vinculo, cenario.atual.id_vinculo]);
  for (const papel of ["compra", "venda"] as const) {
    const esperado = cenario.pedidos.filter((p) => papel === "compra" ? ids.has(p.id_vinculo_comprador) : !ids.has(p.id_vinculo_comprador));
    const resultado = await consultarMeusPedidos(cenario.pessoa.id, `?papel=${papel}`);
    assert.deepEqual(resultado.dados.map((p) => p.id_pedido), esperado.map((p) => p.id_pedido));
    assert.equal(resultado.paginacao.total, esperado.length);
    assert.ok(resultado.dados.every((p) => p.papel_usuario === (papel === "compra" ? "COMPRADOR" : "VENDEDOR")));
  }
});

test("todos os cinco estados, inclusive terminais, são listados e filtráveis sem perder ownership", async () => {
  for (const status of ["SOLICITADO", "ACEITO", "RECUSADO", "CANCELADO", "CONCLUIDO"] as const) {
    const resultado = await consultarMeusPedidos(cenario.pessoa.id, `?status=${status}`);
    const esperado = cenario.pedidos.filter((p) => p.status_pedido === status);
    assert.deepEqual(resultado.dados.map((p) => p.id_pedido), esperado.map((p) => p.id_pedido));
    assert.equal(resultado.paginacao.total, esperado.length);
  }
});

test("paginação estável por solicitação/UUID descendentes mantém count filtrado e página além do fim", async () => {
  for (const pagina of [1, 2, 3, 4]) {
    const resultado = await consultarMeusPedidos(cenario.pessoa.id, `?pagina=${pagina}&limite=2`);
    assert.deepEqual(resultado.dados.map((p) => p.id_pedido), cenario.pedidos.slice((pagina - 1) * 2, pagina * 2).map((p) => p.id_pedido));
    assert.deepEqual(resultado.paginacao, { pagina, limite: 2, total: 6, total_paginas: 3 });
  }
  const combinado = await consultarMeusPedidos(cenario.pessoa.id, "?papel=venda&status=SOLICITADO&pagina=1&limite=1");
  assert.equal(combinado.dados.length, 1); assert.equal(combinado.dados[0].papel_usuario, "VENDEDOR");
  assert.equal(combinado.dados[0].status_pedido, "SOLICITADO"); assert.equal(combinado.paginacao.total, 1);
  assert.deepEqual((await consultarMeusPedidos(cenario.pessoa.id, "?papel=compra&status=RECUSADO")).dados, []);
  assert.equal((await consultarMeusPedidos(cenario.pessoa.id, "?limite=100")).dados.length, 6);
});

test("query inválida, repetida ou de impersonation retorna 400, inclusive para super admin", async () => {
  for (const query of [
    "pagina=0", "pagina=abc", "pagina=1.5", "pagina=1e2", "limite=0", "limite=101", "limite=1&limite=2", "pagina=2147483647&limite=100",
    "papel=admin", "papel=todos", "papel=comprador", "papel=compra&papel=venda", "status=PENDENTE", "status=EM_PREPARO", "status=ENTREGUE", "status=abc", "status=SOLICITADO&status=ACEITO",
    `id_usuario=${comprador.id}`, `id_vinculo=${comprador.vinculo.id_vinculo}`, `id_condominio=${condominioA}`, `user_id=${comprador.id}`, "vinculo=forjado", "condominio=forjado",
  ]) {
    for (const id of [cenario.pessoa.id, superAdmin]) {
      await confirmarErro(await fetch(`${base}/pedidos/me?${query}`, { headers: await headers(id) }), 400, "VALIDATION_ERROR");
    }
  }
});

test("GET não usa body para obter identidade alternativa", async () => {
  const dados = JSON.stringify({ id_usuario: comprador.id });
  const cabecalhos = await headers(cenario.pessoa.id);
  const resposta = await new Promise<{ status?: number; body: string }>((resolve, reject) => {
    const req = request(`${base}/pedidos/me`, { method: "GET", headers: { ...cabecalhos, "Content-Length": Buffer.byteLength(dados) } }, (res) => {
      let body = ""; res.setEncoding("utf8"); res.on("data", (item: string) => { body += item; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject); req.end(dados);
  });
  assert.equal(resposta.status, 400); assert.equal(JSON.parse(resposta.body).erro, "VALIDATION_ERROR");
});

test("contraparte e condomínio vêm do vínculo da negociação, mesmo após mudança de ambas as pessoas", async () => {
  const compras = await consultarMeusPedidos(cenario.pessoa.id, "?papel=compra");
  const compraAntiga = compras.dados.find((p) => p.produto.id_produto === cenario.produtoVizinhoA.id_produto)!;
  assert.deepEqual(compraAntiga.contraparte, { nome_completo: "Vizinho histórico A", moradia: "Apto antigo do vizinho" });
  assert.deepEqual(compraAntiga.condominio, { id_condominio: condominioA, nome_residencial: "Pedidos A" });
  assert.equal(compraAntiga.produto.nome_produto, "Nome atualizado do produto"); assert.equal(compraAntiga.valor_pedido, "50.00");
  const vendas = await consultarMeusPedidos(cenario.pessoa.id, "?papel=venda");
  const vendaAntiga = vendas.dados.find((p) => p.produto.id_produto === cenario.produtoA.id_produto)!;
  assert.deepEqual(vendaAntiga.contraparte, { nome_completo: "Vizinho histórico A", moradia: "Apto antigo do vizinho" });
  assert.deepEqual(vendaAntiga.condominio, compraAntiga.condominio);
});

test("sem vínculo ativo, com vínculo encerrado ou suspenso, mantém todo o histórico próprio", async () => {
  for (const status of ["ENCERRADO", "SUSPENSO"] as const) {
    await prisma.vinculo_condominio.update({ where: { id_vinculo: cenario.atual.id_vinculo }, data: { status_vinculo: status } });
    try {
      assert.deepEqual((await consultarMeusPedidos(cenario.pessoa.id)).dados.map((p) => p.id_pedido), cenario.pedidos.map((p) => p.id_pedido));
    } finally { await prisma.vinculo_condominio.update({ where: { id_vinculo: cenario.atual.id_vinculo }, data: { status_vinculo: "ATIVO" } }); }
  }
});

test("nova solicitação pendente não oculta compras e vendas do vínculo encerrado", async () => {
  const pessoa = await criarMorador("ENCERRADO");
  await prisma.vinculo_condominio.create({ data: { id_condomino: pessoa.id, id_condominio: condominioB, moradia: "Novo", status_vinculo: "PENDENTE" } });
  const produto = await criarProduto({ id_vinculo_vendedor: pessoa.vinculo.id_vinculo, ativo: false });
  const compra = await criarPedidoHistorico(pessoa.vinculo.id_vinculo, cenario.produtoVizinhoA.id_produto);
  const venda = await criarPedidoHistorico(cenario.vizinhoA.vinculo.id_vinculo, produto.id_produto);
  const resultado = await consultarMeusPedidos(pessoa.id);
  assert.deepEqual(new Set(resultado.dados.map((p) => p.id_pedido)), new Set([compra.pedido.id_pedido, venda.pedido.id_pedido]));
});

test("histórico é cronológico com desempate por UUID; chat retorna só disponibilidade e status", async () => {
  const alvo = cenario.pedidos.find((p) => p.status_pedido === "CONCLUIDO")!;
  const ids = [randomUUID(), randomUUID(), randomUUID()].sort();
  await prisma.pedido_status_historico.deleteMany({ where: { id_pedido: alvo.id_pedido } });
  await prisma.pedido_status_historico.createMany({ data: [
    { id_historico: ids[2], id_pedido: alvo.id_pedido, status_anterior: "ACEITO", status_novo: "CONCLUIDO", alterado_por: cenario.pessoa.id, motivo: "Concluído", created_at: new Date("2020-01-02T00:00:00Z") },
    { id_historico: ids[0], id_pedido: alvo.id_pedido, status_anterior: null, status_novo: "SOLICITADO", alterado_por: cenario.pessoa.id, created_at: new Date("2020-01-01T00:00:00Z") },
    { id_historico: ids[1], id_pedido: alvo.id_pedido, status_anterior: "SOLICITADO", status_novo: "ACEITO", alterado_por: cenario.pessoa.id, created_at: new Date("2020-01-02T00:00:00Z") },
  ] });
  const conversa = await prisma.conversa.update({ where: { id_pedido: alvo.id_pedido }, data: { status_conversa: "ENCERRADA" } });
  await prisma.mensagem.create({ data: { id_conversa: conversa.id_conversa, id_remetente: cenario.pessoa.id, conteudo: "CONTEUDO_PRIVADO_NAO_CARREGAR" } });
  const resultado = await consultarMeusPedidos(cenario.pessoa.id, "?status=CONCLUIDO");
  const item = resultado.dados[0];
  assert.deepEqual(item.historico.map((h) => h.status_novo), ["SOLICITADO", "ACEITO", "CONCLUIDO"]);
  assert.equal(item.historico[2].motivo, "Concluído");
  assert.deepEqual(item.chat, { disponivel: true, status_conversa: "ENCERRADA" });
  assert.doesNotMatch(JSON.stringify(resultado), /mensagem|CONTEUDO_PRIVADO_NAO_CARREGAR|alterado_por/);
});

test("GET repetido é somente leitura: não altera estoque, pedido, histórico, conversa, participantes ou mensagens", async () => {
  const lerEstado = async () => ({
    produtos: await prisma.produto.findMany({ orderBy: { id_produto: "asc" } }),
    pedidos: await prisma.pedido.findMany({ orderBy: { id_pedido: "asc" } }),
    historicos: await prisma.pedido_status_historico.findMany({ orderBy: { id_historico: "asc" } }),
    conversas: await prisma.conversa.findMany({ orderBy: { id_conversa: "asc" } }),
    participantes: await prisma.conversa_participante.findMany({ orderBy: [{ id_conversa: "asc" }, { id_usuario: "asc" }] }),
    mensagens: await prisma.mensagem.findMany({ orderBy: { id_mensagem: "asc" } }),
    imagens: await prisma.produto_imagem.findMany({ orderBy: { id_imagem: "asc" } }),
    vinculos: await prisma.vinculo_condominio.findMany({ orderBy: { id_vinculo: "asc" } }),
    auditorias: await prisma.auditoria.count(),
  });
  const antes = await lerEstado();
  await consultarMeusPedidos(cenario.pessoa.id); await consultarMeusPedidos(cenario.pessoa.id, "?papel=venda&status=SOLICITADO");
  assert.deepEqual(await lerEstado(), antes);
});

test("pedido legado sem conversa não quebra a página nem é reparado automaticamente", async () => {
  const pessoa = await criarMorador("ENCERRADO");
  const legado = await prisma.pedido.create({ data: { id_produto: cenario.produtoVizinhoA.id_produto, id_vinculo_comprador: pessoa.vinculo.id_vinculo, quantidade: 1, valor_pedido: "25.00", hora_combinada: new Date(futuro) } });
  const conversas = await prisma.conversa.count();
  const log = mock.method(console, "warn", () => {});
  try {
    const resultado = await consultarMeusPedidos(pessoa.id);
    assert.equal(resultado.dados[0].id_pedido, legado.id_pedido);
    assert.deepEqual(resultado.dados[0].chat, { disponivel: false, status_conversa: null });
    assert.deepEqual(resultado.dados[0].historico, []);
    assert.deepEqual(log.mock.calls[0].arguments, [{ evento: "ORDER_CHAT_UNAVAILABLE", id_pedido: legado.id_pedido }]);
    assert.equal(await prisma.conversa.count(), conversas);
  } finally { log.mock.restore(); }
});

// Ciclo do pedido e chat: fixtures reais com reserva pelo POST existente.
async function novaNegociacao(status: status_pedido_enum = "SOLICITADO") {
  const produto = await criarProduto();
  const pedido = await confirmarCriado(await solicitar(produto.id_produto, 2));
  if (status !== "SOLICITADO") await prisma.pedido.update({ where: { id_pedido: pedido.id_pedido }, data: { status_pedido: status } });
  const conversa = await prisma.conversa.findUniqueOrThrow({ where: { id_pedido: pedido.id_pedido } });
  return { produto, pedido, conversa };
}
async function mudarStatus(idPedido: string, status: string, ator: string = vendedor.id, extras: object = {}) {
  return fetch(`${base}/pedidos/${idPedido}/status`, { method: "PATCH", headers: await headers(ator), body: JSON.stringify({ status, ...extras }) });
}
async function lerChat(idPedido: string, ator: string = comprador.id, query = "") {
  return fetch(`${base}/pedidos/${idPedido}/chat${query}`, { headers: await headers(ator) });
}
async function enviarMensagem(idPedido: string, ator: string = comprador.id, dados: object = { conteudo: "Olá!" }) {
  return fetch(`${base}/pedidos/${idPedido}/chat/messages`, { method: "POST", headers: await headers(ator), body: JSON.stringify(dados) });
}
async function estadoNegociacao(idPedido: string) {
  return prisma.pedido.findUniqueOrThrow({ where: { id_pedido: idPedido }, include: {
    produto: true, pedido_status_historico: { orderBy: { id_historico: "asc" } },
    conversa: { include: { conversa_participante: true, mensagem: true } },
  } });
}

for (const [anterior, novo, papel, restitui] of [
  ["SOLICITADO", "ACEITO", "vendedor", false],
  ["SOLICITADO", "RECUSADO", "vendedor", true],
  ["ACEITO", "CONCLUIDO", "vendedor", false],
  ["SOLICITADO", "CANCELADO", "comprador", true],
  ["ACEITO", "CANCELADO", "comprador", true],
] as const) {
  test(`PATCH ${papel}: ${anterior} → ${novo}, histórico atômico e restituição=${restitui}`, async () => {
    const { produto, pedido, conversa } = await novaNegociacao(anterior);
    const ator = papel === "comprador" ? comprador.id : vendedor.id;
    const antes = await estadoNegociacao(pedido.id_pedido);
    const resposta = await mudarStatus(pedido.id_pedido, novo, ator, { motivo: "  Motivo da decisão  " });
    assert.equal(resposta.status, 200);
    const json = await resposta.json();
    assert.deepEqual(Object.keys(json), ["dados"]);
    assert.deepEqual(Object.keys(json.dados).sort(), ["id_pedido", "status_pedido", "ultima_atualizacao"]);
    assert.equal(json.dados.status_pedido, novo);
    const depois = await estadoNegociacao(pedido.id_pedido);
    assert.equal(depois.status_pedido, novo);
    assert.equal(depois.ultima_atualizacao.toISOString(), json.dados.ultima_atualizacao);
    assert.ok(depois.ultima_atualizacao >= antes.ultima_atualizacao);
    assert.equal(depois.produto.estoque, produto.estoque - (restitui ? 0 : 2));
    assert.equal(depois.valor_pedido.toFixed(2), antes.valor_pedido.toFixed(2));
    const historico = depois.pedido_status_historico.find((h) => h.status_anterior !== null)!;
    assert.equal(depois.pedido_status_historico.length, 2);
    assert.equal(historico.status_anterior, anterior); assert.equal(historico.status_novo, novo);
    assert.equal(historico.alterado_por, ator); assert.equal(historico.motivo, "Motivo da decisão");
    assert.equal(historico.created_at.toISOString(), json.dados.ultima_atualizacao);
    assert.deepEqual(await prisma.conversa.findUniqueOrThrow({ where: { id_conversa: conversa.id_conversa } }), conversa);
    await confirmarErro(await mudarStatus(pedido.id_pedido, novo, ator), 409, "INVALID_ORDER_TRANSITION");
    assert.deepEqual(await estadoNegociacao(pedido.id_pedido), depois);
  });
}

test("PATCH cobre toda matriz de estados/destinos/papéis sem permitir transição adicional", async () => {
  const validas = new Set(["SOLICITADO:ACEITO", "SOLICITADO:RECUSADO", "SOLICITADO:CANCELADO", "ACEITO:CONCLUIDO", "ACEITO:CANCELADO"]);
  for (const anterior of ["SOLICITADO", "ACEITO", "RECUSADO", "CANCELADO", "CONCLUIDO"] as const) {
    for (const novo of ["ACEITO", "RECUSADO", "CANCELADO", "CONCLUIDO"]) {
      for (const papel of ["comprador", "vendedor"] as const) {
        const autorizado = (novo === "CANCELADO") === (papel === "comprador");
        if (autorizado && validas.has(`${anterior}:${novo}`)) continue;
        const { pedido } = await novaNegociacao(anterior);
        const antes = await estadoNegociacao(pedido.id_pedido);
        await confirmarErro(await mudarStatus(pedido.id_pedido, novo, papel === "comprador" ? comprador.id : vendedor.id), autorizado ? 409 : 403, autorizado ? "INVALID_ORDER_TRANSITION" : "ORDER_STATUS_FORBIDDEN");
        assert.deepEqual(await estadoNegociacao(pedido.id_pedido), antes);
      }
    }
  }
});

test("PATCH nega pedidos inexistentes/alheios inclusive admins e valida params/body estritos", async () => {
  const { pedido } = await novaNegociacao();
  const antes = await estadoNegociacao(pedido.id_pedido);
  for (const id of [admin.id, superAdmin, outroCondominio.id, randomUUID()]) {
    for (const alvo of [pedido.id_pedido, randomUUID()]) await confirmarErro(await mudarStatus(alvo, "ACEITO", id), 404, "ORDER_NOT_FOUND");
  }
  await confirmarErro(await mudarStatus("invalido", "ACEITO"), 400, "VALIDATION_ERROR");
  for (const dados of [ {}, { status: "SOLICITADO" }, { status: "ACEITO", motivo: null }, { status: "ACEITO", motivo: "x".repeat(256) }, { status: "ACEITO", alterado_por: comprador.id }, { status: "ACEITO", quantidade: 5 } ]) {
    await confirmarErro(await fetch(`${base}/pedidos/${pedido.id_pedido}/status`, { method: "PATCH", headers: await headers(vendedor.id), body: JSON.stringify(dados) }), 400, "VALIDATION_ERROR");
  }
  assert.deepEqual(await estadoNegociacao(pedido.id_pedido), antes);
});

for (const outro of ["ACEITO", "RECUSADO", "CANCELADO"] as const) {
  test(`concorrência real ${outro} vs CANCELADO: um vencedor, um histórico, uma restituição no máximo`, async () => {
    const { pedido, produto } = await novaNegociacao();
    const client = new Client({ connectionString: urlTeste }); await client.connect();
    let pendentes: Promise<globalThis.Response[]> | undefined;
    try {
      await client.query("BEGIN");
      await client.query("SELECT id_pedido FROM pedido WHERE id_pedido = $1 FOR UPDATE", [pedido.id_pedido]);
      pendentes = Promise.all([mudarStatus(pedido.id_pedido, outro, outro === "CANCELADO" ? comprador.id : vendedor.id), mudarStatus(pedido.id_pedido, "CANCELADO", comprador.id)]);
      // Ambos leem SOLICITADO e ficam bloqueados no UPDATE condicional antes do COMMIT.
      let bloqueadas = false;
      for (let i = 0; i < 120; i++) {
        await client.query("SELECT pg_stat_clear_snapshot()");
        const r = await client.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%UPDATE%pedido%'");
        if (r.rows[0].n >= 2) { bloqueadas = true; break; }
        await esperar(20);
      }
      assert.equal(bloqueadas, true, "As duas transações devem disputar a atualização do mesmo estado");
      await client.query("COMMIT");
      const respostas = await pendentes;
      assert.deepEqual(respostas.map((r) => r.status).sort(), [200, 409]);
      await confirmarErro(respostas.find((r) => r.status === 409)!, 409, "INVALID_ORDER_TRANSITION");
      const depois = await estadoNegociacao(pedido.id_pedido);
      assert.equal(depois.pedido_status_historico.length, 2);
      assert.equal(depois.produto.estoque, produto.estoque - (depois.status_pedido === "ACEITO" ? 2 : 0));
      assert.equal(depois.pedido_status_historico.find((h) => h.status_anterior !== null)!.status_novo, depois.status_pedido);
    } finally { await client.query("ROLLBACK"); await client.end(); if (pendentes) await pendentes; }
  });
}

test("falha de FK no histórico do PATCH reverte status, ultima_atualizacao e restituição", async () => {
  const { pedido } = await novaNegociacao();
  const antes = await estadoNegociacao(pedido.id_pedido);
  const originalTx = prisma.$transaction;
  Reflect.set(prisma, "$transaction", (acao: (tx: Prisma.TransactionClient) => Promise<unknown>, opcoes: { isolationLevel: Prisma.TransactionIsolationLevel }) => originalTx.call(prisma, async (tx: Prisma.TransactionClient) => {
    const original = tx.pedido_status_historico.create;
    Reflect.set(tx.pedido_status_historico, "create", (args: Prisma.pedido_status_historicoCreateArgs) => original({ ...args, data: { ...(args.data as Prisma.pedido_status_historicoUncheckedCreateInput), alterado_por: randomUUID() } }));
    try { return await acao(tx); } finally { Reflect.set(tx.pedido_status_historico, "create", original); }
  }, opcoes));
  const log = mock.method(console, "error", () => {});
  try {
    await confirmarErro(await mudarStatus(pedido.id_pedido, "CANCELADO", comprador.id), 500, "INTERNAL_ERROR");
    assert.deepEqual(await estadoNegociacao(pedido.id_pedido), antes);
  } finally { Reflect.set(prisma, "$transaction", originalTx); log.mock.restore(); }
});

test("GET chat permite partes e super admin, nega terceiros/admin local sem enumerar pedidos", async () => {
  const { pedido, conversa } = await novaNegociacao();
  for (const ator of [comprador.id, vendedor.id, superAdmin]) {
    const resposta = await lerChat(pedido.id_pedido, ator); assert.equal(resposta.status, 200);
    assert.deepEqual(await resposta.json(), { dados: [], paginacao: { pagina: 1, limite: 50, total: 0, total_paginas: 0 }, conversa: { id_conversa: conversa.id_conversa, status_conversa: "ATIVA" }, pedido: { id_pedido: pedido.id_pedido, status_pedido: "SOLICITADO" } });
  }
  for (const ator of [admin.id, outroCondominio.id, randomUUID()]) await confirmarErro(await lerChat(pedido.id_pedido, ator), 404, "ORDER_NOT_FOUND");
  await confirmarErro(await lerChat(randomUUID(), superAdmin), 404, "ORDER_NOT_FOUND");
});

for (const papel of ["COMPRADOR", "VENDEDOR"] as const) {
  test(`POST mensagem ${papel}: normaliza texto, usa identidade autenticada e DTO mínimo`, async () => {
    const { pedido, conversa } = await novaNegociacao();
    const ator = papel === "COMPRADOR" ? comprador.id : vendedor.id;
    const resposta = await enviarMensagem(pedido.id_pedido, ator, { conteudo: "  Posso buscar às 19h?\n " });
    assert.equal(resposta.status, 201);
    const json = await resposta.json();
    assert.deepEqual(Object.keys(json), ["dados"]);
    assert.deepEqual(Object.keys(json.dados).sort(), ["conteudo", "created_at", "id_mensagem", "remetente"]);
    assert.deepEqual(json.dados.remetente, { nome_completo: "Morador teste pedido", papel });
    assert.equal(json.dados.conteudo, "Posso buscar às 19h?");
    assert.doesNotMatch(JSON.stringify(json), /cpf|email|data_nascimento|id_remetente|id_usuario|storage_path/);
    const salvo = await prisma.mensagem.findUniqueOrThrow({ where: { id_mensagem: json.dados.id_mensagem } });
    assert.equal(salvo.id_remetente, ator); assert.equal(salvo.id_conversa, conversa.id_conversa);
    assert.equal(salvo.created_at.toISOString(), json.dados.created_at);
    assert.equal((await (await lerChat(pedido.id_pedido)).json()).dados[0].id_mensagem, salvo.id_mensagem);
  });
}

test("POST mensagem nega super admin observador/terceiro e valida conteúdo/body estritos", async () => {
  const { pedido } = await novaNegociacao();
  const antes = await estadoNegociacao(pedido.id_pedido);
  await confirmarErro(await enviarMensagem(pedido.id_pedido, superAdmin), 403, "CHAT_SEND_FORBIDDEN");
  for (const ator of [admin.id, outroCondominio.id, randomUUID()]) await confirmarErro(await enviarMensagem(pedido.id_pedido, ator), 404, "ORDER_NOT_FOUND");
  for (const dados of [{}, { conteudo: "" }, { conteudo: " \n\t " }, { conteudo: "a".repeat(1001) }, { conteudo: 1 }, { conteudo: "Olá", id_remetente: vendedor.id }, { conteudo: "Olá", created_at: "2020-01-01" }]) {
    await confirmarErro(await enviarMensagem(pedido.id_pedido, comprador.id, dados), 400, "VALIDATION_ERROR");
  }
  assert.deepEqual(await estadoNegociacao(pedido.id_pedido), antes);
  assert.equal((await enviarMensagem(pedido.id_pedido, comprador.id, { conteudo: "a".repeat(1000) })).status, 201);
});

test("GET chat pagina cronologicamente com desempate por UUID e preserva ultimo_lido_em", async () => {
  const { pedido, conversa } = await novaNegociacao();
  const ids = [randomUUID(), randomUUID(), randomUUID()].sort();
  await prisma.mensagem.createMany({ data: [
    { id_mensagem: ids[2], id_conversa: conversa.id_conversa, id_remetente: comprador.id, conteudo: "Terceira", created_at: new Date("2020-01-02") },
    { id_mensagem: ids[1], id_conversa: conversa.id_conversa, id_remetente: vendedor.id, conteudo: "Segunda", created_at: new Date("2020-01-01") },
    { id_mensagem: ids[0], id_conversa: conversa.id_conversa, id_remetente: comprador.id, conteudo: "Primeira", created_at: new Date("2020-01-01") },
  ] });
  await prisma.conversa_participante.updateMany({ where: { id_conversa: conversa.id_conversa }, data: { ultimo_lido_em: new Date("2019-01-01") } });
  const antes = await estadoNegociacao(pedido.id_pedido);
  for (const pagina of [1, 2, 3]) {
    const r = await lerChat(pedido.id_pedido, vendedor.id, `?pagina=${pagina}&limite=2`); assert.equal(r.status, 200);
    const json = await r.json();
    assert.ok(Array.isArray(json.dados)); assert.deepEqual(json.paginacao, { pagina, limite: 2, total: 3, total_paginas: 2 });
    assert.deepEqual(json.dados.map((m: { id_mensagem: string }) => m.id_mensagem), ids.slice((pagina - 1) * 2, pagina * 2));
    assert.doesNotMatch(JSON.stringify(json), /cpf|email|data_nascimento|storage_path|id_remetente|ultimo_lido_em/);
  }
  for (const query of ["pagina=0", "limite=101", "limite=0", "limite=1&limite=2", "pagina=2147483647&limite=100", `id_usuario=${comprador.id}`, "status=ATIVA"]) {
    await confirmarErro(await lerChat(pedido.id_pedido, comprador.id, `?${query}`), 400, "VALIDATION_ERROR");
  }
  assert.deepEqual(await estadoNegociacao(pedido.id_pedido), antes);
});

test("conversa encerrada permite GET, impede envio e não é reaberta por transição de pedido", async () => {
  const { pedido, conversa } = await novaNegociacao();
  const encerrada = await prisma.conversa.update({ where: { id_conversa: conversa.id_conversa }, data: { status_conversa: "ENCERRADA", encerrada_em: new Date() } });
  const antes = await estadoNegociacao(pedido.id_pedido);
  await confirmarErro(await enviarMensagem(pedido.id_pedido), 409, "CHAT_CLOSED");
  assert.equal((await lerChat(pedido.id_pedido)).status, 200);
  assert.deepEqual(await estadoNegociacao(pedido.id_pedido), antes);
  assert.equal((await mudarStatus(pedido.id_pedido, "ACEITO")).status, 200);
  assert.deepEqual(await prisma.conversa.findUniqueOrThrow({ where: { id_conversa: conversa.id_conversa } }), encerrada);
});

test("pedido válido sem conversa retorna CHAT_NOT_FOUND sem reparar dados em GET ou POST", async () => {
  const produto = await criarProduto();
  const pedido = await prisma.pedido.create({ data: { id_produto: produto.id_produto, id_vinculo_comprador: comprador.vinculo.id_vinculo, quantidade: 1, valor_pedido: "25.90", hora_combinada: new Date(futuro) } });
  const antes = await estadoNegociacao(pedido.id_pedido);
  await confirmarErro(await lerChat(pedido.id_pedido), 404, "CHAT_NOT_FOUND");
  await confirmarErro(await enviarMensagem(pedido.id_pedido), 404, "CHAT_NOT_FOUND");
  await confirmarErro(await lerChat(pedido.id_pedido, admin.id), 404, "ORDER_NOT_FOUND");
  assert.deepEqual(await estadoNegociacao(pedido.id_pedido), antes);
});

test("identidade histórica permite PATCH/GET/POST após mudança e suspensão local; super admin participante pode enviar", async () => {
  const pessoa = await criarMorador(); const vizinho = await criarMorador();
  const produto = await criarProduto({ id_vinculo_vendedor: vizinho.vinculo.id_vinculo });
  const pedido = await confirmarCriado(await solicitar(produto.id_produto, 2, pessoa.id));
  await prisma.vinculo_condominio.update({ where: { id_vinculo: pessoa.vinculo.id_vinculo }, data: { status_vinculo: "ENCERRADO" } });
  await prisma.vinculo_condominio.create({ data: { id_condomino: pessoa.id, id_condominio: condominioB, status_vinculo: "ATIVO", moradia: "Novo endereço" } });
  await prisma.vinculo_condominio.update({ where: { id_vinculo: vizinho.vinculo.id_vinculo }, data: { status_vinculo: "SUSPENSO" } });
  for (const id of [pessoa.id, vizinho.id]) {
    assert.equal((await lerChat(pedido.id_pedido, id)).status, 200);
    assert.equal((await enviarMensagem(pedido.id_pedido, id)).status, 201);
  }
  assert.equal((await mudarStatus(pedido.id_pedido, "ACEITO", vizinho.id)).status, 200);
  await prisma.super_admin.create({ data: { id_super_admin: pessoa.id } });
  assert.equal((await enviarMensagem(pedido.id_pedido, pessoa.id)).status, 201);
  assert.equal((await mudarStatus(pedido.id_pedido, "CANCELADO", pessoa.id)).status, 200);
  assert.equal((await prisma.produto.findUniqueOrThrow({ where: { id_produto: produto.id_produto } })).estoque, 10);
});

test("as três rotas exigem autenticação e bloqueiam conta global suspensa", async () => {
  const { pedido } = await novaNegociacao();
  const ator = await criarMorador();
  await prisma.usuario.update({ where: { id_usuario: ator.id }, data: { status_conta: "SUSPENSA" } });
  for (const [caminho, metodo, body] of [["status", "PATCH", { status: "ACEITO" }], ["chat", "GET", undefined], ["chat/messages", "POST", { conteudo: "Olá" }]] as const) {
    const endpoint = `${base}/pedidos/${pedido.id_pedido}/${caminho}`;
    await confirmarErro(await fetch(endpoint, { method: metodo }), 401, "UNAUTHENTICATED");
    await confirmarErro(await fetch(endpoint, { method: metodo, headers: await headers(ator.id), ...(body ? { body: JSON.stringify(body) } : {}) }), 403, "ACCOUNT_SUSPENDED");
  }
});

test("fluxo C: criação → reserva/histórico/conversa → aceite → mensagem → conclusão", async () => {
  const r = await fetch(`${base}/produtos`, { method: "POST", headers: await headers(vendedor.id), body: JSON.stringify({ id_categoria: categoria, nome_produto: "Venda completa", descricao: "Fluxo integrado", preco: "15.00", estoque: 4 }) });
  assert.equal(r.status, 201); const produto = (await r.json()).dados;
  const pedido = await confirmarCriado(await solicitar(produto.id_produto, 2));
  const inicial = await estadoNegociacao(pedido.id_pedido);
  assert.equal(inicial.produto.estoque, 2); assert.equal(inicial.pedido_status_historico[0].status_novo, "SOLICITADO");
  assert.equal(inicial.conversa!.conversa_participante.length, 2);
  assert.equal((await mudarStatus(pedido.id_pedido, "ACEITO")).status, 200);
  assert.equal((await enviarMensagem(pedido.id_pedido, comprador.id, { conteudo: "Combinado!" })).status, 201);
  assert.equal((await mudarStatus(pedido.id_pedido, "CONCLUIDO")).status, 200);
  const final = await estadoNegociacao(pedido.id_pedido);
  assert.equal(final.produto.estoque, 2); assert.equal(final.status_pedido, "CONCLUIDO");
  assert.equal(final.pedido_status_historico.length, 3); assert.equal(final.conversa!.mensagem[0].conteudo, "Combinado!");
});
