import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, criarApi, type SessaoApi } from "../src/lib/api.client";
import { destinos, podeAcessarHistorico, resolverEstadoAplicacao } from "../src/routes/estadoAplicacao";
import type { SituacaoResidencial, Vinculo } from "../src/features/vinculos/vinculo.types";
import { onboardingSchema } from "../src/features/onboarding/onboarding.schema";
import { cadastroSchema } from "../src/features/auth/auth.schema";
import { lerFiltrosVitrine, queryVitrine } from "../src/features/produtos/produto.schema";
import { alterarStatusPedidoSchema, converterHorarioLocal, formularioPedidoSchema, lerFiltrosPedidos } from "../src/features/pedidos/pedido.schema";
import { acoesPermitidasPedido } from "../src/features/pedidos/pedido.regras";
import type { DestinoPedido, PapelPedido, StatusPedido } from "../src/features/pedidos/pedido.types";
import { mensagemChatSchema, paginaChatSchema } from "../src/features/chat/chat.schema";
import { calcularTotalEstimado, formatarReais } from "../src/lib/moeda";
import { arquivoImagemProdutoSchema, diferencaProduto, formularioProdutoSchema, lerFiltrosMeusProdutos, normalizarPreco, produtoDadosSchema, produtoPatchSchema, queryMeusProdutos, tamanhoMaximoImagemProduto } from "../src/features/produtos/produto.schema";
import { transferenciaSchema } from "../src/features/vinculos/vinculo.schema";
import { alterarAdminSchema, alterarContaSchema, lerFiltrosAdministracao } from "../src/features/administracao/administracao.schema";
import { podeAdministrar, podeAlterarAdmin } from "../src/features/administracao/administracao.regras";

const sessao: SessaoApi = { access_token: "original", user: { id: "pessoa" } };
const vinculo: Vinculo = { id_vinculo: "vinculo", status_vinculo: "ATIVO", moradia: "Apto 302", admin_condominio: false,
  data_solicitacao: "2026-10-16T12:00:00Z", data_inicio: null, data_aprovacao: null, data_fim: null,
  condominio: { id_condominio: "condominio", nome_residencial: "Residencial", cep: "00000000", endereco: "Exemplo" } };
const residencial: SituacaoResidencial = { onboarding_realizado: true, super_admin: false, vinculo_ativo: vinculo, solicitacao_pendente: null, ultimo_vinculo: null };
const base = { temSessao: true, carregandoSessao: false, carregandoEstado: false, erroEstado: null,
  meuUsuario: { id_usuario: "pessoa", nome_completo: "Morador", onboarding_realizado: true, super_admin: false }, situacaoResidencial: residencial };
