# Consulta histórica de pedidos próprios

O ciclo de status e as rotas de chat estão documentados em [CICLO_PEDIDOS_CHAT.md](./CICLO_PEDIDOS_CHAT.md).

```http
GET /api/pedidos/me
Authorization: Bearer <token>
```

A rota retorna compras e vendas da identidade autenticada em **todos os seus vínculos residenciais**, incluindo vínculos encerrados/suspensos e pedidos terminais. A autorização se baseia no histórico próprio, sem exigir vínculo ativo atual ou limitar pelo condomínio atual.

O roteiro `Roteiro_Projeto_de_Software_Preenchido (1).docx`, agora disponível na raiz, foi consultado. Seu apêndice de rotas define a consulta como acesso por vínculo ATIVO/histórico próprio, e suas regras preservam identidade e vínculos anteriores. A implementação mantém os nomes REST em português já adotados.

## Arquivos alterados

| Arquivo relativo a backend | Finalidade |
| --- | --- |
| `src/modules/pedidos/pedido.routes.ts` | Registra o GET com autenticação, ausência de body e validação de query; mantém vínculo ativo somente no POST. |
| `src/modules/pedidos/pedido.controller.ts` | Encaminha contexto/query validada ao service e responde 200. |
| `src/modules/pedidos/pedido.schema.ts` | Query estrita com paginação, papel e enum real de status do Prisma. |
| `src/modules/pedidos/pedido.repository.ts` | Consulta perfil e todos os vínculos; aplica ownership no banco e carrega relações paginadas com count equivalente. |
| `src/modules/pedidos/pedido.service.ts` | Autoriza por perfil/identidade, coordena snapshot, deriva papel/contraparte e monta DTO sem efeitos de escrita. |
| `src/modules/pedidos/pedido.model.ts` | Reutiliza os tipos monetários/temporais de criação e o tipo de paginação existente; declara DTO de histórico próprio. |
| `tests/pedido.test.ts` | Acrescenta sete testes de query, autorização, filtros, seleção de relações, DTO e perfil sem vínculos. |
| `tests/pedido.integration.test.ts` | Acrescenta 15 testes HTTP/PostgreSQL de histórico, filtros, privacidade, ausência de conversa e preservação dos dados. |
| `CRIACAO_PEDIDOS.md` | Referencia a nova consulta e registra a disponibilidade posterior do roteiro. |
| `MEUS_PEDIDOS.md` | Documenta contrato, ownership histórico, formato, decisões, validação e exemplos curl. |

Não há scripts ou dependências novos: as suítes existentes `test:pedidos` e `test:pedidos:integration` passaram a cobrir as duas operações do módulo.

## Contrato e paginação

O envelope permanece no padrão existente, confirmado para esta tarefa: **`dados[]` e `paginacao` na raiz**.

| Query | Default | Valores aceitos |
| --- | --- | --- |
| `pagina` | `1` | Inteiro positivo; mantém a proteção técnica de overflow do deslocamento já usada nas listagens. |
| `limite` | `20` | Inteiro de 1 a 100. |
| `papel` | Sem filtro | Exatamente `compra` ou `venda`. |
| `status` | Sem filtro | Enum Prisma: `SOLICITADO`, `ACEITO`, `RECUSADO`, `CANCELADO`, `CONCLUIDO`. |

Query desconhecida/repetida, papel inválido e estados antigos como `PENDENTE`, `EM_PREPARO` e `ENTREGUE` retornam `400 VALIDATION_ERROR`. Não há aliases silenciosos. Body JSON presente também é rejeitado. Não são aceitos IDs de usuário, vínculo ou condomínio como fontes alternativas de identidade/autoridade.

Uma coleção vazia retorna `200`, `dados: []` e `total_paginas: 0`. Página além do fim retorna `dados: []`, preservando o total filtrado.

## Autorização e vínculos históricos

O JWT continua sendo validado pelo middleware existente, incluindo assinatura, issuer, audience e expiração. A conta global suspensa recebe `403 ACCOUNT_SUSPENDED`. Nenhuma regra global de autenticação foi alterada.

O service usa exclusivamente `auth.id_usuario` para confirmar a existência de `condomino.id_condomino`. Sem perfil, retorna o novo código `403 CONDOMINO_PROFILE_REQUIRED`, inclusive para super admin sem perfil residencial. Não cria perfil/vínculo automaticamente nem permite acesso administrativo a pedidos de terceiros por esta rota.

Todos os vínculos são consultados diretamente em `vinculo_condominio` com `id_condomino = auth.id_usuario`, **sem filtro por status**. A relação singular introspectada em `condomino.vinculo_condominio` não é usada, pois não representa todos os vínculos históricos.

