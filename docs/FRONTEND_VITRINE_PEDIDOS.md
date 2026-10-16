# Frontend — Vitrine, detalhe e criação de pedido

Prompt 24, 16/10/2026. A vitrine do morador ativo passa a consumir os contratos do [backend auditado](FRONTEND_HANDOFF.md). Auth, providers, API client e guards da [infraestrutura anterior](FRONTEND_INFRA.md) foram reutilizados. Nenhuma dependência foi adicionada.

## Rotas e APIs

| Frontend | APIs consumidas | Acesso |
| --- | --- | --- |
| `/vitrine` | `GET /api/categorias`, `GET /api/produtos` | USUARIO_ATIVO |
| `/produtos/:id` | `GET /api/produtos/:id`, `POST /api/pedidos` | USUARIO_ATIVO |

O detalhe funciona por acesso direto e refresh: valida UUID e consulta o produto por ID, sem varrer páginas da vitrine. Super admin permanece em `/admin`; PENDENTE sem ATIVO segue para aprovação. Não há nova rota GET de pedido ou navegação para páginas ainda ausentes. A confirmação existe na própria página do produto.

Todas as chamadas usam o `apiFetch` existente com Bearer. Nenhum condomínio é enviado como autoridade/filtro do morador. Não há acesso direto a tabelas Supabase ou Storage, alteração de contratos backend ou mudanças estruturais de banco.

## Vitrine e URL

Busca, `id_categoria` e página ficam em URLSearchParams, por exemplo `/vitrine?busca=bolo&id_categoria=<UUID>&pagina=2`. A busca é enviada ao pressionar Enter/Buscar, com trim e máximo 140; espaços não viram query vazia. Alterar busca ou categoria reinicia a página 1. Refresh e voltar/avançar do navegador preservam os filtros; voltar do detalhe restaura a URL da listagem quando disponível no estado da navegação.

O request usa `pagina`, `limite=20`, busca não vazia e categoria opcional. Queries repetidas/inválidas são rejeitadas na UX antes da leitura; parâmetros alheios não são encaminhados à API. Não há paginação em memória. A resposta utiliza `dados[]` e `paginacao` na raiz. Lista vazia não mostra “Página 1 de 0”; uma página que ficou vazia após mudanças nos anúncios oferece retorno à primeira página.

Categorias têm loading/erro/retry separados e não bloqueiam a listagem. Sem categorias ativas, somente o filtro fica desabilitado. Vitrine distingue loading inicial, atualização por filtro/página, falha recuperável, nenhum anúncio e filtro sem resultado. Mantém os cards anteriores durante atualização/falha de paginação para evitar apagar o layout.

Cards mostram nome, preço BRL, estoque (inclusive zero), categoria e nome/moradia do vendedor. São links semânticos para o detalhe, sem criação de pedido na listagem. A grade usa uma coluna no mobile, duas a partir de 640 px e três a partir de 960 px.

## Imagens e detalhe

`imagens[0]` é a imagem visual principal. Signed URLs ficam apenas na memória/renderização; não são persistidas em localStorage nem usadas como identidade do produto. Os componentes usam lazy loading, alt e placeholder para lista vazia ou falha da imagem. A falha não remove o anúncio. Novas leituras da API obtêm URLs renovadas; não há chamada direta ao Storage nem renovação automática em loop.

A galeria oferece imagem destacada e miniaturas com botões/aria-pressed, sem dependência de carousel. O detalhe mostra apenas dados do contrato: nome, descrição, preço, estoque, categoria, vendedor e moradia. Produto próprio compara `vendedor.id_vinculo` ao vínculo ATIVO atual e mostra “Este anúncio é seu”, sem formulário ou link fictício de gestão. Estoque zero permanece visível e desabilita quantidade/envio. Produto/categoria inativos também não permitem envio pela UI.

## Pedido e horário

O formulário Zod exige quantidade inteira de 1 até o estoque carregado e data/hora local válida e futura. O estoque é apenas snapshot; a API reaplica a regra transacional. O input datetime-local é convertido por `new Date(valorLocal).toISOString()` depois de validar os componentes e rejeitar rollover/datas inválidas/horários locais inexistentes. Assim o servidor recebe um timestamp com `Z`, preservando o instante local escolhido. A apresentação converte os timestamps ao fuso do navegador.

O resumo mostra produto, quantidade, preço unitário atual, total estimado e horário. A estimativa usa centavos inteiros/BigInt para evitar imprecisão; serve exclusivamente à apresentação. O POST envia somente:

```json
{
  "id_produto": "<UUID_PRODUTO>",
  "quantidade": 2,
  "hora_combinada": "2099-01-01T22:00:00.000Z"
}
```

O exemplo corresponde a 19h locais em America/Sao_Paulo. Nenhum preço, valor, status, condomínio ou vínculo é enviado. Trava síncrona e controles desabilitados impedem duplo clique. Não há decremento otimista definitivo ou repetição automática por rede/409; permanece a política central já existente de uma renovação/repetição estritamente após rejeição por autenticação.

Após 201, a confirmação mostra ID, produto, quantidade, valor congelado, SOLICITADO e horário **da resposta do POST**. Informa que o pedido foi enviado, aguarda vendedor e que o chat estará disponível em Meus Pedidos. Não afirma aceite nem cria um GET por ID. Uma nova leitura do produto atualiza o snapshot sem desfazer a confirmação se o anúncio deixar a vitrine.

