# Exclusão de imagem do próprio produto

```http
DELETE /api/produtos/:id/imagens/:idImagem
Authorization: Bearer <token>
```

Sucesso: **204 No Content**, sem body. A rota não recebe body nem parâmetros de query. Os dois params precisam ser UUIDs e são normalizados para minúsculas via Zod. A sequência é autenticação → vínculo ativo → params → ausência de body/query → controller → service → repository/helper de Storage.

## Arquivos alterados

| Arquivo (relativo a backend) | Finalidade |
| --- | --- |
| `src/modules/produtos/produto.routes.ts` | Registra somente a nova rota DELETE e conecta os middlewares existentes. |
| `src/modules/produtos/produto.schema.ts` | Reutiliza UUID e schema do produto para validar `id`/`idImagem`; rejeita query extra. |
| `src/modules/produtos/produto.controller.ts` | Encaminha auth/params validados ao service e responde 204 sem body. |
| `src/modules/produtos/produto.service.ts` | Reutiliza ownership, confirma associação da imagem, coordena Storage antes do banco e registra falha parcial. |
| `src/modules/produtos/produto.repository.ts` | Busca imagem e exclui metadados com os filtros `id_imagem AND id_produto`. |
| `src/lib/storage.ts` | Acrescenta remoção com bucket privado e erros controlados; compartilha a chamada SDK exata com a compensação de upload, preservando seu contrato. |
| `tests/imagem-produto.test.ts` | Acrescenta 11 testes de validação, autorização, sequência, falhas, logs e contrato do SDK com transporte HTTP simulado. |
| `tests/imagem-produto.integration.test.ts` | Acrescenta 16 testes HTTP/PostgreSQL de exclusão, preservação, lacunas, leituras, upload e recuperação de falha parcial. |
| `UPLOAD_IMAGENS.md` | Referencia a exclusão e atualiza a verificação somente de leitura da privacidade do bucket. |
| `LEITURA_IMAGENS.md` | Referencia a exclusão e a confirmação mais recente de privacidade do bucket. |
| `EXCLUSAO_IMAGENS.md` | Registra contrato, decisões, falhas parciais, validação e cinco exemplos curl. |

Nenhum model/DTO novo foi necessário, pois a resposta não tem conteúdo. Não há dependências ou scripts novos.

## Ownership e isolamento

O service reutiliza `obterProdutoProprio`, usado no upload e na edição/status. A consulta exige `id_produto = :id AND id_vinculo_vendedor = auth.vinculo_ativo.id_vinculo`. O vínculo é derivado do banco na autenticação e precisa estar ATIVO. Sem vínculo, inclusive super admin sem vínculo residencial, retorna `403 MEMBERSHIP_REQUIRED`, o código existente. Admin local pode excluir somente suas próprias imagens.

Produto alheio, inexistente ou de vínculo histórico recebe o mesmo `404 PRODUCT_NOT_FOUND`, antes da consulta da imagem e do Storage. A imagem é buscada com `id_imagem = :idImagem AND id_produto = :id`. Ausente ou pertencente a outro produto, recebe `404 IMAGE_NOT_FOUND`, inclusive se o outro produto pertence ao mesmo vendedor. A query final de exclusão repete ambos os IDs.

Produto/categoria ativos ou inativos permitem exclusão pelo dono. Query/body com `storage_path`, usuário, vendedor ou condomínio são recusados; não são fontes alternativas de autoridade. Conta global suspensa continua bloqueada pela autenticação com `ACCOUNT_SUSPENDED`.

## Storage e objeto já ausente

O cliente singleton `supabaseAdmin` e o helper de Storage existentes são reutilizados. O helper consulta `getBucket('product-images')`, exige `public === false` e não altera configuração. `SUPABASE_SECRET_KEY` permanece exclusivamente no backend.

