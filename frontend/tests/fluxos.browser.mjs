// Executar com Vite e variáveis fictícias descritas em docs/FRONTEND_INFRA.md.
import { test, after } from "node:test";
import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true });
after(() => browser.close());
const origem = process.env.FRONTEND_TEST_URL || "http://127.0.0.1:5174";
const id = "12345678-1234-4234-8234-123456789012";
const outroId = "22345678-1234-4234-8234-123456789012";
const condominio = { id_condominio: "32345678-1234-4234-8234-123456789012", nome_residencial: "Residencial Exemplo", cep: "00000000", endereco: "Endereço fictício" };
const vinculo = { id_vinculo: "42345678-1234-4234-8234-123456789012", status_vinculo: "ATIVO", moradia: "Apto 302", admin_condominio: false,
  data_solicitacao: "2026-10-16T12:00:00Z", data_aprovacao: null, data_inicio: null, data_fim: null, condominio };
const produtoId = "52345678-1234-4234-8234-123456789012";
const categoriaId = "62345678-1234-4234-8234-123456789012";
const produtoBase = { id_produto: produtoId, nome_produto: "Bolo de cenoura", descricao: "Bolo caseiro com cobertura de chocolate.", preco: "25.90", estoque: 4,
  ativo: true, created_at: "2026-10-16T12:00:00Z", updated_at: "2026-10-16T12:00:00Z", categoria: { id_categoria: categoriaId, nome: "Alimentos", ativo: true },
  vendedor: { id_vinculo: outroId, nome_completo: "Vizinho Exemplo", moradia: "Apto 201" }, imagens: [] };
const pedidoId = "72345678-1234-4234-8234-123456789012";
const pedidoBase = { id_pedido: pedidoId, papel_usuario: "COMPRADOR", quantidade: 2, valor_pedido: "51.80", status_pedido: "SOLICITADO", hora_solicitacao: "2026-10-16T12:00:00Z", hora_combinada: "2099-01-01T22:00:00Z", ultima_atualizacao: "2026-10-16T12:00:00Z", produto: { id_produto: produtoId, nome_produto: "Bolo no pedido" }, contraparte: { nome_completo: "Contraparte Exemplo", moradia: "Apto antigo 201" }, condominio: { id_condominio: condominio.id_condominio, nome_residencial: "Residencial da negociação" }, historico: [{ status_anterior: null, status_novo: "SOLICITADO", motivo: null, created_at: "2026-10-16T12:00:00Z" }], chat: { disponivel: true, status_conversa: "ATIVA" } };
const mensagemBase = { id_mensagem: "c2345678-1234-4234-8234-123456789012", conteudo: "Mensagem mais antiga", created_at: "2026-10-16T12:00:00Z", remetente: { nome_completo: "Contraparte Exemplo", papel: "VENDEDOR" } };
const destinoCondominio = { ...condominio, id_condominio: "92345678-1234-4234-8234-123456789012", nome_residencial: "Residencial Novo" };
const vinculoAdminBase = { id_vinculo: "a2345678-1234-4234-8234-123456789012", status_vinculo: "PENDENTE", moradia: "Bloco C - 12", admin_condominio: false, data_solicitacao: vinculo.data_solicitacao, data_inicio: null, morador: { id_usuario: outroId, nome_completo: "Morador da fila" }, condominio: { id_condominio: condominio.id_condominio, nome_residencial: condominio.nome_residencial } };
function sessao(idUsuario = id, versao = "inicial") {
  const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: idUsuario, exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated", versao })).toString("base64url")}.assinatura-ficticia`;
  return { access_token: token, refresh_token: "refresh-ficticio", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: idUsuario, aud: "authenticated", role: "authenticated", email: "morador@example.com", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, identities: [], created_at: "2026-10-16T12:00:00Z" } };
}
async function preparar(t, opcoes = {}) {
  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", timezoneId: "America/Sao_Paulo" });
  t.after(() => contexto.close());
  const page = await contexto.newPage();
  page.setDefaultTimeout(8000);
  const falhas = [];
  page.on("pageerror", error => falhas.push(error.message));
  t.after(() => assert.deepEqual(falhas, [], "Sem exceções na aplicação"));
  const estado = { modo: "ativo", pessoa: id, confirmar: false, atraso: 0, erroPost: null, chamadas: [], produto: structuredClone(produtoBase), pedidos: [structuredClone(pedidoBase)], mensagens: [structuredClone(mensagemBase)], conversa: "ATIVA", vinculosAdmin: [structuredClone(vinculoAdminBase)], ...opcoes };
  if (estado.sessao) await contexto.addInitScript(({ valor }) => { if (!sessionStorage.getItem("teste-inicializado")) { localStorage.setItem("sb-auth-auth-token", JSON.stringify(valor)); sessionStorage.setItem("teste-inicializado", "sim"); } }, { valor: sessao() });
  await contexto.addInitScript(() => {
    window.loginPiscou = false;
    new MutationObserver(() => { if (document.querySelector("h1")?.textContent === "Bom ter você por aqui") window.loginPiscou = true; }).observe(document, { subtree: true, childList: true });
  });
  const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS" };
  await contexto.route("http://auth.porta.test/**", async route => {
    const url = new URL(route.request().url());
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (url.pathname.endsWith("/logout")) return route.fulfill({ status: 204, headers });
    if (url.pathname.endsWith("/user")) return route.fulfill({ json: sessao(estado.pessoa).user, headers });
    if (estado.erroLogin && url.searchParams.get("grant_type") === "password") return route.fulfill({ status: 400, json: { code: estado.erroLogin, message: "Negação fictícia de Auth" }, headers: { ...headers, "x-supabase-api-version": "2024-01-01", "access-control-expose-headers": "x-supabase-api-version" } });
    if (url.searchParams.get("grant_type") === "refresh_token") estado.renovacoes = (estado.renovacoes || 0) + 1;
    if (url.pathname.endsWith("/signup") && estado.confirmar) return route.fulfill({ json: { ...sessao().user, confirmation_sent_at: new Date().toISOString() }, headers });
    return route.fulfill({ json: sessao(estado.pessoa, url.searchParams.get("grant_type") === "refresh_token" ? "renovada" : "inicial"), headers });
  });
  await contexto.route("http://api.porta.test/api/**", async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const chamada = { caminho: url.pathname, query: url.searchParams.toString(), metodo: req.method(), bearer: req.headers().authorization, headers: req.headers(), body: req.headers()["content-type"]?.includes("application/json") ? req.postDataJSON() : null, bytes: req.postDataBuffer()?.length ?? 0 };
    estado.chamadas.push(chamada);
    if (estado.forcar401 && !estado.rejeitou401 && url.pathname.endsWith("/usuarios/me")) {
      estado.rejeitou401 = true;
      return route.fulfill({ status: 401, json: { erro: "UNAUTHENTICATED" }, headers });
    }
    if (estado.atraso) await new Promise(resolve => setTimeout(resolve, estado.atraso));
    if (estado.modo === "suspensa") return route.fulfill({ status: 403, json: { erro: "ACCOUNT_SUSPENDED" }, headers });
    if (estado.modo === "falha") return route.fulfill({ status: 500, json: { erro: "INTERNAL_ERROR" }, headers });
    if (url.pathname.endsWith("/categorias")) {
      if (estado.erroCategorias) return route.fulfill({ status: 500, json: { erro: "INTERNAL_ERROR" }, headers });
      return route.fulfill({ json: { dados: estado.categoriasVazias ? [] : [{ id_categoria: categoriaId, nome: "Alimentos" }] }, headers });
    }
    async function falhar(erro) {
      if (["MEMBERSHIP_REQUIRED", "FORBIDDEN_CROSS_TENANT"].includes(erro.codigo)) estado.modo = "SUSPENSO";
      if (erro.codigo === "ACCOUNT_SUSPENDED") estado.modo = "suspensa";
      return route.fulfill({ status: erro.status, json: { erro: erro.codigo, detalhes: erro.detalhes }, headers });
    }
    if (url.pathname === "/api/admin/condominios" && req.method() === "POST") {
      if (estado.atrasoCondominio) await new Promise(resolve => setTimeout(resolve, estado.atrasoCondominio));
      if (estado.erroCondominio) {
        if (estado.erroCondominio.status === 403) estado.modo = "admin";
        return falhar(estado.erroCondominio);
      }
      const dados = { ...req.postDataJSON(), id_condominio: destinoCondominio.id_condominio, ativo: true, created_at: "2026-10-16T20:00:00.000Z" };
      estado.catalogoCondominios = [dados];
      if (estado.perderRespostaCondominio) return route.abort("failed");
      return route.fulfill({ status: 201, json: { dados }, headers });
    }
    if (url.pathname === "/api/vinculos/transferencia") {
      if (estado.atrasoTransferencia) await new Promise(resolve => setTimeout(resolve, estado.atrasoTransferencia));
      if (estado.erroTransferencia) {
        if (estado.erroTransferencia.codigo === "MEMBERSHIP_PENDING") estado.destinoPendente = { ...vinculo, status_vinculo: "PENDENTE", condominio: destinoCondominio };
        return falhar(estado.erroTransferencia);
      }
      const body = req.postDataJSON();
      estado.destinoPendente = { ...vinculo, ...body, id_vinculo: vinculoAdminBase.id_vinculo, status_vinculo: "PENDENTE", admin_condominio: false, condominio: destinoCondominio };
      return route.fulfill({ status: 201, json: { dados: { ...body, id_vinculo: vinculoAdminBase.id_vinculo, status_vinculo: "PENDENTE", admin_condominio: false, data_solicitacao: vinculo.data_solicitacao } }, headers });
    }
    if (["/api/admin/vinculos", "/api/admin/vinculos/pendentes"].includes(url.pathname)) {
      if (estado.erroAdminLista) {
        if (estado.perderAdmin) estado.modo = "ativo";
        return falhar(estado.erroAdminLista);
      }
      const pendentes = url.pathname.endsWith("/pendentes"), pagina = Number(url.searchParams.get("pagina")), busca = (url.searchParams.get("busca") ?? "").toLowerCase();
      let dados = estado.vinculosAdmin.filter(v => (!pendentes || v.status_vinculo === "PENDENTE") && (!url.searchParams.has("status") || v.status_vinculo === url.searchParams.get("status")) && (!busca || `${v.morador.nome_completo} ${v.moradia}`.toLowerCase().includes(busca)) && (!url.searchParams.has("id_condominio") || v.condominio.id_condominio === url.searchParams.get("id_condominio")));
      const total = dados.length;
      dados = dados.slice((pagina - 1) * 20, pagina * 20);
      if (pendentes) dados = dados.map(({ admin_condominio, data_inicio, morador, ...v }) => ({ ...v, morador: { id_condomino: morador.id_usuario, nome_completo: morador.nome_completo } }));
      if (estado.atrasarAdmin && busca === "morador") await new Promise(resolve => setTimeout(resolve, 450));
      return route.fulfill({ json: { dados, paginacao: { pagina, limite: 20, total, total_paginas: Math.ceil(total / 20) } }, headers });
    }
    const adminMatch = url.pathname.match(/^\/api\/admin\/(vinculos|usuarios)\/([^/]+)\/(aprovar|rejeitar|suspender|admin|status)$/);
    if (adminMatch) {
      if (estado.atrasoAdmin) await new Promise(resolve => setTimeout(resolve, estado.atrasoAdmin));
      const item = estado.vinculosAdmin.find(v => v.id_vinculo === adminMatch[2]);
      if (estado.erroAcaoAdmin) {
        if (estado.perderAdmin) estado.modo = "ativo";
        if (estado.erroAcaoAdmin.codigo === "MEMBERSHIP_NOT_PENDING" && item) item.status_vinculo = "ATIVO";
        return falhar(estado.erroAcaoAdmin);
      }
      if (adminMatch[1] === "usuarios") {
        const body = req.postDataJSON(); estado.statusGlobal = body.status_conta;
        return route.fulfill({ json: { dados: { id_usuario: adminMatch[2], status_conta: body.status_conta } }, headers });
      }
      if (adminMatch[3] === "admin") {
        item.admin_condominio = req.postDataJSON().admin_condominio;
        return route.fulfill({ json: { dados: { id_vinculo: item.id_vinculo, admin_condominio: item.admin_condominio, admin_atualizado_em: null } }, headers });
      }
      item.status_vinculo = { aprovar: "ATIVO", rejeitar: "REJEITADO", suspender: "SUSPENSO" }[adminMatch[3]];
      if (item.morador.id_usuario === estado.pessoa && adminMatch[3] === "suspender") estado.modo = "SUSPENSO";
      return route.fulfill({ json: { dados: { ...item, data_aprovacao: null, data_inicio: null, data_fim: null, morador: { id_condomino: item.morador.id_usuario, nome_completo: item.morador.nome_completo } } }, headers });
    }
    if (url.pathname === "/api/pedidos/me") {
      if (estado.erroHistorico) return falhar(estado.erroHistorico);
      const papel = url.searchParams.get("papel"), status = url.searchParams.get("status");
      let dados = estado.pedidos.filter(p => (!papel || p.papel_usuario === (papel === "compra" ? "COMPRADOR" : "VENDEDOR")) && (!status || p.status_pedido === status));
      const total = dados.length;
      const pagina = Number(url.searchParams.get("pagina"));
      dados = dados.slice((pagina - 1) * 20, pagina * 20);
      if (estado.atrasarPedidos && papel === "compra") await new Promise(resolve => setTimeout(resolve, 450));
      return route.fulfill({ json: { dados, paginacao: { pagina, limite: 20, total, total_paginas: Math.ceil(total / 20) } }, headers });
    }
    const statusMatch = url.pathname.match(/^\/api\/pedidos\/([^/]+)\/status$/);
    if (statusMatch) {
      if (estado.atrasoTransicao) await new Promise(resolve => setTimeout(resolve, estado.atrasoTransicao));
      const pedido = estado.pedidos.find(p => p.id_pedido === statusMatch[1]);
      if (estado.erroTransicao) {
        if (estado.erroTransicao.codigo === "INVALID_ORDER_TRANSITION" && pedido) { pedido.status_pedido = "CANCELADO"; pedido.ultima_atualizacao = "2026-10-16T12:15:00Z"; pedido.historico.push({ status_anterior: "SOLICITADO", status_novo: "CANCELADO", motivo: "Decisão concorrente", created_at: pedido.ultima_atualizacao }); }
        if (estado.erroTransicao.codigo === "ORDER_NOT_FOUND") estado.pedidos = estado.pedidos.filter(p => p.id_pedido !== statusMatch[1]);
        return falhar(estado.erroTransicao);
      }
      const dados = req.postDataJSON();
      pedido.historico.push({ status_anterior: pedido.status_pedido, status_novo: dados.status, motivo: dados.motivo ?? null, created_at: "2026-10-16T12:15:00Z" });
      pedido.status_pedido = dados.status; pedido.ultima_atualizacao = "2026-10-16T12:15:00Z";
      return route.fulfill({ json: { dados: { id_pedido: pedido.id_pedido, status_pedido: pedido.status_pedido, ultima_atualizacao: pedido.ultima_atualizacao } }, headers });
    }
    const chatMatch = url.pathname.match(/^\/api\/pedidos\/([^/]+)\/chat(?:\/messages)?$/);
    if (chatMatch) {
      if (req.method() === "POST") {
        if (estado.atrasoMensagem) await new Promise(resolve => setTimeout(resolve, estado.atrasoMensagem));
        if (estado.redeMensagem) return route.abort("failed");
        if (estado.erroMensagem) { if (estado.erroMensagem.codigo === "CHAT_CLOSED") estado.conversa = "ENCERRADA"; return falhar(estado.erroMensagem); }
        const dados = req.postDataJSON();
        const mensagem = { ...structuredClone(mensagemBase), id_mensagem: `d2345678-1234-4234-8234-${String(estado.mensagens.length + 1).padStart(12, "0")}`, conteudo: dados.conteudo, created_at: "2026-10-16T12:30:00Z", remetente: { nome_completo: "Morador atual", papel: "COMPRADOR" } };
        estado.mensagens.push(mensagem);
        return route.fulfill({ status: 201, json: { dados: mensagem }, headers });
      }
      if (estado.erroChat) return falhar(estado.erroChat);
      const total = estado.mensagens.length, pagina = Number(url.searchParams.get("pagina"));
      const dados = estado.mensagens.slice((pagina - 1) * 50, pagina * 50);
      if (estado.atrasarChat && pagina === 2) await new Promise(resolve => setTimeout(resolve, 450));
      return route.fulfill({ json: { dados, paginacao: { pagina, limite: 50, total, total_paginas: Math.ceil(total / 50) }, conversa: { id_conversa: "e2345678-1234-4234-8234-123456789012", status_conversa: estado.conversa }, pedido: { id_pedido: chatMatch[1], status_pedido: estado.statusPedidoChat ?? "ACEITO" } }, headers });
    }
    function gestao(produto) { const { vendedor, ...dados } = produto; return dados; }
    if (url.pathname === "/api/produtos/me") {
      if (estado.erroMeusProdutos) return falhar(estado.erroMeusProdutos);
      let produtos = estado.proprios ?? (estado.produto.vendedor.id_vinculo === vinculo.id_vinculo ? [estado.produto] : []);
      const busca = (url.searchParams.get("busca") ?? "").toLowerCase();
      produtos = produtos.filter(p => (!busca || p.nome_produto.toLowerCase().includes(busca)) && (!url.searchParams.has("ativo") || p.ativo === (url.searchParams.get("ativo") === "true")) && (!url.searchParams.has("id_categoria") || p.categoria.id_categoria === url.searchParams.get("id_categoria")));
      if (estado.atrasarBusca && busca === "bolo") await new Promise(resolve => setTimeout(resolve, 450));
      return route.fulfill({ json: { dados: produtos.map(gestao), paginacao: { pagina: Number(url.searchParams.get("pagina")), limite: 20, total: estado.paginarGestao && produtos.length ? 21 : produtos.length, total_paginas: estado.paginarGestao && produtos.length ? 2 : produtos.length ? 1 : 0 } }, headers });
    }
    if (url.pathname === "/api/produtos" && req.method() === "POST") {
      if (estado.erroCriacao) return falhar(estado.erroCriacao);
      const { id_categoria, ...campos } = req.postDataJSON();
      estado.produto = { ...structuredClone(produtoBase), ...campos, categoria: { id_categoria, nome: "Alimentos", ativo: true }, id_produto: "82345678-1234-4234-8234-123456789012", vendedor: { ...produtoBase.vendedor, id_vinculo: vinculo.id_vinculo } };
      const { imagens, updated_at, ...dados } = gestao(estado.produto);
      const { ativo, ...categoria } = dados.categoria;
      return route.fulfill({ status: 201, json: { dados: { ...dados, categoria } }, headers });
    }
    const caminhoProduto = `/api/produtos/${estado.produto.id_produto}`;
    if (url.pathname === `${caminhoProduto}/status`) {
      if (estado.atrasoStatus) await new Promise(resolve => setTimeout(resolve, estado.atrasoStatus));
      if (estado.erroStatus) return falhar(estado.erroStatus);
      if (req.postDataJSON().ativo && !estado.produto.categoria.ativo) return falhar({ status: 409, codigo: "CATEGORY_INACTIVE" });
      estado.produto.ativo = req.postDataJSON().ativo;
      const { imagens, ...dados } = gestao(estado.produto);
      return route.fulfill({ json: { dados }, headers });
    }
    if (url.pathname === caminhoProduto && req.method() === "PATCH") {
      if (estado.erroEdicao) return falhar(estado.erroEdicao);
      const { id_categoria, ...dados } = req.postDataJSON();
      Object.assign(estado.produto, dados);
      if (id_categoria) estado.produto.categoria = { id_categoria, nome: "Alimentos", ativo: true };
      const { imagens, ...resposta } = gestao(estado.produto);
      if (estado.falharGetAposPatch) estado.erroDetalhe = { status: 500, codigo: "INTERNAL_ERROR" };
      return route.fulfill({ json: { dados: resposta }, headers });
    }
    if (url.pathname === `${caminhoProduto}/imagens` && req.method() === "POST") {
      const form = await new Response(req.postDataBuffer(), { headers: { "Content-Type": req.headers()["content-type"] } }).formData();
      chamada.camposForm = [...form.entries()].map(([nome, file]) => ({ nome, tamanho: file.size, tipo: file.type, arquivo: file.name }));
      if (estado.erroUpload) return falhar(estado.erroUpload);
      const imagem = { id_imagem: `92345678-1234-4234-8234-${String(estado.produto.imagens.length + 1).padStart(12, "0")}`, ordem: estado.produto.imagens.length * 2, url: "https://images.porta.test/nova?token=temporario", expires_in: 600 };
      estado.produto.imagens.push(imagem);
      return route.fulfill({ status: 201, json: { dados: { id_imagem: imagem.id_imagem, id_produto: estado.produto.id_produto, ordem: imagem.ordem, created_at: "2026-10-16T12:00:00Z" } }, headers });
    }
    if (url.pathname.startsWith(`${caminhoProduto}/imagens/`) && req.method() === "DELETE") {
      if (estado.erroExcluir) {
        if (estado.erroExcluir.codigo === "IMAGE_NOT_FOUND") estado.produto.imagens = estado.produto.imagens.filter(i => i.id_imagem !== url.pathname.split("/").at(-1));
        return falhar(estado.erroExcluir);
      }
      estado.produto.imagens = estado.produto.imagens.filter(i => i.id_imagem !== url.pathname.split("/").at(-1));
      return route.fulfill({ status: 204, headers });
    }
    if (url.pathname === "/api/produtos") {
      if (estado.erroLista) return route.fulfill({ status: 500, json: { erro: "INTERNAL_ERROR" }, headers });
      const vazio = estado.listaVazia || url.searchParams.get("busca") === "Ausente" || !estado.produto.ativo || !estado.produto.categoria.ativo;
      const { ativo, updated_at, ...item } = estado.produto;
      const { ativo: categoriaAtiva, ...categoria } = item.categoria;
      return route.fulfill({ json: { dados: vazio ? [] : [{ ...item, categoria }], paginacao: { pagina: Number(url.searchParams.get("pagina")), limite: 20, total: vazio ? 0 : 21, total_paginas: vazio ? 0 : 2 } }, headers });
    }
    if (url.pathname === caminhoProduto) {
      if (estado.erroDetalhe) {
        if (["MEMBERSHIP_REQUIRED", "FORBIDDEN_CROSS_TENANT"].includes(estado.erroDetalhe.codigo)) estado.modo = "SUSPENSO";
        return route.fulfill({ status: estado.erroDetalhe.status, json: { erro: estado.erroDetalhe.codigo }, headers });
      }
      return route.fulfill({ json: { dados: estado.produto }, headers });
    }
    if (url.pathname === "/api/pedidos") {
      if (estado.atrasoPedido) await new Promise(resolve => setTimeout(resolve, estado.atrasoPedido));
      if (estado.negarPedidoAtrasado) return route.fulfill({ status: 403, json: { erro: "MEMBERSHIP_REQUIRED" }, headers });
      if (estado.erroPedido) {
        if (estado.erroPedido.codigo === "INSUFFICIENT_STOCK") estado.produto.estoque = estado.estoqueNovo ?? 1;
        if (estado.erroPedido.codigo === "PRODUCT_UNAVAILABLE") estado.erroDetalhe = { status: 404, codigo: "PRODUCT_NOT_FOUND" };
        if (["MEMBERSHIP_REQUIRED", "FORBIDDEN_CROSS_TENANT"].includes(estado.erroPedido.codigo)) estado.modo = "SUSPENSO";
        return route.fulfill({ status: estado.erroPedido.status, json: { erro: estado.erroPedido.codigo, detalhes: estado.erroPedido.detalhes }, headers });
      }
      const dados = req.postDataJSON();
      estado.produto.estoque -= dados.quantidade;
      if (estado.perderRespostaPedido) {
        estado.pedidos.push({ ...structuredClone(pedidoBase), produto: { id_produto: produtoId, nome_produto: "Pedido cuja resposta foi perdida" } });
        return route.abort("failed");
      }
      return route.fulfill({ status: 201, json: { dados: { ...dados, id_pedido: "72345678-1234-4234-8234-123456789012", valor_pedido: "77.70", status_pedido: "SOLICITADO", produto: { id_produto: produtoId, nome_produto: "Bolo confirmado pelo servidor" }, hora_solicitacao: "2026-10-16T12:00:00Z", ultima_atualizacao: "2026-10-16T12:00:00Z" } }, headers });
    }
    if (url.pathname.endsWith("/usuarios/me")) return route.fulfill({ json: { dados: { id_usuario: estado.pessoa, nome_completo: estado.modo === "novo" ? null : estado.pessoa === id ? "Maria Exemplo" : "Outra Pessoa", onboarding_realizado: estado.modo !== "novo", super_admin: estado.modo === "super" } }, headers });
    if (url.pathname.endsWith("/vinculos/me")) {
      const dados = { onboarding_realizado: estado.modo !== "novo", super_admin: estado.modo === "super", vinculo_ativo: null, solicitacao_pendente: null, ultimo_vinculo: null };
      if (["ativo", "transferencia", "admin"].includes(estado.modo)) dados.vinculo_ativo = { ...vinculo, admin_condominio: ["transferencia", "admin"].includes(estado.modo), ...(estado.ativoOverride ?? {}) };
      if (["pendente", "transferencia"].includes(estado.modo)) dados.solicitacao_pendente = { ...vinculo, status_vinculo: "PENDENTE", condominio: { ...condominio, nome_residencial: "Residencial Destino" } };
      if (["SUSPENSO", "REJEITADO", "ENCERRADO"].includes(estado.modo)) dados.ultimo_vinculo = { ...vinculo, status_vinculo: estado.modo };
      if (estado.destinoPendente) dados.solicitacao_pendente = estado.destinoPendente;
      return route.fulfill({ json: { dados }, headers });
    }
    if (url.pathname.endsWith("/condominios")) {
      if (estado.erroCatalogo) return falhar({ status: 500, codigo: "INTERNAL_ERROR" });
      return route.fulfill({ json: { dados: url.searchParams.get("busca") === "Ausente" ? [] : (estado.catalogoCondominios ?? [condominio]), paginacao: { pagina: Number(url.searchParams.get("pagina")), limite: 20, total: 21, total_paginas: 2 } }, headers });
    }
    if (url.pathname.endsWith("/onboarding")) {
      if (estado.erroPost) return route.fulfill({ status: estado.erroPost.status, json: estado.erroPost.json, headers });
      estado.modo = "pendente";
      return route.fulfill({ status: 201, json: { dados: { id_usuario: id, nome_completo: "Maria Exemplo", id_vinculo: vinculo.id_vinculo, id_condominio: condominio.id_condominio, moradia: "Apto 302", status_vinculo: "PENDENTE", admin_condominio: false } }, headers });
    }
    throw new Error(`API inesperada: ${url.pathname}`);
  });
  return { page, estado, contexto };
}
async function caminho(page, path) { await page.waitForURL(`${origem}${path}`); }
async function visivel(page, texto) { await page.getByText(texto, { exact: true }).waitFor({ state: "visible" }); }
async function entrar(page) {
  await page.getByLabel("E-mail", { exact: true }).fill("morador@example.com");
  await page.getByLabel("Senha", { exact: true }).fill("senha-ficticia");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}
