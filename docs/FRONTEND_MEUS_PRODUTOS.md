# Frontend — jornada do vendedor

Prompt 25, 16/10/2026. Meus Produtos, publicação, edição parcial, status e imagens estão implementados sobre os providers, cliente HTTP e tema existentes. **Nenhuma dependência foi adicionada.** O backend e os [contratos auditados](FRONTEND_HANDOFF.md) foram preservados.

## Rotas e autorização

- `/meus-produtos`: lista própria, filtros e ações.
- `/meus-produtos/novo`: publicação.
- `/meus-produtos/:id/editar`: dados, status e imagens.

As três rotas usam o guard USUARIO_ATIVO. Sem sessão/onboarding/residência ativa, o resolvedor existente decide o destino. Super admin permanece no fluxo global. A navegação do morador tem Meus Produtos; o detalhe público oferece Editar anúncio apenas se o vendedor da resposta corresponde ao vínculo ativo atual.

O editor lê o UUID diretamente em GET /produtos/:id e confere vendedor.id_vinculo antes de exibir o formulário. Um anúncio alheio legível na vitrine não ganha permissão de edição, inclusive para admin local. UUID inválido e 404 têm erro navegável/retorno à lista. MEMBERSHIP_REQUIRED refaz o estado residencial e retira o editor quando a autoridade deixa de existir. A API continua sendo a autoridade de segurança.

## Operações e DTOs

Todas usam `apiFetch` autenticado; não há acesso direto a Supabase Database/Storage.

| Operação | DTO utilizado |
| --- | --- |
| GET /api/produtos/me | `ListaPaginada<MeuProduto>`: gestão com categoria.ativo e imagens, sem vendedor |
| GET /api/produtos/:id | `Objeto<ProdutoDetalhe>`: gestão, imagens e vendedor para verificar ownership |
| GET /api/categorias | `Objeto<Categoria[]>`, somente categorias ativas |
| POST /api/produtos | `Objeto<ProdutoCriado>`: categoria ID/nome, sem imagens/updated_at |
| PATCH /api/produtos/:id | `Objeto<ProdutoAtualizado>`: gestão sem imagens |
| PATCH /api/produtos/:id/status | Mesmo DTO de atualização, sem imagens |
| POST /api/produtos/:id/imagens | `Objeto<ImagemEnviada>`: ID/produto/ordem/created_at, sem signed URL |
| DELETE /api/produtos/:id/imagens/:idImagem | void, 204 sem JSON |

Nenhum DTO de PATCH é aplicado como se fosse um detalhe completo: uma leitura posterior sincroniza o editor sem apagar imagens por ausência do campo na resposta. Atualizações por status/imagem preservam o rascunho do formulário. Depois de PATCH salvo, um GET bem-sucedido redefine a base de comparação; se esse GET falhar, o retry de leitura conclui a reconciliação sem repetir o PATCH.

## Lista e filtros

`busca`, `id_categoria`, `ativo` e `pagina` ficam na URL, com limite fixo 20. Omitir ativo significa Todos, incluindo ativos/inativos; false é enviado explicitamente ao selecionar Inativos. Busca usa trim/máximo 140 e somente é submetida em Buscar/Enter. Busca/categoria/status reiniciam a página 1. Refresh preserva filtros; links de edição carregam somente a URL de retorno em estado da navegação.

O envelope usa dados[] + paginacao na raiz. A página trata loading, erro/retry, lista vazia, filtros sem resultado e página que ficou vazia; nunca mostra Página 1 de 0. Não há paginação em memória. AbortController impede respostas antigas de substituir uma seleção recente. Após mudança de status em voo, o refetch usa o filtro **atual**, mesmo se o usuário mudou de filtro enquanto aguardava.

Cards exibem imagem/placeholder, nome, categoria, BRL, estoque, status textual e Editar/Ativar/Desativar. Estoque zero é independente de ativo. Categoria inativa permanece visível com aviso. Atualizar lista renova a leitura e as URLs temporárias. Produtos desativados continuam na gestão; a vitrine segue sua própria API de visibilidade.

## Publicação e edição

`FormularioProduto` atende criação e edição. Zod valida nome trim 1..140, descrição não vazia, categoria UUID e estoque inteiro 0..2147483647. Preço aceita apresentação simples com vírgula ou ponto, sem separador de milhar, e é normalizado para **string decimal com ponto e duas casas**, positiva, até dez dígitos inteiros. Não há conversão do preço para número JSON.

POST envia somente id_categoria, nome_produto, descricao, preco e estoque. Sem categoria ativa a publicação é desabilitada com explicação. Após 201, a navegação usa o ID real retornado e abre o editor com confirmação; upload só aparece depois da leitura/ownership do produto persistido. Há trava contra clique duplicado.

Edição calcula diff com a base inicial normalizada. Sem alterações, Salvar fica desabilitado e a API também rejeita PATCH vazio. São enviados apenas campos editáveis que mudaram; ativo, imagens, proprietário, condomínio e datas não entram no PATCH geral. Erros de campo preservam todos os valores digitados.

Se a categoria atual ficou inativa, seu ID permanece selecionado como indisponível/inativa; o select não troca para a primeira categoria retornada. A opção inativa não é destino de uma troca. Editar nome/descrição/preço/estoque mantém id_categoria omitido; uma troca explícita usa categoria ativa. CATEGORY_NOT_FOUND/CATEGORY_INACTIVE atualizam categorias e orientam correção, mantendo o formulário.

Status é uma operação separada com body somente `{ "ativo": true }` ou false. Estoque zero não impede ativação; categoria inativa impede ativação e permite desativação. Há loading/feedback por produto, refetch e preservação dos filtros. O editor serializa suas operações de dados/status/imagem. Não existe DELETE de produto nesta UI.