O path vem somente de `produto_imagem.storage_path`. O SDK recebe `remove([storagePath])` com **um nome completo exato**, sem reconstrução por IDs, filename ou prefixo. O SDK instalado envia esse array no campo HTTP chamado `prefixes`; esse nome não transforma o valor em exclusão recursiva. A API documenta nomes completos de arquivos, incluindo o caminho. [Referência oficial de remove](https://supabase.com/docs/reference/javascript/file-buckets-remove).

Com bucket sem versionamento, a implementação pública de remoção em lote retorna os objetos efetivamente removidos e pode produzir `200 []` quando nenhum dos nomes existe. O código aceita o retorno SDK `{ data: [], error: null }` como remoção já satisfeita. Essa interpretação pressupõe o cliente privilegiado de backend configurado, como no upload. [Implementação do servidor](https://github.com/supabase/storage/blob/master/src/storage/object.ts).

Se houver erro explícito `status === 404` e `statusCode === 'NoSuchKey'`, também considera o objeto já ausente. A documentação distingue `NoSuchKey` de `NoSuchBucket` e `TenantNotFound`; esses últimos, 404 genérico, falha de permissão e erros operacionais não são tratados como ausência. O comportamento do SDK instalado é exercitado com respostas HTTP simuladas. [Códigos oficiais do Storage](https://supabase.com/docs/guides/storage/debugging/error-codes).

O path não é retornado ao cliente nem em erros controlados. As signed URLs não são persistidas ou invalidadas manualmente; novos GETs deixam de incluir a imagem excluída. URLs anteriores seguem as regras de expiração/cache do Storage.

## Falhas parciais

1. **Storage falha antes do banco:** retorna `500 IMAGE_DELETE_FAILED`; não executa DELETE no banco. O registro permanece como referência para diagnóstico ou nova tentativa.
2. **Objeto já ausente:** sucesso vazio do Storage ou `NoSuchKey` explícito permite excluir o registro e concluir com 204. Um segundo DELETE após o registro ter sido removido retorna `404 IMAGE_NOT_FOUND`, sem nova chamada ao Storage.
3. **Storage remove e banco falha:** retorna `500 IMAGE_DELETE_FAILED` e registra `IMAGE_DELETE_INCONSISTENCY` com `id_produto`, `id_imagem`, `storage_path` e causa fixa `IMAGE_RECORD_DELETE_FAILED`. Não retorna erro bruto do Prisma, não finge sucesso e não tenta recriar o arquivo. Se o registro permaneceu, leituras omitem a imagem indisponível e uma nova tentativa pode limpar os metadados.

A ordem é **Storage → DELETE produto_imagem**. Não existe transação distribuída e não se usa `$transaction` como se abrangesse o Storage. Nenhum erro interno do SDK, JWT, secret, URL de conexão ou CPF é enviado ao cliente ou incluído no log de inconsistência.

## Ordem e preservação

Somente o objeto e a linha solicitados são removidos. As demais imagens não são atualizadas; `0,1,2` vira `0,2` ao excluir a ordem 1. A ordenação existente `ordem ASC, id_imagem ASC` continua estável e o próximo upload segue `max(ordem)+1`, podendo produzir 3. Excluir a menor ordem torna naturalmente a próxima imagem a primeira nas leituras.

A exclusão não altera produto, preço, estoque, timestamps do produto, categoria, vínculo, pedido, histórico, conversa ou auditoria. Fixtures dessas entidades são usadas apenas no banco descartável para verificar sua preservação. DDL, seeds, schema Prisma e frontend permanecem intactos; não há migration, reordenação, capa, exclusão/detalhe de produto ou implementação de pedidos/chat.

## Erros

| HTTP | Código | Situação |
| --- | --- | --- |
| 401 | `UNAUTHENTICATED` | Token ausente/inválido. |
| 403 | `MEMBERSHIP_REQUIRED` | Sem vínculo ATIVO, inclusive super admin sem vínculo. |
| 403 | `ACCOUNT_SUSPENDED` | Conta global suspensa. |
| 400 | `VALIDATION_ERROR` | UUID inválido, body JSON presente ou query extra. |
| 404 | `PRODUCT_NOT_FOUND` | Produto inexistente, alheio ou histórico. |
| 404 | `IMAGE_NOT_FOUND` | Imagem ausente ou não associada ao produto próprio. |
| 500 | `IMAGE_DELETE_FAILED` | Falha de Storage, bucket público/inacessível ou falha do DELETE após Storage. |

## Validação

A suíte específica de imagens passou com **21 testes unitários e 36 de integração HTTP/PostgreSQL**, incluindo os casos A–P do pedido, preservação das outras imagens, gaps, leitura após exclusão, repetição do DELETE e upload posterior. O SDK instalado também é exercitado com transporte HTTP simulado para verificar o método DELETE, o path exato e as respostas de ausência/erro.

Foram executados os **27 scripts de testes existentes**, todos aprovados: **351 testes**, sendo **139 de unidade e 212 de integração HTTP/PostgreSQL**. A regressão inclui autenticação, condomínios, onboarding, vínculos, administração, categorias e todas as operações anteriores de produtos/imagens. Cada script executa `tsc -p tsconfig.test.json`; TypeScript de backend e testes passou em strict. Não existem scripts genéricos `typecheck` ou `test`.

`npm run build` compilou o backend, mas o build completo continua falhando nos erros preexistentes de `ImportMeta.env` em `frontend/src/lib/api.ts` e `frontend/src/lib/supabase.ts`. Essas fontes não foram alteradas. `npm run dev` iniciou API em `localhost:3000` e Vite em `localhost:5173`; ambos foram encerrados após a verificação.

A comparação por SHA-256 confirmou que os 38 arquivos protegidos examinados — DDL/seeds, schema Prisma, fontes do frontend, manifests e lock — permaneceram intactos. Nenhuma migration foi criada e nenhum esquema remoto foi alterado. A instância PostgreSQL descartável dos testes foi encerrada após a validação.

A consulta somente de leitura ao Supabase configurado **confirmou `product-images` com `public === false` nesta etapa**. Nenhum objeto remoto foi excluído nos testes; o Storage é simulado, enquanto Express, JWT/JWKS e PostgreSQL local descartável são exercitados nas integrações. Nenhuma configuração de bucket foi alterada.

## Testes manuais

Todos os tokens e UUIDs abaixo são fictícios. Use imagens de teste descartáveis com as associações descritas. Repita a leitura de `/produtos` e `/produtos/me` após o sucesso para conferir que somente a imagem excluída desapareceu.

```bash
API='http://localhost:3000/api/produtos'
TOKEN='TOKEN_FICTICIO_VENDEDOR_ATIVO'
TOKEN_PENDENTE='TOKEN_FICTICIO_VINCULO_PENDENTE'
PRODUTO='20000000-0000-4000-8000-000000000001'
IMAGEM='30000000-0000-4000-8000-000000000001'
IMAGEM_INEXISTENTE='30000000-0000-4000-8000-000000000099'
PRODUTO_ALHEIO='20000000-0000-4000-8000-000000000002'
IMAGEM_ALHEIA='30000000-0000-4000-8000-000000000002'
IMAGEM_OUTRO_PRODUTO='30000000-0000-4000-8000-000000000003'

# 1. Produto próprio e imagem associada: 204, sem body.
curl -i -X DELETE "$API/$PRODUTO/imagens/$IMAGEM" \
  -H "Authorization: Bearer $TOKEN"

# 2. Produto próprio, imagem inexistente: 404 IMAGE_NOT_FOUND.
curl -i -X DELETE "$API/$PRODUTO/imagens/$IMAGEM_INEXISTENTE" \
  -H "Authorization: Bearer $TOKEN"

# 3. Produto de outro vendedor: 404 PRODUCT_NOT_FOUND.
curl -i -X DELETE "$API/$PRODUTO_ALHEIO/imagens/$IMAGEM_ALHEIA" \
  -H "Authorization: Bearer $TOKEN"

# 4. Imagem de outro produto do mesmo vendedor: 404 IMAGE_NOT_FOUND.
curl -i -X DELETE "$API/$PRODUTO/imagens/$IMAGEM_OUTRO_PRODUTO" \
  -H "Authorization: Bearer $TOKEN"

# 5. Usuário autenticado com vínculo PENDENTE: 403 MEMBERSHIP_REQUIRED.
curl -i -X DELETE "$API/$PRODUTO/imagens/$IMAGEM" \
  -H "Authorization: Bearer $TOKEN_PENDENTE"
```
