# Contratos para o frontend — backend auditado

Contratos do Prompt 22 com adendo do Prompt 29, 16/10/2026. Consumir os contratos reais abaixo e o [inventário completo](BACKEND_INVENTARIO.md). O texto anterior registra a auditoria do Prompt 22; a seção do Prompt 29 abaixo descreve a nova interface.

## Convenções comuns

Base de desenvolvimento: `http://localhost:3000/api`; `npm run dev` na raiz inicia API e Vite. `VITE_API_URL` pode substituir a base. Auth usa apenas URL/publishable key públicas do Supabase (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`). Secret key e DATABASE_URL pertencem somente ao backend. O arquivo `vite-env.d.ts` agora fornece os tipos de `import.meta.env`; não constitui implementação de UI.

Todas as rotas de domínio exigem `Authorization: Bearer <ACCESS_TOKEN>`; só `/health` é público. O client `frontend/src/lib/api.ts` já injeta Bearer da sessão (Prompt 23), preserva envelopes, suporta FormData/204 e renova uma vez somente após 401 UNAUTHENTICATED com token novo da mesma identidade. Não repete escrita por falha de rede. Não acessar tabelas de domínio via `supabase.from()`. Não enviar senha à API Express.

Body JSON de escrita é estrito, salvo upload multipart. Omitir campos não editáveis/ausentes; não enviar undefined/null como substituto indiscriminado. UUIDs são strings. Valores monetários são **strings decimais**, nunca autoridade numérica do cliente para pedidos. `preco` é editável somente na gestão do produto; `valor_pedido` é calculado/congelado pelo servidor. Inteiros continuam números JSON. Timestamps retornam ISO UTC; enviar `hora_combinada` com timezone/offset e converter horário local conscientemente.

Objeto: `{ "dados": {} }`. Lista simples: `{ "dados": [] }`. Lista paginada obrigatória:

```json
{ "dados": [], "paginacao": { "pagina": 1, "limite": 20, "total": 0, "total_paginas": 0 } }
```

Nunca procurar `dados.itens`/`dados.paginacao`. Chat acrescenta `conversa` e `pedido` na raiz. DELETE de imagem retorna 204, portanto não chamar `.json()` nesse sucesso. Health retorna `{ "status": "ok", "projeto": "porta-a-porta" }`.

Erros de domínio: `{ "erro": "CODIGO", "mensagem": "texto" }`; validação Zod: `{ "erro": "VALIDATION_ERROR", "detalhes": { "formErrors": [], "fieldErrors": {} } }`. Algumas negações de super admin contêm só `erro`. Tratar pelo código/status, sem depender de mensagem. JSON malformado: 400; JSON acima de 1 MiB: 413 PAYLOAD_TOO_LARGE; 500 é sanitizado. 401 UNAUTHENTICATED pede recuperação da sessão/login; 403 ACCOUNT_SUSPENDED bloqueia a aplicação protegida globalmente. Não confundir com MEMBERSHIP_REQUIRED (sem vínculo ATIVO).

Queries paginadas exigem strings de inteiros positivos, rejeitam arrays/parâmetros repetidos, limites excedidos e offset maior que INTEGER. Defaults 1/20, máximo 100, **exceto condomínios máximo 50 e chat default 50**. Super seleciona condomínio quando a vitrine exige; admin local nunca usa um ID do cliente como autoridade.

Exemplos usam IDs/nomes/datas fictícios e placeholders a substituir. Não contêm credenciais ou CPF real.

## Auth

Signup, confirmação de e-mail conforme configuração do projeto, login, logout e renovação de sessão são Supabase Auth. A API confere JWT/JWKS, assinatura, issuer, audience, expiração e identidade; `super_admin` e vínculo são resolvidos no banco, não em user_metadata.

Após obter sessão, consultar `GET /usuarios/me` e `GET /vinculos/me`, ambos com Bearer, sem body. A primeira query é estrita vazia. Exemplos:

```json
{ "dados": { "id_usuario": "<UUID_AUTH>", "nome_completo": "Maria Exemplo", "onboarding_realizado": true, "super_admin": false } }
```

Antes do onboarding: mesmo ID autenticado, nome null, onboarding_realizado=false, super_admin=false. Super sem residência: nome null, onboarding_realizado=true, super_admin=true. Não há consulta de usuário arbitrário por esse GET; `?id_usuario=...` é inválido. E-mail da própria credencial pode vir da sessão Supabase; API não retorna CPF/nascimento/e-mail no Perfil.

Estado de tela: aguardar restauração da sessão antes de redirecionar; mostrar carregamento das duas leituras; se usuário de domínio ainda não existe, abrir onboarding; conta suspensa mostra bloqueio global; falha transitória oferece retry. Não exigir ATIVO para páginas de pedidos históricos/chat. Super admin segue administração e seleção explícita de vitrine, sem formulário residencial.

## Onboarding

`GET /condominios?busca=Residencial&pagina=1&limite=20` aceita JWT antes do onboarding e retorna somente condomínios ativos:

```json
{
  "dados": [{ "id_condominio": "<UUID_CONDOMINIO>", "nome_residencial": "Residencial Exemplo", "cep": "00000000", "endereco": "Endereço fictício" }],
  "paginacao": { "pagina": 1, "limite": 20, "total": 1, "total_paginas": 1 }
}
```

Busca opcional com trim, 1..160 caracteres; omitir busca vazia. Limite máximo 50.

`POST /onboarding` exige JWT, pessoa ainda sem usuario no domínio, e não permite super admin. Body:

```json
{
  "nome_completo": "Maria Exemplo",
  "cpf": "<CPF_11_DIGITOS>",
  "data_nascimento": "2000-01-01",
  "id_condominio": "<UUID_CONDOMINIO>",
  "moradia": "Bloco B - Apto 302"
}
```

Nome trim 1..160; CPF normalizado para 11 dígitos (backend não calcula dígitos verificadores); nascimento é data ISO existente; moradia trim 1..80. Não enviar e-mail/senha/UUID da pessoa/admin/status/datas de aprovação.

Sucesso 201:

```json
{ "dados": { "id_usuario": "<UUID_AUTH>", "nome_completo": "Maria Exemplo", "id_vinculo": "<UUID_VINCULO>", "id_condominio": "<UUID_CONDOMINIO>", "moradia": "Bloco B - Apto 302", "status_vinculo": "PENDENTE", "admin_condominio": false } }
```

Erros tratáveis: 400 VALIDATION_ERROR; 403 AUTH_EMAIL_REQUIRED/SUPER_ADMIN_CANNOT_ONBOARD; 404 CONDOMINIO_NOT_FOUND; 409 ONBOARDING_ALREADY_COMPLETED/CPF_ALREADY_REGISTERED/EMAIL_ALREADY_REGISTERED. No conflito de onboarding, atualizar estado antes de reapresentar formulário. Loading de seleção e envio; condomínio vazio desabilita submissão; falha de rede não deve duplicar identidade no cliente.

## Vínculo/Aprovação

`GET /vinculos/me`, Bearer, sem body. Exemplo após aprovação:

```json
{
  "dados": {
    "onboarding_realizado": true,
    "super_admin": false,
    "vinculo_ativo": {
      "id_vinculo": "<UUID_VINCULO>", "status_vinculo": "ATIVO", "moradia": "Apto 302", "admin_condominio": false,
      "data_solicitacao": "2026-10-16T10:00:00.000Z", "data_aprovacao": "2026-10-16T12:00:00.000Z",
      "data_inicio": "2026-10-16T12:00:00.000Z", "data_fim": null,
      "condominio": { "id_condominio": "<UUID_CONDOMINIO>", "nome_residencial": "Residencial Exemplo", "cep": "00000000", "endereco": "Endereço fictício" }
    },
    "solicitacao_pendente": null,
    "ultimo_vinculo": null
  }
}
```

Pendente possui a mesma forma de vínculo, com datas administrativas null. Na transferência, ATIVO e PENDENTE coexistem. `ultimo_vinculo` só aparece se não há ativo/pendente, com REJEITADO/SUSPENSO/ENCERRADO; não é toda a linha do tempo. Antes do onboarding, flags false e três vínculos null. Super tem super_admin=true e vínculos null.

Use o estado retornado para onboarding/aguardando/liberado/histórico bloqueado/transferência pendente. Flag de admin de vínculo histórico não concede administração. Suspensão local não impede ler próprios pedidos/chat históricos. Erros comuns são autenticação/conta global e eventual 500 sanitizado de inconsistência. Polling/refetch manual pode acompanhar aprovação; não há notificação push implementada. Carregamento não deve renderizar vitrine antes da decisão; estados vazios e pendentes devem ser explícitos.

## Vitrine

`GET /categorias` exige ATIVO ou super e responde sem paginação:

```json
{ "dados": [{ "id_categoria": "<UUID_CATEGORIA>", "nome": "Alimentos" }] }
```

`GET /produtos?pagina=1&limite=20&busca=Bolo&id_categoria=<UUID_CATEGORIA>` exige ATIVO do morador/admin. Super deve acrescentar `id_condominio=<UUID_CONDOMINIO_ATIVO>`; sem isso, 400 CONDOMINIUM_REQUIRED; seleção inválida/inativa, 404 CONDOMINIO_NOT_FOUND. Morador pode omitir ID de condomínio; diferente do seu gera 403 FORBIDDEN_CROSS_TENANT. `categoria` é alias legado de `id_categoria`; se ambos forem enviados precisam coincidir. Busca trim≤140, limite≤100. Estoque zero aparece.

Exemplo de item real (envelope com paginação comum):

```json
{
  "dados": [{
    "id_produto": "<UUID_PRODUTO>", "nome_produto": "Bolo", "descricao": "Caseiro", "preco": "25.90", "estoque": 4,
    "created_at": "2026-10-16T12:00:00.000Z",
    "categoria": { "id_categoria": "<UUID_CATEGORIA>", "nome": "Alimentos" },
    "vendedor": { "id_vinculo": "<UUID_VINCULO_VENDEDOR>", "nome_completo": "Maria Exemplo", "moradia": "Apto 302" },
    "imagens": [{ "id_imagem": "<UUID_IMAGEM>", "ordem": 0, "url": "<SIGNED_URL_TEMPORARIA>", "expires_in": 600 }]
  }],
  "paginacao": { "pagina": 1, "limite": 20, "total": 1, "total_paginas": 1 }
}
```

Não existem `ativo`, `updated_at` ou `categoria.ativo` nesse item de vitrine; sua visibilidade já exige ativo. Não supor e-mail/ID de pessoa do vendedor. Signed URL é temporária e não deve ser armazenada como referência permanente; atualizar via GET após expirar. Imagem omitida por falha do Storage usa placeholder; não tratar como produto ausente. Loading, busca sem resultados, lista vazia, erro de consulta e estado sem vínculo são distintos. Sem categorias ativas, desabilitar nova publicação.

## Produto

`GET /produtos/:id` (UUID), Bearer, query estrita `{ id_condominio? }`, sem body, retorna 200 com o item por ID. Super também deve selecionar condomínio ativo. A leitura pública mantém produto/categoria/vendedor ativos e tenant; somente o dono pelo **vínculo ativo atual** pode ler seu inativo/categoria inativa para editar. Produto de outro condomínio/inexistente/invisível retorna 404 PRODUCT_NOT_FOUND; filtro de condomínio forjado, 403. Morador sem ATIVO recebe MEMBERSHIP_REQUIRED.

Exemplo:

```json
{ "dados": {
  "id_produto": "<UUID_PRODUTO>", "nome_produto": "Bolo", "descricao": "Caseiro", "preco": "25.90", "estoque": 4, "ativo": true,
  "created_at": "2026-10-16T12:00:00.000Z", "updated_at": "2026-10-16T12:00:00.000Z",
  "categoria": { "id_categoria": "<UUID_CATEGORIA>", "nome": "Alimentos", "ativo": true },
  "vendedor": { "id_vinculo": "<UUID_VINCULO_VENDEDOR>", "nome_completo": "Maria Exemplo", "moradia": "Apto 302" }, "imagens": []
} }
```

Permite URL recarregável sem varrer a vitrine. Comparar vendedor.id_vinculo com vínculo atual apenas para escolher controles de UI; o backend reaplica ownership. Loading, 404 indisponível após refetch, imagem vazia e conta/vínculo bloqueados precisam de estado próprio. Pedidos antigos continuam acessíveis mesmo se o produto deixar a vitrine, pelos dados do pedido; este GET não libera catálogo histórico de outro tenant.

## Meus Produtos

`GET /produtos/me`: exige vínculo ATIVO, mesmos pagina/limite/busca/id_categoria da vitrine, mais `ativo=true|false` opcional. Omitir ativo lista ambos. Query estrita, sem id_condominio/categoria legado. Retorna `{ dados:[<item>], paginacao }`, onde o item é o detalhe acima **sem vendedor**, com categoria.ativo e imagens. Sem produtos é lista vazia, não 404.

`POST /produtos`: Bearer de ATIVO; body estrito:

```json
{ "id_categoria": "<UUID_CATEGORIA>", "nome_produto": "Bolo", "descricao": "Caseiro", "preco": "25.90", "estoque": 4 }
```

Nome trim 1..140; descrição trim não vazia; preço string decimal positiva, até dez dígitos inteiros/duas casas (ponto); estoque inteiro 0..2147483647. Não enviar vendedor, tenant, ativo, imagens ou datas. Sucesso 201 tem ID/nome/descrição/preço/estoque/ativo/created_at/categoria `{id_categoria,nome}`; não inclui imagens/updated_at.

`PATCH /produtos/:id`: mesmos campos opcionais, ao menos um; não preencher omitidos. Sucesso 200 é o item de gestão **sem imagens**, com updated_at e categoria.ativo. `PATCH /produtos/:id/status` aceita apenas `{ "ativo": false }` ou true e retorna a mesma forma. Dono é vínculo ATIVO atual; histórico de propriedade global não basta.

Categoria explícita deve existir/estar ativa; ativar valida categoria atual. Desativar ou editar outros campos sem trocar categoria continua possível se categoria ficou inativa. Erros: 404 PRODUCT_NOT_FOUND/CATEGORY_NOT_FOUND; 409 CATEGORY_INACTIVE; 400 VALIDATION_ERROR; 403 MEMBERSHIP_REQUIRED. A transação revalida vínculo ao gravar; se houver transferência/suspensão concorrente, atualizar estado residencial ao receber 403. Loading de gravação deve desabilitar duplo clique; em erro preservar campos do formulário; refetch após sucesso.

### Imagens do produto

`POST /produtos/:id/imagens`: Bearer do dono ATIVO, `multipart/form-data` com um arquivo no campo **imagem**, nenhum campo extra. Não definir Content-Type manualmente com FormData (o navegador cria boundary). Até 5 MiB exatos, JPEG/PNG/WEBP compatíveis. Sucesso 201:

```json
{ "dados": { "id_imagem": "<UUID_IMAGEM>", "id_produto": "<UUID_PRODUTO>", "ordem": 0, "created_at": "2026-10-16T12:00:00.000Z" } }
```

Refazer GET para obter signed URL. Não enviar storage_path, nome/chave de objeto, URL/base64 ou ordem. Não há capa/reordenação. Erros: IMAGE_REQUIRED 400; IMAGE_TYPE_NOT_ALLOWED 415; IMAGE_TOO_LARGE 413; IMAGE_ORDER_EXHAUSTED 409; IMAGE_UPLOAD_FAILED/IMAGE_PERSISTENCE_FAILED 500, além de vínculo/ownership.

`DELETE /produtos/:id/imagens/:idImagem`: dono ATIVO, UUIDs, sem body nem query, sucesso 204. Repetir após registro removido gera IMAGE_NOT_FOUND 404. IMAGE_DELETE_FAILED 500 permite retry; refetch para refletir possível inconsistência entre objeto/registro. Loading por arquivo; upload/delete falho não deve remover produto do estado da UI; sem imagens mantém placeholder.

## Pedidos

`POST /pedidos`: comprador ATIVO; body estrito:

```json
{ "id_produto": "<UUID_PRODUTO>", "quantidade": 2, "hora_combinada": "2099-01-01T19:00:00-03:00" }
```

Quantidade 1..2147483647, número inteiro; horário deve ser ≥ hora de solicitação do servidor. Não enviar comprador/vendedor, condomínio, status, valor ou preço. Sucesso 201:

```json
{ "dados": {
  "id_pedido": "<UUID_PEDIDO>", "id_produto": "<UUID_PRODUTO>", "quantidade": 2, "valor_pedido": "51.80", "status_pedido": "SOLICITADO",
  "hora_solicitacao": "2026-10-16T12:00:00.000Z", "hora_combinada": "2099-01-01T22:00:00.000Z", "ultima_atualizacao": "2026-10-16T12:00:00.000Z",
  "produto": { "id_produto": "<UUID_PRODUTO>", "nome_produto": "Bolo" }
} }
```

Essa confirmação significa estoque reservado, histórico inicial, conversa e participantes criados juntos. Valor é **total congelado**, não preço unitário atual. Erros: 404 PRODUCT_NOT_FOUND; 403 FORBIDDEN_CROSS_TENANT/MEMBERSHIP_REQUIRED; 409 CANNOT_BUY_OWN_PRODUCT/PRODUCT_UNAVAILABLE/INSUFFICIENT_STOCK; 422 INVALID_SCHEDULE_TIME/ORDER_VALUE_OUT_OF_RANGE. Atualizar estoque ao falhar/sucesso. Sem pagamento nesta etapa.

`GET /pedidos/me?papel=compra&status=SOLICITADO&pagina=1&limite=20`: exige perfil condômino, sem exigir vínculo ATIVO; omitir papel inclui compras e vendas. `papel` é compra/venda (não COMPRADOR/VENDEDOR), status é o enum real de pedido. Todos os vínculos históricos participam. Ordenação por hora_solicitacao/ID DESC; limite≤100.

Exemplo de item, dentro do envelope paginado comum:

```json
{
  "id_pedido": "<UUID_PEDIDO>", "papel_usuario": "COMPRADOR", "quantidade": 2, "valor_pedido": "51.80", "status_pedido": "SOLICITADO",
  "hora_solicitacao": "2026-10-16T12:00:00.000Z", "hora_combinada": "2099-01-01T22:00:00.000Z", "ultima_atualizacao": "2026-10-16T12:00:00.000Z",
  "produto": { "id_produto": "<UUID_PRODUTO>", "nome_produto": "Bolo" },
  "contraparte": { "nome_completo": "Maria Exemplo", "moradia": "Apto 302" },
  "condominio": { "id_condominio": "<UUID_CONDOMINIO_DA_NEGOCIACAO>", "nome_residencial": "Residencial Exemplo" },
  "historico": [{ "status_anterior": null, "status_novo": "SOLICITADO", "motivo": null, "created_at": "2026-10-16T12:00:00.000Z" }],
  "chat": { "disponivel": true, "status_conversa": "ATIVA" }
}
```

Esse item não tem id_produto no topo. Nome do produto é atual, valor é histórico; moradia/condomínio são dos vínculos originais. Vínculo suspenso/encerrado e estado terminal não somem. Conversa legada ausente retorna disponivel=false/status_conversa=null, sem criação automática. CONDOMINO_PROFILE_REQUIRED 403 distingue falta de perfil, inclusive para super sem residência. Não há GET /pedidos/:id: os dados completos de um pedido próprio podem ser localizados por ID nas páginas do histórico. Chat tem acesso direto por ID. Empty list, filtros sem resultados, loading de página, conflito e histórico sem vínculo ativo precisam ser tratados.

`PATCH /pedidos/:id/status`: UUID e body `{ "status": "ACEITO", "motivo": "Pode buscar" }`. Motivo opcional string trim≤255; não aceitar null se enviado. SOLICITADO não é destino permitido. Matriz:

| Papel | Estado atual | Ações |
| --- | --- | --- |
| VENDEDOR | SOLICITADO | ACEITO / RECUSADO |
| VENDEDOR | ACEITO | CONCLUIDO |
| COMPRADOR | SOLICITADO ou ACEITO | CANCELADO |
| Qualquer | RECUSADO/CANCELADO/CONCLUIDO | Nenhuma |

Sucesso 200: `{ "dados": { "id_pedido": "<UUID_PEDIDO>", "status_pedido": "ACEITO", "ultima_atualizacao": "2026-10-16T12:10:00.000Z" } }`. Recusa/cancelamento devolvem estoque uma vez; aceite/conclusão não devolvem. 404 ORDER_NOT_FOUND inclui pedido alheio; 403 ORDER_STATUS_FORBIDDEN para papel errado; 409 INVALID_ORDER_TRANSITION para estado inválido, repetido ou corrida. Sem bypass de admin. Após conflito, refetch do pedido/histórico; não repetir ação automaticamente com estado presumido. Loading desabilita ações até resposta; o backend ainda protege chamadas concorrentes.

## Chat

`GET /pedidos/:id/chat?pagina=1&limite=50`: partes históricas ou super, independentemente do vínculo ATIVO; admin local alheio é terceiro. UUID, query estrita, sem body, limite≤100. Ordem created_at/UUID ASC. Exemplo 200:

```json
{
  "dados": [{ "id_mensagem": "<UUID_MENSAGEM>", "conteudo": "Posso buscar?", "created_at": "2026-10-16T12:10:00.000Z", "remetente": { "nome_completo": "Maria Exemplo", "papel": "COMPRADOR" } }],
  "paginacao": { "pagina": 1, "limite": 50, "total": 1, "total_paginas": 1 },
  "conversa": { "id_conversa": "<UUID_CONVERSA>", "status_conversa": "ATIVA" },
  "pedido": { "id_pedido": "<UUID_PEDIDO>", "status_pedido": "ACEITO" }
}
```

GET não marca lido/ultimo_lido_em. Pode consultar ENCERRADA. 404 ORDER_NOT_FOUND inclui alheio; CHAT_NOT_FOUND é pedido válido sem conversa. Super pode inspecionar sem ser participante, mas não envia nesse papel. Não há realtime/push/indicador de leitura implementado; carregar/refazer GET conforme UX posterior.

`POST /pedidos/:id/chat/messages`, somente partes históricas, body estrito `{ "conteudo": "Posso buscar às 19h?" }`: trim, 1..1000 caracteres. Não enviar remetente/conversa/data. Sucesso 201: `{ "dados": <mensagem no mesmo formato do GET> }`. 400 VALIDATION_ERROR, 409 CHAT_CLOSED; 403 CHAT_SEND_FORBIDDEN para super observador; terceiro recebe ORDER_NOT_FOUND. Em legado, remetente pode ter papel null/nome genérico; não inventar outro papel administrativo de envio.

Loading de conversa, lista vazia e erro de acesso são diferentes. Mensagem em envio deve ser reconciliada com ID retornado; não afirmar entrega antes de 201. Fechada desabilita compositor, preservando leitura. Status terminal do pedido não fecha conversa automaticamente; não inferir essa regra na UI.

## Perfil/Transferência

Perfil usa `/usuarios/me` para nome/identidade e `/vinculos/me` para moradia/permissões/condomínio. Exibir e-mail da própria sessão Auth se necessário; não existe edição de CPF/nascimento/e-mail de domínio ou PATCH de Perfil nessa API.

`POST /vinculos/transferencia`: vínculo ATIVO, body estrito `{ "id_condominio": "<UUID_DESTINO>", "moradia": "Bloco B - Apto 302" }`, destino escolhido em `/condominios`, trim 1..80. Sucesso 201:

```json
{ "dados": { "id_vinculo": "<UUID_NOVO>", "id_condominio": "<UUID_DESTINO>", "moradia": "Bloco B - Apto 302", "status_vinculo": "PENDENTE", "admin_condominio": false, "data_solicitacao": "2026-10-16T12:00:00.000Z" } }
```

Manter vitrine atual enquanto ATIVO antigo + PENDENTE novo. Solicitar não desativa produtos nem bloqueia por pedidos/último admin; as verificações ocorrem na aprovação. Erros: MEMBERSHIP_REQUIRED 403; CONDOMINIUM_NOT_FOUND 404; CONDOMINIUM_INACTIVE/SAME_CONDOMINIUM/MEMBERSHIP_PENDING 409. Após sucesso, refetch `/vinculos/me`; após aprovação, recarregar tenant/vitrine/próprios produtos. Pedidos/chat antigos permanecem no histórico.

Sem ATIVO após rejeição/suspensão/encerramento, mostrar estado retornado; **não inventar** POST /vinculos ou repetição do onboarding para reenviar residência. Nova solicitação desse tipo não tem contrato definido. Loading, transferência já pendente e destino indisponível devem manter contexto da residência atual.

## Administração

Exigir super_admin=true ou vínculo ATIVO com admin_condominio=true para navegação administrativa. Backend reaplica escopo; não é uma autorização fornecida por query/body.

`GET /admin/vinculos/pendentes`: pagina/limite (1/20, máximo100), busca trim≤160, id_condominio opcional. Admin local usa seu tenant e rejeita outro; super omite para global. Retorno paginado com `{ id_vinculo,status_vinculo,moradia,data_solicitacao,morador:{id_condomino,nome_completo},condominio:{id_condominio,nome_residencial} }` por item.

`GET /admin/vinculos`: mesmos filtros e `status=ATIVO|PENDENTE|REJEITADO|SUSPENSO|ENCERRADO`. Retorno paginado:

```json
{
  "dados": [{ "id_vinculo": "<UUID_VINCULO>", "status_vinculo": "ATIVO", "moradia": "Apto 302", "admin_condominio": false, "data_solicitacao": "2026-10-16T10:00:00.000Z", "data_inicio": "2026-10-16T12:00:00.000Z", "morador": { "id_usuario": "<UUID_AUTH>", "nome_completo": "Maria Exemplo" }, "condominio": { "id_condominio": "<UUID_CONDOMINIO>", "nome_residencial": "Residencial Exemplo" } }],
  "paginacao": { "pagina": 1, "limite": 20, "total": 1, "total_paginas": 1 }
}
```

Atenção à compatibilidade: fila antiga usa `morador.id_condomino`; lista geral usa `morador.id_usuario`, ambos representam a identidade global nesse domínio. Não normalizar resposta no servidor sem necessidade de contrato. Não há filtro por CPF/e-mail. Loading/filtros sem resultado/lista vazia/403 precisam de tratamento separado.

`PATCH /admin/vinculos/:id/aprovar`, `/rejeitar`, `/suspender`: UUID e Bearer, **sem body**, nem `{}`. Local só opera no condomínio do alvo (destino em transferência); super tem escopo global. Sucesso 200 com dados do vínculo, condomínio `{id_condominio,nome_residencial}` e morador `{id_condomino,nome_completo}`. Aprovação inclui id/status/moradia/admin/data_aprovacao/data_inicio; rejeição/suspensão acrescentam data_solicitacao/data_fim, com nulls conforme estado. Exemplo de aprovação:

```json
{ "dados": { "id_vinculo": "<UUID_VINCULO>", "status_vinculo": "ATIVO", "moradia": "Apto 302", "admin_condominio": false, "data_aprovacao": "2026-10-16T12:00:00.000Z", "data_inicio": "2026-10-16T12:00:00.000Z", "condominio": { "id_condominio": "<UUID_CONDOMINIO>", "nome_residencial": "Residencial Exemplo" }, "morador": { "id_condomino": "<UUID_AUTH>", "nome_completo": "Maria Exemplo" } } }
```

Aprovação pode concluir transferência atomicamente: pedidos abertos geram OPEN_ORDERS_BLOCK_TRANSFER 409; último admin sem substituto gera LAST_ACTIVE_ADMIN 409 para local (super pode intervir). Falha não ativa parcialmente. Rejeitar não encerra o vínculo antigo. Suspender muda só estado local e não apaga histórico nem suspende conta global. Demais erros: 404 MEMBERSHIP_NOT_FOUND, 403 FORBIDDEN_CROSS_TENANT, 409 MEMBERSHIP_NOT_PENDING/MEMBERSHIP_NOT_ACTIVE/MEMBERSHIP_INCONSISTENT/ACTIVE_MEMBERSHIP_ALREADY_EXISTS (último é fallback de corrida de integridade, não bloqueio normal da transferência). Refetch da fila/lista após ação ou conflito; impedir envio duplicado enquanto loading.

`PATCH /admin/vinculos/:id/admin`: `{ "admin_condominio": true }` ou false, boolean real. Alvo ATIVO; local só altera outro vínculo no seu tenant. Sucesso 200 `{ "dados": { "id_vinculo": "<UUID_VINCULO>", "admin_condominio": true, "admin_atualizado_em": "2026-10-16T12:00:00.000Z" } }`. Idempotente sem auditoria duplicada; timestamp pode ser null se nunca mudou e o valor já era o solicitado. SELF_ADMIN_CHANGE_FORBIDDEN 403 impede ação local sobre si. MEMBERSHIP_NOT_ACTIVE 409, MEMBERSHIP_NOT_FOUND 404 e tenant/autoridade 403 completam erros. Refetch pode revelar que o ator perdeu o privilégio enquanto aguardava.

`PATCH /admin/usuarios/:id/status`: somente super; `{ "status_conta": "SUSPENSA" }` ou ATIVA. Sucesso 200 `{ "dados": { "id_usuario": "<UUID_AUTH>", "status_conta": "SUSPENSA" } }`. Conta inexistente: USER_NOT_FOUND 404; admin local: FORBIDDEN 403. Estado global e local são separados: suspensão/reativação não alteram vínculos/produtos/pedidos/Auth. Futuras requisições protegidas do suspenso são bloqueadas mesmo com token válido. Sem edição de super_admin ou senha por essa rota. Loading por ação, confirmação adequada à UX futura, erro mantendo estado anterior e refetch após sucesso/conflito.

Não existe GET público de auditoria: ações críticas são registradas atomicamente no banco, com metadados mínimos, sem exigir rota extra para montar estas telas.

## Limites e próximo prompt

Contratos auditados estão prontos para iniciar infraestrutura de frontend, providers de Auth, API client com Bearer, proteção de rotas, login/cadastro e onboarding/estado residencial. Manter histórico acessível independentemente de ATIVO; manter administração global separada da residência. Não adicionar pagamento, notificações, reputação, leitura de chat ou novos estados. Não houve implementação de interface neste prompt.


## Prompt 29 — Condomínios exclusivos do superadmin (16/10/2026)

Navegação real: /admin → Condomínios → Consultar e cadastrar condomínios → **/admin/condominios**. Página única com catálogo ativo e botão Cadastrar condomínio que abre o formulário. Link e rota exigem super_admin===true; GuardAdmin com somenteSuper mantém ferramentas locais existentes e redireciona local a /admin, morador a seu destino residencial. Refresh direto é suportado. Shell usa chave de identidade/papel/residência, descartando resultados privados antigos.

`POST /admin/condominios`, Bearer automático via criarCondominioAdmin em condominio.api.ts. Body estrito:

```json
{"nome_residencial":"Residencial Jardim das Flores","cep":"72000000","endereco":"Rua Fictícia, 123"}
```

Nome e endereço trim com limites 1..160/1..255; CEP exatamente oito dígitos no backend. Formulário aceita 00000-000 e normaliza antes do POST. Não enviar ativo, UUID, ator, datas ou outros campos. Não há consulta externa de CEP, síndico nem unicidade por CEP/nome.

Sucesso 201, valores retornados do PostgreSQL:

```json
{"dados":{"id_condominio":"<UUID_GERADO>","nome_residencial":"Residencial Jardim das Flores","cep":"72000000","endereco":"Rua Fictícia, 123","ativo":true,"created_at":"2026-10-16T20:00:00.000Z"}}
```

Criação + auditoria CREATE_CONDOMINIUM são atômicas. Erros: 400 VALIDATION_ERROR com fieldErrors, 401 UNAUTHENTICATED, 403 FORBIDDEN/ACCOUNT_SUSPENDED, 500 INTERNAL_ERROR sanitizado. Local/morador recebem 403 na API mesmo com privilégios forjados. Suspensão global continua bloqueando tudo.

Formulário tem labels/required, erros por campo, fieldset/botão bloqueados durante envio, trava síncrona, cancelar e confirmação real. 400 preserva dados; 403 refaz providers/guard. Rede/5xx/resposta ilegível têm orientação de resultado incerto e bloqueiam envio até verificação explícita. Não há idempotência HTTP nem repetição automática. Após 201 mantém administração, mostra ID/nome/CEP/endereço, fecha formulário e refaz GET /condominios por nome/página 1. A confirmação mostra o recém-criado mesmo se houver nomes repetidos ou mais de uma página.

Catálogo usa GET /condominios existente (dados[] + paginacao raiz, UI 20, máximo API 50), busca/página na URL, loading/vazio/erro/retry e AbortController. Sem cache persistente a invalidar; seletores de onboarding/transferência releem ao montar/buscar/refazer consulta. O novo condomínio aceita onboarding sem admin local; primeiro vínculo é PENDENTE/admin=false, super aprova e opcionalmente promove pelo PATCH /admin/vinculos/:id/admin. Nenhum privilégio automático.

Testes Node, Chromium com APIs simuladas e jornada browser/Express/PostgreSQL local estão descritos em [CONDOMINIOS_SUPERADMIN.md](CONDOMINIOS_SUPERADMIN.md). Auth/JWKS/Storage remotos e configuração Supabase de demonstração continuam pendentes de homologação. Sem edição/desativação/exclusão ou GET administrativo novo.
