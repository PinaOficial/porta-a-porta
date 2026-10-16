# Imagens nas leituras de produtos

A exclusão de uma imagem própria está documentada em [EXCLUSAO_IMAGENS.md](./EXCLUSAO_IMAGENS.md). Após excluí-la, estas leituras retornam somente as imagens restantes.

`GET /api/produtos` e `GET /api/produtos/me` retornam `imagens` com signed URLs temporárias. A vitrine substitui os antigos placeholders `url: null`; a listagem própria acrescenta o array sem remover campos. Produtos sem imagens retornam `imagens: []`.

```json
{
  "imagens": [
    {
      "id_imagem": "10000000-0000-4000-8000-000000000001",
      "ordem": 0,
      "url": "https://projeto.supabase.co/storage/v1/object/sign/product-images/arquivo.png?token=FICTICIO",
      "expires_in": 600
    }
  ]
}
```

## Arquivos

| Arquivo | Finalidade |
| --- | --- |
| `src/lib/storage.ts` | Assinatura em lote, TTL central, exigência de bucket privado, tratamento de falhas e logs seguros. Reutiliza o cliente singleton existente. |
| `src/modules/produtos/produto.repository.ts` | Seleciona imagens e paths junto à página de ambas as listagens, com ordenação estável. |
| `src/modules/produtos/produto.model.ts` | Define `ProdutoImagemDto`, amplia os DTOs das leituras e preserva o DTO de edição/status. |
| `src/modules/produtos/produto.service.ts` | Coleta paths após autorização/paginação e monta explicitamente os DTOs usando o mapa de URLs. |
| `tests/produto.test.ts` | Testa lote, deduplicação, associação por path, falhas, SDK real com transporte simulado e ausência de N+1. Atualiza o antigo contrato `url: null`. |
| `tests/meus-produtos.test.ts` | Atualiza seleção Prisma e contrato com imagens vazias, mantendo testes de filtros e autorização. |
| `tests/produto.integration.test.ts` | Amplia testes HTTP/PostgreSQL: imagens autorizadas, exclusões de vitrine, ordem, paginação, path órfão e não persistência. |
| `tests/meus-produtos.integration.test.ts` | Amplia testes HTTP/PostgreSQL: imagens próprias ativas/inativas, categorias inativas, ownership, paginação e não persistência. |
| `tests/editar-produto.integration.test.ts` | Simula assinatura nas leituras de regressão e reconhece `imagens: []` no GET, preservando a resposta PATCH. |
| `tests/status-produto.integration.test.ts` | Simula assinatura nas leituras de regressão sem acesso ao Storage real. |
| `tests/imagem-produto.integration.test.ts` | Acrescenta assinatura ao Storage simulado e verifica que o upload continua aparecendo nas duas leituras. |
| `tests/storage-assinatura.fake.ts` | Fixture compartilhada de Storage para testes, com retorno propositalmente invertido e falhas por path. |
| `UPLOAD_IMAGENS.md` | Referencia o contrato atualizado das leituras. |
| `LEITURA_IMAGENS.md` | Documenta implementação, validação e testes manuais desta etapa. |

## URLs e performance

A constante `PRODUCT_IMAGE_SIGNED_URL_TTL_SECONDS = 600` fica em `src/lib/storage.ts`: validade de dez minutos a partir da assinatura. O helper usa exclusivamente `product-images`, exige `getBucket().data.public === false` e chama `createSignedUrls` do SDK instalado (`@supabase/supabase-js` 2.109.0). Não cria um cliente por request, não altera o bucket e não usa URLs públicas.

O repository continua cuidando somente de Prisma. `findMany` paginado seleciona a relação `produto_imagem` com `id_imagem`, `storage_path` e `ordem`, ordenada por `ordem ASC, id_imagem ASC`. Não há consultas por produto ou por imagem em loops. Página e contagem mantêm a transação `RepeatableRead` existente.

Depois da query, o service reúne os paths exclusivamente dos produtos autorizados da página. O helper deduplica, faz uma consulta de privacidade e **uma assinatura em lote por página com imagens**. Não há assinatura individual sequencial. O mapa usa o `path` devolvido pelo Storage, sem depender da posição do resultado; o DTO preserva a ordem consultada no banco. Sem paths, nenhuma chamada ao Storage é feita, nem mesmo `getBucket`.

As URLs existem somente na resposta em memória e não participam de operações de escrita. O banco continua guardando somente `storage_path` e os demais metadados existentes. O campo `storage_path` não é exposto no DTO porque é um detalhe interno; o frontend recebe a URL pronta. A própria signed URL pode conter o path no endereço, como exige o formato do Supabase.

## Falhas e segurança

- Objeto inexistente, erro individual, URL ausente ou item omitido no retorno batch: omite somente a imagem afetada e registra evento, path e causa resumida. O GET não remove nem repara registros.
- Falha operacional do Storage, inclusive HTTP/rede reportados pelo SDK: retorna os produtos com `imagens: []` e log técnico seguro.
- Bucket público, ausente ou inacessível: não assina; retorna produtos com imagens vazias.
- Erros inesperados de programação propagam para o tratamento HTTP existente; não há `catch` genérico novo para escondê-los.