## Conflitos e falhas

| Código | Comportamento |
| --- | --- |
| INSUFFICIENT_STOCK | Explica mudança, refaz detalhe, ajusta quantidade ao novo estoque; zero desabilita envio. Nenhuma confirmação de pedido. |
| PRODUCT_UNAVAILABLE / PRODUCT_NOT_FOUND no POST | Refaz detalhe; 404 vira anúncio indisponível. |
| CANNOT_BUY_OWN_PRODUCT | Mensagem controlada e refetch do detalhe. |
| MEMBERSHIP_REQUIRED / FORBIDDEN_CROSS_TENANT | Refaz estado residencial; guard resolve suspensão/transferência/tenant concorrente. |
| INVALID_SCHEDULE_TIME | Mantém campos e pede novo horário. |
| ORDER_VALUE_OUT_OF_RANGE | Mensagem controlada, sem repetir envio. |
| VALIDATION_ERROR | Mapeia fieldErrors aos campos e apresenta erro geral. |
| Rede/falha inesperada | Mantém formulário e informa que não foi possível confirmar o envio; sem afirmar sucesso e sem retry automático. |

GET do detalhe trata loading, atualização, 404, acesso alterado e rede/retry. Requisições de leitura são canceladas no cleanup, impedindo respostas de filtros/IDs anteriores de substituir a leitura atual. Bloqueios globais de conta/sessão continuam no provider existente.

## Arquivos

Criados:

- `frontend/src/lib/moeda.ts`: apresentação de decimais e total estimado.
- `frontend/src/features/produtos/VitrinePage.tsx`: filtros e listagem.
- `frontend/src/features/produtos/ProdutoCard.tsx`: card navegável.
- `frontend/src/features/produtos/ImagemProduto.tsx`: placeholder e galeria.
- `frontend/src/features/produtos/ProdutoPage.tsx`: detalhe recarregável e coordenação da confirmação.
- `frontend/src/features/pedidos/FormularioPedido.tsx`: formulário e conflitos.
- `frontend/src/features/pedidos/ConfirmacaoPedido.tsx`: dados do POST e retorno à vitrine.
- `docs/FRONTEND_VITRINE_PEDIDOS.md`: este relatório.

Alterados:

- `frontend/src/features/produtos/produto.api.ts`, `produto.schema.ts`, `produto.types.ts`: chamadas, filtros e DTOs reais.
- `frontend/src/features/pedidos/pedido.api.ts`, `pedido.schema.ts`, `pedido.types.ts`: payload mínimo, data local e DTO de criação.
- `frontend/src/layouts/ShellPage.tsx`: layout reutilizado pelo morador e shell global preservado.
- `frontend/src/routes/AppRoutes.tsx`: Vitrine funcional e rota de detalhe com o guard existente.
- `frontend/src/styles.css`: grade, cards, filtros, galeria, resumo e confirmação responsivos.
- `frontend/tests/infra.test.ts`, `frontend/tests/fluxos.browser.mjs`: verificações novas e regressão da etapa anterior.
- `AGENTS.md`: estado atual do frontend e limite da etapa.

AuthProvider, EstadoUsuarioProvider, api.ts/api.client.ts, package.json/package-lock.json e configurações de ambiente foram preservados. Hashes de backend/src, Prisma e database coincidem com o início do trabalho.

## Validação

```bash
npm run build
npm test --workspace frontend
```

Build dos dois workspaces e TypeScript strict passaram. **30 testes Node passaram** (21 anteriores e nove adicionais de filtros/paginação, decimais, quantidade e data). **42 cenários Chromium passaram** (18 de regressão e 24 de vitrine/detalhe/pedido), usando SDK Auth real com HTTP Auth/API simulados, sem pedidos ou usuários reais no Supabase. Os cenários usam fuso America/Sao_Paulo e verificam explicitamente a conversão 19h local → 22h UTC.

Cobertura de navegador inclui estado ATIVO/PENDENTE/super, categorias independentes, envelope/paginação, filtros/refresh/back-forward, placeholders e falha de signed URL, galeria, detalhe direto/refresh, próprio anúncio, estoque zero, quantidade acima do snapshot, POST com somente três campos, duplo envio, confirmação com valor/nome vindos do servidor, conflito de estoque com refetch/ajuste, indisponibilidade, horário/limite/validação e atualização residencial por 403 na leitura e na criação. Capturas de 390 px e 1280 px foram inspecionadas; o detalhe mobile não apresenta overflow horizontal.

O procedimento para iniciar Vite com origens fictícias e executar Playwright continua em [FRONTEND_INFRA.md](FRONTEND_INFRA.md#verificação-reproduzível); o arquivo de cenários foi ampliado. Playwright/Chromium permanecem somente no ambiente temporário, sem dependências novas. Não há lint frontend configurado.

Busca estática confirmou ausência de supabase.from(), acesso Supabase Storage, variáveis VITE de segredo/banco e literais de secret key no código frontend; o bundle também foi verificado para literais de secret key/URL PostgreSQL. O build continua com avisos não bloqueantes de anotações internas do Zod e bundle JavaScript de aproximadamente 599 kB (175 kB gzip).

Meus Produtos, criação/edição/imagens de produto, Meus Pedidos completos, status de pedido, Chat visual, Perfil/Transferência e Administração permanecem fora desta etapa.
