import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, mock, test } from "node:test";
import { setTimeout as esperar } from "node:timers/promises";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { Prisma } from "../src/generated/prisma/client.js";
const conexao = new URL(process.env.ONBOARDING_TEST_DATABASE_URL || "http://ausente.invalid");
if (conexao.protocol !== "postgresql:" || !["127.0.0.1", "localhost"].includes(conexao.hostname) || conexao.pathname !== "/porta_onboarding_teste") throw new Error("Exige PostgreSQL local descartável porta_onboarding_teste.");
process.env.DATABASE_URL = conexao.toString(); process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.SUPABASE_URL = "https://teste.supabase.co"; process.env.SUPABASE_SECRET_KEY = "chave-apenas-para-testes";
const { prisma } = await import("../src/lib/prisma.js");
const { app } = await import("../src/app.js");
const chaves = await generateKeyPair("ES256");
const jwk = { ...await exportJWK(chaves.publicKey), kid: "gestao-p30", alg: "ES256", use: "sig" };
const tag = randomUUID(), superId = randomUUID(); let morador: string, admin: string, base: string;
const servidor = createServer(app);
const cadastro = { nome_residencial: `Gestão ${tag}`, cep: "72000000", endereco: "Rua de testes, 30" };
async function headers(id: string) {
  const token = await new SignJWT({ email: `${id}@exemplo.test`, super_admin: true, user_metadata: { super_admin: true } }).setProtectedHeader({ alg: "ES256", kid: jwk.kid }).setSubject(id).setIssuer("https://teste.supabase.co/auth/v1").setAudience("authenticated").setExpirationTime("10m").sign(chaves.privateKey);
  return { Authorization: `Bearer ${token}` };
}
async function chamar(path: string, method = "GET", dados?: unknown, id: string | null = superId) {
  const r = await fetch(`${base}${path}`, { method, headers: { ...(id ? await headers(id) : {}), ...(dados !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(dados !== undefined ? { body: JSON.stringify(dados) } : {}) });
  return { status: r.status, body: await r.json() };
}
async function novo(ativo = true) { return prisma.condominio.create({ data: { ...cadastro, ativo } }); }
async function pessoa(condominio: string, status: "ATIVO" | "PENDENTE" = "ATIVO", admin_condominio = false) {
  const id = randomUUID();
  await prisma.usuario.create({ data: { id_usuario: id, email: `${id}@exemplo.test` } });
  await prisma.condomino.create({ data: { id_condomino: id, nome_completo: "Pessoa fictícia", cpf: String(randomInt(0, 100_000_000_000)).padStart(11, "0"), data_nascimento: new Date("2000-01-01") } });
  const vinculo = await prisma.vinculo_condominio.create({ data: { id_condomino: id, id_condominio: condominio, moradia: "Apto 30", status_vinculo: status, admin_condominio } });
  return { id, vinculo };
}
const detalhe = async (id: string) => (await chamar(`/admin/condominios/${id}`)).body.dados;
const status = async (id: string, ativo: boolean, versao?: string) => chamar(`/admin/condominios/${id}/status`, "PATCH", { ativo, versao: versao ?? (await detalhe(id)).versao, motivo: "Teste de disponibilidade" });
before(async () => {
  const original = globalThis.fetch;
  mock.method(globalThis, "fetch", async (...args: Parameters<typeof fetch>) => String(args[0]) === "https://teste.supabase.co/auth/v1/.well-known/jwks.json" ? Response.json({ keys: [jwk] }) : original(...args));
  await prisma.usuario.create({ data: { id_usuario: superId, email: `${superId}@exemplo.test` } });
  await prisma.super_admin.create({ data: { id_super_admin: superId } });
  const c = await novo(); morador = (await pessoa(c.id_condominio)).id; admin = (await pessoa(c.id_condominio, "ATIVO", true)).id;
  await new Promise<void>(resolve => servidor.listen(0, "127.0.0.1", resolve)); const endereco = servidor.address(); assert.ok(endereco && typeof endereco === "object"); base = `http://127.0.0.1:${endereco.port}/api`;
});
after(async () => { servidor.closeAllConnections(); await new Promise<void>(resolve => servidor.close(() => resolve())); mock.restoreAll(); await prisma.$disconnect(); });
test("quatro endpoints novos exigem super real, sem bypass por claims; conta suspensa bloqueada", async () => {
  const c = await novo();
  for (const id of [null, morador, admin]) for (const [path, method, body] of [["/admin/condominios", "GET", undefined], [`/admin/condominios/${c.id_condominio}`, "GET", undefined], [`/admin/condominios/${c.id_condominio}`, "PATCH", { nome_residencial: "Forjado" }], [`/admin/condominios/${c.id_condominio}/status`, "PATCH", { ativo: false }]] as const) assert.equal((await chamar(path, method, body, id)).status, id ? 403 : 401);
  await prisma.usuario.update({ where: { id_usuario: superId }, data: { status_conta: "SUSPENSA" } });
  try { assert.equal((await chamar("/admin/condominios")).body.erro, "ACCOUNT_SUSPENDED"); } finally { await prisma.usuario.update({ where: { id_usuario: superId }, data: { status_conta: "ATIVA" } }); }
});
test("listagem busca literal, ativos/inativos, snapshot, paginação estável e DTO sem dados pessoais", async () => {
  const a = await novo(), b = await novo(false); const ids: string[] = [];
  for (const pagina of [1, 2]) { const r = await chamar(`/admin/condominios?busca=${tag}&limite=1&pagina=${pagina}`); assert.equal(r.status, 200); assert.ok(r.body.paginacao.total >= 2); ids.push(r.body.dados[0].id_condominio); assert.match(r.body.dados[0].versao, /^[a-f0-9]{64}$/); assert.doesNotMatch(JSON.stringify(r.body), /revisao|cpf|email|morador|xmin/); }
  assert.equal(new Set(ids).size, 2);
  for (const ativo of [true, false]) { const r = await chamar(`/admin/condominios?busca=${tag}&ativo=${ativo}`); assert.ok(r.body.dados.some((c: { id_condominio: string }) => c.id_condominio === (ativo ? a : b).id_condominio)); assert.ok(r.body.dados.every((c: { ativo: boolean }) => c.ativo === ativo)); }
  const destinos = (await chamar(`/condominios?busca=${tag}`)).body.dados; assert.ok(!destinos.some((c: { id_condominio: string }) => c.id_condominio === b.id_condominio));
  assert.equal((await chamar("/admin/condominios?busca=%25")).body.dados.length, 0);
});
test("validação estrita, inexistente, edição parcial, auditoria de diferenças e no-op", async () => {
  const c = await novo(), antes = await detalhe(c.id_condominio);
  assert.equal((await chamar(`/admin/condominios/${randomUUID()}`)).status, 404);
  assert.equal((await chamar("/admin/condominios/abc")).status, 400);
  for (const body of [{ versao: antes.versao }, { versao: antes.versao, nome_residencial: " " }, { versao: antes.versao, cep: null }, { versao: antes.versao, nome_residencial: "Novo", ativo: false }]) assert.equal((await chamar(`/admin/condominios/${c.id_condominio}`, "PATCH", body)).status, 400);
  const editado = await chamar(`/admin/condominios/${c.id_condominio}`, "PATCH", { versao: antes.versao, nome_residencial: " Nome atualizado " }); assert.equal(editado.status, 200); assert.equal(editado.body.dados.nome_residencial, "Nome atualizado"); assert.equal(editado.body.dados.cep, c.cep); assert.notEqual(editado.body.dados.versao, antes.versao);
  const auditoria = await prisma.auditoria.findFirstOrThrow({ where: { entidade_id: c.id_condominio, acao: "UPDATE_CONDOMINIUM" } }); assert.equal(auditoria.id_ator, superId); assert.deepEqual(auditoria.metadata, { antes: { nome_residencial: c.nome_residencial }, depois: { nome_residencial: "Nome atualizado" } });
  const noop = await chamar(`/admin/condominios/${c.id_condominio}`, "PATCH", { versao: editado.body.dados.versao, nome_residencial: "Nome atualizado" }); assert.equal(noop.status, 200); assert.equal(noop.body.dados.versao, editado.body.dados.versao); assert.equal(await prisma.auditoria.count({ where: { entidade_id: c.id_condominio } }), 1);
});
test("duas edições concorrentes e dois estados da mesma versão: um sucesso e um conflito", async () => {
  const c = await novo(); let versao = (await detalhe(c.id_condominio)).versao;
  const edicoes = await Promise.all(["A", "B"].map(nome_residencial => chamar(`/admin/condominios/${c.id_condominio}`, "PATCH", { nome_residencial, versao })));
  assert.deepEqual(edicoes.map(r => r.status).sort(), [200, 409]); assert.equal(edicoes.find(r => r.status === 409)!.body.erro, "CONDOMINIUM_UPDATE_CONFLICT");
  versao = (await detalhe(c.id_condominio)).versao;
  const estados = await Promise.all([status(c.id_condominio, false, versao), status(c.id_condominio, false, versao)]); assert.deepEqual(estados.map(r => r.status).sort(), [200, 409]);
  const atual = await detalhe(c.id_condominio); assert.equal((await status(c.id_condominio, false, atual.versao)).status, 200); assert.equal((await detalhe(c.id_condominio)).versao, atual.versao);
  assert.equal(await prisma.auditoria.count({ where: { entidade_id: c.id_condominio, acao: "DEACTIVATE_CONDOMINIUM" } }), 1);
  assert.equal((await status(c.id_condominio, true, versao)).status, 409);
});
test("estado HTTP exige motivo/boolean; inativo mantém consulta, rejeição e suspensão local autorizadas", async () => {
  const c = await novo(), local = await pessoa(c.id_condominio, "ATIVO", true), pendente = await pessoa(c.id_condominio, "PENDENTE"), ativo = await pessoa(c.id_condominio);
  const versao = (await detalhe(c.id_condominio)).versao;
  for (const dados of [{ versao, ativo: "false", motivo: "Teste" }, { versao, ativo: false, motivo: " " }, { versao, ativo: false, motivo: "x".repeat(256) }, { versao, ativo: false, motivo: "Teste", id_ator: superId }]) assert.equal((await chamar(`/admin/condominios/${c.id_condominio}/status`, "PATCH", dados)).status, 400);
  assert.equal((await status(c.id_condominio, false)).status, 200);
  assert.equal((await chamar("/admin/vinculos/pendentes", "GET", undefined, local.id)).body.dados[0].id_vinculo, pendente.vinculo.id_vinculo);
  assert.equal((await chamar(`/admin/vinculos/${pendente.vinculo.id_vinculo}/aprovar`, "PATCH", undefined, local.id)).body.erro, "CONDOMINIUM_INACTIVE");
  assert.equal((await chamar(`/admin/vinculos/${pendente.vinculo.id_vinculo}/rejeitar`, "PATCH", undefined, local.id)).status, 200);
  assert.equal((await chamar(`/admin/vinculos/${ativo.vinculo.id_vinculo}/suspender`, "PATCH", undefined, local.id)).status, 200);
  assert.equal((await status(c.id_condominio, true)).status, 200);
  assert.equal((await prisma.vinculo_condominio.findUniqueOrThrow({ where: { id_vinculo: ativo.vinculo.id_vinculo } })).status_vinculo, "SUSPENSO");
});
test("falha de auditoria reverte edição e estado no PostgreSQL, resposta sanitizada", async () => {
  const c = await novo(), antes = await detalhe(c.id_condominio); const original = prisma.$transaction;
  Reflect.set(prisma, "$transaction", (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, opcoes: object) => original.call(prisma, tx => callback(new Proxy(tx, { get(target, prop, receiver) { if (prop !== "auditoria") return Reflect.get(target, prop, receiver); return new Proxy(target.auditoria, { get(delegate, metodo, receptor) { return metodo === "create" ? () => { throw new Error("segredo SQL privado"); } : Reflect.get(delegate, metodo, receptor); } }); } })), opcoes));
  try { for (const [path, dados] of [[`/admin/condominios/${c.id_condominio}`, { versao: antes.versao, endereco: "Rua alterada" }], [`/admin/condominios/${c.id_condominio}/status`, { versao: antes.versao, ativo: false, motivo: "Teste" }]] as const) { const r = await chamar(path, "PATCH", dados); assert.equal(r.status, 500); assert.deepEqual(r.body, { erro: "INTERNAL_ERROR", mensagem: "Erro interno do servidor." }); } } finally { Reflect.set(prisma, "$transaction", original); }
  assert.deepEqual(await detalhe(c.id_condominio), antes); assert.equal(await prisma.auditoria.count({ where: { entidade_id: c.id_condominio } }), 0);
});
test("desativar ocupado preserva vínculos, produto, pedido/chat; bloqueia entradas e aprovação; reativar preserva suspensões", async () => {
  const c = await novo(), vendedor = await pessoa(c.id_condominio), comprador = await pessoa(c.id_condominio), pendente = await pessoa(c.id_condominio, "PENDENTE");
  const categoria = await prisma.categoria_produto.create({ data: { nome: randomUUID() } });
  const produto = await prisma.produto.create({ data: { id_categoria: categoria.id_categoria, id_vinculo_vendedor: vendedor.vinculo.id_vinculo, nome_produto: "Produto", descricao: "Teste", preco: "2.50", estoque: 10 } });
  const pedido = await chamar("/pedidos", "POST", { id_produto: produto.id_produto, quantidade: 1, hora_combinada: "2099-01-01T19:00:00Z" }, comprador.id); assert.equal(pedido.status, 201);
  const vinculosAntes = await prisma.vinculo_condominio.findMany({ where: { id_condominio: c.id_condominio }, orderBy: { id_vinculo: "asc" } });
  assert.equal((await status(c.id_condominio, false)).status, 200);
  assert.deepEqual(await prisma.vinculo_condominio.findMany({ where: { id_condominio: c.id_condominio }, orderBy: { id_vinculo: "asc" } }), vinculosAntes);
  assert.equal((await chamar("/produtos", "GET", undefined, comprador.id)).body.dados[0].id_produto, produto.id_produto);
  assert.equal((await chamar("/pedidos/me", "GET", undefined, comprador.id)).body.dados[0].id_pedido, pedido.body.dados.id_pedido);
  assert.equal((await chamar(`/pedidos/${pedido.body.dados.id_pedido}/chat/messages`, "POST", { conteudo: "Continuo aqui" }, vendedor.id)).status, 201);
  assert.equal((await chamar(`/admin/vinculos/${pendente.vinculo.id_vinculo}/aprovar`, "PATCH")).body.erro, "CONDOMINIUM_INACTIVE");
  const novoUsuario = randomUUID(); const onboarding = { nome_completo: "Fictício", cpf: String(randomInt(0, 100_000_000_000)).padStart(11, "0"), data_nascimento: "2000-01-01", id_condominio: c.id_condominio, moradia: "Apto 1" };
  assert.equal((await chamar("/onboarding", "POST", onboarding, novoUsuario)).body.erro, "CONDOMINIO_NOT_FOUND"); assert.equal(await prisma.usuario.count({ where: { id_usuario: novoUsuario } }), 0);
  assert.equal((await chamar("/vinculos/transferencia", "POST", { id_condominio: c.id_condominio, moradia: "Apto 1" }, morador)).body.erro, "CONDOMINIUM_INACTIVE");
  const destino = await novo(); assert.equal((await chamar("/vinculos/transferencia", "POST", { id_condominio: destino.id_condominio, moradia: "Novo" }, comprador.id)).status, 201);
  const transferencia = await prisma.vinculo_condominio.findFirstOrThrow({ where: { id_condomino: comprador.id, status_vinculo: "PENDENTE" } });
  assert.equal((await chamar(`/admin/vinculos/${transferencia.id_vinculo}/aprovar`, "PATCH")).body.erro, "OPEN_ORDERS_BLOCK_TRANSFER");
  await prisma.usuario.update({ where: { id_usuario: vendedor.id }, data: { status_conta: "SUSPENSA" } });
  await prisma.vinculo_condominio.update({ where: { id_vinculo: vendedor.vinculo.id_vinculo }, data: { status_vinculo: "SUSPENSO" } });
  assert.equal((await status(c.id_condominio, true)).status, 200);
  assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id_usuario: vendedor.id } })).status_conta, "SUSPENSA");
  assert.equal((await prisma.vinculo_condominio.findUniqueOrThrow({ where: { id_vinculo: vendedor.vinculo.id_vinculo } })).status_vinculo, "SUSPENSO");
  assert.equal((await prisma.vinculo_condominio.findUniqueOrThrow({ where: { id_vinculo: pendente.vinculo.id_vinculo } })).status_vinculo, "PENDENTE");
  assert.equal((await chamar(`/admin/vinculos/${pendente.vinculo.id_vinculo}/aprovar`, "PATCH")).status, 200);
});