Os logs não incluem a resposta bruta do Supabase, signed URLs, JWT, secret, conexão do banco ou CPF. A secret permanece no cliente existente exclusivamente no backend.

A assinatura ocorre depois da autorização e das queries filtradas. A vitrine mantém produto ativo, categoria ativa, vendedor com vínculo ATIVO e mesmo condomínio; morador/admin local não ampliam escopo pela query. Super admin continua obrigado a selecionar `id_condominio` de condomínio ativo. `/me` mantém ownership pelo vínculo ativo, admite produtos/categorias inativos e nega super admin sem vínculo.

Paginação, busca, categoria, filtro `ativo` de `/me`, ordenação dos produtos e preço `Decimal.toFixed(2)` não mudaram. Respostas de POST, PATCH de edição/status e upload preservam seus contratos. Não há rota nova, frontend, cache, exclusão, reordenação, capa, detalhe, pedido ou chat.

Não foram alterados DDL, seeds, schema Prisma ou configuração remota do bucket; nenhuma migration foi criada. As integrações usam uma instância PostgreSQL descartável local criada com o DDL existente, sem modificar o banco do projeto.

## Validação

Os scripts existentes `test:*` executam `tsc -p tsconfig.test.json` antes dos testes. Não existem scripts genéricos `typecheck` ou `test`; não foram criados scripts/dependências novos.

Foram executados os **27 scripts de teste existentes**, todos aprovados: **324 testes**, sendo **128 de unidade e 196 de integração HTTP/PostgreSQL**. Isso inclui autenticação, condomínios, onboarding, vínculos, administração, categorias, vitrine, criação/listagem própria/edição/status de produto e upload. Os testes cobrem os casos A–J do pedido, filtros de regressão, assinatura em lote, deduplicação, retorno fora de ordem, não persistência, bucket público/ausente/inacessível e propagação de bugs inesperados. O TypeScript de backend e testes passou em strict, executado por cada script.

`npm run build` compilou o backend, mas o build completo falhou nos erros preexistentes de `ImportMeta.env` em `frontend/src/lib/api.ts` e `frontend/src/lib/supabase.ts`, já registrados em `UPLOAD_IMAGENS.md`. O frontend não foi alterado nesta tarefa. `npm run dev` iniciou a API em `localhost:3000` e Vite em `localhost:5173`, sendo ambos encerrados após a verificação.

Na validação original desta etapa, a consulta ao Supabase retornou `StorageUnknownError` com causa `ENOTFOUND`, inclusive fora do sandbox, impedindo a confirmação remota. Na validação posterior da etapa de [exclusão](./EXCLUSAO_IMAGENS.md), a consulta somente de leitura funcionou e confirmou o bucket privado. Nenhum bucket/objeto remoto foi modificado. Os testes de leitura usam Storage simulado e também exercitam a API do SDK instalado com transporte HTTP simulado, incluindo HTTP 503 e falha de rede. A API exige bucket privado antes de assinar.

A comparação por SHA-256 confirmou a preservação dos 38 arquivos existentes de DDL/seeds/schema Prisma, fontes do frontend e manifests/lock examinados. Não há dependências novas ou mudanças nos comandos da raiz.

## Testes manuais

Tokens e UUIDs são fictícios. Substitua por dados de teste autorizados. Os exemplos de busca pressupõem produtos previamente cadastrados com os nomes indicados; não existe filtro por presença de imagem nem rota de detalhe nesta etapa.

```bash
API='http://localhost:3000/api'
TOKEN='TOKEN_FICTICIO_MORADOR'
TOKEN_SUPER_ADMIN='TOKEN_FICTICIO_SUPER_ADMIN'
CONDOMINIO='20000000-0000-4000-8000-000000000001'

# 1. Vitrine: produto ativo com imagem válida no mesmo condomínio.
# Esperado: imagens com url assinada e expires_in 600.
curl -i "$API/produtos?busca=Bolo&pagina=1&limite=20" \
  -H "Authorization: Bearer $TOKEN"

# 2. Painel do vendedor: imagens somente dos produtos próprios.
curl -i "$API/produtos/me?pagina=1&limite=20" \
  -H "Authorization: Bearer $TOKEN"

# 3. Produto previamente cadastrado sem imagem: imagens [].
curl -i "$API/produtos?busca=Produto%20sem%20foto" \
  -H "Authorization: Bearer $TOKEN"

# 4. Produto próprio inativo com imagem: continua retornando imagem.
curl -i "$API/produtos/me?ativo=false&busca=Bolo%20pausado" \
  -H "Authorization: Bearer $TOKEN"

# 5. Super admin: seleção explícita de condomínio ativo.
curl -i "$API/produtos?id_condominio=$CONDOMINIO&pagina=1&limite=20" \
  -H "Authorization: Bearer $TOKEN_SUPER_ADMIN"
```

Super admin sem `id_condominio` na vitrine recebe `400 CONDOMINIUM_REQUIRED`; sem vínculo ativo em `/produtos/me`, recebe `403 MEMBERSHIP_REQUIRED`. Para validar expiração, uma URL emitida deve funcionar antes de 600 segundos e deixar de autorizar o acesso após a expiração. Para observar omissão de órfão manualmente, use um registro de teste cujo objeto esteja ausente, confirme `200` sem a imagem problemática e confira que o registro continua intacto.
