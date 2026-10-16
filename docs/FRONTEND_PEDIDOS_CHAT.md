# Frontend — Meus Pedidos, transições e chat

Prompt 26, 16/10/2026. Foram integradas as quatro operações auditadas de histórico, status e conversa, reutilizando AuthProvider, EstadoUsuarioProvider, cliente HTTP, layout e tema existentes. **Nenhuma dependência foi adicionada.**

## Rotas, navegação e guards

- `/pedidos`: compras/vendas próprias, filtros, histórico e ações.
- `/pedidos/:id/chat`: conversa pelo UUID do pedido, inclusive acesso direto e refresh.

Pedidos substitui a navegação desabilitada no shell ativo. A confirmação de criação oferece Ver meus pedidos. A tela de vínculo indisponível oferece Meus pedidos anteriores quando existe perfil. O shell histórico sem ATIVO não apresenta atalhos para vitrine/publicação nem exibe um condomínio atual fictício.

O guard original de Vitrine/Meus Produtos continua exigindo USUARIO_ATIVO. O novo GuardHistorico verifica sessão restaurada, ausência de erros globais e perfil onboarding_realizado=true/não super, **sem exigir residência atual**. Aceita inclusive perfil sem qualquer vínculo retornado; não depende de o resolvedor residencial conseguir liberar catálogo. Conta global suspensa, sessão rejeitada, erro de carga e pré-onboarding continuam bloqueados. A autorização final de participação histórica permanece no backend.

Super não acessa a listagem de pedidos próprios. Conforme o contrato existente, um deep link de chat admite super como leitor por ID: compositor desabilitado, sem painel administrativo de descoberta ou privilégio de envio como observador.

## APIs e DTOs

| Operação | Contrato utilizado |
| --- | --- |
| GET /api/pedidos/me | `ListaPaginada<MeuPedido>`: dados[] e paginacao na raiz |
| PATCH /api/pedidos/:id/status | Body status/motivo opcional; resposta id_pedido/status_pedido/ultima_atualizacao |
| GET /api/pedidos/:id/chat | dados[]/paginacao/conversa/pedido na raiz |
| POST /api/pedidos/:id/chat/messages | Body somente conteudo; resposta dados: MensagemChat |

Todas usam o apiFetch com Bearer e ApiError existente. Não há GET /api/pedidos/:id, criação/reparo de conversa, filtro por condomínio atual ou envio de IDs pessoais como autoridade. Nenhuma alteração de backend, DDL, Prisma, permissões ou contratos foi necessária.

## Filtros, paginação e histórico

`/pedidos?papel=compra&status=SOLICITADO&pagina=2` mantém filtros na URL. Todos omite papel; Compras/Vendas enviam compra/venda, nunca COMPRADOR/VENDEDOR. Status usa os cinco enums reais. Papel/status reiniciam página 1. Limite da interface é 20; o client aceita limite opcional para o contrato existente. Refresh e back/forward preservam a consulta.

A paginação é do servidor. Total zero mostra vazio, sem Página 1 de 0. Após alteração, a consulta mantém os filtros atuais e corrige página acima do novo total, inclusive voltando à primeira página quando não há registros. AbortController descarta leituras antigas; refetch de ação em voo usa o callback da consulta atual. Logout/troca de identidade desmonta conteúdo protegido pelo fluxo de sessão existente.

Cards usam `produto.id_produto` aninhado e mostram nome atual do produto, papel, contraparte/moradia, condomínio original, quantidade, valor total congelado, status e horário combinado. Não consultam preço atual nem recalculam valor_pedido. Datas ISO são exibidas no fuso do dispositivo. Histórico expansível preserva a ordem cronológica do backend, com estado anterior/novo, motivo e data; nenhum ator é inventado.

## Matriz de ações

| Papel histórico | Estado atual | Ações |
| --- | --- | --- |
| COMPRADOR | SOLICITADO ou ACEITO | Cancelar → CANCELADO |
| VENDEDOR | SOLICITADO | Aceitar → ACEITO; Recusar → RECUSADO |
| VENDEDOR | ACEITO | Concluir → CONCLUIDO |
| Qualquer | RECUSADO/CANCELADO/CONCLUIDO | Nenhuma |

Admin local não amplia essa matriz. Recusar/Cancelar/Concluir pedem confirmação nativa acessível; Aceitar é direto. Motivo é opcional, trim até 255, omitido quando vazio e nunca null. Há trava por pedido e controles desabilitados durante PATCH.

Após 200, a listagem/histórico são relidos e o feedback permanece visível mesmo se o pedido sair do filtro. Não se altera estoque ou histórico de forma otimista. INVALID_ORDER_TRANSITION mostra conflito e refaz os dados sem repetir PATCH. ORDER_STATUS_FORBIDDEN retira ações e atualiza a leitura; ORDER_NOT_FOUND retira conteúdo indisponível sem revelar terceiros. VALIDATION_ERROR preserva o motivo e mostra erro próximo do campo. Erros globais seguem o provider. Rede/conflito não repetem escrita automaticamente; permanece a política central preexistente e limitada para rejeição por autenticação.

## Chat

O acesso direto precisa somente do GET de chat além da infraestrutura habitual de sessão/perfil. O cabeçalho usa ID abreviado e status do pedido/conversa retornados nesse GET. Não depende de varrer o histórico para encontrar o pedido.