Perfil com vínculo pendente/rejeitado e sem pedidos recebe 200 vazio. Vínculo suspenso ou encerrado e ausência de vínculo ativo não removem acesso ao histórico próprio. Uma solicitação pendente durante mudança também não oculta pedidos anteriores. Perfil sem vínculos retorna 200 vazio sem consultar pedidos.

## Compras, vendas e isolamento

A partir dos IDs dos vínculos próprios:

```text
compra: pedido.id_vinculo_comprador IN meusVinculos
venda:  pedido.produto.id_vinculo_vendedor IN meusVinculos
```

Sem `papel`, os dois filtros são combinados com OR; com papel, somente o ramo correspondente é aplicado. O status opcional é combinado com AND. Ownership é aplicado em `findMany` e `count` no PostgreSQL, sem buscar pedidos de um condomínio e filtrá-los em memória.

Não há filtro automático pelo condomínio atual. Um pedido antigo do condomínio A continua visível após a mudança para B, desde que esteja ligado a um vínculo da própria pessoa como comprador ou vendedor. Um pedido entre terceiros nunca aparece, mesmo no mesmo condomínio atual ou histórico.

O produto permanece ligado ao seu vendedor histórico. Não se usa o vínculo atual da contraparte para descobrir a negociação antiga. Produto/categoria inativos, vendedor suspenso e vínculos encerrados não escondem pedidos já existentes. Sem filtro de status, todos os cinco estados são incluídos.

## Papel, contraparte e condomínio

`papel_usuario` é derivado do pedido: se o vínculo comprador está no conjunto próprio, retorna `COMPRADOR`; caso contrário, o filtro de venda já garante a propriedade e retorna `VENDEDOR`. O campo não é persistido.

Na compra, a contraparte vem de `pedido.produto.vinculo_condominio.condomino`; na venda, de `pedido.vinculo_condominio.condomino`. Apenas `nome_completo` e `moradia` são expostos. A moradia é a do vínculo da negociação, mesmo quando a pessoa possui nova moradia em outro vínculo. O nome pertence ao perfil associado; o esquema não congela nomes pessoais.

O condomínio retornado vem do vínculo comprador daquele pedido, que registra o condomínio da negociação. Não é substituído pelo condomínio ativo atual.

## Valor, produto, histórico e chat

`valor_pedido` é lido do pedido e serializado com `toFixed(2)`, sem recalcular pelo preço atual. `produto.nome_produto` é metadata atual, como documentado no DTO; o esquema congela o valor, não o nome do produto.

`historico[]` contém `status_anterior`, `status_novo`, `motivo` e `created_at` em ISO UTC. A relação é ordenada por `created_at ASC, id_historico ASC`, mesmo com pedidos em ordem decrescente. O UUID do ator e seus dados pessoais não são carregados para esta listagem.

O chat retorna somente `disponivel` e `status_conversa`. Disponível significa que a conversa existe; isso não promete permissão de envio em um estado futuro do chat. Se não existe conversa em dado legado/inconsistente, retorna `{ disponivel: false, status_conversa: null }`, registra somente evento técnico e `id_pedido`, e continua retornando o pedido. Não cria nem repara conversa em GET. Histórico vazio também é aceito.

Não são carregadas mensagens, participantes, imagens ou preço/estoque atuais. Não há chamadas a Supabase Storage, geração de signed URLs ou mutações de status/estoque/horário/histórico/conversa.

## Resposta

Exemplo `200 OK`:

```json
{
  "dados": [
    {
      "id_pedido": "10000000-0000-4000-8000-000000000001",
      "papel_usuario": "COMPRADOR",
      "quantidade": 2,
      "valor_pedido": "50.00",
      "status_pedido": "CONCLUIDO",
      "hora_solicitacao": "2026-10-10T12:00:00.000Z",
      "hora_combinada": "2026-10-10T15:00:00.000Z",
      "ultima_atualizacao": "2026-10-10T15:30:00.000Z",
      "produto": {
        "id_produto": "20000000-0000-4000-8000-000000000001",
        "nome_produto": "Nome atual do produto"
      },
      "contraparte": {
        "nome_completo": "Maria Silva",
        "moradia": "Bloco A - Apto 101"
      },
      "condominio": {
        "id_condominio": "30000000-0000-4000-8000-000000000001",
        "nome_residencial": "Residencial da negociação"
      },
      "historico": [
        {
          "status_anterior": null,
          "status_novo": "SOLICITADO",
          "motivo": null,
          "created_at": "2026-10-10T12:00:00.000Z"
        },
        {
          "status_anterior": "SOLICITADO",
          "status_novo": "ACEITO",
          "motivo": null,
          "created_at": "2026-10-10T12:30:00.000Z"
        },
        {
          "status_anterior": "ACEITO",
          "status_novo": "CONCLUIDO",
          "motivo": null,
          "created_at": "2026-10-10T15:30:00.000Z"
        }
      ],
      "chat": { "disponivel": true, "status_conversa": "ATIVA" }
    }
  ],
  "paginacao": { "pagina": 1, "limite": 20, "total": 1, "total_paginas": 1 }
}
```

