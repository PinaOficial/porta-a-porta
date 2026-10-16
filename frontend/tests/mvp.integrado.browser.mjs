// Build prévio + Vite/preview com as variáveis fictícias de FRONTEND_INFRA.md.
// Domínio: navegador -> HTTP Express real -> Prisma -> PostgreSQL local real.
// Somente Auth/JWKS e Storage são simulados; nenhuma chamada remota ao Supabase.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const conexao = new URL(process.env.ONBOARDING_TEST_DATABASE_URL || "http://ausente.invalid");
if (conexao.protocol !== "postgresql:" || !["127.0.0.1", "localhost"].includes(conexao.hostname) || conexao.pathname !== "/porta_onboarding_teste") {
  throw new Error("MVP integrado exige ONBOARDING_TEST_DATABASE_URL do banco local descartável porta_onboarding_teste.");
}
const origem = process.env.FRONTEND_TEST_URL || "http://127.0.0.1:5174";
if (!["127.0.0.1", "localhost"].includes(new URL(origem).hostname)) throw new Error("Frontend de teste deve ser local.");
process.env.DATABASE_URL = conexao.toString();
process.env.SUPABASE_URL = "http://auth.porta.test";
process.env.SUPABASE_SECRET_KEY = "chave-apenas-para-testes";
process.env.CORS_ORIGIN = origem;
const { prisma } = await import("../../backend/dist/lib/prisma.js");
const { supabaseAdmin } = await import("../../backend/dist/lib/supabase.js");
const { app } = await import("../../backend/dist/app.js");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");

