# Inventário e auditoria do backend

Auditoria de 16/10/2026 (Prompt 22). Fontes: código atual, Prisma introspectado, DDL existente e testes. O roteiro `.docx` é referência de domínio; não prova implementação.

## Descoberta e comparação

Rotas descobertas percorrendo a AST TypeScript de `app.use`, montagens de `apiRouter` e routers Express, incluindo `pedidoRoutes.use("/:id/chat", chatRoutes)` e `usuarioRoutes` sem prefixo próprio. Buscas `rg` confirmaram middlewares, controllers, schemas, chamadas de services/repositories, transações, respostas e testes. Não foram contados arquivos placeholder sem router registrado.

**Antes: 25 rotas. Depois: 27.** As 25 esperadas no Prompt 22 existem e estão **OK**. Nenhuma esperada ausente/parcial e nenhuma extra suspeita/legada. Duas leituras estavam ausentes para as telas de Produto e Perfil: foram implementadas como **ROTA EXTRA JUSTIFICADA**, `GET /api/produtos/:id` e `GET /api/usuarios/me`.

Por módulo de router: health 1; condomínios 1; usuários 2; vínculos 2; administração 7; categorias 1; produtos 8 (incluem 2 de imagens); pedidos 3; chat 2. Auditoria e histórico de pedido são persistência interna, sem rotas próprias.

## Rotas reais

JWT na tabela significa Bearer Supabase válido, inclusive bloqueio de conta global SUSPENSA. Erros comuns das rotas protegidas: 401 UNAUTHENTICATED, 403 ACCOUNT_SUSPENDED, 400 VALIDATION_ERROR quando há Zod e 500 INTERNAL_ERROR sanitizado. UUIDs, query/body e limites completos são detalhados no [handoff](FRONTEND_HANDOFF.md). Query “Ignorada” não autoriza campos nem fornece filtros; estes valores não chegam ao service. Health é exceção ao envelope de domínio.