async function preencherOnboarding(page) {
  await page.getByLabel("Nome completo").fill(" Maria Exemplo ");
  await page.getByLabel("CPF", { exact: true }).fill("000.000.000-00");
  await page.getByLabel("Data de nascimento").fill("2000-01-01");
  await page.getByRole("radio").first().check();
  await page.getByLabel("Sua moradia").fill(" Apto 302 ");
}
test("sem sessão: guarda de rota protegida leva ao Login", async t => {
  const { page } = await preparar(t);
  await page.goto(`${origem}/vitrine`); await caminho(page, "/login"); await visivel(page, "Bom ter você por aqui");
  await page.screenshot({ path: "/tmp/porta-frontend-login-mobile.png", fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});
test("login válido sem onboarding carrega formulário com Bearer nas duas leituras", async t => {
  const { page, estado } = await preparar(t, { modo: "novo" });
  await page.goto(`${origem}/login`); await entrar(page); await caminho(page, "/onboarding"); await visivel(page, "Encontre sua vizinhança");
  assert.ok(estado.chamadas.filter(c => c.caminho.endsWith("/me")).every(c => c.bearer?.startsWith("Bearer ")));
});
for (const confirmar of [true, false]) test(`cadastro trata sessão imediata ou confirmação (${confirmar})`, async t => {
  const { page } = await preparar(t, { modo: "novo", confirmar });
  await page.goto(`${origem}/cadastro`);
  await page.getByLabel("E-mail", { exact: true }).fill("morador@example.com");
  await page.getByLabel("Senha", { exact: true }).fill("senha-ficticia");
  await page.getByLabel("Confirmar senha").fill("senha-ficticia");
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  await caminho(page, confirmar ? "/confirmar-email" : "/onboarding");
});
test("onboarding envia body estrito, aguarda, restaura após refresh e detecta aprovação", async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "novo" });
  await page.goto(origem); await caminho(page, "/onboarding"); await preencherOnboarding(page);
  await page.screenshot({ path: "/tmp/porta-frontend-onboarding-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Solicitar acesso ao condomínio" }).click();
  await caminho(page, "/aguardando-aprovacao"); await visivel(page, "Residencial Destino");
  assert.deepEqual(estado.chamadas.find(c => c.metodo === "POST").body, { nome_completo: "Maria Exemplo", cpf: "00000000000", data_nascimento: "2000-01-01", id_condominio: condominio.id_condominio, moradia: "Apto 302" });
  await page.reload(); await visivel(page, "Sua solicitação está a caminho");
  assert.equal(await page.evaluate(() => window.loginPiscou), false);
  estado.modo = "ativo";
  await page.getByRole("button", { name: "Atualizar status" }).click();
  await caminho(page, "/vitrine"); await visivel(page, "Olá, Maria Exemplo!");
});
test("busca omite vazio, pagina e distingue lista sem resultado", async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "novo" });
  await page.goto(`${origem}/onboarding`); await page.getByRole("radio").first().waitFor();
  assert.equal(estado.chamadas.find(c => c.caminho.endsWith("/condominios")).query.includes("busca="), false);
  await page.getByRole("button", { name: "Próxima", exact: true }).click(); await visivel(page, "Página 2 de 2");
  await page.getByLabel("Buscar condomínio").fill("Ausente"); await visivel(page, "Nenhum condomínio encontrado. Tente outro nome.");
  assert.equal(await page.getByRole("button", { name: "Solicitar acesso ao condomínio" }).isDisabled(), true);
});
test("erro de campo preserva formulário e não duplica escrita", async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "novo", erroPost: { status: 400, json: { erro: "VALIDATION_ERROR", detalhes: { formErrors: [], fieldErrors: { cpf: ["Confira seu CPF."] } } } } });
  await page.goto(origem); await caminho(page, "/onboarding"); await preencherOnboarding(page);
  await page.getByRole("button", { name: "Solicitar acesso ao condomínio" }).click(); await visivel(page, "Confira seu CPF.");
  assert.equal(await page.getByLabel("Nome completo").inputValue(), " Maria Exemplo ");
  assert.equal(estado.chamadas.filter(c => c.metodo === "POST").length, 1);
});
test("ativo restaura sem flash, transferência não bloqueia e admin local tem painel do condomínio", async t => {
  const { page } = await preparar(t, { sessao: true, modo: "transferencia", atraso: 150 });
  await page.goto(`${origem}/admin`); await caminho(page, "/admin"); await visivel(page, "Olá, Maria Exemplo!"); await visivel(page, "ADMIN DO CONDOMÍNIO");
  await visivel(page, "Administrador do condomínio");
  assert.ok(await page.getByRole("status").filter({ hasText: "Mudança de condomínio" }).isVisible());
  assert.equal(await page.evaluate(() => window.loginPiscou), false);
  assert.equal(await page.getByRole("link", { name: "Pedidos", exact: true }).getAttribute("href"), "/pedidos");
  await page.setViewportSize({ width: 1280, height: 900 }); await page.screenshot({ path: "/tmp/porta-frontend-shell-desktop.png", fullPage: true });
});
for (const modo of ["SUSPENSO", "REJEITADO", "ENCERRADO"]) test(`histórico ${modo} mostra vínculo sem reenviar residência`, async t => {
  const { page } = await preparar(t, { sessao: true, modo });
  await page.goto(`${origem}/vitrine`); await caminho(page, "/estado-vinculo"); await visivel(page, "Residencial Exemplo");
  assert.equal(await page.getByRole("button", { name: /solicitar/i }).count(), 0);
});
test("super sem residência vai para admin e não chama APIs administrativas", async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "super" });
  await page.goto(`${origem}/onboarding`); await caminho(page, "/admin"); await visivel(page, "Super admin");
  assert.equal(estado.chamadas.some(c => c.caminho.includes("/admin/")), false);
  assert.equal(await page.getByText("Moradia", { exact: true }).count(), 0);
});
test("conta suspensa bloqueia dados e permite logout", async t => {
  const { page } = await preparar(t, { sessao: true, modo: "suspensa" });
  await page.goto(`${origem}/vitrine`); await visivel(page, "Conta suspensa");
  assert.equal(await page.getByText("Maria Exemplo", { exact: false }).count(), 0);
  await page.getByRole("button", { name: "Sair da conta" }).click(); await caminho(page, "/login");
});
test("logout limpa identidade anterior e novo login carrega a nova pessoa", async t => {
  const { page, estado } = await preparar(t, { sessao: true });
  await page.goto(origem); await caminho(page, "/vitrine"); await visivel(page, "Olá, Maria Exemplo!");
  await page.getByRole("button", { name: "Sair da conta" }).click(); await caminho(page, "/login");
  assert.equal(await page.getByText("Maria Exemplo", { exact: false }).count(), 0);
  estado.pessoa = outroId;
  await entrar(page); await caminho(page, "/vitrine"); await visivel(page, "Olá, Outra Pessoa!");
  assert.equal(await page.getByText("Maria Exemplo", { exact: false }).count(), 0);
});
test("erro transitório tem retry sem renderizar dados privados antigos", async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "falha" });
  await page.goto(origem); await visivel(page, "Vamos tentar de novo?");
  estado.modo = "ativo"; await page.getByRole("button", { name: "Tentar novamente" }).click();
  await caminho(page, "/vitrine"); await visivel(page, "Olá, Maria Exemplo!");
});
test("401 renova a sessão real do SDK e refaz somente a leitura rejeitada", async t => {
  const { page, estado } = await preparar(t, { sessao: true, forcar401: true });
  await page.goto(origem); await caminho(page, "/vitrine"); await visivel(page, "Olá, Maria Exemplo!");
  assert.equal(estado.renovacoes, 1);
  const leituras = estado.chamadas.filter(c => c.caminho.endsWith("/usuarios/me"));
  assert.equal(leituras.length, 2);
  assert.notEqual(leituras[0].bearer, leituras[1].bearer);
});
test("callback de confirmação restaura a sessão da URL antes de resolver onboarding", async t => {
  const { page } = await preparar(t, { modo: "novo" });
  const s = sessao();
  await page.goto(`${origem}/#access_token=${s.access_token}&refresh_token=${s.refresh_token}&expires_in=3600&token_type=bearer&type=signup`);
  await caminho(page, "/onboarding"); await visivel(page, "Encontre sua vizinhança");
  assert.equal(await page.evaluate(() => window.loginPiscou), false);
});
test("respostas em voo após logout não restauram dados da identidade anterior", async t => {
  const { page, estado, contexto } = await preparar(t, { sessao: true, atraso: 1000 });
  const leitura = page.waitForRequest("http://api.porta.test/api/usuarios/me");
  await page.goto(origem); await leitura;
  estado.atraso = 0;
  const outraAba = await contexto.newPage();
  await outraAba.goto(origem); await outraAba.getByRole("button", { name: "Sair da conta", exact: true }).click();
  await caminho(page, "/login");
  estado.atraso = 0; estado.pessoa = outroId;
  await entrar(page); await caminho(page, "/vitrine"); await visivel(page, "Olá, Outra Pessoa!");
  await page.waitForTimeout(1050);
  assert.equal(await page.getByText("Maria Exemplo", { exact: false }).count(), 0);
});