test("MVP integrado: A–F, I, J e K atravessam navegador, API e PostgreSQL", { timeout: 180_000 }, async t => {
  const chaves = await generateKeyPair("ES256");
  const jwk = { ...await exportJWK(chaves.publicKey), kid: "mvp-local", alg: "ES256", use: "sig" };
  const fetchOriginal = globalThis.fetch;
  mock.method(globalThis, "fetch", async (...args) => String(args[0]) === "http://auth.porta.test/auth/v1/.well-known/jwks.json"
    ? Response.json({ keys: [jwk] }) : fetchOriginal(...args));
  const objetos = new Map();
  mock.method(supabaseAdmin.storage, "getBucket", async () => ({ data: { public: false }, error: null }));
  mock.method(supabaseAdmin.storage, "from", () => ({
    upload: async (path, buffer) => { objetos.set(path, buffer); return { data: { path }, error: null }; },
    remove: async paths => { paths.forEach(path => objetos.delete(path)); return { data: paths.map(name => ({ name })), error: null }; },
    createSignedUrls: async paths => ({ data: paths.map(path => ({ path, signedUrl: `http://auth.porta.test/storage/${path}?token=temporario-ficticio` })), error: null }),
  }));
  const servidor = createServer(app);
  let browser;
  t.after(async () => {
    await browser?.close(); servidor.closeAllConnections();
    await new Promise(resolve => servidor.close(resolve)); mock.restoreAll(); await prisma.$disconnect();
  });
  await new Promise(resolve => servidor.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  browser = await chromium.launch({ headless: true });
  const condominioX = randomUUID(), condominioY = randomUUID(), categoria = randomUUID();
  const tag = randomUUID().slice(0, 8);
  await prisma.condominio.createMany({ data: [
    { id_condominio: condominioX, nome_residencial: `MVP X ${tag}`, cep: "00000000", endereco: "Endereço fictício X" },
    { id_condominio: condominioY, nome_residencial: `MVP Y ${tag}`, cep: "00000000", endereco: "Endereço fictício Y" },
  ] });
  await prisma.categoria_produto.create({ data: { id_categoria: categoria, nome: `Alimentos MVP ${tag}` } });
  const contas = new Map();
  async function pessoa(nome, destino, administrador = false, superAdmin = false) {
    const conta = { id: randomUUID(), email: `${randomUUID()}@exemplo.test`, nome };
    contas.set(conta.email, conta);
    if (destino || superAdmin) {
      await prisma.usuario.create({ data: { id_usuario: conta.id, email: conta.email } });
      if (superAdmin) await prisma.super_admin.create({ data: { id_super_admin: conta.id } });
      else {
        await prisma.condomino.create({ data: { id_condomino: conta.id, nome_completo: nome, cpf: String(randomInt(0, 100_000_000_000)).padStart(11, "0"), data_nascimento: new Date("2000-01-01") } });
        conta.vinculo = await prisma.vinculo_condominio.create({ data: { id_condomino: conta.id, id_condominio: destino, status_vinculo: "ATIVO", admin_condominio: administrador, moradia: "Apto fictício 101" } });
      }
    }
    return conta;
  }
  const comprador = await pessoa(`Comprador MVP ${tag}`), vendedor = await pessoa("Vendedor MVP", condominioX);
  const adminX = await pessoa("Admin MVP X", condominioX, true), adminY = await pessoa("Admin MVP Y", condominioY, true);
  const terceiro = await pessoa("Terceiro MVP Y", condominioY), superAdmin = await pessoa("Super MVP", null, false, true);
  async function token(conta) {
    // Claims administrativas forjadas não autorizam: a API deve resolver o papel no banco.
    return new SignJWT({ email: conta.email, user_metadata: { super_admin: true, admin_condominio: true } })
      .setProtectedHeader({ alg: "ES256", kid: jwk.kid }).setSubject(conta.id)
      .setIssuer("http://auth.porta.test/auth/v1").setAudience("authenticated").setIssuedAt().setExpirationTime("1h").sign(chaves.privateKey);
  }
  async function sessao(conta) {
    return { access_token: await token(conta), refresh_token: `ficticio-${conta.id}`, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: conta.id, email: conta.email, aud: "authenticated", role: "authenticated", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, identities: [], created_at: "2026-10-16T12:00:00Z" } };
  }
  async function pagina(conta) {
    const contexto = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", timezoneId: "America/Sao_Paulo" });
    const page = await contexto.newPage(); page.setDefaultTimeout(10_000);
    const falhas = []; page.on("pageerror", erro => falhas.push(erro.message)); t.after(() => assert.deepEqual(falhas, []));
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" };
    await page.route("http://auth.porta.test/**", async route => {
      const req = route.request(), url = new URL(req.url());
      if (req.method() === "OPTIONS" || url.pathname.endsWith("/logout")) return route.fulfill({ status: 204, headers: cors });
      if (url.pathname.startsWith("/storage/")) {
        const buffer = objetos.get(decodeURIComponent(url.pathname.slice("/storage/".length)));
        return route.fulfill({ status: buffer ? 200 : 404, body: buffer, contentType: "image/png", headers: cors });
      }
      if (url.pathname.endsWith("/user")) return route.fulfill({ json: (await sessao(conta)).user, headers: cors });
      const dados = req.postDataJSON();
      const identidade = contas.get(dados.email) ?? (dados.refresh_token === `ficticio-${conta.id}` ? conta : null);
      if (!identidade || dados.password && dados.password !== "senha-ficticia") return route.fulfill({ status: 400, json: { code: "invalid_credentials", message: "Credenciais fictícias inválidas" }, headers: cors });
      return route.fulfill({ json: await sessao(identidade), headers: cors });
    });
    await page.route("http://api.porta.test/api/**", async route => {
      const url = new URL(route.request().url());
      const resposta = await route.fetch({ url: `${base}${url.pathname}${url.search}`, maxRedirects: 0 });
      await route.fulfill({ response: resposta });
    });
    await page.goto(`${origem}/login`);
    await page.getByLabel("E-mail", { exact: true }).fill(conta.email); await page.getByLabel("Senha", { exact: true }).fill("senha-ficticia");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.waitForURL(url => url.pathname !== "/login");
    return page;
  }
  async function api(conta, caminho, method = "GET", json) {
    return fetchOriginal(`${base}/api${caminho}`, { method, headers: { Authorization: `Bearer ${await token(conta)}`, ...(json === undefined ? {} : { "Content-Type": "application/json" }) }, ...(json === undefined ? {} : { body: JSON.stringify(json) }) });
  }
  async function erro(conta, caminho, status, codigo, method, json) {
    const resposta = await api(conta, caminho, method, json); assert.equal(resposta.status, status); assert.equal((await resposta.json()).erro, codigo);
  }
  // Prompt 29: novo condomínio, primeira residência e promoção pelo fluxo real.
  const cadastroPage = await pagina(superAdmin);
  await cadastroPage.getByRole("link", { name: "Consultar e cadastrar condomínios" }).click();
  await cadastroPage.reload();
  await cadastroPage.getByRole("button", { name: "Cadastrar condomínio", exact: true }).click();
  const nomeNovo = `Novo integrado ${tag}`;
  await cadastroPage.getByLabel("Nome do condomínio/residencial *", { exact: true }).fill(nomeNovo);
  await cadastroPage.getByLabel("CEP *", { exact: true }).fill("72000-000");
  await cadastroPage.getByLabel("Endereço completo *", { exact: true }).fill("Rua Fictícia, 29");
  await cadastroPage.getByRole("button", { name: "Salvar condomínio", exact: true }).click();
  await cadastroPage.getByText(`Condomínio cadastrado: ${nomeNovo}`, { exact: true }).waitFor();
  await cadastroPage.getByRole("article", { name: `Condomínio ${nomeNovo}`, exact: true }).waitFor();
  const novo = await prisma.condominio.findFirstOrThrow({ where: { nome_residencial: nomeNovo } });
  assert.equal(novo.cep, "72000000"); assert.equal(novo.ativo, true);
  assert.equal(await prisma.auditoria.count({ where: { acao: "CREATE_CONDOMINIUM", id_condominio: novo.id_condominio, id_ator: superAdmin.id } }), 1);
  assert.equal(await prisma.vinculo_condominio.count({ where: { id_condominio: novo.id_condominio } }), 0);
  const primeiro = await pessoa(`Primeiro morador ${tag}`), primeiroPage = await pagina(primeiro);
  await primeiroPage.getByLabel("Buscar condomínio").fill(nomeNovo);
  await primeiroPage.getByRole("radio", { name: new RegExp(nomeNovo) }).check();
  await primeiroPage.getByLabel("Nome completo").fill(primeiro.nome);
  await primeiroPage.getByLabel("CPF", { exact: true }).fill(String(randomInt(0, 100_000_000_000)).padStart(11, "0"));
  await primeiroPage.getByLabel("Data de nascimento").fill("2000-01-01");
  await primeiroPage.getByLabel("Sua moradia").fill("Apto 29");
  await primeiroPage.getByRole("button", { name: "Solicitar acesso ao condomínio", exact: true }).click();
  await primeiroPage.waitForURL("**/aguardando-aprovacao");
  const primeiroVinculo = await prisma.vinculo_condominio.findFirstOrThrow({ where: { id_condomino: primeiro.id } });
  assert.equal(primeiroVinculo.admin_condominio, false);
  await cadastroPage.goto(`${origem}/admin/vinculos/pendentes?busca=${encodeURIComponent(primeiro.nome)}`);
  cadastroPage.once("dialog", d => d.accept()); await cadastroPage.getByRole("button", { name: "Aprovar", exact: true }).click();
  await cadastroPage.getByRole("button", { name: "Aprovar", exact: true }).waitFor({ state: "detached" });
  assert.equal((await prisma.vinculo_condominio.findUniqueOrThrow({ where: { id_vinculo: primeiroVinculo.id_vinculo } })).admin_condominio, false);
  assert.equal((await api(superAdmin, `/admin/vinculos/${primeiroVinculo.id_vinculo}/admin`, "PATCH", { admin_condominio: true })).status, 200);
  await primeiroPage.getByRole("button", { name: "Atualizar status", exact: true }).click(); await primeiroPage.waitForURL("**/vitrine");
  await primeiroPage.goto(`${origem}/admin/condominios`); await primeiroPage.waitForURL("**/admin");
  assert.equal(await primeiroPage.getByRole("link", { name: "Consultar e cadastrar condomínios" }).count(), 0);
  await erro(primeiro, "/admin/condominios", 403, "FORBIDDEN", "POST", { nome_residencial: "Proibido", cep: "72000000", endereco: "Rua Fictícia" });
  t.diagnostic("P29: cadastro React/Express/PG + auditoria → catálogo/onboarding → primeiro aprovado sem admin prévio → promoção explícita → local recebe 403 e guard.");
  const compraPage = await pagina(comprador), vendaPage = await pagina(vendedor), adminPage = await pagina(adminX);
  await compraPage.getByLabel("Nome completo").fill(comprador.nome); await compraPage.getByLabel("CPF", { exact: true }).fill(String(randomInt(0, 100_000_000_000)).padStart(11, "0"));
  await compraPage.getByLabel("Data de nascimento").fill("2000-01-01"); await compraPage.getByLabel("Buscar condomínio").fill(`MVP X ${tag}`);
  await compraPage.getByRole("radio", { name: new RegExp(`MVP X ${tag}`) }).check(); await compraPage.getByLabel("Sua moradia").fill("Apto fictício 202");
  await compraPage.getByRole("button", { name: "Solicitar acesso ao condomínio", exact: true }).click(); await compraPage.waitForURL("**/aguardando-aprovacao");
  comprador.vinculo = await prisma.vinculo_condominio.findFirstOrThrow({ where: { id_condomino: comprador.id } }); assert.equal(comprador.vinculo.status_vinculo, "PENDENTE");
  await adminPage.goto(`${origem}/admin/vinculos/pendentes`); const fila = adminPage.getByRole("article", { name: `Vínculo de ${comprador.nome}`, exact: true });
  adminPage.once("dialog", d => d.accept()); await fila.getByRole("button", { name: "Aprovar", exact: true }).click(); await fila.waitFor({ state: "detached" });
  await compraPage.getByRole("button", { name: "Atualizar status", exact: true }).click(); await compraPage.waitForURL("**/vitrine");
  t.diagnostic("A: login → onboarding → PENDENTE → aprovação administrativa → ATIVO → vitrine, por HTTP real.");

  await vendaPage.goto(`${origem}/meus-produtos/novo`); await vendaPage.getByLabel("Categoria", { exact: true }).selectOption(categoria);
  await vendaPage.getByLabel("Nome do produto").fill("Bolo MVP integrado"); await vendaPage.getByLabel("Descrição", { exact: true }).fill("Produto inteiramente fictício para auditoria local.");
  await vendaPage.getByLabel("Preço (R$)").fill("25,90"); await vendaPage.getByLabel("Estoque", { exact: true }).fill("4");
  await vendaPage.getByRole("button", { name: "Publicar produto", exact: true }).click(); await vendaPage.waitForURL(/\/meus-produtos\/[^/]+\/editar$/);
  const idProduto = new URL(vendaPage.url()).pathname.split("/")[2];
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWn8AAAAASUVORK5CYII=", "base64");
  await vendaPage.getByLabel("Adicionar uma imagem").setInputFiles({ name: "teste.png", mimeType: "image/png", buffer: png });
  await vendaPage.getByRole("button", { name: "Enviar imagem", exact: true }).click(); await vendaPage.getByRole("button", { name: "Excluir imagem 1", exact: true }).waitFor();
  assert.equal(await prisma.produto_imagem.count({ where: { id_produto: idProduto } }), 1);
  await compraPage.getByLabel("Buscar produto").fill("Bolo MVP integrado"); await compraPage.getByRole("button", { name: "Buscar", exact: true }).click();
  await compraPage.getByRole("link", { name: /Bolo MVP integrado/ }).click(); await compraPage.waitForURL(`**/produtos/${idProduto}`);
  await compraPage.getByRole("img", { name: "Bolo MVP integrado", exact: true }).waitFor();
  await compraPage.getByLabel("Quantidade", { exact: true }).fill("2"); await compraPage.getByLabel("Data e hora combinada").fill("2099-01-01T19:00");
  await vendaPage.getByLabel("Preço (R$)").fill("30,00"); await vendaPage.getByRole("button", { name: "Salvar alterações", exact: true }).click(); await vendaPage.getByText("Alterações salvas.", { exact: true }).waitFor();
  await compraPage.getByRole("button", { name: "Confirmar pedido", exact: true }).click(); await compraPage.getByRole("heading", { name: "Pedido enviado ao vendedor", exact: true }).waitFor();
  const pedido = await prisma.pedido.findFirstOrThrow({ where: { id_produto: idProduto, id_vinculo_comprador: comprador.vinculo.id_vinculo } });
  assert.equal(pedido.valor_pedido.toFixed(2), "60.00"); assert.equal(pedido.status_pedido, "SOLICITADO");
  assert.equal((await prisma.produto.findUniqueOrThrow({ where: { id_produto: idProduto } })).estoque, 2);
  assert.equal(await prisma.conversa.count({ where: { id_pedido: pedido.id_pedido } }), 1);
  t.diagnostic("B/C: publicação → imagem → vitrine → detalhe → reserva; preço alterado após GET congelou o total real 60.00.");

  await vendaPage.goto(`${origem}/pedidos`); await vendaPage.getByRole("button", { name: "Aceitar", exact: true }).click(); await vendaPage.locator(".pedido-card .etiqueta").filter({ hasText: "Aceito" }).waitFor();
  await compraPage.getByRole("link", { name: "Ver meus pedidos", exact: true }).click(); await compraPage.getByRole("link", { name: "Conversar", exact: true }).click();
  await compraPage.getByLabel("Mensagem", { exact: true }).fill("Podemos combinar a entrega fictícia?"); await compraPage.getByRole("button", { name: "Enviar", exact: true }).click(); await compraPage.getByText("Podemos combinar a entrega fictícia?", { exact: true }).waitFor();
  vendaPage.once("dialog", d => d.accept()); await vendaPage.getByRole("button", { name: "Concluir", exact: true }).click(); await vendaPage.locator(".pedido-card .etiqueta").filter({ hasText: "Concluído" }).waitFor();
  assert.equal((await prisma.pedido.findUniqueOrThrow({ where: { id_pedido: pedido.id_pedido } })).status_pedido, "CONCLUIDO");
  t.diagnostic("D: vendedor aceita, comprador conversa e vendedor conclui; histórico e mensagem persistidos.");

  const criar = async () => { const res = await api(comprador, "/pedidos", "POST", { id_produto: idProduto, quantidade: 1, hora_combinada: "2099-01-01T22:00:00Z" }); assert.equal(res.status, 201); return (await res.json()).dados; };
  const cancelado = await criar(), recusado = await criar();
  await compraPage.goto(`${origem}/pedidos`); compraPage.once("dialog", d => d.accept()); await compraPage.locator(".pedido-card").filter({ hasText: cancelado.id_pedido }).getByRole("button", { name: "Cancelar", exact: true }).click();
  await compraPage.locator(".pedido-card").filter({ hasText: cancelado.id_pedido }).getByText("Cancelado", { exact: true }).first().waitFor();
  await vendaPage.reload(); vendaPage.once("dialog", d => d.accept()); await vendaPage.locator(".pedido-card").filter({ hasText: recusado.id_pedido }).getByRole("button", { name: "Recusar", exact: true }).click();
  await vendaPage.locator(".pedido-card").filter({ hasText: recusado.id_pedido }).getByText("Recusado", { exact: true }).first().waitFor();
  await erro(comprador, `/pedidos/${cancelado.id_pedido}/status`, 409, "INVALID_ORDER_TRANSITION", "PATCH", { status: "CANCELADO" });
  assert.equal((await prisma.produto.findUniqueOrThrow({ where: { id_produto: idProduto } })).estoque, 2);
  t.diagnostic("E: cancelamento e recusa pela UI restituem estoque uma vez; repetição HTTP retorna 409.");

  await erro(comprador, `/produtos?id_condominio=${condominioY}`, 403, "FORBIDDEN_CROSS_TENANT");
  await erro(comprador, `/produtos/${idProduto}`, 404, "PRODUCT_NOT_FOUND", "PATCH", { descricao: "Tentativa indevida" });
  await erro(adminX, `/admin/vinculos?id_condominio=${condominioY}`, 403, "FORBIDDEN_CROSS_TENANT");
  await erro(terceiro, `/pedidos/${pedido.id_pedido}/chat`, 404, "ORDER_NOT_FOUND");
  await erro(superAdmin, `/pedidos/${pedido.id_pedido}/chat/messages`, 403, "CHAT_SEND_FORBIDDEN", "POST", { conteudo: "Sem autoridade de participante" });
  await erro(superAdmin, `/pedidos/${pedido.id_pedido}/status`, 404, "ORDER_NOT_FOUND", "PATCH", { status: "CANCELADO" });
  t.diagnostic("I: API nega tenant alheio, ownership alheio, chat de terceiro e bypasses inexistentes de super, inclusive com claims forjadas.");

  const anuncioAntigoRes = await api(comprador, "/produtos", "POST", { id_categoria: categoria, nome_produto: "Anúncio antigo do comprador", descricao: "Fictício", preco: "10.00", estoque: 1 }); assert.equal(anuncioAntigoRes.status, 201);
  const anuncioAntigo = (await anuncioAntigoRes.json()).dados;
  await compraPage.goto(`${origem}/perfil/transferencia`); await compraPage.getByLabel("Buscar condomínio").fill(`MVP Y ${tag}`);
  await compraPage.getByRole("radio", { name: new RegExp(`MVP Y ${tag}`) }).check(); await compraPage.getByLabel("Nova moradia").fill("Apto fictício Y 303");
  await compraPage.getByRole("button", { name: "Enviar solicitação de transferência", exact: true }).click(); await compraPage.waitForURL("**/perfil"); await compraPage.getByText("Transferência solicitada — aguardando aprovação", { exact: true }).waitFor();
  assert.equal((await prisma.vinculo_condominio.findUniqueOrThrow({ where: { id_vinculo: comprador.vinculo.id_vinculo } })).status_vinculo, "ATIVO");
  const destinoPage = await pagina(adminY); await destinoPage.goto(`${origem}/admin/vinculos/pendentes`); const transferencia = destinoPage.getByRole("article", { name: `Vínculo de ${comprador.nome}`, exact: true });
  destinoPage.once("dialog", d => d.accept()); await transferencia.getByRole("button", { name: "Aprovar", exact: true }).click(); await transferencia.waitFor({ state: "detached" });
  await compraPage.getByRole("button", { name: "Atualizar perfil", exact: true }).click(); await compraPage.getByRole("heading", { name: "Residência atual", exact: true }).waitFor();
  const residencia = await prisma.vinculo_condominio.findFirstOrThrow({ where: { id_condomino: comprador.id, status_vinculo: "ATIVO" } }); assert.equal(residencia.id_condominio, condominioY); assert.equal(residencia.admin_condominio, false);
  const antigo = await prisma.produto.findUniqueOrThrow({ where: { id_produto: anuncioAntigo.id_produto } }); assert.equal(antigo.ativo, false); assert.equal(antigo.id_vinculo_vendedor, comprador.vinculo.id_vinculo);
  await compraPage.getByRole("link", { name: "Vitrine", exact: true }).click(); await compraPage.getByText("Ainda não há produtos por aqui", { exact: true }).waitFor();
  await compraPage.goto(`${origem}/pedidos`); await compraPage.locator(".pedido-card").filter({ hasText: pedido.id_pedido }).waitFor();
  t.diagnostic("F: solicitação preserva ATIVO; aprovação muda tenant, desativa anúncio antigo sem reescrever FK e mantém pedidos históricos.");

  const filtroComprador = encodeURIComponent(comprador.nome);
  const superPage = await pagina(superAdmin); await superPage.goto(`${origem}/admin/vinculos?busca=${filtroComprador}`);
  superPage.once("dialog", d => d.accept()); await superPage.getByRole("button", { name: "Suspender conta", exact: true }).first().click(); await superPage.getByText("Última alteração confirmada nesta sessão: conta SUSPENSA.", { exact: true }).first().waitFor();
  await compraPage.reload(); await compraPage.getByRole("heading", { name: "Conta suspensa", exact: true }).waitFor();
  superPage.once("dialog", d => d.accept()); await superPage.getByRole("button", { name: "Reativar conta", exact: true }).first().click(); await superPage.getByText("Última alteração confirmada nesta sessão: conta ATIVA.", { exact: true }).first().waitFor();
  assert.equal((await prisma.vinculo_condominio.findUniqueOrThrow({ where: { id_vinculo: residencia.id_vinculo } })).status_vinculo, "ATIVO");
  await compraPage.reload(); await compraPage.getByRole("heading", { name: "Meus Pedidos", exact: true }).waitFor();
  t.diagnostic("J: suspensão global bloqueia o mesmo usuário/token; reativação não modifica vínculo local.");

  await destinoPage.goto(`${origem}/admin/vinculos?busca=${filtroComprador}&status=ATIVO`); destinoPage.once("dialog", d => d.accept()); await destinoPage.getByRole("button", { name: "Suspender vínculo", exact: true }).click();
  await destinoPage.getByText("Nenhum vínculo para estes filtros", { exact: true }).waitFor(); await compraPage.reload();
  await compraPage.locator(".pedido-card").filter({ hasText: pedido.id_pedido }).getByRole("link", { name: "Conversar", exact: true }).click(); await compraPage.getByText("Podemos combinar a entrega fictícia?", { exact: true }).waitFor();
  await compraPage.getByLabel("Mensagem", { exact: true }).fill("Histórico preservado sem residência ativa."); await compraPage.getByRole("button", { name: "Enviar", exact: true }).click(); await compraPage.getByText("Histórico preservado sem residência ativa.", { exact: true }).waitFor();
  assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id_usuario: comprador.id } })).status_conta, "ATIVA");
  t.diagnostic("K: suspensão local preserva pedidos/chat próprios; pedido terminal não encerra conversa por inferência.");

  await vendaPage.goto(`${origem}/meus-produtos/${idProduto}/editar`); vendaPage.once("dialog", d => d.accept()); await vendaPage.getByRole("button", { name: "Excluir imagem 1", exact: true }).click();
  await vendaPage.getByText("Imagem excluída do anúncio.", { exact: true }).waitFor(); assert.equal(await prisma.produto_imagem.count({ where: { id_produto: idProduto } }), 0); assert.equal(objetos.size, 0);
  assert.ok(await prisma.produto.findUnique({ where: { id_produto: idProduto } }));
  t.diagnostic("Imagem: multipart validado pelo Express; exclusão real de registro retorna 204 e preserva produto, Storage simulado.");
});