test("admin exige super ou privilégio no vínculo realmente ativo, nunca histórico", () => {
  assert.equal(podeAdministrar(base.meuUsuario, residencial), false);
  assert.equal(podeAdministrar(base.meuUsuario, { ...residencial, vinculo_ativo: { ...vinculo, admin_condominio: true } }), true);
  for (const status_vinculo of ["PENDENTE", "SUSPENSO", "ENCERRADO", "REJEITADO"] as const) {
    const antigo = { ...vinculo, admin_condominio: true, status_vinculo };
    assert.equal(podeAdministrar(base.meuUsuario, { ...residencial, vinculo_ativo: antigo }), false);
    assert.equal(podeAdministrar(base.meuUsuario, { ...residencial, vinculo_ativo: null, ultimo_vinculo: antigo }), false);
  }
  assert.equal(podeAdministrar({ ...base.meuUsuario, super_admin: true }, null), true);
  assert.equal(podeAdministrar(null, residencial), false);
});
test("alteração de admin local exclui próprio vínculo e estados históricos", () => {
  const item = { ...vinculo, morador: { id_usuario: "pessoa", nome_completo: "Exemplo" } };
  assert.equal(podeAlterarAdmin(item, false, vinculo.id_vinculo), false);
  assert.equal(podeAlterarAdmin(item, false, "outro"), true);
  assert.equal(podeAlterarAdmin(item, true, vinculo.id_vinculo), true);
  assert.equal(podeAlterarAdmin({ ...item, status_vinculo: "ENCERRADO" }, true), false);
});
test("transferência usa somente dois campos, valida UUID, trim e limite de moradia", () => {
  const dados = { id_condominio: "92345678-1234-4234-8234-123456789012", moradia: " Apto 1 " };
  assert.deepEqual(transferenciaSchema.parse(dados), { ...dados, moradia: "Apto 1" });
  for (const moradia of ["  ", "x".repeat(81)]) assert.equal(transferenciaSchema.safeParse({ ...dados, moradia }).success, false);
  assert.equal(transferenciaSchema.safeParse({ ...dados, id_condominio: "livre" }).success, false);
  assert.equal(transferenciaSchema.safeParse({ ...dados, admin_condominio: true }).success, false);
});
test("filtros administrativos preservam paginação, trim, enum e UUID sem autoridade extra", () => {
  const filtros = lerFiltrosAdministracao(new URLSearchParams("busca=%20Maria%20&pagina=2&status=ATIVO"));
  assert.equal(filtros.success, true);
  if (filtros.success) assert.deepEqual(filtros.data, { busca: "Maria", pagina: 2, status: "ATIVO" });
  for (const query of ["pagina=0", "pagina=1&pagina=2", "pagina=999999999999", "busca=a&busca=b", "status=ATIVA", "id_condominio=invalido", "admin_condominio=true", `busca=${"a".repeat(161)}`]) assert.equal(lerFiltrosAdministracao(new URLSearchParams(query)).success, false, query);
  assert.equal(lerFiltrosAdministracao(new URLSearchParams("status=ATIVO"), true).success, false);
});
test("privilégio e conta têm corpos distintos e estritos", () => {
  assert.equal(alterarAdminSchema.safeParse({ admin_condominio: "true" }).success, false);
  assert.equal(alterarAdminSchema.safeParse({ admin_condominio: false }).success, true);
  assert.equal(alterarContaSchema.safeParse({ status_conta: "SUSPENSO" }).success, false);
  assert.equal(alterarContaSchema.safeParse({ status_conta: "ATIVA", status_vinculo: "ATIVO" }).success, false);
});
test("PATCH sem corpo não serializa objeto nem define Content-Type", async () => {
  const api = cliente(async (_url, init) => {
    assert.equal(init?.method, "PATCH"); assert.equal(init.body, undefined);
    assert.equal(new Headers(init.headers).has("Content-Type"), false);
    return Response.json({ dados: { id_vinculo: "alvo" } });
  });
  await api.requisitar("/admin/vinculos/alvo/aprovar", { method: "PATCH" });
});
test("resolver mantém loading durante restauração, sem flash de login", () => {
  assert.equal(resolverEstadoAplicacao({ ...base, temSessao: false, carregandoSessao: true }), "CARREGANDO");
  assert.equal(resolverEstadoAplicacao({ ...base, carregandoEstado: true }), "CARREGANDO");
});
test("sem sessão vai para login; novo usuário vai para onboarding", () => {
  assert.equal(destinos[resolverEstadoAplicacao({ ...base, temSessao: false })], "/login");
  assert.equal(resolverEstadoAplicacao({ ...base, meuUsuario: { ...base.meuUsuario, onboarding_realizado: false }, situacaoResidencial: { ...residencial, onboarding_realizado: false, vinculo_ativo: null } }), "PRECISA_ONBOARDING");
});
test("pendente aguarda; ativo, inclusive com transferência, continua na vitrine", () => {
  assert.equal(resolverEstadoAplicacao({ ...base, situacaoResidencial: { ...residencial, vinculo_ativo: null, solicitacao_pendente: { ...vinculo, status_vinculo: "PENDENTE" } } }), "AGUARDANDO_APROVACAO");
  assert.equal(destinos[resolverEstadoAplicacao(base)], "/vitrine");
  assert.equal(resolverEstadoAplicacao({ ...base, situacaoResidencial: { ...residencial, solicitacao_pendente: { ...vinculo, status_vinculo: "PENDENTE" } } }), "USUARIO_ATIVO");
});
for (const status of ["REJEITADO", "SUSPENSO", "ENCERRADO"] as const) test(`histórico ${status} mantém estado indisponível`, () => {
  assert.equal(resolverEstadoAplicacao({ ...base, situacaoResidencial: { ...residencial, vinculo_ativo: null, ultimo_vinculo: { ...vinculo, status_vinculo: status } } }), "VINCULO_INDISPONIVEL");
});
test("super sem residência vai para admin e suspensão global prevalece", () => {
  const superAdmin = { ...base, meuUsuario: { ...base.meuUsuario, super_admin: true }, situacaoResidencial: { ...residencial, super_admin: true, vinculo_ativo: null } };
  assert.equal(destinos[resolverEstadoAplicacao(superAdmin)], "/admin");
  assert.equal(resolverEstadoAplicacao({ ...superAdmin, erroEstado: new ApiError(403, "ACCOUNT_SUSPENDED", "Suspensa") }), "CONTA_SUSPENSA");
});
test("falhas e respostas incoerentes permitem erro recuperável sem redirect cíclico", () => {
  assert.equal(resolverEstadoAplicacao({ ...base, meuUsuario: null }), "ERRO");
  assert.equal(resolverEstadoAplicacao({ ...base, situacaoResidencial: { ...residencial, super_admin: true } }), "ERRO");
  assert.equal(resolverEstadoAplicacao({ ...base, situacaoResidencial: { ...residencial, vinculo_ativo: null } }), "ERRO");
});