async function abrirProduto(page) {
  await page.goto(`${origem}/produtos/${produtoId}`);
  await page.getByRole("heading", { name: "Bolo de cenoura", exact: true }).waitFor();
}
async function escolherPedido(page, quantidade = "2") {
  await page.getByLabel("Quantidade", { exact: true }).fill(quantidade);
  await page.getByLabel("Data e hora combinada", { exact: true }).fill("2099-01-01T19:00");
}
const postsPedido = estado => estado.chamadas.filter(c => c.caminho === "/api/pedidos");
test("vitrine ativa mostra categorias, dados paginados e card sem imagem", async t => {
  const { page, estado } = await preparar(t, { sessao: true });
  await page.goto(`${origem}/vitrine`); await visivel(page, "Bolo de cenoura");
  await page.getByRole("option", { name: "Alimentos", exact: true }).waitFor({ state: "attached" });
  await visivel(page, "Página 1 de 2"); await visivel(page, "Sem imagem disponível");
  assert.ok(await page.getByText("R$ 25,90", { exact: true }).isVisible());
  assert.ok(estado.chamadas.some(c => c.caminho === "/api/categorias"));
  assert.ok(estado.chamadas.filter(c => c.caminho === "/api/produtos").every(c => c.query === "pagina=1&limite=20" && c.bearer?.startsWith("Bearer ")));
  await page.screenshot({ path: "/tmp/porta-vitrine-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 }); await page.screenshot({ path: "/tmp/porta-vitrine-desktop.png", fullPage: true });
});
test("paginação, busca e categoria mudam URL; refresh e back/forward preservam os filtros", async t => {
  const { page, estado } = await preparar(t, { sessao: true });
  await page.goto(`${origem}/vitrine`); await visivel(page, "Bolo de cenoura");
  await page.getByRole("button", { name: "Próxima", exact: true }).click(); await visivel(page, "Página 2 de 2");
  await page.getByLabel("Buscar produto").fill("  bolo  "); await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page.waitForURL(url => url.searchParams.get("busca") === "bolo" && url.searchParams.get("pagina") === "1");
  await page.getByLabel("Categoria", { exact: true }).selectOption(categoriaId);
  await page.waitForURL(url => url.searchParams.get("id_categoria") === categoriaId);
  await page.reload(); await visivel(page, "Bolo de cenoura");
  assert.equal(await page.getByLabel("Buscar produto").inputValue(), "bolo");
  assert.equal(await page.getByLabel("Categoria", { exact: true }).inputValue(), categoriaId);
  await page.goBack(); await page.waitForURL(url => !url.searchParams.has("id_categoria"));
  assert.equal(await page.getByLabel("Categoria", { exact: true }).inputValue(), "");
  await page.goForward(); await page.waitForURL(url => url.searchParams.get("id_categoria") === categoriaId);
  assert.ok(estado.chamadas.filter(c => c.caminho === "/api/produtos").every(c => !c.query.includes("id_condominio") && !new URLSearchParams(c.query).has("categoria")));
});
test("sem categorias ativas mantém todos os produtos e desabilita apenas filtro", async t => {
  const { page } = await preparar(t, { sessao: true, categoriasVazias: true });
  await page.goto(`${origem}/vitrine`); await visivel(page, "Bolo de cenoura");
  assert.equal(await page.getByLabel("Categoria", { exact: true }).isDisabled(), true);
});
test("falha de categorias permite retry sem bloquear os produtos", async t => {
  const { page, estado } = await preparar(t, { sessao: true, erroCategorias: true });
  await page.goto(`${origem}/vitrine`); await visivel(page, "Bolo de cenoura");
  await page.getByRole("button", { name: "Tentar categorias novamente" }).waitFor();
  estado.erroCategorias = false; await page.getByRole("button", { name: "Tentar categorias novamente" }).click();
  await page.getByRole("option", { name: "Alimentos", exact: true }).waitFor({ state: "attached" });
});
test("vitrine distingue lista vazia de busca sem resultado e não mostra página 1 de 0", async t => {
  const { page, estado } = await preparar(t, { sessao: true, listaVazia: true });
  await page.goto(`${origem}/vitrine`); await visivel(page, "Ainda não há produtos por aqui");
  assert.equal(await page.getByText("Página 1 de 0", { exact: true }).count(), 0);
  estado.listaVazia = false;
  await page.getByLabel("Buscar produto").fill("Ausente"); await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await visivel(page, "Nenhum resultado para estes filtros");
});
test("erro de atualização mantém lista anterior e oferece retry", async t => {
  const { page, estado } = await preparar(t, { sessao: true });
  await page.goto(`${origem}/vitrine`); await visivel(page, "Bolo de cenoura");
  estado.erroLista = true; await page.getByRole("button", { name: "Próxima", exact: true }).click();
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).waitFor(); await visivel(page, "Bolo de cenoura");
  estado.erroLista = false; await page.getByRole("button", { name: "Tentar novamente", exact: true }).click(); await visivel(page, "Página 2 de 2");
});
test("signed URL com erro usa placeholder e mantém o produto navegável", async t => {
  const produto = structuredClone(produtoBase); produto.imagens = [{ id_imagem: "imagem", ordem: 0, url: "https://images.porta.test/falha?token=temporario", expires_in: 600 }];
  const { page } = await preparar(t, { sessao: true, produto });
  await page.route("https://images.porta.test/**", route => route.fulfill({ status: 403, body: "" }));
  await page.goto(`${origem}/vitrine`); await visivel(page, "Sem imagem disponível");
  await page.getByRole("link", { name: /Bolo de cenoura/ }).click(); await caminho(page, `/produtos/${produtoId}`);
  await page.getByRole("heading", { name: "Bolo de cenoura", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => Object.values(localStorage).some(valor => valor.includes("images.porta.test"))), false);
});
test("detalhe direto e refresh não varrem vitrine; galeria permite escolher imagem", async t => {
  const produto = structuredClone(produtoBase); produto.imagens = [0, 1].map(i => ({ id_imagem: `imagem-${i}`, ordem: i, url: `https://images.porta.test/${i}?token=temporario`, expires_in: 600 }));
  const { page, estado } = await preparar(t, { sessao: true, produto });
  await page.route("https://images.porta.test/**", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#efd9c4"/></svg>' }));
  await abrirProduto(page); await page.getByRole("button", { name: "Ver imagem 2 de 2" }).click();
  assert.equal(await page.getByRole("button", { name: "Ver imagem 2 de 2" }).getAttribute("aria-pressed"), "true");
  await page.reload(); await page.getByRole("heading", { name: "Bolo de cenoura", exact: true }).waitFor();
  assert.equal(estado.chamadas.some(c => c.caminho === "/api/produtos"), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: "/tmp/porta-produto-mobile.png", fullPage: true });
});
test("produto próprio não mostra formulário nem link de gestão inexistente", async t => {
  const produto = structuredClone(produtoBase); produto.vendedor.id_vinculo = vinculo.id_vinculo;
  const { page } = await preparar(t, { sessao: true, produto });
  await abrirProduto(page); await visivel(page, "Este anúncio é seu");
  assert.equal(await page.getByRole("button", { name: "Confirmar pedido" }).count(), 0);
});
test("estoque zero permanece visível e bloqueia quantidade e pedido", async t => {
  const produto = { ...structuredClone(produtoBase), estoque: 0 };
  const { page, estado } = await preparar(t, { sessao: true, produto });
  await abrirProduto(page);
  assert.equal(await page.getByLabel("Quantidade", { exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Confirmar pedido" }).isDisabled(), true);
  assert.equal(postsPedido(estado).length, 0);
});
test("quantidade acima do snapshot é rejeitada antes de POST", async t => {
  const { page, estado } = await preparar(t, { sessao: true });
  await abrirProduto(page); await escolherPedido(page, "5");
  await page.getByRole("button", { name: "Confirmar pedido" }).click(); await visivel(page, "Há 4 unidade(s) disponíveis.");
  assert.equal(postsPedido(estado).length, 0);
});
test("pedido envia três campos, converte timezone, bloqueia duplo clique e confirma dados do servidor", async t => {
  const { page, estado } = await preparar(t, { sessao: true, atrasoPedido: 200 });
  await abrirProduto(page); await escolherPedido(page);
  await page.evaluate(() => { const form = document.querySelector(".formulario-pedido form"); form.requestSubmit(); form.requestSubmit(); });
  await visivel(page, "Pedido enviado ao vendedor");
  assert.deepEqual(postsPedido(estado).map(c => c.body), [{ id_produto: produtoId, quantidade: 2, hora_combinada: "2099-01-01T22:00:00.000Z" }]);
  await visivel(page, "Bolo confirmado pelo servidor"); assert.ok(await page.getByText("R$ 77,70", { exact: true }).isVisible());
  assert.equal(estado.chamadas.some(c => /^\/api\/pedidos\//.test(c.caminho)), false);
  await page.screenshot({ path: "/tmp/porta-pedido-confirmado-mobile.png", fullPage: true });
});
test("estoque concorrente insuficiente refaz detalhe e ajusta quantidade sem repetir pedido", async t => {
  const { page, estado } = await preparar(t, { sessao: true, erroPedido: { status: 409, codigo: "INSUFFICIENT_STOCK" } });
  await abrirProduto(page); await escolherPedido(page);
  await page.getByRole("button", { name: "Confirmar pedido" }).click();
  await visivel(page, "1 em estoque"); await page.waitForFunction(() => document.querySelector("#quantidade")?.value === "1");
  assert.equal(await page.getByLabel("Data e hora combinada", { exact: true }).inputValue(), "2099-01-01T19:00");
  assert.equal(postsPedido(estado).length, 1);
  assert.equal(await page.getByText("Pedido enviado ao vendedor", { exact: true }).count(), 0);
  assert.equal(estado.chamadas.filter(c => c.caminho === `/api/produtos/${produtoId}`).length, 2);
});
test("anúncio indisponível após POST vira estado indisponível sem confirmação", async t => {
  const { page, estado } = await preparar(t, { sessao: true, erroPedido: { status: 409, codigo: "PRODUCT_UNAVAILABLE" } });
  await abrirProduto(page); await escolherPedido(page); await page.getByRole("button", { name: "Confirmar pedido" }).click();
  await visivel(page, "Produto indisponível"); assert.equal(postsPedido(estado).length, 1);
  assert.equal(await page.getByText("Pedido enviado ao vendedor", { exact: true }).count(), 0);
});
for (const codigo of ["INVALID_SCHEDULE_TIME", "ORDER_VALUE_OUT_OF_RANGE", "VALIDATION_ERROR"]) test(`erro ${codigo} preserva campos sem retry automático`, async t => {
  const { page, estado } = await preparar(t, { sessao: true, erroPedido: { status: codigo === "VALIDATION_ERROR" ? 400 : 422, codigo, detalhes: { formErrors: [], fieldErrors: { quantidade: ["Quantidade inválida no servidor."] } } } });
  await abrirProduto(page); await escolherPedido(page); await page.getByRole("button", { name: "Confirmar pedido" }).click();
  if (codigo === "INVALID_SCHEDULE_TIME") await visivel(page, "O horário não foi aceito. Escolha uma nova data e hora futuras.");
  else if (codigo === "VALIDATION_ERROR") await visivel(page, "Quantidade inválida no servidor.");
  else await visivel(page, "O valor deste pedido ultrapassa o limite permitido. Revise a quantidade antes de tentar novamente.");
  assert.equal(await page.getByLabel("Quantidade", { exact: true }).inputValue(), "2");
  assert.equal(await page.getByLabel("Data e hora combinada", { exact: true }).inputValue(), "2099-01-01T19:00");
  assert.equal(postsPedido(estado).length, 1);
});
test("404 direto mostra indisponível e ID inválido nem chega à API", async t => {
  const { page, estado } = await preparar(t, { sessao: true, erroDetalhe: { status: 404, codigo: "PRODUCT_NOT_FOUND" } });
  await page.goto(`${origem}/produtos/${produtoId}`); await visivel(page, "Produto indisponível");
  await page.goto(`${origem}/produtos/invalido`); await visivel(page, "Produto indisponível");
  assert.equal(estado.chamadas.some(c => c.caminho.endsWith("/invalido")), false);
});
for (const codigo of ["MEMBERSHIP_REQUIRED", "FORBIDDEN_CROSS_TENANT"]) test(`${codigo} no detalhe refaz estado residencial e deixa guard resolver`, async t => {
  const { page, estado } = await preparar(t, { sessao: true, erroDetalhe: { status: 403, codigo } });
  await page.goto(`${origem}/produtos/${produtoId}`); await caminho(page, "/estado-vinculo");
  assert.ok(estado.chamadas.filter(c => c.caminho === "/api/vinculos/me").length >= 2);
});
for (const modo of ["pendente", "super"]) test(`guard do detalhe impede ${modo} e não carrega produto`, async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo });
  await page.goto(`${origem}/produtos/${produtoId}`); await caminho(page, modo === "super" ? "/admin" : "/aguardando-aprovacao");
  assert.equal(estado.chamadas.some(c => c.caminho.startsWith("/api/produtos")), false);
});
for (const codigo of ["MEMBERSHIP_REQUIRED", "FORBIDDEN_CROSS_TENANT"]) test(`${codigo} no pedido atualiza residência e não confirma nem repete`, async t => {
  const { page, estado } = await preparar(t, { sessao: true, erroPedido: { status: 403, codigo } });
  await abrirProduto(page); await escolherPedido(page);
  await page.getByRole("button", { name: "Confirmar pedido" }).click(); await caminho(page, "/estado-vinculo");
  assert.equal(postsPedido(estado).length, 1);
  assert.equal(await page.getByText("Pedido enviado ao vendedor", { exact: true }).count(), 0);
  assert.ok(estado.chamadas.filter(c => c.caminho === "/api/vinculos/me").length >= 2);
});

function proprio(opcoes = {}) {
  return { ...structuredClone(produtoBase), vendedor: { ...produtoBase.vendedor, id_vinculo: vinculo.id_vinculo }, ...opcoes };
}
const fotoA = { id_imagem: "a2345678-1234-4234-8234-123456789012", ordem: 0, url: "https://images.porta.test/a?token=temporario", expires_in: 600 };
const fotoB = { id_imagem: "b2345678-1234-4234-8234-123456789012", ordem: 7, url: "https://images.porta.test/b?token=temporario", expires_in: 600 };
const imagemPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwL8AAAAASUVORK5CYII=", "base64");
async function abrirEditor(page, idProduto = produtoId) {
  await page.goto(`${origem}/meus-produtos/${idProduto}/editar`);
  await page.getByLabel("Nome do produto", { exact: true }).waitFor();
}
async function preencherProduto(page) {
  await page.getByLabel("Categoria", { exact: true }).selectOption(categoriaId);
  await page.getByLabel("Nome do produto", { exact: true }).fill(" Bolo novo ");
  await page.getByLabel("Descrição", { exact: true }).fill(" Caseiro e fresco ");
  await page.getByLabel("Preço (R$)", { exact: true }).fill("25,90");
  await page.getByLabel("Estoque", { exact: true }).fill("0");
}
const escritasProduto = estado => estado.chamadas.filter(c => ["POST", "PATCH", "DELETE"].includes(c.metodo) && c.caminho.startsWith("/api/produtos"));
async function imagensTeste(page) { await page.route("https://images.porta.test/**", route => route.fulfill({ contentType: "image/png", body: imagemPng })); }

test("gestão lista ativos/inativos/categoria inativa sem ativo na query e navegação real", async t => {
  const ativo = proprio(); const inativo = proprio({ id_produto: outroId, nome_produto: "Anúncio antigo", ativo: false, categoria: { ...produtoBase.categoria, ativo: false } });
  const { page, estado } = await preparar(t, { sessao: true, produto: ativo, proprios: [ativo, inativo] });
  await page.goto(`${origem}/vitrine`); await page.getByRole("link", { name: "Meus Produtos", exact: true }).click();
  await visivel(page, "Anúncio antigo"); await visivel(page, "Categoria inativa. Você pode editar ou desativar este anúncio.");
  await visivel(page, "Ativo"); await visivel(page, "Inativo");
  assert.ok(estado.chamadas.filter(c => c.caminho === "/api/produtos/me").every(c => c.query === "pagina=1&limite=20"));
  await page.screenshot({ path: "/tmp/porta-meus-produtos-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 }); await page.screenshot({ path: "/tmp/porta-meus-produtos-desktop.png", fullPage: true });
});
test("gestão mantém status/busca/categoria/página na URL e em refresh", async t => {
  const { page, estado } = await preparar(t, { sessao: true, produto: proprio(), paginarGestao: true });
  await page.goto(`${origem}/meus-produtos`); await visivel(page, "Bolo de cenoura");
  await page.getByRole("button", { name: "Próxima", exact: true }).click(); await visivel(page, "Página 2 de 2");
  await page.getByLabel("Status", { exact: true }).selectOption("true");
  await page.waitForURL(url => url.searchParams.get("pagina") === "1" && url.searchParams.get("ativo") === "true");
  await page.getByLabel("Buscar meus produtos").fill(" bolo "); await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page.getByLabel("Categoria", { exact: true }).selectOption(categoriaId); await page.reload(); await visivel(page, "Bolo de cenoura");
  assert.equal(await page.getByLabel("Buscar meus produtos").inputValue(), "bolo");
  assert.equal(await page.getByLabel("Status", { exact: true }).inputValue(), "true");
  assert.ok(estado.chamadas.filter(c => c.caminho === "/api/produtos/me").every(c => !c.query.includes("id_condominio") && !new URLSearchParams(c.query).has("categoria")));
  await page.getByRole("link", { name: "Editar", exact: true }).click(); await page.getByLabel("Nome do produto", { exact: true }).waitFor();
  await page.getByRole("link", { name: "Voltar a Meus Produtos", exact: false }).click();
  assert.equal(new URL(page.url()).searchParams.get("ativo"), "true");
});
test("lista gestora vazia, filtro sem resultado e retry de erro são distintos", async t => {
  const { page, estado } = await preparar(t, { sessao: true });
  await page.goto(`${origem}/meus-produtos`); await visivel(page, "Você ainda não publicou produtos");
  assert.equal(await page.getByText("Página 1 de 0").count(), 0);
  estado.produto = proprio(); estado.erroMeusProdutos = { status: 500, codigo: "INTERNAL_ERROR" };
  await page.getByRole("button", { name: "Atualizar lista" }).click(); await page.getByRole("button", { name: "Tentar novamente", exact: true }).waitFor();
  estado.erroMeusProdutos = null; await page.getByRole("button", { name: "Tentar novamente", exact: true }).click(); await visivel(page, "Bolo de cenoura");
  await page.getByLabel("Buscar meus produtos").fill("Ausente"); await page.getByRole("button", { name: "Buscar", exact: true }).click(); await visivel(page, "Nenhum anúncio para estes filtros");
});
test("resposta de busca antiga não sobrescreve filtro recente", async t => {
  const { page } = await preparar(t, { sessao: true, produto: proprio(), atrasarBusca: true });
  await page.goto(`${origem}/meus-produtos`); await visivel(page, "Bolo de cenoura");
  await page.getByLabel("Buscar meus produtos").fill("bolo"); await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page.getByLabel("Buscar meus produtos").fill("Ausente"); await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await visivel(page, "Nenhum anúncio para estes filtros"); await page.waitForTimeout(500);
  assert.equal(await page.getByText("Bolo de cenoura", { exact: true }).count(), 0);
});
test("publicação envia cinco campos tipados e navega para ID retornado antes de oferecer upload", async t => {
  const { page, estado } = await preparar(t, { sessao: true });
  await page.goto(`${origem}/meus-produtos/novo`); await preencherProduto(page);
  assert.equal(await page.getByLabel("Adicionar uma imagem").count(), 0);
  await page.evaluate(() => { const form = document.querySelector(".editor-produto form"); form.requestSubmit(); form.requestSubmit(); });
  await caminho(page, "/meus-produtos/82345678-1234-4234-8234-123456789012/editar");
  await page.getByLabel("Adicionar uma imagem").waitFor(); await visivel(page, "Produto publicado. Agora você pode adicionar imagens.");
  assert.deepEqual(escritasProduto(estado).map(c => c.body), [{ id_categoria: categoriaId, nome_produto: "Bolo novo", descricao: "Caseiro e fresco", preco: "25.90", estoque: 0 }]);
  assert.equal(estado.chamadas.some(c => c.caminho.endsWith("/imagens") && c.metodo === "POST"), false);
  await page.reload(); await page.getByLabel("Nome do produto", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Nome do produto", { exact: true }).inputValue(), "Bolo novo");
});
test("criação sem categoria ativa é bloqueada com explicação", async t => {
  const { page, estado } = await preparar(t, { sessao: true, categoriasVazias: true });
  await page.goto(`${origem}/meus-produtos/novo`); await visivel(page, "Não há categorias ativas para publicar um produto. Aguarde uma categoria disponível.");
  assert.equal(await page.getByRole("button", { name: "Publicar produto" }).isDisabled(), true); assert.equal(escritasProduto(estado).length, 0);
});
test("erro de validação na criação mantém os campos", async t => {
  const { page, estado } = await preparar(t, { sessao: true, erroCriacao: { status: 400, codigo: "VALIDATION_ERROR", detalhes: { fieldErrors: { nome_produto: ["Confira o nome informado."] } } } });
  await page.goto(`${origem}/meus-produtos/novo`); await preencherProduto(page); await page.getByRole("button", { name: "Publicar produto" }).click(); await visivel(page, "Confira o nome informado.");
  assert.equal(await page.getByLabel("Descrição", { exact: true }).inputValue(), " Caseiro e fresco "); assert.equal(escritasProduto(estado).length, 1);
});
test("categoria atual inativa não some; PATCH altera só nome e preserva imagens após resposta sem imagens", async t => {
  const produto = proprio({ categoria: { ...produtoBase.categoria, id_categoria: outroId, ativo: false }, imagens: [fotoA] });
  const { page, estado } = await preparar(t, { sessao: true, produto }); await imagensTeste(page);
  await abrirEditor(page); assert.equal(await page.getByLabel("Categoria", { exact: true }).inputValue(), outroId);
  assert.equal(await page.getByRole("button", { name: "Salvar alterações" }).isDisabled(), true);
  await page.getByLabel("Nome do produto", { exact: true }).fill("Bolo editado"); await page.getByRole("button", { name: "Salvar alterações" }).click();
  await visivel(page, "Alterações salvas."); await page.getByRole("button", { name: "Excluir imagem 1", exact: true }).waitFor();
  assert.deepEqual(escritasProduto(estado).map(c => c.body), [{ nome_produto: "Bolo editado" }]);
  await page.waitForFunction(() => document.querySelector(".editor-produto button[type=submit]")?.disabled);
  await page.screenshot({ path: "/tmp/porta-editor-produto-mobile.png", fullPage: true });
});
test("troca explícita para categoria ativa envia só categoria e erro CATEGORY_INACTIVE permite corrigir", async t => {
  const { page, estado } = await preparar(t, { sessao: true, produto: proprio({ categoria: { ...produtoBase.categoria, id_categoria: outroId, ativo: false } }), erroEdicao: { status: 409, codigo: "CATEGORY_INACTIVE" } });
  await abrirEditor(page); await page.getByLabel("Categoria", { exact: true }).selectOption(categoriaId);
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await visivel(page, "Esta categoria está inativa. Escolha uma categoria ativa para trocar a categoria ou ativar o anúncio.");
  assert.equal(await page.getByLabel("Categoria", { exact: true }).inputValue(), categoriaId);
  estado.erroEdicao = null; await page.getByRole("button", { name: "Salvar alterações" }).click(); await visivel(page, "Alterações salvas.");
  assert.deepEqual(escritasProduto(estado).map(c => c.body), [{ id_categoria: categoriaId }, { id_categoria: categoriaId }]);
});
test("ativar com estoque zero envia apenas boolean e refaz a lista com filtros", async t => {
  const { page, estado } = await preparar(t, { sessao: true, produto: proprio({ estoque: 0, ativo: false }) });
  await page.goto(`${origem}/meus-produtos?ativo=false`); await visivel(page, "Inativo");
  await page.getByRole("button", { name: "Ativar", exact: true }).click(); await visivel(page, "Nenhum anúncio para estes filtros");
  assert.deepEqual(escritasProduto(estado).map(c => c.body), [{ ativo: true }]); assert.equal(new URL(page.url()).searchParams.get("ativo"), "false");
});
test("categoria inativa permite desativação e impede ativação com erro orientado", async t => {
  const { page, estado } = await preparar(t, { sessao: true, produto: proprio({ categoria: { ...produtoBase.categoria, ativo: false } }) });
  await abrirEditor(page); await page.getByRole("button", { name: "Desativar", exact: true }).click(); await page.getByRole("button", { name: "Ativar", exact: true }).waitFor();
  await page.getByRole("button", { name: "Ativar", exact: true }).click(); await visivel(page, "Esta categoria está inativa. Escolha uma categoria ativa para trocar a categoria ou ativar o anúncio.");
  assert.deepEqual(escritasProduto(estado).map(c => c.body), [{ ativo: false }, { ativo: true }]);
});
test("upload sequencial usa um campo imagem e boundary; refs atualizam fotos sem perder rascunho", async t => {
  const { page, estado } = await preparar(t, { sessao: true, produto: proprio() }); await imagensTeste(page);
  await abrirEditor(page); await page.getByLabel("Nome do produto", { exact: true }).fill("Rascunho não salvo");
  for (const nome of ["primeira.png", "segunda.png"]) {
    await page.getByLabel("Adicionar uma imagem").setInputFiles({ name: nome, mimeType: "image/png", buffer: imagemPng });
    await page.getByRole("button", { name: "Enviar imagem", exact: true }).click(); await visivel(page, `Imagem ${nome} adicionada ao anúncio.`);
  }
  await page.getByRole("button", { name: "Excluir imagem 2", exact: true }).waitFor();
  const uploads = escritasProduto(estado).filter(c => c.metodo === "POST");
  assert.equal(uploads.length, 2);
  assert.ok(uploads.every(c => c.headers["content-type"].startsWith("multipart/form-data; boundary=") && c.camposForm.length === 1 && c.camposForm[0].nome === "imagem" && c.bearer.startsWith("Bearer ")));
  assert.equal(await page.getByLabel("Nome do produto", { exact: true }).inputValue(), "Rascunho não salvo");
});
test("validação local bloqueia tipo e tamanho e aceita 5 MiB exatos", async t => {
  const { page, estado } = await preparar(t, { sessao: true, produto: proprio() }); await imagensTeste(page);
  await abrirEditor(page);
  await page.getByLabel("Adicionar uma imagem").setInputFiles({ name: "a.gif", mimeType: "image/gif", buffer: imagemPng }); await visivel(page, "Escolha uma imagem JPEG, PNG ou WEBP.");
  await page.getByLabel("Adicionar uma imagem").setInputFiles({ name: "grande.png", mimeType: "image/png", buffer: Buffer.alloc(5 * 1024 * 1024 + 1) }); await visivel(page, "A imagem deve ter até 5 MiB.");
  assert.equal(escritasProduto(estado).length, 0);
  await page.getByLabel("Adicionar uma imagem").setInputFiles({ name: "limite.png", mimeType: "image/png", buffer: Buffer.concat([imagemPng, Buffer.alloc(5 * 1024 * 1024 - imagemPng.length)]) });
  await page.getByRole("button", { name: "Enviar imagem", exact: true }).click(); await visivel(page, "Imagem limite.png adicionada ao anúncio.");
  assert.equal(escritasProduto(estado)[0].camposForm[0].tamanho, 5 * 1024 * 1024);
});
test("DELETE 204 remove só a imagem confirmada, sem body/query nem compactação", async t => {
  const { page, estado } = await preparar(t, { sessao: true, produto: proprio({ imagens: [fotoA, fotoB] }) }); await imagensTeste(page);
  await abrirEditor(page); page.once("dialog", d => d.accept()); await page.getByRole("button", { name: "Excluir imagem 1", exact: true }).click(); await visivel(page, "Imagem excluída do anúncio.");
  await page.getByRole("button", { name: "Excluir imagem 1", exact: true }).waitFor();
  const deletar = escritasProduto(estado)[0]; assert.equal(deletar.caminho, `/api/produtos/${produtoId}/imagens/${fotoA.id_imagem}`); assert.equal(deletar.bytes, 0); assert.equal(deletar.query, "");
  assert.deepEqual(estado.produto.imagens, [fotoB]); assert.equal(estado.produto.imagens[0].ordem, 7);
});
test("cancelar confirmação da imagem não envia DELETE", async t => {
  const { page, estado } = await preparar(t, { sessao: true, produto: proprio({ imagens: [fotoA] }) }); await imagensTeste(page);
  await abrirEditor(page); page.once("dialog", d => d.dismiss()); await page.getByRole("button", { name: "Excluir imagem 1", exact: true }).click(); assert.equal(escritasProduto(estado).length, 0);
});
test("falha no segundo upload preserva a primeira foto e permite nova tentativa explícita", async t => {
  const { page, estado } = await preparar(t, { sessao: true, produto: proprio() }); await imagensTeste(page);
  await abrirEditor(page); await page.getByLabel("Adicionar uma imagem").setInputFiles({ name: "boa.png", mimeType: "image/png", buffer: imagemPng }); await page.getByRole("button", { name: "Enviar imagem", exact: true }).click(); await visivel(page, "Imagem boa.png adicionada ao anúncio.");
  estado.erroUpload = { status: 500, codigo: "IMAGE_PERSISTENCE_FAILED" };
  await page.getByLabel("Adicionar uma imagem").setInputFiles({ name: "outra.png", mimeType: "image/png", buffer: imagemPng }); await page.getByRole("button", { name: "Enviar imagem", exact: true }).click(); await visivel(page, "Não foi possível concluir o registro da imagem. Confira as imagens atuais antes de tentar novamente.");
  assert.equal(estado.produto.imagens.length, 1); assert.equal(escritasProduto(estado).length, 2);
  estado.erroUpload = null; await page.getByRole("button", { name: "Enviar imagem", exact: true }).click(); await visivel(page, "Imagem outra.png adicionada ao anúncio."); assert.equal(estado.produto.imagens.length, 2);
});
test("IMAGE_DELETE_FAILED refaz GET, mantém foto e oferece retry explícito", async t => {
  const { page, estado } = await preparar(t, { sessao: true, produto: proprio({ imagens: [fotoA] }), erroExcluir: { status: 500, codigo: "IMAGE_DELETE_FAILED" } }); await imagensTeste(page);
  await abrirEditor(page); page.once("dialog", d => d.accept()); await page.getByRole("button", { name: "Excluir imagem 1", exact: true }).click();
  await page.getByRole("button", { name: "Tentar excluir imagem 1 novamente" }).waitFor(); assert.equal(estado.produto.imagens.length, 1); assert.equal(escritasProduto(estado).length, 1);
  estado.erroExcluir = null; page.once("dialog", d => d.accept()); await page.getByRole("button", { name: "Tentar excluir imagem 1 novamente" }).click(); await visivel(page, "Imagem excluída do anúncio."); assert.equal(estado.produto.imagens.length, 0);
});
test("IMAGE_NOT_FOUND reconcilia a imagem já removida", async t => {
  const { page } = await preparar(t, { sessao: true, produto: proprio({ imagens: [fotoA] }), erroExcluir: { status: 404, codigo: "IMAGE_NOT_FOUND" } }); await imagensTeste(page);
  await abrirEditor(page); page.once("dialog", d => d.accept()); await page.getByRole("button", { name: "Excluir imagem 1", exact: true }).click(); await visivel(page, "Seu anúncio ainda não tem imagens. Adicione a primeira abaixo.");
});
test("admin local não edita produto alheio nem revela campos no editor", async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "transferencia" });
  await page.goto(`${origem}/meus-produtos/${produtoId}/editar`); await visivel(page, "Anúncio indisponível para edição");
  assert.equal(await page.getByLabel("Nome do produto", { exact: true }).count(), 0); assert.equal(await page.getByText("Bolo de cenoura", { exact: true }).count(), 0); assert.equal(escritasProduto(estado).length, 0);
});
test("vínculo perdido durante PATCH desautoriza editor e atualiza estado", async t => {
  const { page, estado } = await preparar(t, { sessao: true, produto: proprio(), erroEdicao: { status: 403, codigo: "MEMBERSHIP_REQUIRED" } });
  await abrirEditor(page); await page.getByLabel("Nome do produto", { exact: true }).fill("Novo nome"); await page.getByRole("button", { name: "Salvar alterações" }).click(); await caminho(page, "/estado-vinculo");
  assert.equal(await page.getByLabel("Nome do produto", { exact: true }).count(), 0); assert.equal(escritasProduto(estado).length, 1);
});
for (const modo of ["pendente", "SUSPENSO", "ENCERRADO", "super"]) test(`gestão bloqueada para ${modo}`, async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo });
  await page.goto(`${origem}/meus-produtos/novo`); await caminho(page, modo === "super" ? "/admin" : modo === "pendente" ? "/aguardando-aprovacao" : "/estado-vinculo");
  assert.equal(await page.getByRole("button", { name: "Publicar produto" }).count(), 0); assert.equal(escritasProduto(estado).length, 0);
});
test("PATCH salvo com falha na releitura preserva rascunho e retry reconcilia sem novo PATCH", async t => {
  const { page, estado } = await preparar(t, { sessao: true, produto: proprio({ imagens: [fotoA] }), falharGetAposPatch: true }); await imagensTeste(page);
  await abrirEditor(page); await page.getByLabel("Nome do produto", { exact: true }).fill("Nome salvo"); await page.getByRole("button", { name: "Salvar alterações" }).click(); await visivel(page, "Não foi possível atualizar o anúncio");
  assert.equal(await page.getByLabel("Nome do produto", { exact: true }).inputValue(), "Nome salvo");
  estado.erroDetalhe = null; await page.getByRole("button", { name: "Tentar novamente", exact: true }).click(); await page.getByRole("button", { name: "Excluir imagem 1", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Salvar alterações" }).isDisabled(), true); assert.equal(escritasProduto(estado).length, 1);
});
test("alteração de status em voo refaz a lista usando o filtro mais recente", async t => {
  const { page, estado } = await preparar(t, { sessao: true, produto: proprio(), atrasoStatus: 500 });
  await page.goto(`${origem}/meus-produtos`); await visivel(page, "Bolo de cenoura");
  await page.getByRole("button", { name: "Desativar", exact: true }).click();
  await page.getByLabel("Status", { exact: true }).selectOption("true");
  await visivel(page, "Nenhum anúncio para estes filtros");
  assert.equal(new URL(page.url()).searchParams.get("ativo"), "true");
  const ultimaLeitura = estado.chamadas.filter(c => c.caminho === "/api/produtos/me").at(-1);
  assert.equal(new URLSearchParams(ultimaLeitura.query).get("ativo"), "true");
});
test("desativado sai da vitrine mas permanece em Meus Produtos", async t => {
  const { page } = await preparar(t, { sessao: true, produto: proprio() });
  await page.goto(`${origem}/meus-produtos`); await visivel(page, "Bolo de cenoura");
  await page.getByRole("button", { name: "Desativar", exact: true }).click(); await visivel(page, "Inativo");
  await page.getByRole("link", { name: "Vitrine", exact: true }).click(); await visivel(page, "Ainda não há produtos por aqui");
  await page.getByRole("link", { name: "Meus Produtos", exact: true }).click(); await visivel(page, "Bolo de cenoura"); await visivel(page, "Inativo");
});
test("rota de editor inválida e 404 são navegáveis sem expor anúncio", async t => {
  const { page, estado } = await preparar(t, { sessao: true, produto: proprio(), erroDetalhe: { status: 404, codigo: "PRODUCT_NOT_FOUND" } });
  await page.goto(`${origem}/meus-produtos/invalido/editar`); await visivel(page, "Anúncio indisponível para edição");
  assert.equal(estado.chamadas.some(c => c.caminho.includes("/invalido")), false);
  await page.goto(`${origem}/meus-produtos/${produtoId}/editar`); await visivel(page, "Anúncio indisponível para edição");
  await page.getByRole("link", { name: "Voltar a Meus Produtos", exact: false }).click(); await caminho(page, "/meus-produtos");
});
test("prévia local é revogada ao remover seleção e não é persistida", async t => {
  const { page } = await preparar(t, { sessao: true, produto: proprio() });
  await page.addInitScript(() => {
    const criar = URL.createObjectURL.bind(URL); const revogar = URL.revokeObjectURL.bind(URL);
    window.urlsCriadas = []; window.urlsRevogadas = [];
    URL.createObjectURL = blob => { const url = criar(blob); window.urlsCriadas.push(url); return url; };
    URL.revokeObjectURL = url => { window.urlsRevogadas.push(url); revogar(url); };
  });
  await abrirEditor(page); await page.getByLabel("Adicionar uma imagem").setInputFiles({ name: "preview.png", mimeType: "image/png", buffer: imagemPng });
  await page.getByRole("img", { name: "Prévia de preview.png" }).waitFor();
  await page.getByRole("button", { name: "Remover seleção" }).click();
  assert.equal(await page.evaluate(() => window.urlsCriadas.length > 0 && window.urlsCriadas.every(url => window.urlsRevogadas.includes(url))), true);
  assert.equal(await page.evaluate(() => Object.values(localStorage).some(valor => valor.includes("blob:"))), false);
});

const patchesPedido = estado => estado.chamadas.filter(c => /^\/api\/pedidos\/[^/]+\/status$/.test(c.caminho));
const postsMensagem = estado => estado.chamadas.filter(c => c.caminho.endsWith("/chat/messages"));
const mensagensNumeradas = total => Array.from({ length: total }, (_, i) => ({ ...structuredClone(mensagemBase), id_mensagem: `c2345678-1234-4234-8234-${String(i + 1).padStart(12, "0")}`, conteudo: `Mensagem ${i + 1}` }));
async function abrirPedidos(page) { await page.goto(`${origem}/pedidos`); await page.getByRole("heading", { name: "Meus Pedidos", exact: true }).waitFor(); }
async function abrirChat(page, query = "") { await page.goto(`${origem}/pedidos/${pedidoId}/chat${query}`); await page.getByLabel("Mensagem", { exact: true }).waitFor(); }

test("pedidos ativos mostram DTO histórico, valor congelado e navegação; confirmação oferece acesso", async t => {
  const { page, estado } = await preparar(t, { sessao: true });
  await abrirPedidos(page); await visivel(page, "Bolo no pedido"); await visivel(page, "Residencial da negociação"); await visivel(page, "Apto antigo 201");
  assert.ok(await page.getByText("R$ 51,80", { exact: true }).isVisible());
  await page.getByText("Histórico do pedido", { exact: true }).click();
  assert.ok(await page.locator(".historico-pedido time").isVisible());
  assert.equal(estado.chamadas.some(c => c.caminho.startsWith("/api/produtos")), false);
  assert.ok(estado.chamadas.filter(c => c.caminho === "/api/pedidos/me").every(c => c.query === "pagina=1&limite=20" && c.bearer.startsWith("Bearer ")));
  await page.screenshot({ path: "/tmp/porta-pedidos-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 }); await page.screenshot({ path: "/tmp/porta-pedidos-desktop.png", fullPage: true });
  await page.goto(`${origem}/produtos/${produtoId}`); await escolherPedido(page); await page.getByRole("button", { name: "Confirmar pedido" }).click();
  await page.getByRole("link", { name: "Ver meus pedidos", exact: true }).click(); await caminho(page, "/pedidos");
});
for (const modo of ["SUSPENSO", "ENCERRADO", "REJEITADO"]) test(`perfil com vínculo ${modo} acessa pedidos/chat sem liberar catálogo`, async t => {
  const { page } = await preparar(t, { sessao: true, modo });
  await page.goto(`${origem}/estado-vinculo`); await page.getByRole("link", { name: "Meus pedidos anteriores" }).click(); await visivel(page, "Bolo no pedido");
  assert.equal(await page.getByRole("link", { name: "Vitrine", exact: true }).count(), 0);
  await page.getByRole("link", { name: "Conversar", exact: true }).click(); await visivel(page, "Mensagem mais antiga");
  await page.reload(); await visivel(page, "Mensagem mais antiga");
  await page.goto(`${origem}/meus-produtos/novo`); await caminho(page, "/estado-vinculo");
});
test("pré-onboarding e ausência de sessão não acessam pedidos; PENDENTE preserva bloqueio da vitrine", async t => {
  const { page, estado } = await preparar(t);
  await page.goto(`${origem}/pedidos`); await caminho(page, "/login");
  estado.modo = "novo"; await entrar(page); await caminho(page, "/onboarding");
  await page.goto(`${origem}/pedidos`); await caminho(page, "/onboarding");
});
test("conta global suspensa bloqueia histórico e chat", async t => {
  const { page } = await preparar(t, { sessao: true, modo: "suspensa" });
  await page.goto(`${origem}/pedidos`); await visivel(page, "Conta suspensa");
  await page.goto(`${origem}/pedidos/${pedidoId}/chat`); await visivel(page, "Conta suspensa");
  assert.equal(await page.getByText("Mensagem mais antiga", { exact: true }).count(), 0);
});
test("filtros compra/venda/status e páginas preservam URL, refresh e back", async t => {
  const pedidos = Array.from({ length: 22 }, (_, i) => ({ ...structuredClone(pedidoBase), id_pedido: `72345678-1234-4234-8234-${String(i + 1).padStart(12, "0")}`, produto: { ...pedidoBase.produto, nome_produto: `Compra ${i + 1}` } }));
  pedidos.push({ ...structuredClone(pedidoBase), papel_usuario: "VENDEDOR", produto: { ...pedidoBase.produto, nome_produto: "Venda exemplo" } });
  const { page, estado } = await preparar(t, { sessao: true, pedidos });
  await abrirPedidos(page); await page.getByRole("button", { name: "Compras", exact: true }).click(); await visivel(page, "Página 1 de 2 · 22 pedidos");
  await page.getByRole("button", { name: "Próxima", exact: true }).click(); await visivel(page, "Compra 21");
  await page.getByLabel("Status do pedido").selectOption("SOLICITADO"); await page.waitForURL(url => url.searchParams.get("pagina") === "1");
  await page.getByRole("button", { name: "Vendas", exact: true }).click(); await visivel(page, "Venda exemplo"); await page.reload(); await visivel(page, "Venda exemplo");
  assert.equal(new URL(page.url()).searchParams.get("papel"), "venda");
  await page.goBack(); await page.waitForURL(url => url.searchParams.get("papel") === "compra");
  assert.ok(estado.chamadas.filter(c => c.caminho === "/api/pedidos/me").every(c => !c.query.includes("id_usuario") && !c.query.includes("id_condominio") && !c.query.includes("COMPRADOR")));
});
test("vazio não mostra página 1 de 0; erro de leitura tem retry", async t => {
  const { page, estado } = await preparar(t, { sessao: true, pedidos: [] });
  await abrirPedidos(page); await visivel(page, "Você ainda não tem pedidos"); assert.equal(await page.getByText("Página 1 de 0", { exact: false }).count(), 0);
  estado.erroHistorico = { status: 500, codigo: "INTERNAL_ERROR" }; await page.getByRole("button", { name: "Atualizar pedidos" }).click(); await page.getByRole("button", { name: "Tentar novamente", exact: true }).waitFor();
  estado.erroHistorico = null; estado.pedidos = [structuredClone(pedidoBase)]; await page.getByRole("button", { name: "Tentar novamente", exact: true }).click(); await visivel(page, "Bolo no pedido");
});
test("comprador cancela com confirmação e motivo trim, sem duplo PATCH", async t => {
  const { page, estado } = await preparar(t, { sessao: true, atrasoTransicao: 200 });
  await abrirPedidos(page); await page.getByLabel("Motivo (opcional)").fill("  Não preciso mais  ");
  page.once("dialog", d => d.dismiss()); await page.getByRole("button", { name: "Cancelar", exact: true }).click(); assert.equal(patchesPedido(estado).length, 0);
  page.once("dialog", d => d.accept()); await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.locator(".pedido-card .etiqueta").filter({ hasText: "Cancelado" }).waitFor(); assert.deepEqual(patchesPedido(estado).map(c => c.body), [{ status: "CANCELADO", motivo: "Não preciso mais" }]);
  assert.equal(await page.getByRole("button", { name: "Cancelar", exact: true }).count(), 0);
  await page.getByText("Histórico do pedido", { exact: true }).click(); await visivel(page, "Não preciso mais");
});
test("vendedor aceita e conclui; admin local não ganha cancelamento de venda", async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "transferencia", pedidos: [{ ...structuredClone(pedidoBase), papel_usuario: "VENDEDOR" }] });
  await abrirPedidos(page); assert.equal(await page.getByRole("button", { name: "Cancelar", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Aceitar", exact: true }).click(); await page.getByRole("button", { name: "Concluir", exact: true }).waitFor();
  page.once("dialog", d => d.accept()); await page.getByRole("button", { name: "Concluir", exact: true }).click(); await page.locator(".pedido-card .etiqueta").filter({ hasText: "Concluído" }).waitFor();
  assert.deepEqual(patchesPedido(estado).map(c => c.body), [{ status: "ACEITO" }, { status: "CONCLUIDO" }]);
  assert.equal(await page.getByRole("button", { name: "Aceitar", exact: true }).count(), 0);
});
test("vendedor recusa com confirmação e estados terminais não oferecem alteração", async t => {
  const { page, estado } = await preparar(t, { sessao: true, pedidos: [{ ...structuredClone(pedidoBase), papel_usuario: "VENDEDOR" }] });
  await abrirPedidos(page); page.once("dialog", d => d.accept()); await page.getByRole("button", { name: "Recusar", exact: true }).click(); await page.locator(".pedido-card .etiqueta").filter({ hasText: "Recusado" }).waitFor();
  assert.deepEqual(patchesPedido(estado).map(c => c.body), [{ status: "RECUSADO" }]);
  assert.equal(await page.getByLabel("Motivo (opcional)").count(), 0);
});
test("conflito 409 refaz histórico, mostra decisão concorrente e não repete PATCH", async t => {
  const { page, estado } = await preparar(t, { sessao: true, pedidos: [{ ...structuredClone(pedidoBase), papel_usuario: "VENDEDOR" }], erroTransicao: { status: 409, codigo: "INVALID_ORDER_TRANSITION" } });
  await abrirPedidos(page); await page.getByRole("button", { name: "Aceitar", exact: true }).click();
  await visivel(page, "O pedido mudou antes desta ação. Confira o status e o histórico atualizados antes de decidir novamente."); await page.locator(".pedido-card .etiqueta").filter({ hasText: "Cancelado" }).waitFor();
  await page.getByText("Histórico do pedido", { exact: true }).click(); await visivel(page, "Decisão concorrente"); assert.equal(patchesPedido(estado).length, 1);
});
for (const codigo of ["ORDER_STATUS_FORBIDDEN", "ORDER_NOT_FOUND"]) test(`ação trata ${codigo} retirando acesso e sem repetir`, async t => {
  const { page, estado } = await preparar(t, { sessao: true, pedidos: [{ ...structuredClone(pedidoBase), papel_usuario: "VENDEDOR" }], erroTransicao: { status: codigo === "ORDER_NOT_FOUND" ? 404 : 403, codigo } });
  await abrirPedidos(page); await page.getByRole("button", { name: "Aceitar", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: codigo === "ORDER_NOT_FOUND" ? "Pedido indisponível" : "Você não tem permissão" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Aceitar", exact: true }).count(), 0); assert.equal(patchesPedido(estado).length, 1);
});
test("mudança remove pedido do filtro e corrige página acima do total", async t => {
  const pedidos = Array.from({ length: 21 }, (_, i) => ({ ...structuredClone(pedidoBase), id_pedido: `72345678-1234-4234-8234-${String(i + 1).padStart(12, "0")}`, papel_usuario: "VENDEDOR", produto: { ...pedidoBase.produto, nome_produto: `Pedido ${i + 1}` } }));
  const { page, estado } = await preparar(t, { sessao: true, pedidos });
  await page.goto(`${origem}/pedidos?papel=venda&status=SOLICITADO&pagina=2`); await visivel(page, "Pedido 21");
  await page.getByRole("button", { name: "Aceitar", exact: true }).click(); await page.waitForURL(url => url.searchParams.get("pagina") === "1"); await visivel(page, "Página 1 de 1 · 20 pedidos");
  assert.equal(await page.getByText("Pedido 21", { exact: true }).count(), 0); assert.equal(patchesPedido(estado).length, 1);
});
test("chat legado indisponível não inventa criação de conversa", async t => {
  const { page, estado } = await preparar(t, { sessao: true, pedidos: [{ ...structuredClone(pedidoBase), chat: { disponivel: false, status_conversa: null } }] });
  await abrirPedidos(page); await visivel(page, "Chat indisponível para este pedido."); assert.equal(await page.getByRole("link", { name: "Conversar", exact: true }).count(), 0); assert.equal(postsMensagem(estado).length, 0);
});
test("chat por link e reload usa apenas endpoint próprio, com layout neutro em acesso direto", async t => {
  const { page, estado } = await preparar(t, { sessao: true });
  await abrirPedidos(page); await page.getByRole("link", { name: "Conversar", exact: true }).click(); await caminho(page, `/pedidos/${pedidoId}/chat`); await visivel(page, "Mensagem mais antiga");
  await page.reload(); await visivel(page, "Mensagem mais antiga");
  assert.equal(estado.chamadas.some(c => c.caminho === `/api/pedidos/${pedidoId}`), false);
  await page.goto(`${origem}/pedidos/${pedidoId}/chat`); await visivel(page, "Mensagem mais antiga"); assert.equal(await page.locator(".mensagem.propria").count(), 0);
  assert.ok(estado.chamadas.filter(c => c.caminho.endsWith("/chat")).every(c => new URLSearchParams(c.query).get("limite") === "50"));
});
test("paginação ASC começa nas antigas e botão últimas mostra página final", async t => {
  const { page } = await preparar(t, { sessao: true, mensagens: mensagensNumeradas(101) });
  await abrirChat(page); await visivel(page, "Mensagem 1"); assert.equal(await page.getByText("Mensagem 101", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Ir para as últimas mensagens", exact: true }).click(); await visivel(page, "Mensagem 101"); await visivel(page, "Página 3 de 3");
  await page.getByRole("button", { name: "Anterior", exact: true }).click(); await visivel(page, "Mensagem 51");
  await page.reload(); await visivel(page, "Mensagem 51");
});
test("envio trim com 201 vai à nova última página e não duplica mensagem real", async t => {
  const { page, estado } = await preparar(t, { sessao: true, mensagens: mensagensNumeradas(50), atrasoMensagem: 200 });
  await abrirChat(page); await page.getByLabel("Mensagem", { exact: true }).fill("  Podemos combinar?  ");
  await page.evaluate(() => { const form = document.querySelector(".compositor-chat"); form.requestSubmit(); form.requestSubmit(); });
  await visivel(page, "Podemos combinar?"); await visivel(page, "Página 2 de 2");
  assert.deepEqual(postsMensagem(estado).map(c => c.body), [{ conteudo: "Podemos combinar?" }]);
  const enviada = estado.mensagens.at(-1); assert.equal(await page.locator(`[data-mensagem-id="${enviada.id_mensagem}"]`).count(), 1);
  assert.equal(await page.getByLabel("Mensagem", { exact: true }).inputValue(), "");
  await page.screenshot({ path: "/tmp/porta-chat-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 }); await page.screenshot({ path: "/tmp/porta-chat-desktop.png", fullPage: true });
});
test("chat vazio e texto em branco não enviam; texto é renderizado sem HTML", async t => {
  const { page, estado } = await preparar(t, { sessao: true, mensagens: [] });
  await abrirChat(page); await visivel(page, "Ainda não há mensagens nesta conversa.");
  await page.getByLabel("Mensagem", { exact: true }).fill("   "); assert.equal(await page.getByRole("button", { name: "Enviar", exact: true }).isDisabled(), true);
  const texto = '<img src=x onerror="window.injetado=true">';
  await page.getByLabel("Mensagem", { exact: true }).fill(texto); await page.getByRole("button", { name: "Enviar", exact: true }).click(); await visivel(page, texto);
  assert.equal(await page.locator(".mensagens img").count(), 0); assert.equal(postsMensagem(estado).length, 1);
});
test("conversa encerrada preserva leitura; CHAT_CLOSED em corrida bloqueia escrita", async t => {
  const { page, estado } = await preparar(t, { sessao: true, erroMensagem: { status: 409, codigo: "CHAT_CLOSED" } });
  await abrirChat(page); await page.getByLabel("Mensagem", { exact: true }).fill("Olá"); await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await visivel(page, "Conversa encerrada. Você pode continuar lendo o histórico."); await visivel(page, "Mensagem mais antiga"); assert.equal(await page.getByLabel("Mensagem", { exact: true }).isDisabled(), true); assert.equal(postsMensagem(estado).length, 1);
});
test("pedido terminal com conversa ATIVA continua permitindo envio", async t => {
  const { page, estado } = await preparar(t, { sessao: true, statusPedidoChat: "CONCLUIDO" });
  await abrirChat(page); await visivel(page, "Concluído"); await page.getByLabel("Mensagem", { exact: true }).fill("Obrigado!"); await page.getByRole("button", { name: "Enviar", exact: true }).click(); await visivel(page, "Obrigado!");
  assert.equal(patchesPedido(estado).length, 0); assert.ok(estado.chamadas.filter(c => c.caminho.endsWith("/chat")).every(c => c.metodo === "GET" && c.bytes === 0));
});
for (const codigo of ["ORDER_NOT_FOUND", "CHAT_NOT_FOUND"]) test(`GET chat ${codigo} não revela mensagens ou cria conversa`, async t => {
  const { page, estado } = await preparar(t, { sessao: true, erroChat: { status: 404, codigo } });
  await page.goto(`${origem}/pedidos/${pedidoId}/chat`); await page.getByRole("alert").filter({ hasText: codigo === "ORDER_NOT_FOUND" ? "Conversa indisponível para sua conta." : "Este pedido não possui uma conversa disponível." }).waitFor();
  assert.equal(await page.getByText("Mensagem mais antiga", { exact: true }).count(), 0); assert.equal(postsMensagem(estado).length, 0);
});
for (const codigo of ["VALIDATION_ERROR", "CHAT_SEND_FORBIDDEN"]) test(`envio ${codigo} preserva texto e respeita permissão`, async t => {
  const { page, estado } = await preparar(t, { sessao: true, erroMensagem: { status: codigo === "VALIDATION_ERROR" ? 400 : 403, codigo, detalhes: { fieldErrors: { conteudo: ["Confira o conteúdo."] } } } });
  await abrirChat(page); await page.getByLabel("Mensagem", { exact: true }).fill("Texto mantido"); await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await visivel(page, codigo === "VALIDATION_ERROR" ? "Confira o conteúdo." : "Você não possui permissão para enviar nesta conversa.");
  assert.equal(await page.getByLabel("Mensagem", { exact: true }).inputValue(), "Texto mantido"); assert.equal(postsMensagem(estado).length, 1);
  if (codigo === "CHAT_SEND_FORBIDDEN") assert.equal(await page.getByRole("button", { name: "Enviar", exact: true }).isDisabled(), true);
});
test("super não entra em pedidos próprios; conversa por ID é somente leitura de observador", async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "super" });
  await page.goto(`${origem}/pedidos`); await caminho(page, "/admin");
  await abrirChat(page); await visivel(page, "Leitura de super admin. O envio como observador está desabilitado.");
  assert.equal(await page.getByRole("button", { name: "Enviar", exact: true }).isDisabled(), true); assert.equal(postsMensagem(estado).length, 0);
  assert.equal(estado.chamadas.some(c => c.caminho === "/api/pedidos/me"), false);
});
test("atualização manual reconcilia conversa e páginas atrasadas não sobrescrevem recentes", async t => {
  const { page, estado } = await preparar(t, { sessao: true, mensagens: mensagensNumeradas(101), atrasarChat: true });
  await abrirChat(page); await page.getByRole("button", { name: "Próxima", exact: true }).click();
  await page.goto(`${origem}/pedidos/${pedidoId}/chat?pagina=3`); await visivel(page, "Mensagem 101"); await page.waitForTimeout(500);
  assert.equal(await page.getByText("Mensagem 51", { exact: true }).count(), 0);
  estado.mensagens.push({ ...structuredClone(mensagemBase), id_mensagem: "f2345678-1234-4234-8234-123456789012", conteudo: "Mensagem recém-recebida" });
  await page.getByRole("button", { name: "Atualizar conversa", exact: true }).click(); await visivel(page, "Mensagem recém-recebida");
});
test("logout elimina chat e próximo usuário não recebe texto anterior", async t => {
  const { page, estado } = await preparar(t, { sessao: true });
  await abrirChat(page); await visivel(page, "Mensagem mais antiga"); await page.getByRole("button", { name: "Sair da conta", exact: true }).click(); await caminho(page, "/login");
  assert.equal(await page.getByText("Mensagem mais antiga", { exact: true }).count(), 0);
  estado.pessoa = outroId; estado.mensagens = [{ ...structuredClone(mensagemBase), conteudo: "Conversa de outra conta" }];
  await entrar(page); await caminho(page, "/vitrine"); await abrirChat(page); await visivel(page, "Conversa de outra conta"); assert.equal(await page.getByText("Mensagem mais antiga", { exact: true }).count(), 0);
});
test("perfil sem vínculo algum pode consultar histórico sem ampliar guard do catálogo", async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "sem-vinculo" });
  await abrirPedidos(page); await visivel(page, "Bolo no pedido"); await abrirChat(page); await visivel(page, "Mensagem mais antiga");
  await page.goto(`${origem}/vitrine`); await visivel(page, "Vamos tentar de novo?");
  assert.equal(estado.chamadas.some(c => c.caminho === "/api/produtos"), false);
});
test("condômino ENCERRADO continua cancelando compra e enviando no próprio chat", async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "ENCERRADO" });
  await abrirPedidos(page); page.once("dialog", d => d.accept()); await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.locator(".pedido-card .etiqueta").filter({ hasText: "Cancelado" }).waitFor();
  await page.getByRole("link", { name: "Conversar", exact: true }).click(); await page.getByLabel("Mensagem", { exact: true }).fill("Ainda podemos conversar"); await page.getByRole("button", { name: "Enviar", exact: true }).click(); await visivel(page, "Ainda podemos conversar");
  assert.equal(patchesPedido(estado).length, 1); assert.equal(postsMensagem(estado).length, 1);
});
test("papel proveniente da lista identifica balão próprio; chegada direta usa neutro", async t => {
  const { page } = await preparar(t, { sessao: true, mensagens: [{ ...structuredClone(mensagemBase), remetente: { nome_completo: "Morador", papel: "COMPRADOR" } }] });
  await abrirPedidos(page); await page.getByRole("link", { name: "Conversar", exact: true }).click(); await visivel(page, "Mensagem mais antiga"); assert.equal(await page.locator(".mensagem.propria").count(), 1);
  await page.evaluate(() => history.replaceState(null, "", location.href)); await page.reload(); await visivel(page, "Mensagem mais antiga"); assert.equal(await page.locator(".mensagem.propria").count(), 0);
});
test("falha de rede no POST preserva texto sem repetir ou afirmar sucesso", async t => {
  const { page, estado } = await preparar(t, { sessao: true, redeMensagem: true });
  await abrirChat(page); await page.getByLabel("Mensagem", { exact: true }).fill("Texto em falha de rede"); await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await visivel(page, "Não foi possível confirmar o envio. Seu texto foi mantido; atualize a conversa antes de tentar novamente.");
  assert.equal(await page.getByLabel("Mensagem", { exact: true }).inputValue(), "Texto em falha de rede"); assert.equal(postsMensagem(estado).length, 1);
});
test("suspensão global recebida na atualização retira mensagens já exibidas", async t => {
  const { page, estado } = await preparar(t, { sessao: true });
  await abrirChat(page); await visivel(page, "Mensagem mais antiga"); estado.erroChat = { status: 403, codigo: "ACCOUNT_SUSPENDED" };
  await page.getByRole("button", { name: "Atualizar conversa", exact: true }).click(); await visivel(page, "Conta suspensa"); assert.equal(await page.getByText("Mensagem mais antiga", { exact: true }).count(), 0);
});
test("ID e página de chat inválidos têm erro navegável sem leitura indevida", async t => {
  const { page, estado } = await preparar(t, { sessao: true });
  await page.goto(`${origem}/pedidos/invalido/chat`); await page.getByRole("alert").filter({ hasText: "Conversa indisponível para sua conta." }).waitFor(); assert.equal(estado.chamadas.some(c => c.caminho.includes("/invalido")), false);
  await page.goto(`${origem}/pedidos/${pedidoId}/chat?pagina=0`); await visivel(page, "Confira a página da conversa");
  await page.getByRole("button", { name: "Voltar à primeira página", exact: true }).click(); await visivel(page, "Mensagem mais antiga");
});

// Prompt 27: APIs de Perfil/Transferência/Administração, sempre com dados fictícios.
const patchesAdmin = estado => estado.chamadas.filter(c => c.metodo === "PATCH" && c.caminho.startsWith("/api/admin/"));
const postsTransferencia = estado => estado.chamadas.filter(c => c.metodo === "POST" && c.caminho === "/api/vinculos/transferencia");
async function abrirAdmin(page, pendentes = false) { await page.goto(`${origem}/admin/vinculos${pendentes ? "/pendentes" : ""}`); await page.locator(".vinculo-admin").first().waitFor(); }
async function transferir(page) {
  await page.goto(`${origem}/perfil/transferencia`);
  await page.getByRole("radio", { name: /Residencial Novo/ }).check();
  await page.getByLabel("Nova moradia", { exact: true }).fill(" Bloco B - 402 ");
  await page.getByRole("button", { name: "Enviar solicitação de transferência", exact: true }).click();
}
test("perfil ativo mostra identidade própria, sessão e residência após refresh direto", async t => {
  const { page, estado } = await preparar(t, { sessao: true });
  await page.goto(`${origem}/perfil`); await visivel(page, "Meu Perfil");
  await visivel(page, "morador@example.com"); await visivel(page, id); await visivel(page, "Residência atual");
  assert.equal(await page.getByRole("link", { name: "Solicitar transferência", exact: true }).count(), 1);
  assert.equal(await page.getByLabel("CPF", { exact: true }).count(), 0);
  await page.reload(); await visivel(page, "Meu Perfil");
  assert.equal(estado.chamadas.some(c => c.caminho.endsWith("/usuarios/me") && c.query), false);
  await page.screenshot({ path: "/tmp/porta-prompt27-perfil-mobile.png", fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});
for (const modo of ["SUSPENSO", "REJEITADO", "ENCERRADO"]) test(`perfil ${modo} mostra último vínculo, sem privilégio histórico e com pedidos`, async t => {
  const { page } = await preparar(t, { sessao: true, modo });
  await page.goto(`${origem}/perfil`); await visivel(page, "Último vínculo registrado"); await visivel(page, modo);
  assert.equal(await page.getByRole("link", { name: "Solicitar transferência", exact: true }).count(), 0);
  assert.equal(await page.getByRole("link", { name: "Administração", exact: true }).count(), 0);
  await page.getByRole("link", { name: "Meus pedidos anteriores", exact: true }).click(); await caminho(page, "/pedidos"); await visivel(page, "Bolo no pedido");
});
test("super tem perfil simplificado, sem transferência ou residência inventada", async t => {
  const { page } = await preparar(t, { sessao: true, modo: "super" });
  await page.goto(`${origem}/perfil`); await visivel(page, "Identidade global");
  assert.equal(await page.getByText("Residência atual", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("link", { name: "Solicitar transferência", exact: true }).count(), 0);
  await page.goto(`${origem}/perfil/transferencia`); await caminho(page, "/admin");
});
test("perfil ATIVO e PENDENTE mantém vitrine e impede segunda solicitação até por URL", async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "transferencia" });
  await page.goto(`${origem}/perfil`); await visivel(page, "Residência atual"); await visivel(page, "Destino da transferência — aguardando aprovação");
  assert.equal(await page.getByRole("link", { name: "Solicitar transferência", exact: true }).count(), 0);
  await page.goto(`${origem}/perfil/transferencia`); await caminho(page, "/perfil");
  await page.getByRole("link", { name: "Vitrine", exact: true }).click(); await visivel(page, "Bolo de cenoura");
  assert.equal(postsTransferencia(estado).length, 0);
});
for (const modo of ["pendente", "SUSPENSO", "ENCERRADO"]) test(`guard nega transferência sem ATIVO (${modo})`, async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo });
  await page.goto(`${origem}/perfil/transferencia`); await caminho(page, modo === "pendente" ? "/aguardando-aprovacao" : "/estado-vinculo");
  assert.equal(estado.chamadas.some(c => c.caminho === "/api/condominios"), false);
});
test("transferência usa catálogo paginado, bloqueia atual e envia dois campos sem duplicidade", async t => {
  const { page, estado } = await preparar(t, { sessao: true, catalogoCondominios: [condominio, destinoCondominio], atrasoTransferencia: 250 });
  await page.goto(`${origem}/perfil/transferencia`);
  assert.equal(await page.getByRole("radio", { name: /Residencial Exemplo/ }).isDisabled(), true);
  await page.getByRole("button", { name: "Próxima", exact: true }).click(); await visivel(page, "Página 2 de 2");
  assert.ok(estado.chamadas.filter(c => c.caminho === "/api/condominios").every(c => Number(new URLSearchParams(c.query).get("limite")) <= 50));
  await page.getByRole("radio", { name: /Residencial Novo/ }).check(); await page.getByLabel("Nova moradia").fill(" Bloco B - 402 ");
  await page.getByRole("button", { name: "Enviar solicitação de transferência", exact: true }).dblclick();
  await caminho(page, "/perfil"); await visivel(page, "Transferência solicitada — aguardando aprovação"); await visivel(page, "Residência atual");
  assert.deepEqual(postsTransferencia(estado).map(c => c.body), [{ id_condominio: destinoCondominio.id_condominio, moradia: "Bloco B - 402" }]);
  await page.getByRole("link", { name: "Vitrine", exact: true }).click(); await visivel(page, "Bolo de cenoura");
});
for (const codigo of ["SAME_CONDOMINIUM", "CONDOMINIUM_NOT_FOUND", "CONDOMINIUM_INACTIVE", "VALIDATION_ERROR"]) test(`transferência trata ${codigo}, preserva moradia e não repete POST`, async t => {
  const { page, estado } = await preparar(t, { sessao: true, catalogoCondominios: [condominio, destinoCondominio], erroTransferencia: { status: codigo === "VALIDATION_ERROR" ? 400 : codigo === "CONDOMINIUM_NOT_FOUND" ? 404 : 409, codigo, detalhes: { fieldErrors: { moradia: ["Confira a nova moradia."] } } } });
  await transferir(page);
  await page.getByRole("alert").first().waitFor();
  assert.equal(await page.getByLabel("Nova moradia", { exact: true }).inputValue(), " Bloco B - 402 ");
  assert.equal(postsTransferencia(estado).length, 1);
  if (codigo.startsWith("CONDOMINIUM_")) {
    await page.getByRole("radio", { name: /Residencial Novo/ }).waitFor();
    assert.ok(estado.chamadas.filter(c => c.caminho === "/api/condominios").length >= 2);
    assert.equal(await page.getByRole("button", { name: "Enviar solicitação de transferência", exact: true }).isDisabled(), true);
  }
});
test("MEMBERSHIP_PENDING refaz estado e mostra solicitação existente", async t => {
  const { page, estado } = await preparar(t, { sessao: true, catalogoCondominios: [destinoCondominio], erroTransferencia: { status: 409, codigo: "MEMBERSHIP_PENDING" } });
  await transferir(page); await caminho(page, "/perfil"); await visivel(page, "Já existe uma solicitação pendente. Confira o destino abaixo.");
  await visivel(page, "Destino da transferência — aguardando aprovação"); assert.equal(postsTransferencia(estado).length, 1);
  assert.ok(estado.chamadas.filter(c => c.caminho === "/api/vinculos/me").length >= 2);
});
test("MEMBERSHIP_REQUIRED na transferência refaz vínculo e retira ação", async t => {
  const { page, estado } = await preparar(t, { sessao: true, catalogoCondominios: [destinoCondominio], erroTransferencia: { status: 403, codigo: "MEMBERSHIP_REQUIRED" } });
  await transferir(page); await caminho(page, "/perfil"); await visivel(page, "Último vínculo registrado");
  assert.equal(await page.getByRole("link", { name: "Solicitar transferência", exact: true }).count(), 0); assert.equal(postsTransferencia(estado).length, 1);
});
test("logout de Perfil retira residência e nova conta carrega contexto próprio", async t => {
  const { page, estado } = await preparar(t, { sessao: true });
  await page.goto(`${origem}/perfil`); await visivel(page, "Residência atual"); await page.getByRole("button", { name: "Sair da conta", exact: true }).click(); await caminho(page, "/login");
  assert.equal(await page.getByText("Apto 302", { exact: true }).count(), 0);
  estado.pessoa = outroId; estado.ativoOverride = { moradia: "Apto da outra pessoa" };
  await entrar(page); await caminho(page, "/vitrine"); await page.getByRole("link", { name: "Perfil", exact: true }).click(); await visivel(page, outroId);
  assert.equal(await page.getByText("Apto 302", { exact: true }).count(), 0);
});
for (const modo of ["ativo", "pendente", "ENCERRADO"]) test(`admin por URL é negado ao usuário sem autoridade (${modo})`, async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo });
  await page.goto(`${origem}/admin/vinculos`); await caminho(page, modo === "ativo" ? "/vitrine" : modo === "pendente" ? "/aguardando-aprovacao" : "/estado-vinculo");
  assert.equal(estado.chamadas.some(c => c.caminho.startsWith("/api/admin/")), false);
});
test("admin local mantém escopo próprio, fila com DTO legado e URL estrangeira não chega à API", async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "admin" });
  await abrirAdmin(page, true); await visivel(page, "Morador da fila");
  assert.equal(estado.chamadas.find(c => c.caminho === "/api/admin/vinculos/pendentes").query.includes("id_condominio"), false);
  assert.equal(await page.getByText("Ações globais de conta", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Filtrar por condomínio", { exact: true }).count(), 0);
  const antes = estado.chamadas.filter(c => c.caminho.startsWith("/api/admin/")).length;
  await page.goto(`${origem}/admin/vinculos?id_condominio=${destinoCondominio.id_condominio}`); await visivel(page, "Confira os filtros administrativos");
  assert.equal(estado.chamadas.filter(c => c.caminho.startsWith("/api/admin/")).length, antes);
});
test("super usa lista geral global e catálogo como filtro de condomínio", async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "super", catalogoCondominios: [condominio, destinoCondominio] });
  await abrirAdmin(page); assert.equal(estado.chamadas.find(c => c.caminho === "/api/admin/vinculos").query.includes("id_condominio"), false);
  await page.getByText("Filtrar por condomínio", { exact: true }).click(); await page.getByRole("radio", { name: /Residencial Novo/ }).click();
  await visivel(page, "Nenhum vínculo para estes filtros"); assert.equal(new URL(page.url()).searchParams.get("id_condominio"), destinoCondominio.id_condominio);
  assert.ok(estado.chamadas.some(c => c.caminho === "/api/admin/vinculos" && new URLSearchParams(c.query).get("id_condominio") === destinoCondominio.id_condominio));
  await page.reload(); await visivel(page, "Nenhum vínculo para estes filtros");
});
for (const acao of ["aprovar", "rejeitar", "suspender"]) test(`admin ${acao} confirma, trava duplicidade, envia PATCH sem corpo e refaz lista`, async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "admin", atrasoAdmin: 200, vinculosAdmin: [{ ...structuredClone(vinculoAdminBase), status_vinculo: acao === "suspender" ? "ATIVO" : "PENDENTE" }] });
  await abrirAdmin(page, acao !== "suspender");
  let texto = ""; page.once("dialog", async d => { texto = d.message(); await d.accept(); });
  const nome = { aprovar: "Aprovar", rejeitar: "Rejeitar", suspender: "Suspender vínculo" }[acao];
  await page.getByRole("button", { name: nome, exact: true }).click();
  await page.getByRole("status").filter({ hasText: "alteração confirmada" }).waitFor();
  const patches = patchesAdmin(estado); assert.equal(patches.length, 1); assert.equal(patches[0].bytes, 0); assert.equal(patches[0].headers["content-type"], undefined); assert.equal(patches[0].body, null);
  assert.ok(estado.chamadas.filter(c => c.metodo === "GET" && c.caminho.startsWith("/api/admin/")).length >= 2);
  if (acao === "suspender") { assert.match(texto, /históricos são preservados/); await page.locator(".vinculo-admin .etiqueta").filter({ hasText: "SUSPENSO" }).waitFor(); assert.equal(patches.some(c => c.caminho.includes("/usuarios/")), false); }
  else await visivel(page, "Nenhuma solicitação pendente");
});
for (const codigo of ["OPEN_ORDERS_BLOCK_TRANSFER", "LAST_ACTIVE_ADMIN"]) test(`aprovação ${codigo} mantém PENDENTE e não repete decisão`, async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "admin", erroAcaoAdmin: { status: 409, codigo } });
  await abrirAdmin(page, true); page.once("dialog", d => d.accept()); await page.getByRole("button", { name: "Aprovar", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "solicitação continua pendente" }).waitFor(); await page.locator(".vinculo-admin .etiqueta").filter({ hasText: "PENDENTE" }).waitFor();
  assert.equal(patchesAdmin(estado).length, 1); assert.equal(estado.vinculosAdmin[0].status_vinculo, "PENDENTE");
});
test("local não altera próprio admin; outro vínculo recebe somente boolean e refetch", async t => {
  const propio = { ...structuredClone(vinculoAdminBase), id_vinculo: vinculo.id_vinculo, status_vinculo: "ATIVO", admin_condominio: true, morador: { id_usuario: id, nome_completo: "Admin atual" } };
  const { page, estado } = await preparar(t, { sessao: true, modo: "admin", vinculosAdmin: [propio, { ...structuredClone(vinculoAdminBase), status_vinculo: "ATIVO" }] });
  await abrirAdmin(page); const eu = page.getByRole("article", { name: "Vínculo de Admin atual", exact: true });
  assert.equal(await eu.getByRole("button", { name: /administrador/ }).count(), 0);
  page.once("dialog", d => d.accept()); await page.getByRole("button", { name: "Tornar administrador", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "alteração confirmada" }).waitFor();
  assert.deepEqual(patchesAdmin(estado)[0].body, { admin_condominio: true });
  await page.getByRole("button", { name: "Remover administrador", exact: true }).waitFor();
  page.once("dialog", d => d.accept()); await page.getByRole("button", { name: "Remover administrador", exact: true }).click(); await page.getByRole("button", { name: "Tornar administrador", exact: true }).waitFor();
  assert.deepEqual(patchesAdmin(estado)[1].body, { admin_condominio: false });
});
test("super executa ações globais por usuário, compartilha resultado e não inventa status inicial", async t => {
  const duplicado = { ...structuredClone(vinculoAdminBase), id_vinculo: "b2345678-1234-4234-8234-123456789012", status_vinculo: "ENCERRADO" };
  const { page, estado } = await preparar(t, { sessao: true, modo: "super", atrasoAdmin: 300, vinculosAdmin: [{ ...structuredClone(vinculoAdminBase), status_vinculo: "ATIVO" }, duplicado] });
  await abrirAdmin(page); assert.equal(await page.getByText(/Última alteração confirmada/).count(), 0);
  page.once("dialog", d => { assert.match(d.message(), /mesmo com JWT válido/); return d.accept(); });
  await page.getByRole("button", { name: "Suspender conta", exact: true }).first().click();
  assert.equal(await page.getByRole("button", { name: "Suspender conta", exact: true }).last().isDisabled(), true);
  await page.getByText("Última alteração confirmada nesta sessão: conta SUSPENSA.", { exact: true }).first().waitFor();
  await page.locator(".vinculo-admin").nth(1).waitFor(); assert.equal(await page.getByText("Última alteração confirmada nesta sessão: conta SUSPENSA.", { exact: true }).count(), 2);
  assert.equal(patchesAdmin(estado)[0].caminho, `/api/admin/usuarios/${outroId}/status`); assert.deepEqual(patchesAdmin(estado)[0].body, { status_conta: "SUSPENSA" });
  assert.deepEqual(estado.vinculosAdmin.map(v => v.status_vinculo), ["ATIVO", "ENCERRADO"]);
  page.once("dialog", d => { assert.match(d.message(), /não reativa automaticamente/); return d.accept(); }); await page.getByRole("button", { name: "Reativar conta", exact: true }).first().click();
  await page.getByText("Última alteração confirmada nesta sessão: conta ATIVA.", { exact: true }).first().waitFor();
  assert.deepEqual(patchesAdmin(estado)[1].body, { status_conta: "ATIVA" });
  assert.deepEqual(estado.vinculosAdmin.map(v => v.status_vinculo), ["ATIVO", "ENCERRADO"]);
  await page.setViewportSize({ width: 1280, height: 900 }); await page.screenshot({ path: "/tmp/porta-prompt27-admin-desktop.png", fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});
for (const origemFalha of ["leitura", "ação"]) test(`403 na ${origemFalha} remove área privada e refaz privilégios`, async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "admin", perderAdmin: true });
  await abrirAdmin(page, true);
  if (origemFalha === "leitura") { estado.erroAdminLista = { status: 403, codigo: "FORBIDDEN" }; await page.getByRole("button", { name: "Atualizar vínculos", exact: true }).click(); }
  else { estado.erroAcaoAdmin = { status: 403, codigo: "FORBIDDEN" }; page.once("dialog", d => d.accept()); await page.getByRole("button", { name: "Aprovar", exact: true }).click(); }
  await caminho(page, "/perfil"); await visivel(page, "Sua conta não tem autoridade para esta ação. Atualizamos suas permissões.");
  assert.equal(await page.getByText("Morador da fila", { exact: true }).count(), 0); assert.equal(await page.getByRole("link", { name: "Administração", exact: true }).count(), 0);
  assert.ok(estado.chamadas.filter(c => c.caminho === "/api/vinculos/me").length >= 2);
  assert.equal(patchesAdmin(estado).length, origemFalha === "leitura" ? 0 : 1);
});
test("409 em corrida refaz fila sem repetir PATCH nem apresentar sucesso", async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "admin", erroAcaoAdmin: { status: 409, codigo: "MEMBERSHIP_NOT_PENDING" } });
  await abrirAdmin(page, true); page.once("dialog", d => d.accept()); await page.getByRole("button", { name: "Aprovar", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "já foi decidida" }).waitFor(); await visivel(page, "Nenhuma solicitação pendente"); assert.equal(patchesAdmin(estado).length, 1);
});
test("listas administrativas paginam no servidor e preservam busca/status após refresh", async t => {
  const itens = Array.from({ length: 21 }, (_, i) => ({ ...structuredClone(vinculoAdminBase), id_vinculo: `a2345678-1234-4234-8234-${String(i).padStart(12, "0")}`, status_vinculo: "ATIVO", morador: { id_usuario: outroId, nome_completo: `Morador ${i}` } }));
  const { page, estado } = await preparar(t, { sessao: true, modo: "admin", vinculosAdmin: itens });
  await abrirAdmin(page); await page.getByLabel("Status do vínculo", { exact: true }).selectOption("ATIVO");
  await page.getByLabel("Buscar por nome ou moradia", { exact: true }).fill(" Morador "); await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page.getByRole("button", { name: "Próxima", exact: true }).click(); await visivel(page, "Página 2 de 2 · 21 vínculos");
  assert.equal(await page.locator(".vinculo-admin").count(), 1);
  await page.reload(); await visivel(page, "Página 2 de 2 · 21 vínculos");
  assert.equal(new URL(page.url()).searchParams.get("busca"), "Morador"); assert.equal(new URL(page.url()).searchParams.get("status"), "ATIVO");
  assert.ok(estado.chamadas.filter(c => c.caminho === "/api/admin/vinculos").every(c => new URLSearchParams(c.query).get("limite") === "20"));
});
test("aprovar último item da última página corrige página sem perder filtros", async t => {
  const itens = Array.from({ length: 21 }, (_, i) => ({ ...structuredClone(vinculoAdminBase), id_vinculo: `a2345678-1234-4234-8234-${String(i).padStart(12, "0")}` }));
  const { page } = await preparar(t, { sessao: true, modo: "admin", vinculosAdmin: itens });
  await page.goto(`${origem}/admin/vinculos/pendentes?pagina=2&busca=Morador`); await page.locator(".vinculo-admin").first().waitFor();
  page.once("dialog", d => d.accept()); await page.getByRole("button", { name: "Aprovar", exact: true }).click(); await visivel(page, "Página 1 de 1 · 20 vínculos");
  assert.equal(new URL(page.url()).searchParams.get("busca"), "Morador"); assert.equal(new URL(page.url()).searchParams.get("pagina"), "1");
});
test("autossuspensão de vínculo local é permitida e retira autoridade mantendo histórico", async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "admin", vinculosAdmin: [{ ...structuredClone(vinculoAdminBase), id_vinculo: vinculo.id_vinculo, status_vinculo: "ATIVO", admin_condominio: true, morador: { id_usuario: id, nome_completo: "Admin atual" } }] });
  await abrirAdmin(page); page.once("dialog", d => d.accept()); await page.getByRole("button", { name: "Suspender vínculo", exact: true }).click();
  await caminho(page, "/estado-vinculo"); await visivel(page, "Vínculo suspenso");
  await page.getByRole("link", { name: "Meus pedidos anteriores", exact: true }).click(); await visivel(page, "Bolo no pedido"); assert.equal(patchesAdmin(estado).length, 1);
});
test("USER_NOT_FOUND não atribui status fictício e cancelar confirmação não envia PATCH", async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "super", erroAcaoAdmin: { status: 404, codigo: "USER_NOT_FOUND" } });
  await abrirAdmin(page); page.once("dialog", d => d.dismiss()); await page.getByRole("button", { name: "Suspender conta", exact: true }).click(); assert.equal(patchesAdmin(estado).length, 0);
  page.once("dialog", d => d.accept()); await page.getByRole("button", { name: "Suspender conta", exact: true }).click(); await page.getByRole("alert").filter({ hasText: "conta alvo está indisponível" }).waitFor();
  assert.equal(await page.getByText(/Última alteração confirmada/).count(), 0); assert.equal(patchesAdmin(estado).length, 1);
});
test("sessão encerrada remove nomes da administração e próxima conta não herda lista", async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "admin" });
  await abrirAdmin(page); await page.getByRole("button", { name: "Sair da conta", exact: true }).click(); await caminho(page, "/login"); assert.equal(await page.getByText("Morador da fila", { exact: true }).count(), 0);
  estado.pessoa = outroId; estado.modo = "ativo"; await entrar(page); await caminho(page, "/vitrine"); await page.goto(`${origem}/admin/vinculos`); await caminho(page, "/vitrine"); assert.equal(await page.getByText("Morador da fila", { exact: true }).count(), 0);
});
test("perfil pendente preserva estado sem liberar administração nem vitrine", async t => {
  const { page } = await preparar(t, { sessao: true, modo: "pendente" });
  await page.goto(`${origem}/perfil`); await visivel(page, "Residência — aguardando aprovação");
  assert.equal(await page.getByRole("link", { name: "Vitrine", exact: true }).count(), 0);
  assert.equal(await page.getByRole("link", { name: "Administração", exact: true }).count(), 0);
  assert.equal(await page.getByRole("link", { name: "Solicitar transferência", exact: true }).count(), 0);
});
test("admin diferencia falha de leitura, retry e busca sem resultado com Bearer", async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "admin", erroAdminLista: { status: 500, codigo: "INTERNAL_ERROR" } });
  await page.goto(`${origem}/admin/vinculos`); await page.getByRole("alert").filter({ hasText: "Não foi possível carregar" }).waitFor();
  assert.equal(await page.locator(".vinculo-admin").count(), 0);
  estado.erroAdminLista = null; await page.getByRole("button", { name: "Tentar novamente", exact: true }).click(); await visivel(page, "Morador da fila");
  await page.screenshot({ path: "/tmp/porta-prompt27-admin-mobile.png", fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByLabel("Buscar por nome ou moradia").fill("Ninguém"); await page.getByRole("button", { name: "Buscar", exact: true }).click(); await visivel(page, "Nenhum vínculo para estes filtros");
  assert.ok(estado.chamadas.filter(c => c.caminho.startsWith("/api/admin/")).every(c => c.bearer?.startsWith("Bearer ")));
});
test("resposta antiga de busca administrativa não repõe linhas após filtro novo", async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "admin", atrasarAdmin: true });
  await abrirAdmin(page); await page.getByLabel("Buscar por nome ou moradia").fill("morador");
  const buscando = page.waitForRequest(req => req.url().includes("/admin/vinculos?") && new URL(req.url()).searchParams.get("busca") === "morador");
  await page.getByRole("button", { name: "Buscar", exact: true }).click(); await buscando;
  await page.getByLabel("Buscar por nome ou moradia").fill("Ausente"); await page.getByRole("button", { name: "Buscar", exact: true }).click(); await visivel(page, "Nenhum vínculo para estes filtros");
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(await page.getByText("Morador da fila", { exact: true }).count(), 0);
  assert.equal(new URL(page.url()).searchParams.get("busca"), "Ausente"); assert.equal(patchesAdmin(estado).length, 0);
});
test("suspensão global durante leitura administrativa remove conteúdo e bloqueia perfil", async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "admin" });
  await abrirAdmin(page); estado.erroAdminLista = { status: 403, codigo: "ACCOUNT_SUSPENDED" };
  await page.getByRole("button", { name: "Atualizar vínculos", exact: true }).click(); await visivel(page, "Conta suspensa");
  assert.equal(await page.getByText("Morador da fila", { exact: true }).count(), 0);
  await page.goto(`${origem}/perfil`); await visivel(page, "Conta suspensa"); assert.equal(await page.getByText("Residência atual", { exact: true }).count(), 0);
});
test("logout durante decisão descarta resposta atrasada sem contaminar próxima conta", async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "admin", atrasoAdmin: 650 });
  await abrirAdmin(page, true); page.once("dialog", d => d.accept()); await page.getByRole("button", { name: "Aprovar", exact: true }).click();
  await page.getByRole("button", { name: "Sair da conta", exact: true }).click(); await caminho(page, "/login"); estado.pessoa = outroId; estado.modo = "ativo";
  await entrar(page); await caminho(page, "/vitrine"); await new Promise(resolve => setTimeout(resolve, 750));
  assert.equal(await page.getByText(/alteração confirmada/).count(), 0); assert.equal(await page.getByText("Morador da fila", { exact: true }).count(), 0);
});
test("as cinco rotas de Perfil e administração restauram após refresh direto", async t => {
  const { page } = await preparar(t, { sessao: true, modo: "admin", catalogoCondominios: [condominio, destinoCondominio] });
  for (const [rota, titulo] of [["/perfil", "Meu Perfil"], ["/perfil/transferencia", "Solicitar transferência"], ["/admin", "Administração"], ["/admin/vinculos", "Moradores e vínculos"], ["/admin/vinculos/pendentes", "Solicitações pendentes"]]) {
    await page.goto(`${origem}${rota}`); await page.getByRole("heading", { name: titulo, exact: true, level: 1 }).waitFor();
    await page.reload(); await page.getByRole("heading", { name: titulo, exact: true, level: 1 }).waitFor();
    assert.equal(new URL(page.url()).pathname, rota); assert.equal(await page.evaluate(() => window.loginPiscou), false);
  }
  await page.goto(`${origem}/perfil/transferencia`); await page.getByRole("radio", { name: /Residencial Novo/ }).waitFor();
  await page.screenshot({ path: "/tmp/porta-prompt27-transferencia-mobile.png", fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

// Regressões demonstradas na auditoria integrada (Prompt 28).
test("resposta desconhecida de criação orienta conferir Meus Pedidos antes de reenviar", async t => {
  const { page, estado } = await preparar(t, { sessao: true, perderRespostaPedido: true });
  await page.goto(`${origem}/produtos/${produtoId}`); await page.getByLabel("Data e hora combinada").fill("2099-01-01T19:00");
  await page.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Confira Meus Pedidos antes de tentar novamente" }).waitFor();
  assert.equal(estado.chamadas.filter(c => c.metodo === "POST" && c.caminho === "/api/pedidos").length, 1);
  assert.equal(await page.getByText("Pedido enviado", { exact: true }).count(), 0);
  await page.getByRole("link", { name: "Conferir Meus Pedidos", exact: true }).click(); await visivel(page, "Pedido cuja resposta foi perdida");
});
test("resposta de pedido da sessão anterior não prende próxima conta em carregamento", async t => {
  const { page, estado } = await preparar(t, { sessao: true, atrasoPedido: 1800, negarPedidoAtrasado: true });
  await page.goto(`${origem}/produtos/${produtoId}`); await page.getByLabel("Data e hora combinada").fill("2099-01-01T19:00");
  const respondido = page.waitForResponse(res => res.url().endsWith("/api/pedidos") && res.request().method() === "POST");
  await page.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
  await page.getByRole("button", { name: "Sair da conta", exact: true }).click(); await caminho(page, "/login");
  estado.pessoa = outroId; await entrar(page); await caminho(page, "/vitrine"); await visivel(page, "Olá, Outra Pessoa!");
  await respondido; await new Promise(resolve => setTimeout(resolve, 150));
  await visivel(page, "Olá, Outra Pessoa!"); await visivel(page, "Bolo de cenoura");
  assert.equal(estado.chamadas.filter(c => c.metodo === "POST" && c.caminho === "/api/pedidos").length, 1);
});
test("conflito de onboarding da sessão anterior não apaga estado da próxima pessoa", async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "novo" });
  await page.goto(`${origem}/onboarding`); await preencherOnboarding(page);
  await page.route("http://api.porta.test/api/onboarding", async route => {
    await new Promise(resolve => setTimeout(resolve, 1600));
    await route.fulfill({ status: 409, headers: { "access-control-allow-origin": "*" }, json: { erro: "ONBOARDING_ALREADY_COMPLETED" } });
  });
  const respondido = page.waitForResponse(res => res.url().endsWith("/api/onboarding") && res.request().method() === "POST");
  await page.getByRole("button", { name: "Solicitar acesso ao condomínio", exact: true }).click();
  await page.getByRole("button", { name: "Sair da conta", exact: true }).click(); await caminho(page, "/login");
  estado.pessoa = outroId; estado.modo = "ativo"; await entrar(page); await caminho(page, "/vitrine"); await visivel(page, "Olá, Outra Pessoa!");
  await respondido; await new Promise(resolve => setTimeout(resolve, 150)); await visivel(page, "Olá, Outra Pessoa!");
});
test("detalhe não transborda com nome válido de 140 caracteres sem espaços", async t => {
  const { page } = await preparar(t, { sessao: true, produto: { ...structuredClone(produtoBase), nome_produto: "P".repeat(140) } });
  await page.setViewportSize({ width: 360, height: 800 }); await page.goto(`${origem}/produtos/${produtoId}`); await page.getByRole("heading", { name: "P".repeat(140), exact: true }).waitFor();
  await page.screenshot({ path: "/tmp/porta-mvp28-nome-longo.png", fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});
for (const tamanho of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }]) test(`auditoria visual e semântica das telas em ${tamanho.width}x${tamanho.height}`, async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "admin", catalogoCondominios: [condominio, destinoCondominio] });
  await page.setViewportSize(tamanho);
  const rotas = [["/vitrine", "Encontre pertinho de você"], [`/produtos/${produtoId}`, "Bolo de cenoura"], ["/meus-produtos", "Meus Produtos"], ["/meus-produtos/novo", "Novo produto"], [`/meus-produtos/${produtoId}/editar`, "Editar produto"], ["/pedidos", "Meus Pedidos"], [`/pedidos/${pedidoId}/chat`, `Pedido #${pedidoId.slice(0, 8)}`], ["/perfil", "Meu Perfil"], ["/perfil/transferencia", "Solicitar transferência"], ["/admin", "Administração"], ["/admin/vinculos", "Moradores e vínculos"], ["/admin/vinculos/pendentes", "Solicitações pendentes"]];
  for (const [rota, titulo] of rotas) {
    estado.produto.vendedor.id_vinculo = rota.includes("/editar") || rota === "/meus-produtos" ? vinculo.id_vinculo : outroId;
    await page.goto(`${origem}${rota}`); await page.getByRole("heading", { name: titulo, exact: true, level: 1 }).waitFor();
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
    const semantica = await page.evaluate(() => ({
      largura: document.documentElement.scrollWidth <= innerWidth,
      principais: document.querySelectorAll("main").length,
      titulos: document.querySelectorAll("h1").length,
      semLabel: [...document.querySelectorAll("input, select, textarea")].filter(el => !el.labels?.length && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby")).length,
      semAlt: document.querySelectorAll("img:not([alt])").length,
      idsDuplicados: [...document.querySelectorAll("[id]")].length !== new Set([...document.querySelectorAll("[id]")].map(el => el.id)).size,
    }));
    assert.deepEqual(semantica, { largura: true, principais: 1, titulos: 1, semLabel: 0, semAlt: 0, idsDuplicados: false }, `${tamanho.width}: ${rota}`);
    if (["/vitrine", `/produtos/${produtoId}`, "/perfil", "/admin/vinculos"].includes(rota)) await page.screenshot({ path: `/tmp/porta-mvp28-${tamanho.width}-${rota === "/vitrine" ? "vitrine" : rota.startsWith("/produtos/") ? "produto" : rota === "/perfil" ? "perfil" : "admin"}.png`, fullPage: true });
  }
  await page.goto(`${origem}/perfil`); await page.getByRole("link", { name: "Perfil", exact: true }).waitFor();
  await page.getByRole("link", { name: "Vitrine", exact: true }).focus(); assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("href")), "/vitrine");
  await page.keyboard.press("Enter"); await caminho(page, "/vitrine");
  await page.getByRole("button", { name: "Sair da conta", exact: true }).click(); await caminho(page, "/login");
  await page.getByLabel("E-mail", { exact: true }).focus(); await page.keyboard.press("Tab"); assert.equal(await page.evaluate(() => document.activeElement?.id), "senha");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});
