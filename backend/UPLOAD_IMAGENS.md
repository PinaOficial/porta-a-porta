# Upload de imagem de produto

As leituras `GET /api/produtos` e `GET /api/produtos/me` agora retornam imagens com signed URLs de 600 segundos. O contrato e os testes desta etapa estão em [LEITURA_IMAGENS.md](./LEITURA_IMAGENS.md). O contrato de upload abaixo permanece igual.

A exclusão de uma imagem própria está disponível em `DELETE /api/produtos/:id/imagens/:idImagem`, documentada em [EXCLUSAO_IMAGENS.md](./EXCLUSAO_IMAGENS.md).

`POST /api/produtos/:id/imagens` aceita `multipart/form-data` com **um arquivo no campo `imagem`**, sem campos textuais. Limite: **5 MB = 5.242.880 bytes**, inclusive. Tipos: `image/jpeg`, `image/png`, `image/webp`. Há allowlist Zod e inspeção básica das assinaturas binárias, sem decodificação completa da imagem.

Autenticação, vínculo ativo e UUID são validados antes do parser. Multer recebe o arquivo em memória limitada, sem arquivos temporários. O service confirma propriedade antes de chamar Storage: `id_produto` e `id_vinculo_vendedor` precisam coincidir com o produto solicitado e o vínculo ativo derivado pelo backend. Admin local segue a mesma regra; super admin sem vínculo recebe `MEMBERSHIP_REQUIRED`. Produto alheio e inexistente retornam o mesmo `404 PRODUCT_NOT_FOUND`, sem revelar sua existência. Produtos de vínculos históricos ficam fora desse escopo. Produto/categoria inativos permitem upload.

Resposta `201 Created`:

```json
{
  "dados": {
    "id_imagem": "10000000-0000-4000-8000-000000000001",
    "id_produto": "20000000-0000-4000-8000-000000000001",
    "ordem": 0,
    "created_at": "2026-10-15T23:00:00.000Z"
  }
}
```

## Arquivos e dependências

| Arquivo | Finalidade |
| --- | --- |
| `backend/src/modules/produtos/produto.routes.ts` | Registra a rota e a sequência de middlewares. |
| `backend/src/modules/produtos/produto.upload.ts` | Multer memoryStorage: um arquivo, zero campos textuais, limites e erros controlados. |
| `backend/src/modules/produtos/produto.schema.ts` | MIME, tamanho e assinatura binária via Zod; reutiliza UUID existente. |
| `backend/src/modules/produtos/produto.controller.ts` | Encaminha arquivo/contexto/parâmetro validados e responde 201. |
| `backend/src/modules/produtos/produto.service.ts` | Reutiliza ownership; gera path/ordem; coordena upload, insert e compensação. |
| `backend/src/modules/produtos/produto.repository.ts` | Consulta maior ordem e insere somente metadados da nova imagem. |
| `backend/src/modules/produtos/produto.model.ts` | Tipo do arquivo e DTO mínimo da imagem criada. |
| `backend/src/lib/storage.ts` | Consulta privacidade, faz upload sem sobrescrever e remove objeto exato na compensação. |
| `backend/src/lib/supabase.ts` | Reutiliza cliente privilegiado; configura transporte ws para o SDK no Node 20. |
| `backend/tests/imagem-produto.test.ts` | 10 testes de service/repository/Storage e falhas controladas. |
| `backend/tests/imagem-produto.integration.test.ts` | 20 testes HTTP com multipart/JWT/Prisma/PostgreSQL local e Storage simulado. |
| `backend/package.json` | Dependências e scripts `test:imagem-produto` e `test:imagem-produto:integration`. |
| `package-lock.json` | Lock das dependências do workspace backend. |
| `backend/UPLOAD_IMAGENS.md` | Contrato, configuração, decisões, verificação e exemplos curl. |

Adicionados ao backend: `multer ^2.4.0`, `@types/multer ^2.3.0` (desenvolvimento), `ws ^8.22.0` e `@types/ws ^8.18.2` (desenvolvimento). A versão instalada do Supabase inicializa Realtime na criação do cliente e exige transporte explícito em Node 20; configurar ws permite usar o cliente existente sem abrir uma conexão Realtime.

## Storage, banco e compensação

O bucket existente deve se chamar **`product-images`**, ser **privado** e permitir ao cliente de backend consultar seus metadados, enviar e remover objetos. Nenhum bucket é criado ou alterado em runtime. Antes de enviar, a API consulta `getBucket` e exige `public === false`; bucket ausente, público ou inacessível produz erro controlado.

A configuração remota não foi alterada. Na validação mais recente, da etapa de exclusão, uma consulta somente de leitura ao Supabase confirmou `product-images` com `public = false`; a falha anterior de resolução `ENOTFOUND` não ocorreu nessa consulta. Os testes de privacidade usam Storage simulado e cobrem rejeição de bucket público/ausente/inacessível.

Path interno: `produtos/<id_produto>/<crypto.randomUUID()>.<extensão>`. A extensão vem do MIME validado (`jpg`, `png`, `webp`); `originalname` nunca participa do path. O upload usa `contentType` validado e `upsert: false`.

Em `produto_imagem`, o insert fornece somente `id_produto`, `storage_path` e `ordem`. O PostgreSQL gera `id_imagem` e `created_at`. Ordem inicial zero, próximas ordens `max(ordem) + 1`, inclusive havendo lacunas. Sem constraint única de ordem no esquema atual, uploads concorrentes podem empatar; os paths permanecem únicos. O intervalo SMALLINT existente é respeitado com erro controlado no esgotamento, sem inventar limite adicional de quantidade de imagens.