| Método | Rota | Módulo | Objetivo | Autenticação | Autorização | Params | Query | Body | Sucesso | Resposta | Principais erros específicos | Tabelas/entidades | Transação? | Testes existentes | Situação |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | /api/health | routes | Saúde | Não | Pública | — | Ignorada | — | 200 | {status,projeto} | — | — | Não | [onboarding.integration.test.ts](../backend/tests/onboarding.integration.test.ts) | OK |
| GET | /api/condominios | condominios | Seleção ativa | JWT | JWT, inclusive pré-onboarding/super | — | busca≤160; pagina=1; limite=20≤50 | — | 200 | dados: Condominio[]; paginacao | VALIDATION_ERROR | condominio | RepeatableRead página/count | [condominio.test.ts](../backend/tests/condominio.test.ts); [onboarding.integration.test.ts](../backend/tests/onboarding.integration.test.ts) | OK |
| GET | /api/vinculos/me | vinculos | Estado residencial | JWT | JWT, inclusive histórico/super | — | Ignorada | — | 200 | dados: SituacaoResidencial | INTERNAL_ERROR em inconsistência | usuario,condomino,super_admin,vinculo_condominio,condominio | RepeatableRead | [vinculo.test.ts](../backend/tests/vinculo.test.ts); [vinculo.integration.test.ts](../backend/tests/vinculo.integration.test.ts); [aprovar-vinculo.integration.test.ts](../backend/tests/aprovar-vinculo.integration.test.ts) | OK |
| POST | /api/vinculos/transferencia | vinculos | Solicitar destino PENDENTE | JWT | Vínculo ATIVO | — | Ignorada | id_condominio:UUID,moradia:trim 1..80 | 201 | dados: ResultadoSolicitacaoTransferencia | MEMBERSHIP_REQUIRED, CONDOMINIUM_NOT_FOUND, CONDOMINIUM_INACTIVE, SAME_CONDOMINIUM, MEMBERSHIP_PENDING | condomino,vinculo_condominio,condominio | ReadCommitted + lock perfil/vínculo | [admin-vinculo.test.ts](../backend/tests/admin-vinculo.test.ts); [admin-vinculo.integration.test.ts](../backend/tests/admin-vinculo.integration.test.ts); [aprovar-vinculo.integration.test.ts](../backend/tests/aprovar-vinculo.integration.test.ts) | OK |
| GET | /api/admin/vinculos | administracao | Gestão de vínculos | JWT | Admin local do tenant ou super global | — | busca≤160,status enum,pagina=1,limite=20≤100,id_condominio | — | 200 | dados: VinculoAdmin[]; paginacao | FORBIDDEN, FORBIDDEN_CROSS_TENANT, VALIDATION_ERROR | vinculo_condominio,condomino,condominio | RepeatableRead página/count | [admin-vinculo.test.ts](../backend/tests/admin-vinculo.test.ts); [admin-vinculo.integration.test.ts](../backend/tests/admin-vinculo.integration.test.ts); [aprovar-vinculo.integration.test.ts](../backend/tests/aprovar-vinculo.integration.test.ts) | OK |
| PATCH | /api/admin/vinculos/:id/admin | administracao | Privilégio local | JWT | Admin local de outro vínculo no tenant ou super | id:UUID | Ignorada | admin_condominio:boolean | 200 | dados:{id_vinculo,admin_condominio,admin_atualizado_em} | MEMBERSHIP_NOT_FOUND, MEMBERSHIP_NOT_ACTIVE, SELF_ADMIN_CHANGE_FORBIDDEN, FORBIDDEN_CROSS_TENANT | vinculo_condominio,auditoria | ReadCommitted + mutex condomínio + locks; no-op sem audit | [admin-vinculo.test.ts](../backend/tests/admin-vinculo.test.ts); [admin-vinculo.integration.test.ts](../backend/tests/admin-vinculo.integration.test.ts); [aprovar-vinculo.integration.test.ts](../backend/tests/aprovar-vinculo.integration.test.ts) | OK |
| PATCH | /api/admin/usuarios/:id/status | administracao | Estado global da conta | JWT | Somente super admin | id:UUID | Ignorada | status_conta:ATIVA/SUSPENSA | 200 | dados:{id_usuario,status_conta} | FORBIDDEN, USER_NOT_FOUND | usuario,auditoria | ReadCommitted + FOR UPDATE; no-op sem audit | [admin-vinculo.test.ts](../backend/tests/admin-vinculo.test.ts); [admin-vinculo.integration.test.ts](../backend/tests/admin-vinculo.integration.test.ts); [aprovar-vinculo.integration.test.ts](../backend/tests/aprovar-vinculo.integration.test.ts) | OK |
| GET | /api/admin/vinculos/pendentes | administracao | Fila PENDENTE | JWT | Admin local do tenant ou super | — | busca≤160,pagina=1,limite=20≤100,id_condominio | — | 200 | dados: VinculoPendente[]; paginacao | FORBIDDEN, FORBIDDEN_CROSS_TENANT, VALIDATION_ERROR | vinculo_condominio,condomino,condominio | RepeatableRead página/count | [admin-vinculo.test.ts](../backend/tests/admin-vinculo.test.ts); [admin-vinculo.integration.test.ts](../backend/tests/admin-vinculo.integration.test.ts) | OK |
| PATCH | /api/admin/vinculos/:id/aprovar | administracao | Aprovar vínculo | JWT | Admin local do alvo/destino ou super | id:UUID | Ignorada | Não aceita body | 200 | dados: ResultadoAprovacaoVinculo | MEMBERSHIP_NOT_FOUND, FORBIDDEN_CROSS_TENANT, MEMBERSHIP_NOT_PENDING, ACTIVE_MEMBERSHIP_ALREADY_EXISTS, OPEN_ORDERS_BLOCK_TRANSFER, LAST_ACTIVE_ADMIN, SAME_CONDOMINIUM, CONDOMINIUM_INACTIVE | vinculo_condominio,condomino,condominio,auditoria,produto,pedido | ReadCommitted: status/auditoria; transferência + produtos/locks | [aprovar-vinculo.test.ts](../backend/tests/aprovar-vinculo.test.ts); [aprovar-vinculo.integration.test.ts](../backend/tests/aprovar-vinculo.integration.test.ts) | OK |
| PATCH | /api/admin/vinculos/:id/rejeitar | administracao | Rejeitar vínculo | JWT | Admin local do alvo/destino ou super | id:UUID | Ignorada | Não aceita body | 200 | dados: ResultadoRejeicaoVinculo | MEMBERSHIP_NOT_FOUND, FORBIDDEN_CROSS_TENANT, MEMBERSHIP_NOT_PENDING, MEMBERSHIP_INCONSISTENT | vinculo_condominio,condomino,condominio,auditoria | ReadCommitted: status/auditoria | [rejeitar-vinculo.test.ts](../backend/tests/rejeitar-vinculo.test.ts); [rejeitar-vinculo.integration.test.ts](../backend/tests/rejeitar-vinculo.integration.test.ts) | OK |
| PATCH | /api/admin/vinculos/:id/suspender | administracao | Suspender vínculo | JWT | Admin local do alvo/destino ou super | id:UUID | Ignorada | Não aceita body | 200 | dados: ResultadoSuspensaoVinculo | MEMBERSHIP_NOT_FOUND, FORBIDDEN_CROSS_TENANT, MEMBERSHIP_NOT_ACTIVE | vinculo_condominio,condomino,condominio,auditoria | ReadCommitted: status/auditoria | [suspender-vinculo.test.ts](../backend/tests/suspender-vinculo.test.ts); [suspender-vinculo.integration.test.ts](../backend/tests/suspender-vinculo.integration.test.ts) | OK |
| DELETE | /api/produtos/:id/imagens/:idImagem | produtos | Excluir objeto exato | JWT | Dono pelo vínculo ATIVO atual | id:UUID,idImagem:UUID | Estrita vazia | Não aceita body | 204 | Sem corpo | PRODUCT_NOT_FOUND, IMAGE_NOT_FOUND, IMAGE_DELETE_FAILED | produto,produto_imagem,Storage | Não distribuída; Storage antes do delete DB, retry/log | [imagem-produto.test.ts](../backend/tests/imagem-produto.test.ts); [imagem-produto.integration.test.ts](../backend/tests/imagem-produto.integration.test.ts) | OK |
| POST | /api/produtos/:id/imagens | produtos | Upload privado | JWT | Dono pelo vínculo ATIVO atual | id:UUID | Ignorada | multipart: imagem única JPEG/PNG/WEBP≤5 MiB | 201 | dados:{id_imagem,id_produto,ordem,created_at} | PRODUCT_NOT_FOUND, IMAGE_REQUIRED, IMAGE_TYPE_NOT_ALLOWED, IMAGE_TOO_LARGE, IMAGE_ORDER_EXHAUSTED, IMAGE_UPLOAD_FAILED, IMAGE_PERSISTENCE_FAILED | produto,produto_imagem,Storage | Não distribuída; upload + insert + compensação | [imagem-produto.test.ts](../backend/tests/imagem-produto.test.ts); [imagem-produto.integration.test.ts](../backend/tests/imagem-produto.integration.test.ts) | OK |
| GET | /api/produtos/me | produtos | Gerir ativos e inativos próprios | JWT | Vínculo ATIVO atual, ownership | — | busca≤140,id_categoria,ativo=true/false,pagina=1,limite=20≤100 | — | 200 | dados: MeuProduto[]; paginacao | MEMBERSHIP_REQUIRED, VALIDATION_ERROR | produto,categoria_produto,produto_imagem,Storage | RepeatableRead página/count | [meus-produtos.test.ts](../backend/tests/meus-produtos.test.ts); [meus-produtos.integration.test.ts](../backend/tests/meus-produtos.integration.test.ts) | OK |
| GET | /api/produtos/:id | produtos | Detalhe recarregável por ID | JWT | Vitrine do tenant; próprio ATIVO admite item/categoria inativos; super seleciona condomínio | id:UUID | id_condominio opcional; obrigatório para super | — | 200 | dados: DetalheProduto | PRODUCT_NOT_FOUND, CONDOMINIUM_REQUIRED, CONDOMINIO_NOT_FOUND, FORBIDDEN_CROSS_TENANT, MEMBERSHIP_REQUIRED | produto,categoria_produto,vinculo_condominio,condomino,produto_imagem,Storage | Uma query relacional + assinatura externa | [produto.integration.test.ts](../backend/tests/produto.integration.test.ts); [imagem-produto.integration.test.ts](../backend/tests/imagem-produto.integration.test.ts) | ROTA EXTRA JUSTIFICADA |
| GET | /api/produtos | produtos | Vitrine do condomínio | JWT | ATIVO no tenant; super escolhe condomínio ativo | — | busca≤140,id_categoria/categoria,id_condominio,pagina=1,limite=20≤100 | — | 200 | dados: ProdutoVitrine[]; paginacao | MEMBERSHIP_REQUIRED, CONDOMINIUM_REQUIRED, CONDOMINIO_NOT_FOUND, FORBIDDEN_CROSS_TENANT | produto,categoria_produto,vinculo_condominio,condomino,produto_imagem,Storage | RepeatableRead página/count; assinatura externa | [produto.test.ts](../backend/tests/produto.test.ts); [produto.integration.test.ts](../backend/tests/produto.integration.test.ts) | OK |
| POST | /api/produtos | produtos | Publicar produto | JWT | Vínculo ATIVO atual | — | Ignorada | id_categoria,nome_produto,descricao,preco:string,estoque:int | 201 | dados: ProdutoCriado | CATEGORY_NOT_FOUND, CATEGORY_INACTIVE, MEMBERSHIP_REQUIRED | produto,categoria_produto,vinculo_condominio | ReadCommitted + FOR SHARE vínculo | [criar-produto.test.ts](../backend/tests/criar-produto.test.ts); [criar-produto.integration.test.ts](../backend/tests/criar-produto.integration.test.ts); [aprovar-vinculo.integration.test.ts](../backend/tests/aprovar-vinculo.integration.test.ts) | OK |
| PATCH | /api/produtos/:id/status | produtos | Ativar/desativar produto | JWT | Dono pelo vínculo ATIVO atual | id:UUID | Ignorada | ativo:boolean | 200 | dados: ProdutoEditado | PRODUCT_NOT_FOUND, CATEGORY_NOT_FOUND, CATEGORY_INACTIVE, MEMBERSHIP_REQUIRED | produto,categoria_produto,vinculo_condominio | ReadCommitted + FOR SHARE vínculo | [status-produto.test.ts](../backend/tests/status-produto.test.ts); [status-produto.integration.test.ts](../backend/tests/status-produto.integration.test.ts); [aprovar-vinculo.integration.test.ts](../backend/tests/aprovar-vinculo.integration.test.ts) | OK |
| PATCH | /api/produtos/:id | produtos | Editar subconjunto não vazio | JWT | Dono pelo vínculo ATIVO atual | id:UUID | Ignorada | campos de criação opcionais; ao menos um | 200 | dados: ProdutoEditado | PRODUCT_NOT_FOUND, CATEGORY_NOT_FOUND, CATEGORY_INACTIVE, MEMBERSHIP_REQUIRED | produto,categoria_produto,vinculo_condominio | ReadCommitted + FOR SHARE vínculo | [editar-produto.test.ts](../backend/tests/editar-produto.test.ts); [editar-produto.integration.test.ts](../backend/tests/editar-produto.integration.test.ts); [aprovar-vinculo.integration.test.ts](../backend/tests/aprovar-vinculo.integration.test.ts) | ROTA EXTRA JUSTIFICADA |
| GET | /api/pedidos/me | pedidos | Compras/vendas históricas | JWT | Perfil condômino; todos vínculos próprios, sem exigir ATIVO | — | papel=compra/venda,status enum,pagina=1,limite=20≤100 | — | 200 | dados: MeuPedido[]; paginacao | CONDOMINO_PROFILE_REQUIRED | condomino,vinculo_condominio,condominio,produto,pedido,pedido_status_historico,conversa | RepeatableRead inclusive perfil/vínculos | [pedido.test.ts](../backend/tests/pedido.test.ts); [pedido.integration.test.ts](../backend/tests/pedido.integration.test.ts) | OK |
| POST | /api/pedidos | pedidos | Solicitar com reserva | JWT | Comprador ATIVO, vendedor ATIVO, mesmo condomínio; não próprio | — | Ignorada | id_produto:UUID,quantidade:int>0,hora_combinada:ISO offset | 201 | dados: PedidoCriado | PRODUCT_NOT_FOUND, FORBIDDEN_CROSS_TENANT, CANNOT_BUY_OWN_PRODUCT, PRODUCT_UNAVAILABLE, INSUFFICIENT_STOCK, INVALID_SCHEDULE_TIME, ORDER_VALUE_OUT_OF_RANGE | vinculo_condominio,produto,pedido,pedido_status_historico,conversa,conversa_participante | ReadCommitted + FOR SHARE vínculos + estoque condicional | [pedido.test.ts](../backend/tests/pedido.test.ts); [pedido.integration.test.ts](../backend/tests/pedido.integration.test.ts) | OK |
| PATCH | /api/pedidos/:id/status | pedidos | Transição da matriz | JWT | Comprador/vendedor históricos conforme destino; sem bypass admin | id:UUID | Ignorada | status:ACEITO/RECUSADO/CANCELADO/CONCLUIDO,motivo?:trim≤255 | 200 | dados:{id_pedido,status_pedido,ultima_atualizacao} | ORDER_NOT_FOUND, ORDER_STATUS_FORBIDDEN, INVALID_ORDER_TRANSITION | pedido,produto,vinculo_condominio,pedido_status_historico | ReadCommitted + status condicional + estoque/histórico | [pedido.test.ts](../backend/tests/pedido.test.ts); [pedido.integration.test.ts](../backend/tests/pedido.integration.test.ts) | OK |
| GET | /api/pedidos/:id/chat | chat | Mensagens cronológicas | JWT | Partes históricas ou super; terceiro/admin local alheio negados | id:UUID | pagina=1,limite=50≤100 | — | 200 | dados: Mensagem[]; paginacao; conversa; pedido | ORDER_NOT_FOUND, CHAT_NOT_FOUND | pedido,produto,vinculo_condominio,conversa,mensagem,usuario,condomino | RepeatableRead; não atualiza leitura | [pedido.test.ts](../backend/tests/pedido.test.ts); [pedido.integration.test.ts](../backend/tests/pedido.integration.test.ts) | OK |
| POST | /api/pedidos/:id/chat/messages | chat | Enviar mensagem | JWT | Somente comprador/vendedor históricos; conversa ATIVA | id:UUID | Ignorada | conteudo:string trim 1..1000 | 201 | dados: Mensagem | ORDER_NOT_FOUND, CHAT_NOT_FOUND, CHAT_CLOSED, CHAT_SEND_FORBIDDEN | pedido,produto,vinculo_condominio,conversa,mensagem,usuario,condomino | ReadCommitted + FOR SHARE conversa + insert | [pedido.test.ts](../backend/tests/pedido.test.ts); [pedido.integration.test.ts](../backend/tests/pedido.integration.test.ts) | OK |
| GET | /api/categorias | categorias | Categorias ativas | JWT | Vínculo ATIVO ou super | — | Ignorada | — | 200 | dados:[{id_categoria,nome}] | MEMBERSHIP_REQUIRED | categoria_produto | Não | [categoria.test.ts](../backend/tests/categoria.test.ts); [categoria.integration.test.ts](../backend/tests/categoria.integration.test.ts) | OK |
| POST | /api/onboarding | usuarios | Identidade e primeira residência | JWT | JWT, sem usuário prévio; não super | — | Ignorada | nome_completo,cpf,data_nascimento,id_condominio,moradia | 201 | dados: ResultadoOnboarding | ONBOARDING_ALREADY_COMPLETED, CPF_ALREADY_REGISTERED, EMAIL_ALREADY_REGISTERED, AUTH_EMAIL_REQUIRED, SUPER_ADMIN_CANNOT_ONBOARD, CONDOMINIO_NOT_FOUND | usuario,condomino,vinculo_condominio,condominio | Sim: três inserts | [onboarding.test.ts](../backend/tests/onboarding.test.ts); [onboarding.integration.test.ts](../backend/tests/onboarding.integration.test.ts); [aprovar-vinculo.integration.test.ts](../backend/tests/aprovar-vinculo.integration.test.ts) | OK |
| GET | /api/usuarios/me | usuarios | Identidade/nome próprios | JWT | JWT, inclusive sem residência | — | Estrita vazia | — | 200 | dados: MeuUsuario | VALIDATION_ERROR | usuario,condomino,super_admin | Não; uma leitura | [aprovar-vinculo.integration.test.ts](../backend/tests/aprovar-vinculo.integration.test.ts) | ROTA EXTRA JUSTIFICADA |

