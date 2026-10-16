# Ciclo do pedido e chat — Prompt 20

Implementados, com autenticação JWT já existente:

```http
PATCH /api/pedidos/:id/status
GET   /api/pedidos/:id/chat
POST  /api/pedidos/:id/chat/messages
```

A rota de envio usa exatamente `/messages`, conforme este prompt. `POST /api/pedidos` e `GET /api/pedidos/me` mantêm seus contratos.

## Status e estoque

| Estado anterior | Novo estado | Autoridade | Devolve estoque |
| --- | --- | --- | --- |
| SOLICITADO | ACEITO | Vendedor | Não |
| SOLICITADO | RECUSADO | Vendedor | Sim |
| SOLICITADO | CANCELADO | Comprador | Sim |
| ACEITO | CONCLUIDO | Vendedor | Não |
| ACEITO | CANCELADO | Comprador | Sim |

Não há saída de RECUSADO, CANCELADO ou CONCLUIDO. A identidade de comprador/vendedor é obtida dos `id_condomino` dos vínculos originais do pedido/produto, independentemente do vínculo ativo atual, transferência posterior ou suspensão local. Admin local e super admin não recebem privilégio adicional para alterar status: precisam ser a parte responsável pela transição. Conta global suspensa continua bloqueada pelo middleware.

O body é estrito: `status` aceita somente os quatro destinos acima; `motivo` é string opcional, normalizada com `trim`, de até 255 caracteres. Sem motivo, o histórico registra `null`. O parâmetro `id` deve ser UUID.

A transação `ReadCommitted` executa UPDATE condicional por `id_pedido` **e estado anterior**, exigindo exatamente uma linha alterada. Após disputar o mesmo estado, uma chamada vence e a outra retorna conflito, sem repetir a operação. Alteração de status, `ultima_atualizacao`, incremento atômico de estoque e histórico com `alterado_por` autenticado são confirmados juntos. Falha no histórico reverte tudo. Aceite e conclusão não restituem estoque; valor congelado e horário combinado permanecem intactos.

Erros: pedido inexistente ou alheio retorna `404 ORDER_NOT_FOUND`; parte tentando executar ação do outro papel retorna `403 ORDER_STATUS_FORBIDDEN`; transição inválida, repetida ou perdida em concorrência retorna `409 INVALID_ORDER_TRANSITION` (código já previsto em AGENTS.md). A autoridade do papel é conferida antes da matriz de estados.

Sucesso do PATCH: `200 { dados: { id_pedido, status_pedido, ultima_atualizacao } }`, com data ISO.

## Chat

- **Consultar:** comprador, vendedor e super admin. Terceiro/admin local sem participação recebe `404 ORDER_NOT_FOUND`.
- **Enviar:** comprador e vendedor históricos; super admin observador recebe `403 CHAT_SEND_FORBIDDEN`. Se também for parte, pode enviar nessa condição. O remetente é sempre a identidade autenticada.
- **Conteúdo:** body estrito `{ "conteudo": "texto" }`; `trim`, obrigatório, não vazio, até **1000 caracteres**. O projeto não tinha limite definido; foi adotado o limite deste prompt. `id_remetente`, datas e IDs de conversa enviados no body são rejeitados.
- **Conversa encerrada:** GET continua disponível; POST retorna `409 CHAT_CLOSED`. O envio mantém bloqueio `FOR SHARE` na conversa até o commit, impedindo encerramento entre a validação de ATIVA e a gravação. Nenhuma transição de pedido fecha/reabre conversa.
- **Conversa ausente:** `404 CHAT_NOT_FOUND` após autorizar o pedido; GET e POST não criam nem reparam conversa automaticamente.
- **Datas e leitura:** o INSERT usa o default do banco para `created_at`. Nenhuma dessas rotas modifica `ultimo_lido_em`.

GET aceita somente `pagina` e `limite`: defaults 1 e 50, limite máximo 100; rejeita parâmetros repetidos/desconhecidos e deslocamento fora do intervalo INTEGER. Mensagens seguem `created_at ASC, id_mensagem ASC`. `findMany` e `count` usam o mesmo filtro de conversa numa transação `RepeatableRead`, com nomes carregados por relações em lote, sem consulta individual por mensagem.

As respostas usam DTO explícito de mensagem: `id_mensagem`, `conteudo`, `created_at`, `remetente: { nome_completo, papel }`. Não expõem CPF, nascimento, e-mail, IDs de usuários/vínculos, tokens ou caminhos do Storage. Mensagens normais usam COMPRADOR/VENDEDOR; em eventual dado legado de remetente alheio à negociação, o papel é `null`, sem inventar uma autoridade; perfil ausente usa o nome genérico “Usuário”. Isso não autoriza novos envios de terceiros.