function cliente(fetchMock: typeof fetch, renovarSessao = async () => null as SessaoApi | null) {
  return criarApi({ baseUrl: "http://api.test/api/", obterSessao: async () => sessao, renovarSessao, fetch: fetchMock });
}
test("API injeta Bearer/Accept, preserva envelope e paginação na raiz", async () => {
  const envelope = { dados: [], paginacao: { pagina: 1, limite: 20, total: 0, total_paginas: 0 } };
  const api = cliente(async (url, init) => {
    assert.equal(url, "http://api.test/api/condominios");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer original");
    assert.equal(new Headers(init?.headers).get("Accept"), "application/json");
    assert.equal(new Headers(init?.headers).has("Content-Type"), false);
    return Response.json(envelope);
  });
  assert.deepEqual(await api.requisitar("/condominios"), envelope);
});
test("204 não tenta JSON e FormData não recebe Content-Type manual", async () => {
  const form = new FormData(); form.append("imagem", new Blob(["imagem"]), "teste.png");
  const api = cliente(async (_url, init) => {
    assert.equal(init?.body, form);
    assert.equal(new Headers(init?.headers).has("Content-Type"), false);
    const response = new Response(null, { status: 204 });
    response.json = () => { throw new Error("Não pode chamar JSON em 204"); };
    return response;
  });
  assert.equal(await api.requisitar("/imagens", { method: "POST", body: form, headers: { "Content-Type": "application/json" } }), undefined);
});
test("JSON é serializado e detalhes Zod são preservados no ApiError", async () => {
  const detalhes = { formErrors: [], fieldErrors: { cpf: ["Inválido"] } };
  const api = cliente(async (_url, init) => {
    assert.equal(init?.body, '{"cpf":"curto"}');
    assert.equal(new Headers(init?.headers).get("Content-Type"), "application/json");
    return Response.json({ erro: "VALIDATION_ERROR", detalhes }, { status: 400 });
  });
  await assert.rejects(api.requisitar("/onboarding", { method: "POST", json: { cpf: "curto" } }), (erro: unknown) => {
    assert.ok(erro instanceof ApiError); assert.equal(erro.status, 400); assert.equal(erro.codigo, "VALIDATION_ERROR"); assert.deepEqual(erro.detalhes, detalhes); return true;
  });
});
test("401 renova e repete uma única vez com novo token", async () => {
  let chamadas = 0; let refresh = 0;
  const api = cliente(async (_url, init) => {
    chamadas++;
    assert.equal(new Headers(init?.headers).get("Authorization"), chamadas === 1 ? "Bearer original" : "Bearer renovado");
    return chamadas === 1 ? Response.json({ erro: "UNAUTHENTICATED" }, { status: 401 }) : Response.json({ dados: {} });
  }, async () => { refresh++; return { ...sessao, access_token: "renovado" }; });
  await api.requisitar("/onboarding", { method: "POST", json: {} });
  assert.equal(chamadas, 2); assert.equal(refresh, 1);
});
test("401 persistente não entra em loop e notifica a identidade correta", async () => {
  let chamadas = 0; let refresh = 0; let notificado = "";
  const api = cliente(async () => { chamadas++; return Response.json({ erro: "UNAUTHENTICATED" }, { status: 401 }); }, async () => { refresh++; return { ...sessao, access_token: "renovado" }; });
  api.observarErros((erro, id) => { assert.equal(erro.codigo, "UNAUTHENTICATED"); notificado = id; });
  await assert.rejects(api.requisitar("/usuarios/me"), ApiError);
  assert.equal(chamadas, 2); assert.equal(refresh, 1); assert.equal(notificado, "pessoa");
});
for (const renovada of [null, sessao, { ...sessao, user: { id: "outra-pessoa" }, access_token: "novo" }]) test(`401 não repete sem sessão nova da mesma pessoa: ${renovada?.access_token}`, async () => {
  let chamadas = 0;
  const api = cliente(async () => { chamadas++; return Response.json({ erro: "UNAUTHENTICATED" }, { status: 401 }); }, async () => renovada);
  await assert.rejects(api.requisitar("/onboarding", { method: "POST", json: {} }), ApiError);
  assert.equal(chamadas, 1);
});
for (const method of ["POST", "PATCH", "DELETE"]) test(`${method} não repete em erro de rede ou conflito`, async () => {
  for (const rede of [true, false]) {
    let chamadas = 0;
    const api = cliente(async () => { chamadas++; if (rede) throw new TypeError("offline"); return Response.json({ erro: "CONFLICT" }, { status: 409 }); });
    await assert.rejects(api.requisitar("/recurso", { method, json: {} })); assert.equal(chamadas, 1);
  }
});
test("sem sessão e caminhos externos nunca enviam credenciais", async () => {
  const api = criarApi({ baseUrl: "http://api.test", obterSessao: async () => null, renovarSessao: async () => null, fetch: async () => { assert.fail("Não pode enviar"); } });
  await assert.rejects(api.requisitar("/usuarios/me"), ApiError);
  await assert.rejects(api.requisitar("//outro.test/roubar"));
});
test("schemas normalizam onboarding, validam datas reais e confirmação de senha", () => {
  const dados = { nome_completo: " Maria Exemplo ", cpf: "000.000.000-00", data_nascimento: "2000-02-29", id_condominio: "12345678-1234-4234-8234-123456789012", moradia: " Apto 302 " };
  assert.deepEqual(onboardingSchema.parse(dados), { ...dados, cpf: "00000000000", nome_completo: "Maria Exemplo", moradia: "Apto 302" });
  assert.equal(onboardingSchema.safeParse({ ...dados, data_nascimento: "2001-02-29" }).success, false);
  assert.equal(cadastroSchema.safeParse({ email: "morador@example.com", senha: "abcdef", confirmacao: "abcdeg" }).success, false);
});
test("filtros da vitrine usam somente busca/categoria/página e limite 20", () => {
  const filtros = lerFiltrosVitrine(new URLSearchParams("busca=  bolo  &pagina=2&id_condominio=forjado"));
  assert.equal(filtros.success, true);
  if (!filtros.success) return;
  assert.deepEqual(Object.fromEntries(queryVitrine(filtros.data)), { pagina: "2", limite: "20", busca: "bolo" });
  assert.equal(queryVitrine({ pagina: 1, busca: "  " }).has("busca"), false);
});
for (const query of ["pagina=0", "pagina=1&pagina=2", "id_categoria=forjado", "pagina=999999999999", `busca=${"a".repeat(141)}`]) test(`filtro inválido não deve chegar à API: ${query.slice(0, 35)}`, () => {
  assert.equal(lerFiltrosVitrine(new URLSearchParams(query)).success, false);
});
test("resumo monetário usa centavos exatos e mantém casas decimais em totais grandes", () => {
  assert.equal(calcularTotalEstimado("25.90", 2), "51.80");
  assert.equal(calcularTotalEstimado("0.10", 3), "0.30");
  assert.equal(calcularTotalEstimado("9999999999.99", 2147483647), "21474836469978525163.53");
  assert.equal(formatarReais("51.80"), "R$\u00a051,80");
  assert.equal(calcularTotalEstimado("1.00", 1.5), null);
});
test("formulário bloqueia quantidades inválidas e horário passado", () => {
  const schema = formularioPedidoSchema(4);
  for (const quantidade of ["", "0", "-1", "1.5", "5"]) assert.equal(schema.safeParse({ quantidade, hora_combinada: "2099-01-01T19:00" }).success, false);
  assert.equal(schema.safeParse({ quantidade: "1", hora_combinada: "2000-01-01T19:00" }).success, false);
  assert.equal(formularioPedidoSchema(0).safeParse({ quantidade: "1", hora_combinada: "2099-01-01T19:00" }).success, false);
});
test("data local vira instante ISO com timezone e rejeita rollover", () => {
  assert.equal(converterHorarioLocal("2099-01-01T19:00"), new Date(2099, 0, 1, 19, 0).toISOString());
  assert.equal(converterHorarioLocal("2099-02-30T19:00"), null);
  assert.equal(converterHorarioLocal("2099-01-01T25:00"), null);
  assert.equal(converterHorarioLocal("qualquer coisa"), null);
  const pedido = formularioPedidoSchema(4).parse({ quantidade: "2", hora_combinada: "2099-01-01T19:00" });
  assert.equal(pedido.quantidade, 2); assert.ok(pedido.hora_combinada.endsWith("Z"));
});
const camposProduto = { id_categoria: "62345678-1234-4234-8234-123456789012", nome_produto: " Bolo ", descricao: " Caseiro ", preco: "25,9", estoque: "0" };
test("publicação normaliza preço string decimal e estoque numérico inclusive zero", () => {
  assert.deepEqual(formularioProdutoSchema.parse(camposProduto), { ...camposProduto, nome_produto: "Bolo", descricao: "Caseiro", preco: "25.90", estoque: 0 });
  assert.equal(normalizarPreco(" 00025,90 "), "25.90");
});
for (const preco of ["0", "0.00", "-1", "25.901", "10000000000.00", "1.000,00", "abc"]) test(`preço inválido rejeitado: ${preco}`, () => {
  assert.equal(formularioProdutoSchema.safeParse({ ...camposProduto, preco }).success, false);
});
test("valida limites de nome, categoria e estoque sem campos de autoridade", () => {
  for (const estoque of ["", "-1", "1.5", "2147483648"]) assert.equal(formularioProdutoSchema.safeParse({ ...camposProduto, estoque }).success, false);
  assert.equal(formularioProdutoSchema.safeParse({ ...camposProduto, estoque: "2147483647" }).success, true);
  assert.equal(formularioProdutoSchema.safeParse({ ...camposProduto, nome_produto: " ", id_categoria: "invalido" }).success, false);
  const valido = formularioProdutoSchema.parse(camposProduto);
  assert.equal(produtoDadosSchema.safeParse({ ...valido, ativo: true }).success, false);
  assert.equal(produtoPatchSchema.safeParse({}).success, false);
});
test("diff parcial omite categoria e valores decimais equivalentes não alterados", () => {
  const inicial = formularioProdutoSchema.parse(camposProduto);
  assert.deepEqual(diferencaProduto(inicial, { ...inicial, nome_produto: "Bolo novo" }), { nome_produto: "Bolo novo" });
  assert.deepEqual(diferencaProduto({ ...inicial, preco: "25.9" }, inicial), {});
  assert.deepEqual(diferencaProduto(inicial, { ...inicial, estoque: 7 }), { estoque: 7 });
});
test("gestão omite ativo por padrão, serializa falso explicitamente e ignora autoridade na URL", () => {
  const filtro = lerFiltrosMeusProdutos(new URLSearchParams("pagina=2&ativo=false&id_condominio=forjado&categoria=legado"));
  assert.equal(filtro.success, true);
  if (filtro.success) assert.deepEqual(Object.fromEntries(queryMeusProdutos(filtro.data)), { pagina: "2", limite: "20", ativo: "false" });
  assert.equal(queryMeusProdutos({ busca: "", pagina: 1 }).has("ativo"), false);
  assert.equal(lerFiltrosMeusProdutos(new URLSearchParams("ativo=1")).success, false);
  assert.equal(lerFiltrosMeusProdutos(new URLSearchParams("ativo=true&ativo=false")).success, false);
});
test("imagem aceita até 5 MiB exatos e somente JPEG/PNG/WEBP", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp"]) assert.equal(arquivoImagemProdutoSchema.safeParse({ type, size: tamanhoMaximoImagemProduto }).success, true);
  assert.equal(arquivoImagemProdutoSchema.safeParse({ type: "image/png", size: tamanhoMaximoImagemProduto + 1 }).success, false);
  assert.equal(arquivoImagemProdutoSchema.safeParse({ type: "image/gif", size: 100 }).success, false);
  assert.equal(arquivoImagemProdutoSchema.safeParse({ type: "image/png", size: 0 }).success, false);
});
test("histórico depende de perfil, sem exigir vínculo, e não aceita pré-onboarding ou super", () => {
  assert.equal(podeAcessarHistorico({ onboarding_realizado: true, super_admin: false }), true);
  assert.equal(podeAcessarHistorico({ onboarding_realizado: false, super_admin: false }), false);
  assert.equal(podeAcessarHistorico({ onboarding_realizado: true, super_admin: true }), false);
  assert.equal(podeAcessarHistorico(null), false);
});
const matriz: [PapelPedido, StatusPedido, DestinoPedido[]][] = [
  ["COMPRADOR", "SOLICITADO", ["CANCELADO"]], ["COMPRADOR", "ACEITO", ["CANCELADO"]],
  ["COMPRADOR", "RECUSADO", []], ["COMPRADOR", "CANCELADO", []], ["COMPRADOR", "CONCLUIDO", []],
  ["VENDEDOR", "SOLICITADO", ["ACEITO", "RECUSADO"]], ["VENDEDOR", "ACEITO", ["CONCLUIDO"]],
  ["VENDEDOR", "RECUSADO", []], ["VENDEDOR", "CANCELADO", []], ["VENDEDOR", "CONCLUIDO", []],
];
for (const [papel, status, acoes] of matriz) test(`matriz de pedido ${papel}/${status}`, () => assert.deepEqual(acoesPermitidasPedido(papel, status), acoes));
test("filtros históricos usam compra/venda e não papéis visuais, com validação de página", () => {
  assert.deepEqual(lerFiltrosPedidos(new URLSearchParams("papel=compra&status=ACEITO&pagina=2")).data, { papel: "compra", status: "ACEITO", pagina: 2 });
  assert.equal(lerFiltrosPedidos(new URLSearchParams("papel=VENDEDOR")).success, false);
  assert.equal(lerFiltrosPedidos(new URLSearchParams("pagina=0")).success, false);
  assert.equal(lerFiltrosPedidos(new URLSearchParams("status=ACEITO&status=CANCELADO")).success, false);
});
test("status omite motivo vazio, faz trim e rejeita nulos, excesso e campos de autoridade", () => {
  assert.deepEqual(alterarStatusPedidoSchema.parse({ status: "ACEITO", motivo: "  " }), { status: "ACEITO" });
  assert.deepEqual(alterarStatusPedidoSchema.parse({ status: "CANCELADO", motivo: " Não preciso mais " }), { status: "CANCELADO", motivo: "Não preciso mais" });
  for (const dados of [{ status: "SOLICITADO" }, { status: "ACEITO", motivo: null }, { status: "ACEITO", motivo: "a".repeat(256) }, { status: "ACEITO", id_usuario: "forjado" }]) assert.equal(alterarStatusPedidoSchema.safeParse(dados).success, false);
});
test("mensagem exige texto trim 1..1000 e somente conteudo", () => {
  assert.deepEqual(mensagemChatSchema.parse({ conteudo: "  Olá! \n" }), { conteudo: "Olá!" });
  assert.equal(mensagemChatSchema.safeParse({ conteudo: "a".repeat(1000) }).success, true);
  for (const conteudo of [" ", "a".repeat(1001), null]) assert.equal(mensagemChatSchema.safeParse({ conteudo }).success, false);
  assert.equal(mensagemChatSchema.safeParse({ conteudo: "Oi", id_remetente: "forjado" }).success, false);
});
test("página do chat respeita default e offset para limite 50", () => {
  assert.equal(paginaChatSchema.parse(undefined), 1);
  assert.equal(paginaChatSchema.safeParse("0").success, false);
  assert.equal(paginaChatSchema.safeParse("9999999999").success, false);
});