GET envia pagina=1/limite=50 por padrão. A ordem ASC é preservada: página 1 contém as mensagens mais antigas. Anterior/Próxima fazem paginação real, Ir para as últimas mensagens usa o total de páginas atualizado e Atualizar conversa refaz a leitura manualmente. Query inválida e UUID inválido possuem erro navegável. Não há polling, Realtime, WebSocket, push ou marcação de leitura.

Mensagens são texto React escapado, com nome, papel quando disponível e data local; não há HTML arbitrário ou avatar real inventado. Ao vir do card, o papel histórico pode orientar o balão próprio somente quando o contexto corresponde ao mesmo pedido e identidade autenticada. Esse contexto é apenas visual e não autoriza chamadas. Um acesso direto sem contexto usa balões neutros; um POST bem-sucedido também pode confirmar o papel do remetente pelo DTO retornado. Não se deduz autoria por nome ou residência atual.

Compositor valida conteudo trim 1..1000 e envia somente esse campo. Vazio/loading/ENCERRADA/observador impedem envio; uma trava síncrona evita duplo POST. Somente após 201 há confirmação, limpeza do input e refetch da última página com o total atualizado. Mensagens são renderizadas pelos IDs reais do GET, sem append otimista que possa duplicar o DTO do POST. Se a leitura posterior falhar, a confirmação do envio permanece e há retry de leitura. Falha de envio mantém o texto e não afirma sucesso nem repete POST.

CHAT_CLOSED em corrida desabilita o compositor, refaz a conversa e preserva leitura/texto. Pedido terminal não encerra chat por inferência: apenas status_conversa controla essa regra. CHAT_SEND_FORBIDDEN impede novo envio; VALIDATION_ERROR mantém texto para correção. ORDER_NOT_FOUND/CHAT_NOT_FOUND retiram mensagens indisponíveis e não criam conversa por fora. Suspensão global recebida durante uma atualização remove o conteúdo já exibido.

## Arquivos

Criados:

- `frontend/src/features/pedidos/MeusPedidosPage.tsx`
- `frontend/src/features/pedidos/AcaoPedido.tsx`
- `frontend/src/features/pedidos/pedido.regras.ts`
- `frontend/src/features/chat/ChatPedidoPage.tsx`
- `frontend/src/lib/data.ts`
- `docs/FRONTEND_PEDIDOS_CHAT.md`

Alterados:

- `frontend/src/features/pedidos/pedido.api.ts`, `pedido.types.ts`, `pedido.schema.ts`: contratos históricos, filtros e status.
- `frontend/src/features/chat/chat.api.ts`, `chat.types.ts`, `chat.schema.ts`: conversa, paginação e mensagem.
- `frontend/src/features/pedidos/ConfirmacaoPedido.tsx`: acesso à lista após criação.
- `frontend/src/features/vinculos/EstadoVinculoPage.tsx`: acesso ao histórico sem ATIVO.
- `frontend/src/routes/AppRoutes.tsx`, `estadoAplicacao.ts`: rotas/guard específico de histórico e regra pura de perfil.
- `frontend/src/layouts/ShellPage.tsx`, `frontend/src/styles.css`: navegação, shell histórico, cards e balões responsivos.
- `frontend/tests/infra.test.ts`, `frontend/tests/fluxos.browser.mjs`: novos cenários e regressão.
- `AGENTS.md`: somente estado/rotas reais do frontend.

Auth/providers, cliente HTTP, manifests/lock, BACKEND_INVENTARIO.md e FRONTEND_HANDOFF.md foram preservados. Comparação de hashes verificou backend e banco intactos.

## Verificação e limites

```bash
npm run build
npm test --workspace frontend
```

Build da raiz e TypeScript strict passaram. **57 testes Node passaram** (42 anteriores e 15 novos: perfil histórico, as dez combinações papel/estado, filtros, motivo, mensagem e paginação). **106 cenários Chromium passaram**, zero falhas ou skips na execução completa: 71 de regressão e 35 desta etapa. O navegador usa SDK Auth real e HTTP Auth/API simulados; não houve criação real de pedidos/mensagens nem integração remota com PostgreSQL/Storage neste prompt.

Os cenários verificam vínculo SUSPENSO/ENCERRADO/REJEITADO e perfil sem residência, interação histórica, conta suspensa inicial e em uso, filtros/refresh/back/paginação, total congelado e histórico, confirmações e matriz de ações, PATCH mínimo, 409/403/404 com refetch, correção de página vazia, chat legado, deep link, autoria neutra/contextual, ASC/últimas páginas, POST mínimo/duplo envio/201 sem duplicação, XSS como texto, conversa fechada versus pedido terminal, rede/validação/permissão, observador super, atualização manual, respostas atrasadas e logout/troca de conta. Capturas mobile de 390 px e desktop de 1280 px foram inspecionadas.

A execução de Chromium segue [FRONTEND_INFRA.md](FRONTEND_INFRA.md#verificação-reproduzível); o mesmo arquivo de cenários foi ampliado. Playwright/Chromium continuam no ambiente temporário, sem nova dependência de projeto. Não há lint frontend configurado.

Busca estática no código não encontrou supabase.from(), Supabase Storage, dangerouslySetInnerHTML ou variáveis VITE de segredo/banco; o bundle não contém literais de secret key/URL PostgreSQL. Permanecem avisos não bloqueantes de anotações internas do Zod e bundle JavaScript de aproximadamente 641 kB (185 kB gzip).

Perfil completo, transferência, administração local/global, notificações, recibos, pagamentos, realtime, confirmação de leitura e edição de horário do pedido permanecem fora desta etapa.