Fluxo: **upload Storage → insert DB**. Falha no upload impede o insert. Falha no insert provoca remoção somente do path recém-enviado. Se essa remoção também falhar, a resposta continua sendo erro e o log contém apenas evento, produto, path e causa resumida. Pode restar objeto órfão para manutenção nesse caso; não há transação distribuída entre Storage e PostgreSQL.

`SUPABASE_SECRET_KEY` continua exclusivamente no backend. Não há signed/public URL no banco ou na resposta do upload. As leituras agora incluem signed URLs temporárias conforme [LEITURA_IMAGENS.md](./LEITURA_IMAGENS.md); produto, categoria, estoque, pedidos, chat e auditoria não são alterados pelo upload. Suspensão posterior do vendedor preserva registro e arquivo. Nenhum DDL, SQL de seed ou schema Prisma foi alterado e nenhuma migration foi criada.

## Erros

| HTTP | Código | Situação |
| --- | --- | --- |
| 401 | `UNAUTHENTICATED` | Token ausente/inválido. |
| 403 | `MEMBERSHIP_REQUIRED` | Sem vínculo ativo, inclusive super admin sem vínculo. |
| 403 | `ACCOUNT_SUSPENDED` | Conta global suspensa. |
| 400 | `VALIDATION_ERROR` | UUID inválido, multipart malformado, campo extra/errado, vários arquivos. |
| 404 | `PRODUCT_NOT_FOUND` | Produto inexistente, alheio ou de vínculo histórico. |
| 400 | `IMAGE_REQUIRED` | Arquivo ausente ou vazio. |
| 413 | `IMAGE_TOO_LARGE` | Arquivo acima de 5 MB. |
| 415 | `IMAGE_TYPE_NOT_ALLOWED` | MIME proibido ou conteúdo incompatível com assinatura esperada. |
| 409 | `IMAGE_ORDER_EXHAUSTED` | Próxima ordem excede SMALLINT. |
| 500 | `IMAGE_UPLOAD_FAILED` | Bucket mal configurado/inacessível ou upload falhou. |
| 500 | `IMAGE_PERSISTENCE_FAILED` | Insert falhou; compensação tentada. |

## Exemplos curl

Tokens e UUIDs abaixo são fictícios. Use um produto do vínculo ativo do token, exceto no exemplo de produto alheio. Os arquivos devem existir no computador. O curl define o boundary multipart automaticamente; não defina `Content-Type` manualmente.

```bash
TOKEN='TOKEN_FICTICIO'
PRODUTO='20000000-0000-4000-8000-000000000001'
PRODUTO_ALHEIO='20000000-0000-4000-8000-000000000002'
API='http://localhost:3000/api/produtos'

# 1. JPEG válido: 201
curl -i -X POST "$API/$PRODUTO/imagens" \
  -H "Authorization: Bearer $TOKEN" -F 'imagem=@foto.jpg;type=image/jpeg'

# 2. PNG válido: 201
curl -i -X POST "$API/$PRODUTO/imagens" \
  -H "Authorization: Bearer $TOKEN" -F 'imagem=@foto.png;type=image/png'

# 3. Arquivo acima de 5.242.880 bytes: 413 IMAGE_TOO_LARGE
curl -i -X POST "$API/$PRODUTO/imagens" \
  -H "Authorization: Bearer $TOKEN" -F 'imagem=@foto-grande.jpg;type=image/jpeg'

# 4. MIME inválido, mesmo com filename .jpg: 415 IMAGE_TYPE_NOT_ALLOWED
curl -i -X POST "$API/$PRODUTO/imagens" \
  -H "Authorization: Bearer $TOKEN" -F 'imagem=@documento.pdf;filename=foto.jpg;type=application/pdf'

# 5. Produto alheio com arquivo válido: 404 PRODUCT_NOT_FOUND
curl -i -X POST "$API/$PRODUTO_ALHEIO/imagens" \
  -H "Authorization: Bearer $TOKEN" -F 'imagem=@foto.jpg;type=image/jpeg'

# 6. Sem arquivo: 400 IMAGE_REQUIRED
curl -i -X POST "$API/$PRODUTO/imagens" -H "Authorization: Bearer $TOKEN"
```

## Verificação da etapa de upload

Os scripts de teste executam primeiro `tsc -p tsconfig.test.json`, incluindo backend e testes em strict. Os testes de integração exigem `ONBOARDING_TEST_DATABASE_URL` apontando para PostgreSQL local descartável chamado `porta_onboarding_teste`. JWT/JWKS e Storage são simulados; nenhum arquivo real foi enviado ao Supabase.

Os 10 testes novos de unidade e os 20 testes novos HTTP passaram, assim como todas as suítes anteriores de regressão: **309 testes aprovados**, sendo 119 de unidade e 190 de integração. Foram executados os scripts existentes de categorias, condomínios, onboarding, vínculos, fila administrativa, aprovação, rejeição, suspensão, vitrine, criação, listagem própria, edição e status de produto; as suítes HTTP também conferem health e as rotas anteriores.

`npm run build` compila o backend, mas o build completo ainda encontra os erros anteriores de `ImportMeta.env` em `frontend/src/lib/api.ts` e `frontend/src/lib/supabase.ts`, fora do escopo desta tarefa. Não há scripts genéricos `typecheck` ou `test` neste workspace; a checagem TypeScript é executada pelos scripts específicos de teste e pelo build do backend.

`npm run dev` continua sendo o comando principal: backend e Vite iniciaram e foram encerrados após a verificação. DDL, seeds, schema Prisma e `package.json` da raiz foram conferidos por SHA-256 e preservados.