for (const [codigo, mensagem] of [["invalid_credentials", "E-mail ou senha incorretos."], ["email_not_confirmed", "Confirme seu e-mail antes de entrar."]]) test(`login ${codigo} preserva formulário e não consulta domínio`, async t => {
  const { page, estado } = await preparar(t, { erroLogin: codigo });
  await page.goto(`${origem}/login`); await entrar(page); await visivel(page, mensagem);
  assert.equal(await page.getByLabel("E-mail", { exact: true }).inputValue(), "morador@example.com");
  assert.equal(new URL(page.url()).pathname, "/login"); assert.equal(estado.chamadas.length, 0);
});

// Prompt 29: contratos de domínio simulados; SDK Auth e client de produção reais.
const cadastrosCondominio = estado => estado.chamadas.filter(c => c.caminho === "/api/admin/condominios" && c.metodo === "POST");
async function abrirCadastroCondominio(page) {
  await page.goto(`${origem}/admin/condominios`);
  await page.getByRole("button", { name: "Cadastrar condomínio", exact: true }).click();
}
async function preencherCondominio(page) {
  await page.getByLabel("Nome do condomínio/residencial *", { exact: true }).fill(" Novo Residencial ");
  await page.getByLabel("CEP *", { exact: true }).fill("72000-000");
  await page.getByLabel("Endereço completo *", { exact: true }).fill(" Rua Fictícia, 1 ");
}
test("P29 super vê Condomínios, abre formulário e refresh direto respeita guard", async t => {
  const { page } = await preparar(t, { sessao: true, modo: "super" });
  await page.goto(`${origem}/admin`); await page.getByRole("link", { name: "Consultar e cadastrar condomínios" }).click();
  await page.reload(); await page.getByRole("heading", { name: "Condomínios", exact: true }).waitFor();
  await page.getByRole("button", { name: "Cadastrar condomínio", exact: true }).click();
  await page.getByRole("heading", { name: "Novo condomínio", exact: true }).waitFor();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  assert.equal(await page.getByLabel("CEP *", { exact: true }).count(), 0);
});
for (const modo of ["admin", "ativo"]) test(`P29 ${modo} não vê cadastro nem acessa URL direta`, async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo });
  await page.goto(`${origem}/admin/condominios`); await caminho(page, modo === "admin" ? "/admin" : "/vitrine");
  await page.reload(); await caminho(page, modo === "admin" ? "/admin" : "/vitrine");
  assert.equal(await page.getByRole("link", { name: "Consultar e cadastrar condomínios" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Cadastrar condomínio" }).count(), 0);
  assert.equal(cadastrosCondominio(estado).length, 0);
});
test("P29 validação local por campo impede POST vazio e CEP inválido", async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "super" });
  await abrirCadastroCondominio(page); await page.getByRole("button", { name: "Salvar condomínio" }).click();
  await visivel(page, "Informe o nome do condomínio."); await visivel(page, "Informe o endereço completo.");
  assert.equal(cadastrosCondominio(estado).length, 0);
  await preencherCondominio(page); await page.getByLabel("CEP *", { exact: true }).fill("123");
  await page.getByRole("button", { name: "Salvar condomínio" }).click(); await visivel(page, "Informe oito dígitos (00000-000).");
  assert.equal(cadastrosCondominio(estado).length, 0);
});
test("P29 201: CEP normalizado, Bearer, três campos, duplo clique bloqueado e catálogo atualizado por busca", async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "super", atrasoCondominio: 300 });
  await abrirCadastroCondominio(page); await preencherCondominio(page);
  await page.getByRole("button", { name: "Salvar condomínio" }).dblclick();
  await visivel(page, "Condomínio cadastrado: Novo Residencial");
  await page.getByRole("article", { name: "Condomínio Novo Residencial", exact: true }).waitFor();
  const posts = cadastrosCondominio(estado); assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].body, { nome_residencial: "Novo Residencial", cep: "72000000", endereco: "Rua Fictícia, 1" });
  assert.ok(posts[0].bearer.startsWith("Bearer "));
  assert.equal(JSON.parse(Buffer.from(posts[0].bearer.split(".")[1], "base64url").toString()).sub, id);
  assert.equal(new URL(page.url()).searchParams.get("busca"), "Novo Residencial");
  await page.getByRole("button", { name: "Cadastrar condomínio", exact: true }).click(); assert.equal(await page.getByLabel("CEP *", { exact: true }).inputValue(), "");
});
test("P29 400 preserva entradas e mostra erro do backend junto ao campo", async t => {
  const { page } = await preparar(t, { sessao: true, modo: "super", erroCondominio: { status: 400, codigo: "VALIDATION_ERROR", detalhes: { fieldErrors: { cep: ["CEP inválido do servidor"] } } } });
  await abrirCadastroCondominio(page); await preencherCondominio(page); await page.getByRole("button", { name: "Salvar condomínio" }).click();
  await visivel(page, "CEP inválido do servidor"); assert.equal(await page.getByLabel("CEP *", { exact: true }).inputValue(), "72000-000");
});
test("P29 403 revalida permissões e retira cadastro de quem perdeu papel super", async t => {
  const { page } = await preparar(t, { sessao: true, modo: "super", erroCondominio: { status: 403, codigo: "FORBIDDEN" } });
  await abrirCadastroCondominio(page); await preencherCondominio(page); await page.getByRole("button", { name: "Salvar condomínio" }).click();
  await caminho(page, "/admin"); assert.equal(await page.getByRole("button", { name: "Cadastrar condomínio" }).count(), 0);
});
test("P29 resposta perdida não repete POST e permite conferir condomínio já criado", async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "super", perderRespostaCondominio: true });
  await abrirCadastroCondominio(page); await preencherCondominio(page); await page.getByRole("button", { name: "Salvar condomínio" }).click();
  await visivel(page, "Não foi possível confirmar o cadastro. O condomínio pode ter sido criado. Consulte o catálogo antes de enviar novamente.");
  assert.equal(await page.getByRole("button", { name: "Salvar condomínio" }).isDisabled(), true);
  await page.getByRole("link", { name: "Conferir cadastro no catálogo" }).click();
  await page.getByRole("article", { name: "Condomínio Novo Residencial", exact: true }).waitFor(); assert.equal(cadastrosCondominio(estado).length, 1);
});
test("P29 catálogo: erro/retry, vazio, paginação e filtros sobrevivem refresh", async t => {
  const { page, estado } = await preparar(t, { sessao: true, modo: "super", erroCatalogo: true });
  await page.goto(`${origem}/admin/condominios`); await page.getByRole("alert").filter({ hasText: "Não foi possível consultar o catálogo ativo." }).waitFor();
  estado.erroCatalogo = false; await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await page.getByRole("article", { name: "Condomínio Residencial Exemplo", exact: true }).waitFor();
  await page.getByRole("button", { name: "Próxima", exact: true }).click(); await page.waitForURL(url => url.pathname === "/admin/condominios" && url.searchParams.get("pagina") === "2");
  await page.reload(); await visivel(page, "Página 2 de 2");
  await page.getByLabel("Buscar condomínio", { exact: true }).fill("Ausente"); await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await visivel(page, "Nenhum condomínio encontrado nesta consulta."); assert.equal(new URL(page.url()).searchParams.has("pagina"), false);
});
for (const largura of [360, 390, 768, 1280]) test(`P29 formulário responsivo ${largura}px, labels, foco e títulos longos`, async t => {
  const { page } = await preparar(t, { sessao: true, modo: "super", catalogoCondominios: [{ ...condominio, nome_residencial: "x".repeat(160), endereco: "x".repeat(255) }] });
  await page.setViewportSize({ width: largura, height: 844 }); await abrirCadastroCondominio(page); await preencherCondominio(page);
  await page.getByLabel("CEP *", { exact: true }).focus(); assert.equal(await page.getByLabel("CEP *", { exact: true }).evaluate(el => el === document.activeElement), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (largura === 390) await page.screenshot({ path: "/tmp/porta-p29-condominios.png", fullPage: true });
});