// Barreira após obter o lock REAL: verifica espera no pg_stat_activity antes de liberar.
async function corrida(entrada: () => ReturnType<typeof chamar>, id: string, desativacaoPrimeiro: boolean) {
  const versao = (await detalhe(id)).versao, original = prisma.$transaction;
  let liberar!: () => void, avisar!: () => void, pausou = false;
  const chegou = new Promise<void>(resolve => { avisar = resolve; }), barreira = new Promise<void>(resolve => { liberar = resolve; });
  Reflect.set(prisma, "$transaction", (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, opcoes: object) => original.call(prisma, tx => callback(new Proxy(tx, {
    get(target, prop, receiver) {
      if (prop !== "$queryRaw") return Reflect.get(target, prop, receiver);
      return async (...args: unknown[]) => {
        const r = await Reflect.apply(target.$queryRaw, target, args);
        const sql = String((args[0] as { sql?: string }).sql ?? args[0]);
        if (!pausou && sql.includes("public.condominio") && sql.includes(desativacaoPrimeiro ? "FOR UPDATE" : "FOR SHARE")) { pausou = true; avisar(); await barreira; }
        return r;
      };
    },
  })), { ...opcoes, timeout: 15000 }));
  let primeira: ReturnType<typeof chamar> | undefined, segunda: ReturnType<typeof chamar> | undefined;
  try {
    primeira = desativacaoPrimeiro ? status(id, false, versao) : entrada();
    await Promise.race([chegou, esperar(5000).then(() => { throw new Error("Lock não alcançado"); })]);
    segunda = desativacaoPrimeiro ? entrada() : status(id, false, versao);
    let aguardando = false;
    for (let i = 0; i < 100; i++) {
      const linhas = await prisma.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%public.condominio%'`;
      if (Number(linhas[0]!.total) > 0) { aguardando = true; break; } await esperar(20);
    }
    assert.equal(aguardando, true, "operação concorrente realmente espera o lock PostgreSQL"); liberar();
    const resultados = await Promise.all([primeira, segunda]); const entradaResultado = resultados[desativacaoPrimeiro ? 1 : 0]!;
    assert.equal(resultados[desativacaoPrimeiro ? 0 : 1]!.status, 200);
    assert.equal(entradaResultado.status, desativacaoPrimeiro ? (entradaResultado.body.erro === "CONDOMINIO_NOT_FOUND" ? 404 : 409) : (entradaResultado.body.dados.status_vinculo === "ATIVO" ? 200 : 201));
  } finally { liberar(); await Promise.allSettled([primeira, segunda].filter(Boolean)); Reflect.set(prisma, "$transaction", original); }
}
for (const fluxo of ["onboarding", "transferencia", "aprovacao", "aprovacao-transferencia"] as const) for (const primeiro of [true, false]) test(`concorrência real: ${fluxo}, desativação ${primeiro ? "antes" : "depois"} da entrada`, async () => {
  const c = await novo(); let entrada: () => ReturnType<typeof chamar>;
  if (fluxo === "onboarding") { const id = randomUUID(); entrada = () => chamar("/onboarding", "POST", { nome_completo: "Corrida", cpf: String(randomInt(0, 100_000_000_000)).padStart(11, "0"), data_nascimento: "2000-01-01", id_condominio: c.id_condominio, moradia: "Apto 1" }, id); }
  else if (fluxo === "transferencia") { const origem = await novo(), p = await pessoa(origem.id_condominio); entrada = () => chamar("/vinculos/transferencia", "POST", { id_condominio: c.id_condominio, moradia: "Novo" }, p.id); }
  else {
    let p;
    if (fluxo === "aprovacao-transferencia") { const origem = await novo(); p = await pessoa(origem.id_condominio); const v = await prisma.vinculo_condominio.create({ data: { id_condomino: p.id, id_condominio: c.id_condominio, moradia: "Novo" } }); p = { ...p, vinculo: v }; }
    else p = await pessoa(c.id_condominio, "PENDENTE");
    const id = p.vinculo.id_vinculo; entrada = () => chamar(`/admin/vinculos/${id}/aprovar`, "PATCH");
  }
  await corrida(entrada, c.id_condominio, primeiro);
});