POST responde `201 { dados: <mensagem> }`. GET responde `200` no formato abaixo. **Listagens paginadas preservam `dados[]` e `paginacao` na raiz**, sem envelope `dados.itens`:

```json
{
  "dados": [
    {
      "id_mensagem": "10000000-0000-4000-8000-000000000001",
      "conteudo": "Posso buscar às 19h?",
      "created_at": "2026-10-16T12:10:00.000Z",
      "remetente": { "nome_completo": "Maria", "papel": "COMPRADOR" }
    }
  ],
  "paginacao": { "pagina": 1, "limite": 50, "total": 1, "total_paginas": 1 },
  "conversa": { "id_conversa": "20000000-0000-4000-8000-000000000001", "status_conversa": "ATIVA" },
  "pedido": { "id_pedido": "30000000-0000-4000-8000-000000000001", "status_pedido": "SOLICITADO" }
}
```

## Arquivos

- `src/modules/pedidos/pedido.{routes,controller,schema,service,repository,model}.ts`: PATCH, validação, autorização histórica compartilhada, DTO e persistência transacional.
- `src/modules/chat/chat.{routes,controller,schema,service,repository,model}.ts`: listagem e envio; preservadas as funções de criação da conversa/participantes usadas pelo POST de pedido.
- `tests/pedido.test.ts` e `tests/pedido.integration.test.ts`: validação, privacidade, matriz completa de estados/papéis, concorrência PostgreSQL sincronizada, restituição única, rollback por falha de FK, chat, paginação e autorização histórica.
- Este relatório e links em `CRIACAO_PEDIDOS.md` e `MEUS_PEDIDOS.md`.

A dependência entre services vai de chat para pedidos, reutilizando a autorização da negociação. Pedidos usa apenas o repository de chat para criar conversa/participantes. Não há importação circular entre services. Routes conectam middlewares/controllers; Prisma permanece nos repositories e a coordenação das transações nos services.

## Validação

- **29 scripts existentes passaram: 427 testes**, sendo 156 unitários e 271 de integração. As suítes de pedidos incluem 17 testes unitários e 59 de integração HTTP/PostgreSQL; os testes anteriores do POST transacional e GET histórico continuam passando.
- **TypeScript strict:** passou pelo `tsc -p tsconfig.test.json` executado pelos scripts, incluindo backend e testes. Não há scripts genéricos `typecheck` ou `test`; nenhum script novo foi criado.
- **Build:** `npm run build` compilou o backend. O build completo permanece bloqueado pelos erros preexistentes TS2339 de `ImportMeta.env` em `frontend/src/lib/api.ts:1` e `frontend/src/lib/supabase.ts:3,4`. O frontend não foi alterado.
- **Regressão:** produtos, estoque, categorias, imagens (upload, signed URLs e exclusão), vínculos/admin e onboarding passaram. A suíte de onboarding teve uma espera em banco com fixtures acumuladas; foi encerrada e repetida com sucesso numa segunda instância vazia, sem alterar a suíte original.
- **Banco:** testes somente em PostgreSQL local descartável, com JWT/JWKS simulados. Storage não é chamado pela suíte de pedidos/chat. Nenhuma escrita no Supabase do projeto.
- **Preservação:** comparação SHA-256 confirmou 125 arquivos preexistentes intactos fora dos 14 arquivos de código/testes desta etapa, incluindo DDL, Prisma, frontend, demais módulos e manifests/lock. Nenhuma migration, SQL novo ou alteração manual no schema Prisma. Instâncias locais encerradas após a validação.

## Exemplos curl

Tokens e UUIDs são fictícios. Use token do vendedor para aceitar e token de uma das partes para enviar.

```bash
API='http://localhost:3000/api'
PEDIDO='30000000-0000-4000-8000-000000000001'
TOKEN_VENDEDOR='TOKEN_FICTICIO_VENDEDOR'
TOKEN_COMPRADOR='TOKEN_FICTICIO_COMPRADOR'

curl -i -X PATCH "$API/pedidos/$PEDIDO/status" \
  -H "Authorization: Bearer $TOKEN_VENDEDOR" \
  -H 'Content-Type: application/json' \
  --data '{"status":"ACEITO","motivo":"Pode buscar às 19h"}'

curl -i "$API/pedidos/$PEDIDO/chat?pagina=1&limite=50" \
  -H "Authorization: Bearer $TOKEN_COMPRADOR"

curl -i -X POST "$API/pedidos/$PEDIDO/chat/messages" \
  -H "Authorization: Bearer $TOKEN_COMPRADOR" \
  -H 'Content-Type: application/json' \
  --data '{"conteudo":"Combinado, vou buscar às 19h."}'
```