## Rastreabilidade de implementação

Arquivos abaixo são relativos à raiz. Os nomes de schemas/middlewares são extraídos das chamadas de router; controller e route são resolvidos por imports. Services/repositories foram conferidos no corpo das funções, incluindo helpers compartilhados. Repositories pertencem ao mesmo módulo do service, salvo indicação explícita.

| Rota | Route e linha | Middlewares/schemas | Controller | Service | Repositories/helpers |
| --- | --- | --- | --- | --- | --- |
| GET /api/health | [index.ts](../backend/src/routes/index.ts#L12) | — | inline: health | handler inline | — |
| GET /api/condominios | [condominio.routes.ts](../backend/src/modules/condominios/condominio.routes.ts#L9) | autenticar; validarQuery(listarCondominiosQuerySchema) | [listarCondominiosController](../backend/src/modules/condominios/condominio.controller.ts) | listarCondominiosDisponiveis | listarCondominiosAtivos |
| GET /api/vinculos/me | [vinculo.routes.ts](../backend/src/modules/vinculos/vinculo.routes.ts#L10) | autenticar | [consultarMeuVinculoController](../backend/src/modules/vinculos/vinculo.controller.ts) | consultarMinhaSituacaoResidencial | buscarSituacaoResidencialDoUsuario |
| POST /api/vinculos/transferencia | [vinculo.routes.ts](../backend/src/modules/vinculos/vinculo.routes.ts#L11) | autenticar; exigirVinculoAtivo(); validarBody(solicitarTransferenciaBodySchema) | [solicitarTransferenciaController](../backend/src/modules/vinculos/vinculo.controller.ts) | solicitarTransferencia | vinculo.repository + buscarCondominioParaTransferencia + buscarVinculoBloqueadoParaPedido |
| GET /api/admin/vinculos | [administracao.routes.ts](../backend/src/modules/administracao/administracao.routes.ts#L13) | autenticar; exigirAdmin(); validarSemBody; validarQuery(listarVinculosQuerySchema) | [listarVinculosAdminController](../backend/src/modules/administracao/administracao.controller.ts) | listarVinculosAdmin | listarVinculosAdministrativos |
| PATCH /api/admin/vinculos/:id/admin | [administracao.routes.ts](../backend/src/modules/administracao/administracao.routes.ts#L14) | autenticar; exigirAdmin(); validarParams(decisaoVinculoParamsSchema); validarBody(atualizarAdminVinculoBodySchema) | [alterarAdminVinculoController](../backend/src/modules/administracao/administracao.controller.ts) | alterarAdminVinculo | vinculo.repository + criarAuditoria |
| PATCH /api/admin/usuarios/:id/status | [administracao.routes.ts](../backend/src/modules/administracao/administracao.routes.ts#L15) | autenticar; exigirSuperAdmin(); validarParams(decisaoVinculoParamsSchema); validarBody(atualizarStatusContaBodySchema) | [alterarStatusContaController](../backend/src/modules/administracao/administracao.controller.ts) | alterarStatusConta (usuarios) | usuario.repository + criarAuditoria |
| GET /api/admin/vinculos/pendentes | [administracao.routes.ts](../backend/src/modules/administracao/administracao.routes.ts#L17) | autenticar; exigirAdmin(); validarQuery(listarVinculosPendentesQuerySchema) | [listarVinculosPendentesController](../backend/src/modules/vinculos/vinculo.controller.ts) | listarVinculosPendentes | buscarVinculosPendentes |
| PATCH /api/admin/vinculos/:id/aprovar | [administracao.routes.ts](../backend/src/modules/administracao/administracao.routes.ts#L25) | autenticar; exigirAdmin(); validarParams(decisaoVinculoParamsSchema); validarSemBody | [aprovarVinculoController](../backend/src/modules/vinculos/vinculo.controller.ts) | aprovarVinculo | vinculo.repository + criarAuditoria + produto/pedido.repository |
| PATCH /api/admin/vinculos/:id/rejeitar | [administracao.routes.ts](../backend/src/modules/administracao/administracao.routes.ts#L34) | autenticar; exigirAdmin(); validarParams(decisaoVinculoParamsSchema); validarSemBody | [rejeitarVinculoController](../backend/src/modules/vinculos/vinculo.controller.ts) | rejeitarVinculo | vinculo.repository + criarAuditoria |
| PATCH /api/admin/vinculos/:id/suspender | [administracao.routes.ts](../backend/src/modules/administracao/administracao.routes.ts#L43) | autenticar; exigirAdmin(); validarParams(decisaoVinculoParamsSchema); validarSemBody | [suspenderVinculoController](../backend/src/modules/vinculos/vinculo.controller.ts) | suspenderVinculo | vinculo.repository + criarAuditoria |
| DELETE /api/produtos/:id/imagens/:idImagem | [produto.routes.ts](../backend/src/modules/produtos/produto.routes.ts#L13) | autenticar; exigirVinculoAtivo(); validarParams(excluirImagemProdutoParamsSchema); validarSemBody; validarQuery(excluirImagemProdutoQuerySchema) | [excluirImagemProdutoController](../backend/src/modules/produtos/produto.controller.ts) | excluirImagemProduto | buscarImagemDoProduto + excluirRegistroImagemProduto + storage.ts |
| POST /api/produtos/:id/imagens | [produto.routes.ts](../backend/src/modules/produtos/produto.routes.ts#L18) | autenticar; exigirVinculoAtivo(); validarParams(produtoParamsSchema); uploadImagemProduto | [adicionarImagemProdutoController](../backend/src/modules/produtos/produto.controller.ts) | adicionarImagemProduto | buscarProdutoDoVinculo + buscarMaiorOrdemImagem + criarImagemProduto + storage.ts |
| GET /api/produtos/me | [produto.routes.ts](../backend/src/modules/produtos/produto.routes.ts#L23) | autenticar; exigirVinculoAtivo(); validarSemBody; validarQuery(listarMeusProdutosQuerySchema) | [listarMeusProdutosController](../backend/src/modules/produtos/produto.controller.ts) | listarMeusProdutos | listarProdutosDoVinculo + assinarImagensProdutos |
| GET /api/produtos/:id | [produto.routes.ts](../backend/src/modules/produtos/produto.routes.ts#L24) | autenticar; validarParams(produtoParamsSchema); validarSemBody; validarQuery(detalheProdutoQuerySchema) | [detalharProdutoController](../backend/src/modules/produtos/produto.controller.ts) | detalharProduto | buscarDetalheProduto + assinarImagensProdutos |
| GET /api/produtos | [produto.routes.ts](../backend/src/modules/produtos/produto.routes.ts#L25) | autenticar; validarQuery(listarProdutosQuerySchema) | [listarProdutosController](../backend/src/modules/produtos/produto.controller.ts) | listarVitrineProdutos | listarProdutosDoCondominio + assinarImagensProdutos |
| POST /api/produtos | [produto.routes.ts](../backend/src/modules/produtos/produto.routes.ts#L26) | autenticar; exigirVinculoAtivo(); validarBody(criarProdutoBodySchema) | [cadastrarProdutoController](../backend/src/modules/produtos/produto.controller.ts) | cadastrarProduto | criarProduto + buscarCategoriaPorId + buscarVinculoBloqueadoParaPedido |
| PATCH /api/produtos/:id/status | [produto.routes.ts](../backend/src/modules/produtos/produto.routes.ts#L27) | autenticar; exigirVinculoAtivo(); validarParams(produtoParamsSchema); validarBody(alterarStatusProdutoBodySchema) | [alterarStatusProdutoController](../backend/src/modules/produtos/produto.controller.ts) | alterarStatusProduto | buscarProdutoDoVinculo + atualizarStatusProdutoDoVinculo + buscarCategoriaPorId + buscarVinculoBloqueadoParaPedido |
| PATCH /api/produtos/:id | [produto.routes.ts](../backend/src/modules/produtos/produto.routes.ts#L31) | autenticar; exigirVinculoAtivo(); validarParams(produtoParamsSchema); validarBody(editarProdutoBodySchema) | [editarProdutoController](../backend/src/modules/produtos/produto.controller.ts) | editarProduto | buscarProdutoDoVinculo + atualizarProdutoDoVinculo + buscarCategoriaPorId + buscarVinculoBloqueadoParaPedido |
| GET /api/pedidos/me | [pedido.routes.ts](../backend/src/modules/pedidos/pedido.routes.ts#L10) | autenticar; validarSemBody; validarQuery(listarMeusPedidosQuerySchema) | [listarMeusPedidosController](../backend/src/modules/pedidos/pedido.controller.ts) | listarMeusPedidos | buscarPerfilParaHistoricoPedidos + buscarVinculosDoHistoricoPedidos + listarPedidosDosVinculos |
| POST /api/pedidos | [pedido.routes.ts](../backend/src/modules/pedidos/pedido.routes.ts#L11) | autenticar; exigirVinculoAtivo(); validarBody(criarPedidoBodySchema) | [criarPedidoController](../backend/src/modules/pedidos/pedido.controller.ts) | criarPedido | pedido.repository + criarConversaDoPedido + criarParticipantesDoPedido |
| PATCH /api/pedidos/:id/status | [pedido.routes.ts](../backend/src/modules/pedidos/pedido.routes.ts#L12) | autenticar; validarParams(pedidoParamsSchema); validarBody(atualizarStatusPedidoBodySchema) | [atualizarStatusPedidoController](../backend/src/modules/pedidos/pedido.controller.ts) | atualizarStatusPedido | buscarPedidoDaNegociacao + atualizarStatusPedidoCondicional + devolverEstoquePedido + criarHistoricoTransicaoPedido |
| GET /api/pedidos/:id/chat | [chat.routes.ts](../backend/src/modules/chat/chat.routes.ts#L9) | autenticar; validarParams(pedidoParamsSchema); validarSemBody; validarQuery(listarMensagensQuerySchema) | [listarChatDoPedidoController](../backend/src/modules/chat/chat.controller.ts) | listarChatDoPedido | buscarPedidoDaNegociacao + buscarConversaDoPedido + listarMensagensDaConversa |
| POST /api/pedidos/:id/chat/messages | [chat.routes.ts](../backend/src/modules/chat/chat.routes.ts#L10) | autenticar; validarParams(pedidoParamsSchema); validarBody(criarMensagemBodySchema) | [enviarMensagemDoPedidoController](../backend/src/modules/chat/chat.controller.ts) | enviarMensagemDoPedido | buscarPedidoDaNegociacao + buscarConversaBloqueadaDoPedido + inserirMensagem |
| GET /api/categorias | [categoria.routes.ts](../backend/src/modules/categorias/categoria.routes.ts#L7) | autenticar | [listarCategoriasController](../backend/src/modules/categorias/categoria.controller.ts) | listarCategoriasDaVitrine | listarCategoriasAtivas |
| POST /api/onboarding | [usuario.routes.ts](../backend/src/modules/usuarios/usuario.routes.ts#L11) | autenticar; validarBody(onboardingBodySchema) | [realizarOnboardingController](../backend/src/modules/usuarios/usuario.controller.ts) | realizarOnboarding | usuario.repository + criarVinculoPendenteDoOnboarding |
| GET /api/usuarios/me | [usuario.routes.ts](../backend/src/modules/usuarios/usuario.routes.ts#L12) | autenticar; validarSemBody; validarQuery(consultarMeuUsuarioQuerySchema) | [consultarMeuUsuarioController](../backend/src/modules/usuarios/usuario.controller.ts) | consultarMeuUsuario | buscarMeuUsuario |

## Autenticação

`autenticar.ts` extrai um único Bearer, usa `jose.jwtVerify`/JWKS de `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`, aceita ES256/RS256, confere issuer `<SUPABASE_URL>/auth/v1`, audience `authenticated`, assinatura, expiração e `sub` UUID. Claims `sub`, `exp`, `iss`, `aud` são obrigatórias. Privilégios enviados em claims de aplicação/user_metadata não concedem acesso administrativo.

O backend busca `usuario` pela identidade. Antes do onboarding, usuário de domínio ausente é permitido nas rotas adequadas; conta existente SUSPENSA bloqueia todas as protegidas. `super_admin` vem da tabela, e somente para não-super se resolve o vínculo ATIVO. O contexto real em `types/auth.ts` é:

```ts
req.auth = {
  id_usuario: "<UUID_AUTH>",
  email: "<EMAIL_VALIDO_DA_CLAIM>", // opcional, normalizado; usado no onboarding
  super_admin: false,
  vinculo_ativo: { // opcional; ausente para super admin/sem ATIVO
    id_vinculo: "<UUID_VINCULO>",
    id_condominio: "<UUID_CONDOMINIO>",
    admin_condominio: false,
  },
};
```

Vínculo ATIVO é exigido para categorias (exceto super), vitrine/detalhe (super escolhe condomínio), produtos próprios/imagens, criação de pedido e solicitação de transferência. Histórico próprio de pedidos, transições e chat usam os vínculos da negociação e continuam disponíveis sem ATIVO. `/usuarios/me`, `/vinculos/me` e seleção de condomínios aceitam JWT sem residência. Super não recebe automaticamente autoridade de comprador/vendedor nem vínculo para publicar/comprar. Não existe endpoint público para criar super admin.

Conta global e vínculo são separados: suspender conta só altera usuário; suspender vínculo só altera status local. Reativação global não reativa residência. JWT continua tecnicamente válido, mas o banco bloqueia o acesso da conta suspensa. Testes verificam o mesmo token antes/depois.

## Condomínios/Onboarding

Condomínios ativos são paginados no banco, por nome/UUID, com busca opcional; retorno inclui ID, nome, CEP e endereço. `POST /onboarding` cria `usuario`, `condomino` e PENDENTE na mesma transação. O UUID da claim `sub` é usado nos dois perfis e no vínculo, sem armazenar senha. E-mail vem da claim validada, normalizado, não do body. CPF é reduzido a 11 dígitos e protegido por unicidade; **não há cálculo de dígitos verificadores**. Nascimento exige data ISO existente, sem regra etária adicional inventada. Nome/moradia têm trim e limites 160/80. Constraints reais de e-mail case-insensitive, CPF e identidade são mapeadas inclusive em concorrência. A API não retorna CPF/nascimento.

## Vínculos

`/vinculos/me` retorna `onboarding_realizado`, `super_admin`, `vinculo_ativo`, `solicitacao_pendente`, `ultimo_vinculo`. Cada vínculo expõe ID, estado, moradia, flag de admin, datas ISO/null e condomínio com ID/nome/CEP/endereço. `ultimo_vinculo` é preenchido somente quando não há ATIVO nem PENDENTE; não equivale à lista de todos os vínculos. Para super admin, os três campos residenciais são null. Perfis inconsistentes geram erro interno sanitizado.

A tabela de vínculos é consultada diretamente. O Prisma introspectado representa `condomino.vinculo_condominio` como singular por causa de um índice parcial; essa relação não representa todos os vínculos históricos. DDL mantém no máximo um ATIVO e um PENDENTE por pessoa.

Transferência cria ATIVO + PENDENTE, sem desativar nada na solicitação. Aprovação exige autoridade no destino, verifica SOLICITADO/ACEITO como comprador/vendedor e último admin da origem. Super pode intervir no último admin, mas não ignora pedidos abertos. Produtos antigos ficam inativos e com o vendedor original, vínculo antigo ENCERRADO e novo ATIVO/admin=false, com datas e auditoria atômicas.

A aprovação mantém `FOR UPDATE` no antigo antes da busca de pedidos. Criação de pedido e gravações de produto mantêm `FOR SHARE` no vínculo; se vencem primeiro, a transferência aguarda e vê o resultado; se perdem, revalidam ENCERRADO. Mutex transacional por condomínio, adquirido em ordem fixa, serializa transferências/privilégios. A solicitação serializa por perfil para evitar PENDENTE duplicado. Testes exercitam ambos os lados das corridas e rollback.

## Administração

Listagens administrativas derivam tenant do vínculo ATIVO do admin local; filtro de outro condomínio retorna 403. Super pode omitir condomínio para visão global. Fila retorna apenas PENDENTE. Listagem geral aceita todos os estados reais e contém flag de admin/data de início. Ambas buscam nome/moradia, com seleção relacional explícita e sem CPF/e-mail/nascimento.

Aprovação/rejeição/suspensão têm atualização condicional e auditoria na mesma transação. Rejeição exige solicitação consistente e não encerra outro vínculo ATIVO. Suspensão não encerra vínculo, não altera conta/produtos/pedidos e preserva a flag histórica; por contrato existente pode incluir o próprio único admin, que perde autoridade nas próximas requisições. Não se confundiu essa regra com o bloqueio de encerramento por transferência.

Privilégio local exige alvo ATIVO; admin local só altera outro vínculo do próprio tenant. Ator é revalidado após esperar mutex; alvo fica bloqueado até o commit. Mudanças reais gravam ator/data e auditam; chamadas idempotentes não alteram timestamp nem duplicam auditoria. Super controla o status global da conta com lock de usuário e auditoria, sem mexer no Supabase Auth.

## Categorias

Somente categorias ativas, `id_categoria`/`nome`, ordenadas por nome, sem paginação. Exige ATIVO ou super. Publicação, troca explícita de categoria e ativação validam categoria ativa. Edição que omite categoria e desativação continuam permitidas com categoria inativa. A inativação de categoria não apaga produtos/histórico. Criação de pedido não adiciona bloqueio por categoria inativa além do contrato existente de produto/vínculo ativos.

## Produtos

Relações verificadas: `produto.id_vinculo_vendedor → vinculo_condominio → condomino → usuario`, e vínculo → condomínio histórico; produto → categoria e imagens. Não há tabela loja. Vitrine filtra produto/categoria ativos, vendedor ATIVO e tenant autorizado. Estoque zero é visível. Super precisa selecionar um condomínio ativo. Busca/filtro/paginação são SQL, com desempate por UUID.

Gestão própria sempre usa o **vínculo ATIVO atual**, inclusive ao ter outros vínculos históricos. Produto nunca troca vendedor. Preço é validado como string decimal positiva compatível com NUMERIC(12,2), convertido a `Prisma.Decimal` e serializado com duas casas. Estoque é INTEGER não negativo. Edição parcial rejeita body vazio/campos de autoridade.

Novo detalhe por ID elimina varredura de páginas para recarregar Produto/Editar. O filtro SQL inclui tenant e vendedor ATIVO: produto público exige categoria/produto ativos; somente o dono pelo vínculo atual pode ver seu inativo/categoria inativa. Super segue a seleção de condomínio da vitrine, sem acesso extra a inativos por essa leitura. Não há leitura livre de produto histórico de outro condomínio; seus dados textuais continuam no pedido.

Correção de concorrência: criar/editar/ativar/desativar produto agora revalida identidade e estado do vínculo com `FOR SHARE` dentro da transação da gravação. Impede terminar publicação/reativação num vínculo já encerrado ou anular a desativação da transferência. Categorias continuam com a validação de contrato existente; não se criou administração de categorias nesta etapa.

## Imagens/Storage

Bucket esperado `product-images`, privado. O backend verifica a privacidade nas operações; esta auditoria não leu configuração remota. Upload autentica e verifica dono antes de acessar Storage, aceita uma parte `imagem`, JPEG/PNG/WEBP, até 5 MiB exatos, com assinatura básica de bytes compatível. Não é decodificação completa/moderação. Nome original é ignorado: path `produtos/<id>/<UUID>.<ext>`, `upsert=false`. Ordem é maior ordem+1, limitada por SMALLINT; não há limite artificial de quantidade.

Banco persiste apenas `storage_path` interno. Upload responde ID/ordem/data, sem path. Vitrine, próprios e detalhe geram URLs temporárias em lote, TTL **600 segundos**; URLs não são persistidas. Falha operacional de assinatura omite imagens indisponíveis sem derrubar os produtos nem reparar DB em GET; exceção inesperada passa pelo erro interno sanitizado.

Storage/PostgreSQL não formam transação distribuída. Upload que falha ao inserir no DB tenta remover objeto e registra falha de compensação sem devolver erro bruto do provedor. Delete verifica produto+imagem, remove **somente** o path encontrado no DB e então apaga o registro; falha DB preserva registro para retry e é logada. Objeto já ausente explícito é tolerado; bucket/tenant inacessível não vira sucesso. Sem reordenação/capa, exclusão de produto ou mudanças no histórico.

Nenhuma fonte frontend contém variável de secret/service key ou chamada `supabase.from()` de domínio. O único ajuste frontend nesta auditoria é a referência de tipos Vite, sem telas ou fluxo implementado.

## Pedidos

POST valida quantidade positiva inteira, data com offset e horário não anterior à solicitação. Compra própria é negada. As identidades e condomínio vêm dos vínculos persistidos; vendedor e comprador precisam estar ATIVOS. Em uma transação: locks nos vínculos, reserva por UPDATE com `estoque >= quantidade`, cálculo Decimal após o lock do produto, limite NUMERIC, pedido SOLICITADO, histórico inicial, conversa e dois participantes. Testes de estoque=1/duas compras e outras disputas confirmam um vencedor, estoque zero e rollback completo em falhas.

`/pedidos/me` resolve todos os IDs de vínculos próprios, sem filtrar status/condomínio atual. Compras usam `id_vinculo_comprador`; vendas usam `produto.id_vinculo_vendedor`. Filtros papel/status chegam ao SQL e count. Retorna valor congelado, texto atual de produto, papel, contraparte/moradia e condomínio do vínculo da negociação, histórico ordenado e somente disponibilidade/status do chat. Não retorna mensagens nessa lista. Conta global suspensa permanece bloqueada, mas vínculo suspenso/encerrado não elimina histórico. Super sem perfil de condômino recebe CONDOMINO_PROFILE_REQUIRED nessa rota própria.

Matriz exata:

| Origem | Destino | Ator | Restitui estoque |
| --- | --- | --- | --- |
| SOLICITADO | ACEITO | vendedor | não |
| SOLICITADO | RECUSADO | vendedor | sim |
| SOLICITADO | CANCELADO | comprador | sim |
| ACEITO | CONCLUIDO | vendedor | não |
| ACEITO | CANCELADO | comprador | sim |

Estados terminais não possuem saída. A autoridade do papel é verificada antes da matriz. UPDATE por ID **e status esperado**, exigindo uma linha, protege corridas. Status, `ultima_atualizacao`, incremento de estoque quando aplicável e histórico participam da mesma transação. Repetição/conflito retorna INVALID_ORDER_TRANSITION; admin não tem bypass. Corridas ACEITAR/CANCELAR e RECUSAR/CANCELAR foram testadas com os dois UPDATEs disputando o mesmo estado, sem dupla restituição.

## Histórico de pedidos

Criação: null → SOLICITADO. Transições: estado anterior/novo, identidade `alterado_por`, motivo opcional trim≤255 e timestamp. Falha no histórico reverte a operação inteira. Na lista pública ao participante, `alterado_por` é omitido e as datas são ISO; ordenação por created_at/UUID. Nenhum fluxo de transferência/suspensão apaga ou reassocia esse histórico.

## Chat

FK única de conversa por pedido garante no máximo uma; POST do pedido cria normalmente exatamente uma, com comprador/vendedor reais em `conversa_participante`. Conversa não nasce antes do pedido. A autorização de leitura/envio usa as identidades dos vínculos históricos, não a residência atual nem campos de body.

GET admite partes e super, nega terceiro/admin local não participante com ORDER_NOT_FOUND. Retorna mensagens por created_at/UUID ASC, paginação na raiz e metadados mínimos de conversa/pedido. Count e página usam o mesmo filtro/snapshot. Não marca leitura nem altera `ultimo_lido_em`. Conversa ausente gera CHAT_NOT_FOUND, sem reparo automático.

POST admite somente partes, deriva remetente de req.auth, normaliza texto de 1..1000 caracteres, verifica ATIVA com `FOR SHARE` até o INSERT e usa default do banco para created_at. Encerrada retorna CHAT_CLOSED. Super não participante só lê. Mudanças de status do pedido não fecham/reabrem conversa. DTO não expõe IDs pessoais: remetente é nome/papel; legado sem papel correspondente pode resultar em papel null/nome genérico, sem autorizar terceiro a enviar.

## Auditoria

| Ação real | Entidade | Condomínio | Metadata |
| --- | --- | --- | --- |
| APPROVE_MEMBERSHIP | vinculo_condominio | destino/alvo | PENDENTE → ATIVO; transferência adiciona dois vínculos e ATIVO → ENCERRADO |
| REJECT_MEMBERSHIP | vinculo_condominio | alvo | PENDENTE → REJEITADO |
| SUSPEND_MEMBERSHIP | vinculo_condominio | alvo | ATIVO → SUSPENSO |
| UPDATE_MEMBERSHIP_ADMIN | vinculo_condominio | alvo | admin_anterior/admin_novo |
| UPDATE_USER_STATUS | usuario | null | status_anterior/status_novo |

Todas gravam ator, entidade/ID, ação, timestamp e metadata sem CPF, e-mail, credencial ou conteúdo de chat, na transação da mudança. Aprovação de transferência reutiliza APPROVE_MEMBERSHIP. No-op de privilégio/conta não duplica auditoria. Pedido tem seu próprio histórico; ações comuns, upload, mensagem e solicitação de transferência não receberam auditoria administrativa inventada. Não existe API GET de auditoria registrada.

## Coesão, privacidade e índices

Identidade global é preservada e estado residencial é temporal. Produto/vendedor e pedido/comprador referenciam os vínculos originais, e conversa/participantes/mensagens permanecem no pedido. Transferência não move relações. Não há credenciais gravadas em usuario nem e-mail/CPF/nascimento em DTOs retornados. O novo Perfil usa nome/ID/flags; e-mail de credencial pode ser mostrado pela sessão Auth da própria pessoa.

Prisma fica nos repositories; services coordenam transações e autorização; routes/controllers adaptam HTTP. Dependência de chat.service para pedido.service reutiliza autorização; pedido.service usa só chat.repository. Não se encontrou ciclo de services. Placeholders de auditoria/administracao sem funções registradas não são endpoints. Seleções de relações evitam N+1 em produtos/pedidos/admin/mensagens; assinatura de imagens é lote da página. Página/count compartilham filtros; não há paginação de dados em memória. Loops de mutex têm no máximo origem/destino, não consultas por item de listagem.

Índices existentes relevantes: vínculos por condomínio/status; únicos parciais de ATIVO e PENDENTE por condômino; produto por vendedor/ativo e categoria/ativo; pedido por comprador/status e produto/status; conversa única por pedido; mensagem por conversa/data; histórico por pedido/data. Queries usam naturalmente essas chaves/relações. Não se executou EXPLAIN/benchmark em produção nem se declarou que toda query usa índice em qualquer plano. Nenhum índice crítico ausente foi demonstrado; tuning de busca parcial/offset profundo depende de volume futuro, não bloqueia o MVP.

## Correções desta auditoria

| Arquivo(s) | Problema comprovado | Correção |
| --- | --- | --- |
| `modules/produtos/produto.{routes,controller,schema,model,service,repository}.ts` | Não havia leitura por ID, exigindo varrer páginas para recarregar Produto/Editar | GET autorizado com DTO e imagens, incluindo inativos somente do vínculo próprio atual |
| `modules/usuarios/usuario.{routes,controller,schema,model,service,repository}.ts` | Nome/identidade não eram recuperáveis para Perfil após recarregar | GET /usuarios/me mínimo e privado |
| `produto.service.ts`, `produto.repository.ts` | Gravação de produto podia concluir com contexto anterior a transferência/suspensão | Transação com revalidação/lock de vínculo até a gravação |
| `middlewares/error-handler.ts` | JSON inválido/corpo excessivo caíam em INTERNAL_ERROR 500 | 400 VALIDATION_ERROR e 413 PAYLOAD_TOO_LARGE, sem body/stack nos logs/resposta |
| `frontend/src/vite-env.d.ts` | Build existente falhava em ImportMeta.env sem tipos Vite | Referência de tipos; nenhuma UI ou acesso a domínio implementado |
| `AGENTS.md`, docs e inventário anterior | Planejamento/lista antiga divergiam do backend atual | Catálogo real, convenções, contratos e limites documentados |

Não houve mudança cosmética global, DDL, migration, dependência ou novo estado do domínio. Códigos amplamente usados não foram renomeados. Testes de criação/edição/status de produto tiveram mocks adaptados ao novo limite transacional; os contratos HTTP continuam iguais.

## Códigos de erro reais

Erros de domínio usam `{ erro, mensagem }`; Zod usa `{ erro: "VALIDATION_ERROR", detalhes }`. O middleware de exigirSuperAdmin pode responder apenas `{ erro: "FORBIDDEN" }`. Não depender de texto da mensagem. JSON malformado recebe 400; body JSON maior que 1 MiB recebe 413. Erros Prisma/Supabase inesperados viram erro interno sanitizado. Imagem tem erros operacionais próprios. `IMAGE_CLEANUP_FAILED` é auxiliar interno de compensação, normalmente capturado e logado, sem promessa de emissão HTTP direta.

| Código encontrado no código | HTTP |
| --- | --- |
| ACCOUNT_SUSPENDED | 403 |
| ACTIVE_MEMBERSHIP_ALREADY_EXISTS | 409 |
| AUTH_EMAIL_REQUIRED | 403 |
| CANNOT_BUY_OWN_PRODUCT | 409 |
| CATEGORY_INACTIVE | 409 |
| CATEGORY_NOT_FOUND | 404 |
| CHAT_CLOSED | 409 |
| CHAT_NOT_FOUND | 404 |
| CHAT_SEND_FORBIDDEN | 403 |
| CONDOMINIO_NOT_FOUND | 404 |
| CONDOMINIUM_INACTIVE | 409 |
| CONDOMINIUM_NOT_FOUND | 404 |
| CONDOMINIUM_REQUIRED | 400 |
| CONDOMINO_PROFILE_REQUIRED | 403 |
| CPF_ALREADY_REGISTERED | 409 |
| EMAIL_ALREADY_REGISTERED | 409 |
| FORBIDDEN | 403 |
| FORBIDDEN_CROSS_TENANT | 403 |
| IMAGE_CLEANUP_FAILED | 500 |
| IMAGE_DELETE_FAILED | 500 |
| IMAGE_NOT_FOUND | 404 |
| IMAGE_ORDER_EXHAUSTED | 409 |
| IMAGE_PERSISTENCE_FAILED | 500 |
| IMAGE_REQUIRED | 400 |
| IMAGE_TOO_LARGE | 413 |
| IMAGE_TYPE_NOT_ALLOWED | 415 |
| IMAGE_UPLOAD_FAILED | 500 |
| INSUFFICIENT_STOCK | 409 |
| INTERNAL_ERROR | 500 |
| INVALID_ORDER_TRANSITION | 409 |
| INVALID_SCHEDULE_TIME | 422 |
| LAST_ACTIVE_ADMIN | 409 |
| MEMBERSHIP_INCONSISTENT | 409 |
| MEMBERSHIP_NOT_ACTIVE | 409 |
| MEMBERSHIP_NOT_FOUND | 404 |
| MEMBERSHIP_NOT_PENDING | 409 |
| MEMBERSHIP_PENDING | 409 |
| MEMBERSHIP_REQUIRED | 403 |
| ONBOARDING_ALREADY_COMPLETED | 409 |
| OPEN_ORDERS_BLOCK_TRANSFER | 409 |
| ORDER_NOT_FOUND | 404 |
| ORDER_STATUS_FORBIDDEN | 403 |
| ORDER_VALUE_OUT_OF_RANGE | 422 |
| PAYLOAD_TOO_LARGE | 413 |
| PRODUCT_NOT_FOUND | 404 |
| PRODUCT_UNAVAILABLE | 409 |
| SAME_CONDOMINIUM | 409 |
| SELF_ADMIN_CHANGE_FORBIDDEN | 403 |
| SUPER_ADMIN_CANNOT_ONBOARD | 403 |
| UNAUTHENTICATED | 401 |
| USER_NOT_FOUND | 404 |
| VALIDATION_ERROR | 400 |

Os códigos reais são MEMBERSHIP_REQUIRED e INVALID_ORDER_TRANSITION; não foram criados aliases ACTIVE_MEMBERSHIP_REQUIRED/INVALID_ORDER_STATUS_TRANSITION dos exemplos de planejamento. CONDOMINIO_NOT_FOUND (seleção/onboarding/vitrine) e CONDOMINIUM_NOT_FOUND (transferência) são contratos já publicados; ambos foram preservados e documentados, sem renomeação estética.

## Validação técnica e entre módulos

- **Build:** `npm run build` na raiz passou para backend e frontend; o erro preexistente de ImportMeta.env foi resolvido pela referência de tipos Vite.
- **TypeScript strict:** passou em backend e testes pelo `tsc -p tsconfig.test.json` dos scripts; o build também verifica o workspace frontend. Não há scripts genéricos `typecheck` ou `test`, portanto não foram invocados/criados.
- **Testes:** os 29 scripts existentes passaram: **475 testes, 162 unitários e 313 de integração, zero falhas**. Nenhuma suíte local ficou sem executar. Integrações usam PostgreSQL real descartável, HTTP local e JWT/JWKS/Storage simulados; não se afirmou teste contra Supabase remoto.
- **Dev:** `npm run dev` iniciou API localhost:3000 e Vite localhost:5173; foi encerrado por SIGTERM após 12 segundos (timeout de verificação, não falha do servidor).
- **Preservação:** comparação SHA-256 verificou 120 arquivos preexistentes intactos fora das 21 alterações em código/testes/AGENTS do conjunto examinado. DDL, seeds, schema/config Prisma, manifests e lock não foram alterados; nenhum SQL/migration/dependência criado. No frontend, somente novo `src/vite-env.d.ts`; nenhuma UI/página/provider criado.
- Instância PostgreSQL local encerrada após a validação. Fontes privadas/configuração real do Supabase não foram copiadas para a documentação.

Fluxos completos cobertos: A onboarding → aprovação → ATIVO → vitrine; B publicação HTTP → upload → vitrine/detalhe; C produto → pedido/reserva/histórico/conversa → aceite → mensagem → conclusão; D cancelamento com restituição única e histórico; E transferência com produtos inativos e histórico/chat preservados; F isolamento cross-tenant em vitrine/detalhe/gestão/admin/pedidos/chat. Inclui falhas induzidas com rollback e corridas PostgreSQL reais. Storage é simulado, sem fazer upload/remover objetos remotos.

## Lacunas e telas

| Tela/fluxo | APIs necessárias/disponíveis | Dados suficientes? | Bloqueio atual? |
| --- | --- | --- | --- |
| Login/Cadastro | Supabase Auth; /usuarios/me, /vinculos/me após sessão | Sim, sessão+flags | Não |
| Onboarding | /condominios, POST /onboarding | Sim | Não |
| Aguardando aprovação | /vinculos/me | Sim, PENDENTE e estado anterior | Não |
| Vitrine | /categorias, /produtos | Sim | Não |
| Produto/recarregar edição | Novo /produtos/:id | Sim, inclui ID, descrição, preço, estoque, categoria, vendedor, imagens | Corrigido |
| Meus Produtos/criar/editar | /produtos/me, POST/PATCH produto/status e imagens | Sim | Não |
| Pedido/Meus Pedidos | POST /pedidos, GET /pedidos/me e PATCH status | Sim; buscar ID no histórico paginado quando necessário | Não; sem GET /pedidos/:id separado |
| Chat específico | /pedidos/:id/chat e /messages | Sim, acesso direto pelo ID e metadados do pedido | Não |
| Perfil/Vínculo | Novo /usuarios/me + /vinculos/me; e-mail da própria sessão Auth | Sim, nome/identidade/residência/permissões | Corrigido |
| Transferência | /condominios, /vinculos/transferencia, /vinculos/me | Sim, ATIVO+PENDENTE | Não |
| Administração local | fila/lista, aprovar/rejeitar/suspender/admin | Sim; escopo imposto pelo backend | Não |
| Super administração | lista global/filtrada, ações e status global; vitrine com seleção de condomínio | Sim para contratos definidos | Não |

Não há POST /vinculos independente, edição de Perfil, reativação local de vínculo nem nova solicitação por conta cadastrada sem ATIVO após rejeição/encerramento. Esses contratos não foram definidos como ações desta UX do MVP: mostrar o estado bloqueado é possível. Não foram inventados endpoints para esses retornos. Se a UX futura exigir reenviar solicitação, definir a regra antes dessa ação. Dados completos de pedido específico são recuperáveis por GET /pedidos/me paginado; não foi criada outra leitura sem necessidade. Não há notificações, pagamento ou confirmação de leitura no contrato.

## Checklist de conclusão

- [x] Rotas reais descobertas e comparadas; autorização, tenant e ownership revisados.
- [x] Identidade, histórico de vínculos e relações de produto/pedido/chat preservados.
- [x] Estoque, transições, transferência e transações revisados com concorrência.
- [x] Paginação, DTOs, PII, Storage, auditoria, erros e N+1 revisados.
- [x] Cobertura dos fluxos A–F e testes críticos executados/adicionados.
- [x] AGENTS.md, este inventário e FRONTEND_HANDOFF.md atualizados.

## Prontidão para o Frontend

READY_FOR_FRONTEND = YES

Os contratos necessários às telas definidas estão disponíveis. Não há bloqueio concreto de backend remanescente para iniciar o frontend. Limites de escopo e configuração remota não foram apresentados como funcionalidades já verificadas em produção. Parar nesta auditoria; não iniciar interface neste prompt.