Somente fixtures dos testes simulam estados terminais e suas transições; nenhuma API de transição foi implementada nesta etapa.

## Performance e privacidade

Perfil, IDs dos vínculos, página e contagem compartilham uma transação `RepeatableRead`, mantendo um snapshot coerente. O `where` usado no `count` é o mesmo objeto do `findMany`. A página usa `skip/take`, ordenada por `hora_solicitacao DESC, id_pedido DESC`.

Produto, comprador, vendedor, condomínio, histórico e metadata da conversa são selecionados pela relação Prisma junto à página. Não há consulta em loops por pedido/produto/contraparte/histórico. São quatro operações lógicas de leitura quando há vínculos; as consultas de relações são resolvidas pelo Prisma em lote. Isso não pressupõe que todo o carregamento seja uma única instrução SQL. Os índices existentes são preservados e nenhum DDL foi alterado para micro-otimização.

A seleção e o mapeamento explícitos não expõem CPF, data de nascimento, e-mail, status da conta, UUIDs dos usuários/vínculos, JWT, refresh token ou secrets. O GET não altera dados, como verificado por comparação de produtos, pedidos, históricos, conversas, participantes, mensagens, imagens, vínculos e auditoria antes/depois de leituras repetidas.

## Validação

Os **29 scripts de testes existentes passaram**: **403 testes**, sendo **152 de unidade e 251 de integração HTTP/PostgreSQL**. Cada script executa primeiro `tsc -p tsconfig.test.json`, que passou com backend e testes em strict. Não existem scripts genéricos `typecheck` ou `test`, e eles não foram invocados.

A regressão inclui a criação transacional de pedidos com seus testes de estoque/concorrência/rollback, além de autenticação, condomínios, onboarding, vínculos, administração, categorias, produtos, upload, signed URLs e exclusão de imagens.

`npm run build` compilou o backend, mas o build completo continua falhando nos erros preexistentes de `ImportMeta.env` em `frontend/src/lib/api.ts` e `frontend/src/lib/supabase.ts`. Nenhuma fonte do frontend foi alterada. `npm run dev` iniciou API em `localhost:3000` e Vite em `localhost:5173`, encerrados após a verificação.

A comparação por SHA-256 confirmou a preservação dos 73 arquivos protegidos examinados: DDL/seeds, schema Prisma, fontes do frontend, módulos de produtos/chat/vínculos/usuários, middlewares, bibliotecas e manifests/lock. A comparação das implementações de criação de pedido confirmou que suas regras, queries, schema de body e controller permaneceram iguais. Não há migration, alteração estrutural ou escrita no Supabase do projeto. A instância PostgreSQL descartável foi encerrada após os testes.

As suítes existentes de pedidos passaram na verificação específica com **13 testes unitários e 39 de integração HTTP/PostgreSQL**, incluindo os testes anteriores do POST transacional. O banco de integração é local e descartável; JWT/JWKS são simulados. O Storage não é chamado. O roteiro fornecido não foi alterado.

## Exemplos curl

Tokens abaixo são fictícios. O token histórico deve representar uma pessoa com conta global ativa, perfil de condômino e pedidos ligados a vínculos antigos, mesmo sem vínculo ativo atual.

```bash
API='http://localhost:3000/api/pedidos/me'
TOKEN='TOKEN_FICTICIO_MORADOR'
TOKEN_HISTORICO='TOKEN_FICTICIO_SEM_VINCULO_ATIVO_COM_HISTORICO'

# 1. Compras e vendas de todos os vínculos próprios.
curl -i "$API" -H "Authorization: Bearer $TOKEN"

# 2. Somente compras.
curl -i "$API?papel=compra" -H "Authorization: Bearer $TOKEN"

# 3. Somente vendas.
curl -i "$API?papel=venda" -H "Authorization: Bearer $TOKEN"

# 4. Pedidos concluídos; demais estados do enum também são aceitos.
curl -i "$API?status=CONCLUIDO" -H "Authorization: Bearer $TOKEN"

# 5. Paginação e filtros combinados.
curl -i "$API?papel=venda&status=SOLICITADO&pagina=2&limite=2" \
  -H "Authorization: Bearer $TOKEN"

# 6. Sem vínculo ativo, com histórico próprio: 200.
curl -i "$API" -H "Authorization: Bearer $TOKEN_HISTORICO"
```