## Imagens privadas

O gerenciador ordena a apresentação por ordem e permite **seleção única repetida**, uma operação por vez. Isso permite acrescentar várias fotos por envios sequenciais sem inventar multi-upload ou limite total. Cada foto só é confirmada após seu próprio 201; falha posterior não exclui sucessos anteriores.

O arquivo selecionado tem prévia local criada com URL.createObjectURL; troca/remoção/unmount revogam a URL. A prévia é identificada como local. JPEG/PNG/WEBP são aceitos até **5×1024×1024 bytes exatos**; arquivo vazio/tipo/tamanho inválidos recebem feedback. Validação de bytes permanece no backend.

Upload envia FormData com somente o campo imagem. O cliente existente injeta Bearer e o navegador cria Content-Type multipart com boundary; nenhum cabeçalho manual ou campo extra é acrescentado. Metadata de sucesso não é tratada como URL. Após sucesso ou falha há GET do produto para reconciliar imagens; falhas preservam seleção e permitem nova tentativa explícita.

Excluir confirma a foto selecionada, envia DELETE sem body/query e aceita 204 sem tentar JSON. A imagem não desaparece por atualização otimista: a lista vem do refetch. Não há compactação de ordem. IMAGE_NOT_FOUND atualiza a lista; IMAGE_DELETE_FAILED preserva o estado retornado pelo servidor e oferece tentativa explícita. Não há capa, reordenação manual ou exclusão de produto.

Signed URLs permanecem em memória/renderização. Falhas/expiração usam placeholder e não significam exclusão do registro. Atualizar imagens/lista refaz a API; não se persiste URL, storage_path ou credencial no cliente. Códigos de arquivo, ordem esgotada, upload/persistência/delete têm mensagens específicas, sem detalhes internos. ACCOUNT_SUSPENDED/UNAUTHENTICATED seguem o fluxo global existente. Escritas não são repetidas automaticamente por rede/conflito.

## Arquivos

Criados:

- `frontend/src/features/produtos/MeusProdutosPage.tsx`
- `frontend/src/features/produtos/FormularioProdutoPage.tsx`
- `frontend/src/features/produtos/FormularioProduto.tsx`
- `frontend/src/features/produtos/AcaoStatusProduto.tsx`
- `frontend/src/features/produtos/GerenciadorImagensProduto.tsx`
- `frontend/src/features/produtos/useCategoriasProduto.ts`
- `frontend/src/features/produtos/produto.erros.ts`
- `docs/FRONTEND_MEUS_PRODUTOS.md`

Alterados:

- `frontend/src/features/produtos/produto.api.ts`, `produto.schema.ts`, `produto.types.ts`: oito operações, validação, diff e DTOs distintos.
- `frontend/src/features/produtos/ProdutoPage.tsx`: link de edição somente do próprio anúncio.
- `frontend/src/routes/AppRoutes.tsx`, `frontend/src/layouts/ShellPage.tsx`: rotas e navegação.
- `frontend/src/styles.css`: gestão, formulário, imagens e ações responsivas no tema existente.
- `frontend/tests/infra.test.ts`, `frontend/tests/fluxos.browser.mjs`: validação e cenários de regressão/vendedor.
- `AGENTS.md`: somente estado/estrutura do frontend.

AuthProvider, EstadoUsuarioProvider, cliente HTTP, manifests, lock, BACKEND_INVENTARIO.md e FRONTEND_HANDOFF.md foram preservados. Comparação de hashes confirmou backend e banco intactos; nenhum SQL, migration ou alteração Prisma foi criado.

## Verificação e limites

```bash
npm run build
npm test --workspace frontend
```

Build da raiz (ambos os workspaces) e TypeScript strict passaram. **42 testes Node passaram**: 30 anteriores e 12 novos cobrindo preço/estoque, diff, filtros e tamanho/tipo de imagem. **71 cenários Chromium passaram**: 42 anteriores e 29 novos de vendedor. Auth usa o SDK real no navegador e HTTP simulado, sem criar usuários, produtos ou objetos no Supabase real. Não se declarou integração real com banco/Storage nesta etapa.

Os cenários verificam acesso/ownership, filtros/paginação/refresh, categoria inativa, criação com cinco campos e ID retornado, PATCH não vazio/parcial e categoria omitida, preço string/estoque number, status boolean com estoque zero, refetch de DTO sem imagens, rascunhos mantidos, multipart com um campo, limite exato de 5 MiB, múltiplos envios sequenciais, DELETE 204/cancelamento, falhas e retry explícito, 404/403, concorrência de filtros/status, remoção da vitrine e preservação na gestão, além de limpeza de prévia blob. Capturas mobile de 390 px e desktop de 1280 px foram inspecionadas.

O procedimento do Chromium continua em [FRONTEND_INFRA.md](FRONTEND_INFRA.md#verificação-reproduzível), usando Playwright/Chromium temporários já disponíveis; nenhuma dependência foi adicionada ao workspace. Não há lint frontend configurado. O build emite avisos não bloqueantes de anotações internas do Zod e bundle JavaScript de aproximadamente 623 kB (180 kB gzip).

Busca estática no código não encontrou chamadas a tabelas/Storage Supabase ou variáveis VITE de segredo/banco; o bundle também foi verificado e não contém literais de secret key/URL PostgreSQL. A limitação entre Storage e banco continua sendo tratada pelo backend e pelo refetch da UI; não se promete atomicidade distribuída.

Meus Pedidos completos, ações de pedido, Chat, Perfil/Transferência e Administração permanecem para os próximos prompts.
