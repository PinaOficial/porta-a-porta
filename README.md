# Porta a Porta — template inicial

Template acadêmico do projeto **Porta a Porta**.

A estrutura foi preparada para um único ambiente de execução local/apresentação:

- Frontend: React + TypeScript + Vite + shadcn/ui (componentes adicionados conforme necessário)
- Backend: Node.js + Express + TypeScript
- Validação: Zod
- Auth/Storage/PostgreSQL: Supabase
- ORM: Prisma 7, usando abordagem **database-first**
- Execução local: um único `npm run dev` na raiz

## Ordem recomendada

1. Leia `GUIA_PASSO_A_PASSO_SUPABASE_PRISMA.md`.
2. Crie/configure o projeto no Supabase.
3. Execute `database/00_ddl_base.sql` no SQL Editor.
4. Execute `database/01_usuario_prisma.sql` após trocar a senha do usuário `prisma`.
5. Opcionalmente execute `database/02_seed_categorias.sql`.
6. Configure `frontend/.env` e `backend/.env` a partir dos exemplos.
7. Na raiz, execute `npm install`.
8. Execute `npm run prisma:sync`.
9. Execute `npm run dev`.
10. Abra `http://localhost:5173`.

Após a infraestrutura básica funcionar, use o `AGENTS.md` como instrução permanente para o Codex.
Veja `PROMPT_CODEX_EXEMPLO_PRODUTOS.md` para um exemplo de tarefa.

## Autenticação e condomínios para onboarding

`GET /api/health` é público. `GET /api/condominios` exige um access token válido,
mas pode ser acessado antes do onboarding e sem vínculo ATIVO.

O middleware `autenticar` valida o JWT localmente com `jose`, usando o JWKS em
`<SUPABASE_URL>/auth/v1/.well-known/jwks.json` com cache de chaves. São validados
assinatura ES256/RS256, issuer `<SUPABASE_URL>/auth/v1`, audience `authenticated`,
expiração obrigatória e `sub` no formato UUID. O backend não emite tokens próprios.

`req.auth.id_usuario` vem exclusivamente de `sub`; o e-mail válido da claim
assinada é disponibilizado opcionalmente em `req.auth.email`, normalizado.
Quando ainda não há
`public.usuario`, o contexto contém `id_usuario` e `super_admin: false`, sem
vínculo. Para usuários cadastrados, a conta suspensa é negada; super admin vem
da relação com a tabela `super_admin`, e o vínculo ATIVO dos demais usuários é
buscado no banco. Nenhuma permissão vem de metadata do token ou do cliente.

A rota de condomínios seleciona apenas `id_condominio`, `nome_residencial`, `cep`
e `endereco` de registros com `ativo = true`. A ordenação é por nome crescente,
com UUID como desempate. Os filtros opcionais são:

| Parâmetro | Comportamento |
| --- | --- |
| `busca` | Nome residencial, case-insensitive, trim, entre 1 e 160 caracteres |
| `pagina` | Inteiro positivo, padrão 1 |
| `limite` | Inteiro de 1 a 50, padrão 20 |

O service calcula o deslocamento `(pagina - 1) * limite` e `total_paginas`.
O deslocamento deve caber no intervalo de inteiro PostgreSQL. Consulta e
contagem usam os mesmos filtros e snapshot transacional. A resposta contém
`dados` e `paginacao` (`pagina`, `limite`, `total`, `total_paginas`); uma lista
vazia retorna `200` com `total_paginas: 0`.

Tokens ausentes ou inválidos retornam `401 UNAUTHENTICATED`; conta globalmente
suspensa retorna `403 ACCOUNT_SUSPENDED`; query inválida, repetida ou com campos
desconhecidos retorna `400 VALIDATION_ERROR` com detalhes da validação.
Erros inesperados retornam `500 INTERNAL_ERROR`, sem stack trace no JSON.

Para executar e validar o backend:

```bash
npm run build --workspace backend
npm run test:condominios --workspace backend
npm run start --workspace backend
```

Exemplos de teste manual, com a API iniciada na porta 3000:

```bash
# 200: health público
curl -i http://localhost:3000/api/health

# 401: sem token
curl -i http://localhost:3000/api/condominios

# Substitua o placeholder por um access token válido do Supabase Auth.
# 200 inclusive quando o UUID do token ainda não existe em public.usuario.
curl -i http://localhost:3000/api/condominios \
  -H 'Authorization: Bearer <ACCESS_TOKEN>'

# 200: busca, paginação e apenas registros ativos
curl -i 'http://localhost:3000/api/condominios?busca=residencial&pagina=1&limite=20' \
  -H 'Authorization: Bearer <ACCESS_TOKEN>'

# 400: paginação inválida, com token válido
curl -i 'http://localhost:3000/api/condominios?pagina=0&limite=999' \
  -H 'Authorization: Bearer <ACCESS_TOKEN>'

# 403 ACCOUNT_SUSPENDED: use uma conta de teste já suspensa
curl -i http://localhost:3000/api/condominios \
  -H 'Authorization: Bearer <ACCESS_TOKEN_DA_CONTA_SUSPENSA>'
```

Os testes automatizados usam banco simulado e JWTs assinados localmente,
sem acessar serviços externos nem modificar dados.

## Onboarding inicial

`POST /api/onboarding` exige autenticação e aceita somente este body:

```json
{
  "nome_completo": "Maria da Silva",
  "cpf": "123.456.789-00",
  "data_nascimento": "2000-05-20",
  "id_condominio": "<UUID_DE_UM_CONDOMINIO_ATIVO>",
  "moradia": "Bloco B - Apto 302"
}
```

O schema estrito rejeita campos extras, inclusive UUID de usuário, e-mail,
privilégios e status. Nome e moradia recebem trim, com limites de 160 e 80
caracteres. O CPF é normalizado para 11 dígitos, sem validar dígitos verificadores.
A data civil deve ser válida em `YYYY-MM-DD`; ela é representada como meia-noite
UTC para persistência na coluna PostgreSQL `DATE`, preservando o dia.

O UUID vem de `req.auth.id_usuario` e o e-mail vem exclusivamente da claim
autenticada, com trim e conversão para minúsculas. O middleware mantém o e-mail
opcional para preservar as demais rotas; o onboarding exige um e-mail válido.
Se a claim estiver ausente ou inválida, responde `403 AUTH_EMAIL_REQUIRED`,
sem buscar e-mail no body ou emitir um novo token.

Antes da criação, o service nega super admin e usuário já cadastrado, verifica
CPF/e-mail existentes e confirma que o condomínio existe e está ativo. O e-mail
é comparado literalmente por `lower(email)` em SQL parametrizado pelo Prisma,
respeitando o índice funcional e evitando tratar `_`/`%` como busca.

O service coordena uma única transação interativa Prisma. Os repositories usam
o mesmo cliente transacional para criar `usuario` ATIVA, `condomino` com o mesmo
UUID e `vinculo_condominio` PENDENTE com `admin_condominio = false`. Os defaults
geram UUID/data de solicitação do vínculo; os campos de aprovação permanecem
nulos. Qualquer falha reverte as três inserções.

A resposta `201` contém `dados` com `id_usuario`, `nome_completo`, `id_vinculo`,
`id_condominio`, `moradia`, `status_vinculo` e `admin_condominio`. CPF, nascimento,
e-mail e tokens não voltam na resposta. Em requisições seguintes, um vínculo
PENDENTE continua sem preencher `vinculo_ativo`, e a vitrine permanece bloqueada.
`GET /api/condominios` continua disponível antes e depois do onboarding.

| Status | Código |
| --- | --- |
| 401 | `UNAUTHENTICATED` |
| 403 | `ACCOUNT_SUSPENDED`, `SUPER_ADMIN_CANNOT_ONBOARD`, `AUTH_EMAIL_REQUIRED` |
| 400 | `VALIDATION_ERROR` |
| 404 | `CONDOMINIO_NOT_FOUND` (inexistente ou inativo) |
| 409 | `ONBOARDING_ALREADY_COMPLETED`, `CPF_ALREADY_REGISTERED`, `EMAIL_ALREADY_REGISTERED` |

As verificações amigáveis não substituem as constraints do PostgreSQL. Conflitos
`P2002` dos índices `usuario_pkey`, `condomino_cpf_key` e
`usuario_email_unique_ci` são convertidos nos respectivos códigos `409`, inclusive
em concorrência. Erros desconhecidos continuam internos. Logs registram apenas
tipo técnico e código de erro, sem payloads pessoais ou credenciais.

Para testar manualmente, salve o JSON acima como `/tmp/onboarding.json`,
substituindo o condomínio pelo UUID retornado na listagem:

```bash
# Sem token: 401
curl -i -X POST http://localhost:3000/api/onboarding \
  -H 'Content-Type: application/json' --data-binary @/tmp/onboarding.json

# Usuário Auth novo: 201; repetir com o mesmo token: 409 ONBOARDING_ALREADY_COMPLETED
curl -i -X POST http://localhost:3000/api/onboarding \
  -H 'Authorization: Bearer <ACCESS_TOKEN>' \
  -H 'Content-Type: application/json' --data-binary @/tmp/onboarding.json

# Outra identidade Auth e o mesmo CPF: 409 CPF_ALREADY_REGISTERED
curl -i -X POST http://localhost:3000/api/onboarding \
  -H 'Authorization: Bearer <ACCESS_TOKEN_DE_OUTRA_IDENTIDADE>' \
  -H 'Content-Type: application/json' --data-binary @/tmp/onboarding.json
```

Para testar condomínio inexistente/inativo, use outra identidade ainda sem
onboarding, um CPF não cadastrado e um UUID inexistente/inativo no JSON: retorna
`404 CONDOMINIO_NOT_FOUND` sem inserir registros. Campos administrativos extras
ou datas inválidas retornam `400`. Super admin recebe `403` sem cadastro residencial.

Validação automatizada:

```bash
npm run build --workspace backend
npm run test:onboarding --workspace backend
npm run test:condominios --workspace backend
npm run test:produtos --workspace backend
```

A suíte de integração exige um PostgreSQL local descartável chamado
`porta_onboarding_teste`, previamente criado com `database/00_ddl_base.sql`.
Ela rejeita hosts remotos, usa dados fictícios e testa rollback, concorrência
real de CPF/e-mail/UUID e fluxo HTTP com JWTs locais. Exemplo de execução:

```bash
ONBOARDING_TEST_DATABASE_URL='postgresql://<USUARIO_LOCAL>@127.0.0.1:<PORTA>/porta_onboarding_teste' \
  npm run test:onboarding:integration --workspace backend
```

O comando principal de desenvolvimento continua sendo `npm run dev` na raiz.

## Situação residencial

`GET /api/vinculos/me` exige JWT válido e consulta exclusivamente
`req.auth.id_usuario`. Não possui body, filtros ou paginação; identificadores
extras enviados pelo cliente são ignorados. A operação é somente leitura.

A consulta usa um snapshot `RepeatableRead`, seleção explícita dos campos
públicos e a relação de condomínio de cada vínculo, sem consultas por item.
Os vínculos são buscados diretamente em `vinculo_condominio`, preservando o
histórico e a coexistência de ATIVO + PENDENTE mesmo que a introspecção apresente
a relação `condomino.vinculo_condominio` como singular.

| Estado | Representação em `dados` |
| --- | --- |
| JWT válido sem `public.usuario` | `onboarding_realizado: false`, `super_admin: false`, vínculos nulos; HTTP 200 |
| `usuario` + `condomino` | `onboarding_realizado: true` |
| Super admin | Onboarding e `super_admin` verdadeiros, vínculos nulos; não exige perfil residencial |
| ATIVO | Preenche somente `vinculo_ativo` |
| PENDENTE | Preenche somente `solicitacao_pendente` |
| ATIVO + PENDENTE | Preenche ambos; `ultimo_vinculo` fica nulo |
| Sem ATIVO/PENDENTE | `ultimo_vinculo` traz o histórico REJEITADO/SUSPENSO/ENCERRADO mais recente, ou nulo |

O histórico é ordenado por `data_solicitacao DESC`, sempre preenchida no banco,
e por `id_vinculo DESC` como desempate. Datas são ISO 8601 UTC; datas opcionais
ausentes são `null`. CPF, nascimento, e-mail, tokens, `id_condomino` e campos de
aprovação/administração interna não são retornados.

Sem JWT válido, retorna `401 UNAUTHENTICATED`. Conta global SUSPENSA continua
bloqueada pelo middleware com `403 ACCOUNT_SUSPENDED`; vínculo local SUSPENSO
é um estado consultável com HTTP 200. Usuário comum sem perfil `condomino` ou
duplicidade de vínculos ATIVO/PENDENTE resulta em `500 INTERNAL_ERROR`, sem
reparar dados ou selecionar arbitrariamente um vínculo.

Exemplo sem onboarding (`200`):

```json
{
  "dados": {
    "onboarding_realizado": false,
    "super_admin": false,
    "vinculo_ativo": null,
    "solicitacao_pendente": null,
    "ultimo_vinculo": null
  }
}
```

Exemplo após onboarding, aguardando aprovação (`200`):

```json
{
  "dados": {
    "onboarding_realizado": true,
    "super_admin": false,
    "vinculo_ativo": null,
    "solicitacao_pendente": {
      "id_vinculo": "20000000-0000-4000-8000-000000000001",
      "status_vinculo": "PENDENTE",
      "moradia": "Bloco B - Apto 302",
      "admin_condominio": false,
      "data_solicitacao": "2026-10-02T22:00:00.000Z",
      "data_aprovacao": null,
      "data_inicio": null,
      "data_fim": null,
      "condominio": {
        "id_condominio": "30000000-0000-4000-8000-000000000001",
        "nome_residencial": "Residencial Exemplo",
        "cep": "70000000",
        "endereco": "Rua Exemplo"
      }
    },
    "ultimo_vinculo": null
  }
}
```

Exemplo com vínculo ativo (`200`):

```json
{
  "dados": {
    "onboarding_realizado": true,
    "super_admin": false,
    "vinculo_ativo": {
      "id_vinculo": "20000000-0000-4000-8000-000000000001",
      "status_vinculo": "ATIVO",
      "moradia": "Bloco B - Apto 302",
      "admin_condominio": false,
      "data_solicitacao": "2026-10-02T22:00:00.000Z",
      "data_aprovacao": "2026-10-03T12:00:00.000Z",
      "data_inicio": "2026-10-03T12:00:00.000Z",
      "data_fim": null,
      "condominio": {
        "id_condominio": "30000000-0000-4000-8000-000000000001",
        "nome_residencial": "Residencial Exemplo",
        "cep": "70000000",
        "endereco": "Rua Exemplo"
      }
    },
    "solicitacao_pendente": null,
    "ultimo_vinculo": null
  }
}
```

Teste manual com a API iniciada:

```bash
# 401 sem token
curl -i http://localhost:3000/api/vinculos/me

# 200: use um access token de usuário sem onboarding, pendente ou ativo.
# Cada resposta reflete os dados atuais daquela identidade.
curl -i http://localhost:3000/api/vinculos/me \
  -H 'Authorization: Bearer <ACCESS_TOKEN>'

# O UUID externo é ignorado: a resposta continua pertencendo ao titular do token.
curl -i 'http://localhost:3000/api/vinculos/me?id_usuario=<UUID_DE_OUTRA_PESSOA>' \
  -H 'Authorization: Bearer <ACCESS_TOKEN>'
```

Testes automatizados:

```bash
npm run build --workspace backend
npm run test:vinculos --workspace backend
ONBOARDING_TEST_DATABASE_URL='postgresql://<USUARIO_LOCAL>@127.0.0.1:<PORTA>/porta_onboarding_teste' \
  npm run test:vinculos:integration --workspace backend
```

A integração reutiliza o banco local descartável descrito no onboarding, com
dados fictícios e JWTs assinados localmente. Cobre todos os estados, desempate
do histórico, isolamento da identidade, privacidade e as rotas anteriores
`health`, `condominios` e `onboarding`. Não acessa Supabase.

## Fila administrativa de vínculos pendentes

`GET /api/admin/vinculos/pendentes` exige JWT válido e autoridade administrativa.
A operação é somente leitura e retorna exclusivamente vínculos `PENDENTE`.

O admin local precisa de `admin_condominio = true` no vínculo ATIVO resolvido
no banco pelo middleware de autenticação. Vínculos pendentes ou históricos não
concedem autoridade. Seu escopo vem sempre de
`req.auth.vinculo_ativo.id_condominio`. Super admin é identificado pela relação
com a tabela `super_admin` e pode consultar a fila global sem vínculo residencial.

Parâmetros opcionais, validados com Zod:

| Parâmetro | Comportamento |
| --- | --- |
| `pagina` | Inteiro positivo, padrão 1; deslocamento limitado ao inteiro PostgreSQL |
| `limite` | Inteiro de 1 a 100, padrão 20 |
| `busca` | Parte do nome completo ou da moradia, sem distinguir caixa; trim, até 160 caracteres; vazio equivale à ausência |
| `id_condominio` | UUID; super admin filtra livremente; admin local só pode indicar seu próprio condomínio |

O filtro da query não concede autoridade: o service substitui o escopo local
pelo condomínio autenticado e nega outro UUID com `403 FORBIDDEN_CROSS_TENANT`.
UUIDs são normalizados para minúsculas. A busca usa
`PENDENTE AND condomínio autorizado AND (nome OR moradia)`, preservando o
isolamento mesmo quando o nome pesquisado existe em outro condomínio.

A resposta reutiliza o envelope já adotado nas listagens: a lista de itens é
`dados`, com `paginacao` no mesmo nível:

```json
{
  "dados": [
    {
      "id_vinculo": "20000000-0000-4000-8000-000000000001",
      "status_vinculo": "PENDENTE",
      "moradia": "Bloco B - Apto 302",
      "data_solicitacao": "2026-10-15T12:00:00.000Z",
      "morador": {
        "id_condomino": "10000000-0000-4000-8000-000000000001",
        "nome_completo": "Maria da Silva"
      },
      "condominio": {
        "id_condominio": "30000000-0000-4000-8000-000000000001",
        "nome_residencial": "Residencial Exemplo"
      }
    }
  ],
  "paginacao": { "pagina": 1, "limite": 20, "total": 1, "total_paginas": 1 }
}
```

`skip = (pagina - 1) * limite`; `total` conta todos os itens que atendem aos
mesmos filtros da página; `total_paginas = ceil(total / limite)`. A ordem é
`data_solicitacao ASC, id_vinculo ASC`. Página e contagem compartilham snapshot
`RepeatableRead`. Seleções explícitas e relações Prisma evitam consultas por item.
Fila vazia ou filtro global por condomínio inexistente retorna `200`, `dados: []`,
`total: 0` e `total_paginas: 0`. Página além do total retorna lista vazia,
preservando a contagem filtrada.

CPF, nascimento, e-mail, `status_conta`, tokens, campos de aprovação e de alteração
administrativa não são selecionados nem retornados. Não há registro de auditoria
para essa leitura, alteração de status ou nova estrutura de banco.

| Status | Código |
| --- | --- |
| 401 | `UNAUTHENTICATED`: token ausente, inválido ou expirado |
| 403 | `ACCOUNT_SUSPENDED`: suspensão global, inclusive administradores |
| 403 | `FORBIDDEN`: sem autoridade administrativa atual |
| 403 | `FORBIDDEN_CROSS_TENANT`: admin local indicando outro condomínio |
| 400 | `VALIDATION_ERROR`: query inválida, repetida ou com campos desconhecidos |

Exemplos manuais com placeholders; substitua os UUIDs e tokens por dados de teste:

```bash
# Morador comum: 403 FORBIDDEN
curl -i http://localhost:3000/api/admin/vinculos/pendentes \
  -H 'Authorization: Bearer <TOKEN_MORADOR>'

# Admin local: 200, somente seu condomínio
curl -i http://localhost:3000/api/admin/vinculos/pendentes \
  -H 'Authorization: Bearer <TOKEN_ADMIN_LOCAL>'

# Outro condomínio: 403 FORBIDDEN_CROSS_TENANT
curl -i 'http://localhost:3000/api/admin/vinculos/pendentes?id_condominio=<UUID_OUTRO_CONDOMINIO>' \
  -H 'Authorization: Bearer <TOKEN_ADMIN_LOCAL>'

# Super admin: 200, escopo global; acrescente id_condominio para filtrar
curl -i http://localhost:3000/api/admin/vinculos/pendentes \
  -H 'Authorization: Bearer <TOKEN_SUPER_ADMIN>'

# Paginação
curl -i 'http://localhost:3000/api/admin/vinculos/pendentes?pagina=2&limite=2' \
  -H 'Authorization: Bearer <TOKEN_ADMIN_LOCAL>'

# Busca por nome ou moradia, dentro do escopo permitido
curl -i --get http://localhost:3000/api/admin/vinculos/pendentes \
  --data-urlencode 'busca=Maria' -H 'Authorization: Bearer <TOKEN_ADMIN_LOCAL>'
```

Validação automatizada:

```bash
npm run test:admin-vinculos --workspace backend
ONBOARDING_TEST_DATABASE_URL='postgresql://<USUARIO_LOCAL>@127.0.0.1:<PORTA>/porta_onboarding_teste' \
  npm run test:admin-vinculos:integration --workspace backend
```

A integração exige o banco local descartável com o DDL base já aplicado,
conforme a suíte de onboarding. Usa JWTs assinados localmente e JWKS simulado;
as requisições Express e consultas PostgreSQL são reais. Cobre autorização,
claims forjadas, todos os estados sem autoridade local, isolamento na busca,
privacidade, paginação, ordenação e ausência de mutações/auditoria na leitura.
O comando principal de desenvolvimento continua sendo `npm run dev` na raiz.

## Aprovação administrativa de vínculo

`PATCH /api/admin/vinculos/:id/aprovar` aprova somente um vínculo `PENDENTE`.
O parâmetro `id` é o UUID de `id_vinculo`, validado com Zod antes de chegar ao
service. A rota não recebe body; enviar JSON, inclusive `{}`, retorna `400`.
Identificadores e privilégios na query não participam da autorização.

A rota reutiliza `autenticar` e `exigirAdmin()` da fila. Super admin vem da
relação com a tabela `super_admin`; admin local precisa de
`admin_condominio = true` no vínculo consultado com `status_vinculo = ATIVO`.
O service compartilha a resolução de escopo com a listagem e compara o condomínio
do alvo ao vínculo ativo do administrador. Outro condomínio recebe
`403 FORBIDDEN_CROSS_TENANT` antes de qualquer resposta sobre o estado ou os dados
do morador. O ator vem exclusivamente de `req.auth.id_usuario`.

A operação usa uma transação interativa Prisma coordenada no service, com
isolamento explícito `ReadCommitted`:

1. Busca o alvo com seleção mínima e valida autoridade sobre o condomínio.
2. Exige `PENDENTE`; qualquer outro estado retorna `409 MEMBERSHIP_NOT_PENDING`.
3. Procura outro vínculo `ATIVO` do mesmo condômino, excluindo o alvo. Se houver,
   retorna `409 ACTIVE_MEMBERSHIP_ALREADY_EXISTS`. Não realiza transferência.
4. Atualiza com condição `id_vinculo + id_condominio + status_vinculo=PENDENTE`;
   exige exatamente um registro alterado. Grava `ATIVO`, `data_aprovacao`,
   `data_inicio` e `aprovado_por`, garantindo `admin_condominio=false` e
   `data_fim=null`. Moradia, condômino, condomínio e data da solicitação são preservados.
5. Registra auditoria e lê os campos públicos do vínculo aprovado, antes do commit.

O update condicional espera uma aprovação concorrente e reavalia `PENDENTE`
em `ReadCommitted`; o perdedor retorna `409 MEMBERSHIP_NOT_PENDING`, sem outra
auditoria. O índice parcial `one_active_membership_per_user` protege contra
criação concorrente de outro vínculo ativo após a pré-checagem. Somente o `P2002`
esperado dessa atualização é convertido em `ACTIVE_MEMBERSHIP_ALREADY_EXISTS`;
outras constraints, códigos e falhas da auditoria mantêm o tratamento de erro interno.
O extrator de identificadores de constraints já usado no onboarding foi movido
para `lib/erro-prisma.ts` e reutilizado pelos dois serviços.

Se qualquer etapa falhar, a transação reverte tudo. A falha da auditoria não deixa
um vínculo aprovado. São gravados exatamente estes campos de auditoria:

| Campo | Valor |
| --- | --- |
| `id_auditoria` | UUID gerado pelo default do banco |
| `id_ator` | UUID do administrador autenticado |
| `acao` | `APPROVE_MEMBERSHIP` |
| `entidade` | `vinculo_condominio` |
| `entidade_id` | UUID do vínculo aprovado |
| `id_condominio` | Condomínio do vínculo aprovado |
| `metadata` | `{"status_anterior":"PENDENTE","status_novo":"ATIVO"}` |
| `created_at` | Mesmo instante do backend usado em `data_aprovacao` e `data_inicio` |

Resposta `200`, com datas em ISO 8601 UTC:

```json
{
  "dados": {
    "id_vinculo": "20000000-0000-4000-8000-000000000001",
    "status_vinculo": "ATIVO",
    "moradia": "Bloco B - Apto 302",
    "admin_condominio": false,
    "data_aprovacao": "2026-10-15T22:00:00.000Z",
    "data_inicio": "2026-10-15T22:00:00.000Z",
    "condominio": {
      "id_condominio": "30000000-0000-4000-8000-000000000001",
      "nome_residencial": "Residencial Exemplo"
    },
    "morador": {
      "id_condomino": "10000000-0000-4000-8000-000000000001",
      "nome_completo": "Maria da Silva"
    }
  }
}
```

CPF, nascimento, e-mail, tokens, `aprovado_por` e metadata da auditoria não são
retornados. Após o commit, `GET /api/vinculos/me` naturalmente apresenta o vínculo
ativo e nenhuma solicitação pendente; a fila deixa de listar o vínculo aprovado.

| Status | Código |
| --- | --- |
| 401 | `UNAUTHENTICATED` |
| 403 | `ACCOUNT_SUSPENDED`, `FORBIDDEN`, `FORBIDDEN_CROSS_TENANT` |
| 400 | `VALIDATION_ERROR` para UUID inválido ou body |
| 404 | `MEMBERSHIP_NOT_FOUND` |
| 409 | `MEMBERSHIP_NOT_PENDING`, `ACTIVE_MEMBERSHIP_ALREADY_EXISTS` |

Exemplos manuais com tokens fictícios e UUIDs que devem ser substituídos:

```bash
API='http://localhost:3000/api/admin/vinculos'

# Admin local: 200, pendência do próprio condomínio
curl -i -X PATCH "$API/<UUID_PENDENTE_LOCAL>/aprovar" \
  -H 'Authorization: Bearer <TOKEN_ADMIN_LOCAL>'

# Super admin: 200, pendência de qualquer condomínio
curl -i -X PATCH "$API/<UUID_PENDENTE_OUTRO_CONDOMINIO>/aprovar" \
  -H 'Authorization: Bearer <TOKEN_SUPER_ADMIN>'

# Admin local em outro condomínio: 403 FORBIDDEN_CROSS_TENANT
curl -i -X PATCH "$API/<UUID_PENDENTE_OUTRO_CONDOMINIO>/aprovar" \
  -H 'Authorization: Bearer <TOKEN_ADMIN_LOCAL>'

# UUID válido inexistente: 404 MEMBERSHIP_NOT_FOUND
curl -i -X PATCH "$API/<UUID_INEXISTENTE>/aprovar" \
  -H 'Authorization: Bearer <TOKEN_ADMIN_LOCAL>'

# Alvo já ativo: 409 MEMBERSHIP_NOT_PENDING
curl -i -X PATCH "$API/<UUID_JA_ATIVO>/aprovar" \
  -H 'Authorization: Bearer <TOKEN_ADMIN_LOCAL>'

# Pendência de quem já tem outro ATIVO: 409 ACTIVE_MEMBERSHIP_ALREADY_EXISTS
curl -i -X PATCH "$API/<UUID_PENDENTE_COM_OUTRO_ATIVO>/aprovar" \
  -H 'Authorization: Bearer <TOKEN_ADMIN_LOCAL>'
```

Testes específicos:

```bash
npm run test:aprovar-vinculo --workspace backend
ONBOARDING_TEST_DATABASE_URL='postgresql://<USUARIO_LOCAL>@127.0.0.1:<PORTA>/porta_onboarding_teste' \
  npm run test:aprovar-vinculo:integration --workspace backend
```

A suíte de integração usa o PostgreSQL local descartável já descrito no onboarding,
JWTs locais e apenas JWKS simulado. Cobre todos os erros de autoridade/estado,
tentativas de forjar ator, privacidade, auditoria, corrida com duas aprovações,
conflito real do índice após a pré-checagem e rollback real por falha de auditoria.
O fluxo HTTP completo inclui onboarding, aprovação, fila, situação residencial,
condomínios e health. As suítes anteriores continuam disponíveis.

Nenhum DDL foi alterado, nenhuma migration foi criada e `schema.prisma` não foi
editado. Rejeição, suspensão, transferência e frontend permanecem fora desta etapa.
`npm run dev` na raiz continua iniciando backend e frontend.

## Rejeição administrativa de vínculo

`PATCH /api/admin/vinculos/:id/rejeitar` aceita somente `PENDENTE → REJEITADO`.
O parâmetro `id` é o UUID de `id_vinculo`. A rota não recebe body nem exige motivo;
JSON inesperado, inclusive `{}`, retorna `400 VALIDATION_ERROR`. Privilégios,
condomínio e ator enviados na query não participam da operação.

São reutilizados `autenticar`, `exigirAdmin()`, `validarParams`, `validarSemBody`,
os helpers de escopo e a criação de auditoria já usados na aprovação. O schema
UUID, a busca do alvo e a seleção pública após a decisão agora possuem nomes
compartilhados pelas duas ações, sem duplicar implementação.

Super admin vem da tabela `super_admin` e pode rejeitar pendências globalmente.
Admin local precisa de `admin_condominio=true` no vínculo ATIVO consultado pelo
backend. O condomínio permitido vem exclusivamente desse vínculo. O service
nega outro condomínio com `403 FORBIDDEN_CROSS_TENANT` antes de verificar ou
revelar o estado do alvo. Vínculo inexistente retorna `404 MEMBERSHIP_NOT_FOUND`.
ATIVO, REJEITADO, SUSPENSO e ENCERRADO retornam `409 MEMBERSHIP_NOT_PENDING`,
inclusive para super admin.

A rejeição altera somente `status_vinculo=REJEITADO` e
`aprovado_por=req.auth.id_usuario`. No modelo atual, `aprovado_por` identifica
o ator tanto da aprovação quanto da rejeição. Moradia, condomínio, condômino e
data da solicitação são preservados. `admin_condominio` permanece falso;
`data_aprovacao`, `data_inicio` e `data_fim` permanecem nulos. Uma pendência com
alguma dessas datas preenchida ou `admin_condominio=true` retorna
`409 MEMBERSHIP_INCONSISTENT`, sem normalização silenciosa nem auditoria.

Outro vínculo ATIVO do condômino **não impede a rejeição**: nenhuma nova
residência é ativada. A rejeição afeta apenas a solicitação alvo e preserva
integralmente o vínculo ativo existente, incluindo sua autoridade administrativa.
Não há consulta de outro ATIVO como condição de negócio para rejeitar.

O service coordena uma transação interativa `ReadCommitted`: lê e valida o alvo,
executa update condicionado ao UUID, condomínio, estado PENDENTE e campos
consistentes, exige um registro alterado, registra auditoria e lê o DTO público
antes do commit. O update não grava ou apaga datas. Uma rejeição concorrente ou
aprovação concorrente que vencer primeiro impede o segundo update; o perdedor
recebe `409 MEMBERSHIP_NOT_PENDING` e não cria auditoria. Aprovação e rejeição
usam a mesma condição de estado. Falha na auditoria reverte também a rejeição.

Auditoria gravada na mesma transação:

| Campo | Valor |
| --- | --- |
| `id_auditoria` | UUID gerado pelo default do banco |
| `id_ator` | UUID do administrador autenticado |
| `acao` | `REJECT_MEMBERSHIP` |
| `entidade` | `vinculo_condominio` |
| `entidade_id` | UUID do vínculo rejeitado |
| `id_condominio` | Condomínio do alvo |
| `metadata` | `{"status_anterior":"PENDENTE","status_novo":"REJEITADO"}` |
| `created_at` | Instante gerado pelo backend para o evento administrativo |

Resposta de sucesso `200`:

```json
{
  "dados": {
    "id_vinculo": "20000000-0000-4000-8000-000000000001",
    "status_vinculo": "REJEITADO",
    "moradia": "Bloco B - Apto 302",
    "admin_condominio": false,
    "data_solicitacao": "2026-10-15T21:00:00.000Z",
    "data_aprovacao": null,
    "data_inicio": null,
    "data_fim": null,
    "condominio": {
      "id_condominio": "30000000-0000-4000-8000-000000000001",
      "nome_residencial": "Residencial Exemplo"
    },
    "morador": {
      "id_condomino": "10000000-0000-4000-8000-000000000001",
      "nome_completo": "Maria da Silva"
    }
  }
}
```

A seleção explícita e o DTO omitem CPF, nascimento, e-mail, tokens,
`aprovado_por`, campos administrativos internos e metadata da auditoria.
Nenhum registro de vínculo, usuário ou condômino é excluído.

O vínculo sai naturalmente da fila de PENDENTES. Em `/api/vinculos/me`,
`solicitacao_pendente` passa a nulo; sem outro vínculo ATIVO/PENDENTE,
`ultimo_vinculo` representa a rejeição mais recente. Se há outro ATIVO, a rota
preserva a prioridade atual desse vínculo e mantém `ultimo_vinculo=null`.

| Status | Código |
| --- | --- |
| 401 | `UNAUTHENTICATED` |
| 403 | `FORBIDDEN`, `FORBIDDEN_CROSS_TENANT`, `ACCOUNT_SUSPENDED` |
| 400 | `VALIDATION_ERROR` para UUID inválido ou body inesperado |
| 404 | `MEMBERSHIP_NOT_FOUND` |
| 409 | `MEMBERSHIP_NOT_PENDING`, `MEMBERSHIP_INCONSISTENT` |

Exemplos manuais com tokens fictícios e UUIDs a substituir:

```bash
API='http://localhost:3000/api/admin/vinculos'

# Admin local, solicitação do próprio condomínio: 200
curl -i -X PATCH "$API/<UUID_PENDENTE_LOCAL>/rejeitar" \
  -H 'Authorization: Bearer <TOKEN_ADMIN_LOCAL>'

# Super admin, solicitação de qualquer condomínio: 200
curl -i -X PATCH "$API/<UUID_PENDENTE_OUTRO_CONDOMINIO>/rejeitar" \
  -H 'Authorization: Bearer <TOKEN_SUPER_ADMIN>'

# Admin local em outro condomínio: 403 FORBIDDEN_CROSS_TENANT
curl -i -X PATCH "$API/<UUID_PENDENTE_OUTRO_CONDOMINIO>/rejeitar" \
  -H 'Authorization: Bearer <TOKEN_ADMIN_LOCAL>'

# UUID válido inexistente: 404 MEMBERSHIP_NOT_FOUND
curl -i -X PATCH "$API/<UUID_VALIDO_INEXISTENTE>/rejeitar" \
  -H 'Authorization: Bearer <TOKEN_ADMIN_LOCAL>'

# Já rejeitado: 409 MEMBERSHIP_NOT_PENDING, sem segunda auditoria
curl -i -X PATCH "$API/<UUID_JA_REJEITADO>/rejeitar" \
  -H 'Authorization: Bearer <TOKEN_ADMIN_LOCAL>'

# Alvo tem outro vínculo ATIVO: 200; vínculo ativo preservado
curl -i -X PATCH "$API/<UUID_PENDENTE_COM_OUTRO_ATIVO>/rejeitar" \
  -H 'Authorization: Bearer <TOKEN_ADMIN_LOCAL>'
```

Testes específicos:

```bash
npm run test:rejeitar-vinculo --workspace backend
ONBOARDING_TEST_DATABASE_URL='postgresql://<USUARIO_LOCAL>@127.0.0.1:<PORTA>/porta_onboarding_teste' \
  npm run test:rejeitar-vinculo:integration --workspace backend
```

Os testes usam o PostgreSQL local descartável descrito anteriormente, JWTs locais
e apenas JWKS simulado. Cobrem autorização, claims/body/query forjados, erros de
estado, inconsistência de datas, preservação de outro ATIVO, histórico,
privacidade, auditoria, rejeição/rejeição e aprovação/rejeição concorrentes,
além do rollback real quando a auditoria falha.

Nenhum DDL foi alterado, nenhuma migration foi criada e `schema.prisma` não foi
editado. `npm run dev` permanece como comando principal. Suspensão, promoção de
admin, transferência, produtos, pedidos, chat e frontend ficam fora desta etapa.

## Suspensão administrativa de vínculo ativo

`PATCH /api/admin/vinculos/:id/suspender` realiza exclusivamente `ATIVO → SUSPENSO`.
O parâmetro `id` é o UUID de `id_vinculo`, validado com o schema compartilhado
`decisaoVinculoParamsSchema`. A rota não recebe body; JSON inesperado, inclusive
`{}`, retorna `400 VALIDATION_ERROR`. Não há motivo, duração ou data de suspensão
enviados pelo cliente. Identificadores e privilégios na query não concedem autoridade.

São reutilizados os middlewares `autenticar`, `exigirAdmin()`, `validarParams` e
`validarSemBody`, os helpers de escopo, os repositories de vínculo/auditoria e
os dados comuns dos DTOs administrativos. A busca autorizada do recurso é
compartilhada com aprovação/rejeição, preservando a ordem de verificação:
existência, condomínio e então estado exigido pela ação.

Super admin é identificado pela relação com a tabela `super_admin` e pode
suspender vínculos ativos de qualquer condomínio. Admin local precisa de
`admin_condominio=true` no vínculo ATIVO consultado no banco pela autenticação.
O condomínio permitido vem desse vínculo. Outro condomínio retorna
`403 FORBIDDEN_CROSS_TENANT`, sem informações do alvo. PENDENTE, REJEITADO,
SUSPENSO e ENCERRADO retornam `409 MEMBERSHIP_NOT_ACTIVE`, inclusive para super admin.

A suspensão altera **somente `status_vinculo`**. São preservados identificação,
moradia, condomínio, condômino, `data_solicitacao`, `data_aprovacao`, `data_inicio`,
`data_fim`, `aprovado_por`, `admin_condominio` e campos internos de alteração de
admin. As datas de aprovação/início representam o histórico e não são apagadas.
`data_fim` pertence ao encerramento; a suspensão não a preenche nem normaliza
um valor existente. A autoria da suspensão fica exclusivamente na auditoria.

`usuario.status_conta` não é alterado: esta é uma suspensão residencial local.
O usuário continua autenticável e pode consultar `/api/vinculos/me`, mas deixa
de ter vínculo ativo no contexto de autenticação. Um administrador suspenso
perde a autoridade local nas próximas requisições, mesmo mantendo
`admin_condominio=true` como dado histórico. Não há regra adicional de último
administrador nesta etapa; um admin pode suspender o próprio vínculo ativo.

Produtos e imagens permanecem intactos, incluindo `produto.ativo`. A vitrine
é derivada também do estado ATIVO do vínculo vendedor; a suspensão local não
equivale a pausar cada produto. Pedidos abertos não bloqueiam a operação nem
são cancelados. Pedidos, históricos, conversas, participantes e mensagens não
são modificados ou excluídos.

O service coordena uma transação interativa `ReadCommitted`: busca e autoriza
o alvo, exige ATIVO, faz update condicionado a UUID, condomínio e estado ATIVO,
exige um registro alterado, registra auditoria e lê o DTO antes do commit.
Duas suspensões concorrentes disputam o mesmo registro. Após esperar o update
vencedor, a condição ATIVO é reavaliada; o perdedor recebe
`409 MEMBERSHIP_NOT_ACTIVE`, sem segunda auditoria. Falha da auditoria reverte
a suspensão e mantém ATIVO.

Auditoria na mesma transação:

| Campo | Valor |
| --- | --- |
| `id_auditoria` | UUID gerado pelo default do banco |
| `id_ator` | `req.auth.id_usuario` |
| `acao` | `SUSPEND_MEMBERSHIP` |
| `entidade` | `vinculo_condominio` |
| `entidade_id` | UUID do vínculo suspenso |
| `id_condominio` | Condomínio do vínculo |
| `metadata` | `{"status_anterior":"ATIVO","status_novo":"SUSPENSO"}` |
| `created_at` | Instante gerado pelo backend para a ação |

Resposta `200`, com datas históricas em ISO 8601 UTC ou nulas conforme o banco:

```json
{
  "dados": {
    "id_vinculo": "20000000-0000-4000-8000-000000000001",
    "status_vinculo": "SUSPENSO",
    "moradia": "Bloco B - Apto 302",
    "admin_condominio": false,
    "data_solicitacao": "2026-10-01T20:00:00.000Z",
    "data_aprovacao": "2026-10-02T12:00:00.000Z",
    "data_inicio": "2026-10-02T12:00:00.000Z",
    "data_fim": null,
    "condominio": {
      "id_condominio": "30000000-0000-4000-8000-000000000001",
      "nome_residencial": "Residencial Exemplo"
    },
    "morador": {
      "id_condomino": "10000000-0000-4000-8000-000000000001",
      "nome_completo": "Maria da Silva"
    }
  }
}
```

CPF, nascimento, e-mail, tokens, `aprovado_por`, campos administrativos internos
e metadata da auditoria não são retornados. `/api/vinculos/me` naturalmente deixa
de apresentar o vínculo ativo. Sem outra solicitação pendente, representa o
histórico SUSPENSO conforme a ordenação já existente; a rota não foi alterada.

| Status | Código |
| --- | --- |
| 401 | `UNAUTHENTICATED` |
| 403 | `FORBIDDEN`, `FORBIDDEN_CROSS_TENANT`, `ACCOUNT_SUSPENDED` |
| 400 | `VALIDATION_ERROR` para UUID inválido ou body inesperado |
| 404 | `MEMBERSHIP_NOT_FOUND` |
| 409 | `MEMBERSHIP_NOT_ACTIVE` para estado inválido ou corrida perdida |

Exemplos manuais, substituindo UUIDs e tokens fictícios:

```bash
API='http://localhost:3000/api/admin/vinculos'

# Admin local, vínculo ativo do próprio condomínio: 200
curl -i -X PATCH "$API/<UUID_ATIVO_LOCAL>/suspender" \
  -H 'Authorization: Bearer <TOKEN_ADMIN_LOCAL>'

# Super admin, vínculo ativo de qualquer condomínio: 200
curl -i -X PATCH "$API/<UUID_ATIVO_OUTRO_CONDOMINIO>/suspender" \
  -H 'Authorization: Bearer <TOKEN_SUPER_ADMIN>'

# Admin local em outro condomínio: 403 FORBIDDEN_CROSS_TENANT
curl -i -X PATCH "$API/<UUID_ATIVO_OUTRO_CONDOMINIO>/suspender" \
  -H 'Authorization: Bearer <TOKEN_ADMIN_LOCAL>'

# Já suspenso: 409 MEMBERSHIP_NOT_ACTIVE
curl -i -X PATCH "$API/<UUID_JA_SUSPENSO>/suspender" \
  -H 'Authorization: Bearer <TOKEN_ADMIN_LOCAL>'

# Pendente: 409 MEMBERSHIP_NOT_ACTIVE
curl -i -X PATCH "$API/<UUID_PENDENTE>/suspender" \
  -H 'Authorization: Bearer <TOKEN_ADMIN_LOCAL>'

# UUID válido inexistente: 404 MEMBERSHIP_NOT_FOUND
curl -i -X PATCH "$API/<UUID_VALIDO_INEXISTENTE>/suspender" \
  -H 'Authorization: Bearer <TOKEN_ADMIN_LOCAL>'
```

Testes específicos:

```bash
npm run test:suspender-vinculo --workspace backend
ONBOARDING_TEST_DATABASE_URL='postgresql://<USUARIO_LOCAL>@127.0.0.1:<PORTA>/porta_onboarding_teste' \
  npm run test:suspender-vinculo:integration --workspace backend
```

A integração usa PostgreSQL local descartável, JWTs locais e apenas JWKS
simulado. Cobre autorização, isolamento, privacidade, preservação histórica e da
conta global, admin suspendendo o próprio vínculo, produtos/imagens, pedidos
SOLICITADO/ACEITO, históricos, chat, corrida real e rollback por falha da auditoria.

DDL e `schema.prisma` permanecem intactos; nenhuma migration foi criada.
Reativação, encerramento, transferência, promoção/rebaixamento de admin,
suspensão global e novos recursos de produtos/pedidos/chat/frontend não fazem
parte desta etapa. `npm run dev` continua como comando principal na raiz.

## Vitrine de produtos

`GET /api/produtos` exige `Authorization: Bearer <access_token>` do Supabase.
A autenticação valida assinatura por JWKS (ES256/RS256), issuer, audience
`authenticated`, expiração e identidade, consulta o usuário local e nega contas
suspensas. A rota representa uma vitrine por vez e é somente leitura.

Para morador e admin local, o condomínio vem exclusivamente de
`req.auth.vinculo_ativo.id_condominio`, resolvido no banco com status ATIVO.
`admin_condominio=true` não amplia esse escopo. Sem vínculo ATIVO, inclusive
antes do onboarding ou com vínculo PENDENTE/REJEITADO/SUSPENSO/ENCERRADO,
responde `403 MEMBERSHIP_REQUIRED`, preservando o código já usado no projeto.
Se `id_condominio` for enviado, o próprio condomínio é aceito; outro retorna
`403 FORBIDDEN_CROSS_TENANT`. A query nunca concede autoridade residencial.

Super admin vem da tabela `super_admin` e não precisa de vínculo residencial,
mas deve selecionar `id_condominio` explicitamente. Sem esse parâmetro, retorna
`400 CONDOMINIUM_REQUIRED`. O service reutiliza `buscarCondominioAtivoPorId`;
condomínio inexistente ou inativo retorna `404 CONDOMINIO_NOT_FOUND`.
Não existe listagem global misturando condomínios.

Query params validados com Zod:

| Parâmetro | Comportamento |
| --- | --- |
| `id_categoria` | UUID opcional da categoria; categoria sem produtos resulta em lista vazia |
| `id_condominio` | UUID obrigatório para super admin; morador/admin local só podem indicar seu próprio condomínio |
| `busca` | Parte do nome ou descrição, sem distinguir caixa; trim, até 140 caracteres; vazio equivale à ausência |
| `pagina` | Inteiro positivo, padrão 1 |
| `limite` | Inteiro de 1 a 100, padrão 20 |

O parâmetro anterior `categoria` continua aceito e é normalizado para
`id_categoria` antes do service. Se ambos forem enviados, precisam indicar a
mesma categoria. UUIDs são normalizados para minúsculas. Parâmetros repetidos,
desconhecidos, conflitantes ou inválidos retornam `400 VALIDATION_ERROR`.

O repository combina no PostgreSQL:

```text
produto.ativo = true
AND categoria_produto.ativo = true
AND vínculo vendedor do produto.status_vinculo = ATIVO
AND vínculo vendedor do produto.id_condominio = condomínio autorizado
AND categoria selecionada, se houver
AND (nome contém busca OR descrição contém busca), se houver
```

O `OR` da busca permanece dentro do escopo. Produtos de vendedor PENDENTE,
REJEITADO, SUSPENSO ou ENCERRADO e de categoria inativa não aparecem, mesmo que
o produto continue ativo. O vínculo considerado é aquele referenciado pelo
próprio produto, preservando o histórico quando a pessoa muda de condomínio.
Anúncios do próprio usuário e produtos com estoque zero continuam visíveis.

O service calcula `skip = (pagina - 1) * limite`; o deslocamento deve caber no
inteiro PostgreSQL. A ordenação preserva `created_at DESC, id_produto ASC`.
`total` conta todos os produtos que atendem aos mesmos filtros; `total_paginas`
é `ceil(total / limite)`. Página e contagem compartilham snapshot `RepeatableRead`.
Os filtros são aplicados no banco, e relações Prisma com seleção explícita
evitam consultas por item e carregamento de pedidos/chat/históricos.

Uma vitrine ou categoria sem resultados retorna `200`, `dados: []`, `total: 0`
e `total_paginas: 0`. Página além do total retorna lista vazia, preservando os
totais filtrados.

A resposta contém `dados` e `paginacao` (`pagina`, `limite`, `total`,
`total_paginas`). Cada card retorna `id_produto`, `nome_produto`, `descricao`,
`preco`, `estoque`, `created_at` em ISO 8601 UTC, `categoria` (`id_categoria`,
`nome`), `vendedor` (`id_vinculo`, `nome_completo`, `moradia`) e `imagens`.
A moradia pertence ao vínculo vendedor dentro do condomínio autorizado.
CPF, nascimento, e-mail, UUID global do usuário/condômino, status da conta e
tokens não são selecionados ou retornados.

`NUMERIC(12,2)` continua serializado com `Decimal.toFixed(2)`, por exemplo
`"25.00"`. Não há conversão ou cálculo monetário por floating point.

O suporte parcial seguro de imagens foi preservado: são retornados apenas
`id_imagem`, `ordem` e `url: null`, ordenados por ordem e UUID. Nenhum Storage,
upload ou signed URL foi implementado. `storage_path` não é selecionado nem
exposto, e o bucket privado não é acessado pela listagem.

Exemplo de resposta:

```json
{
  "dados": [{
    "id_produto": "50000000-0000-4000-8000-000000000001",
    "nome_produto": "Bolo de cenoura",
    "descricao": "Bolo caseiro",
    "preco": "25.00",
    "estoque": 4,
    "created_at": "2026-10-15T20:00:00.000Z",
    "categoria": { "id_categoria": "30000000-0000-4000-8000-000000000001", "nome": "Alimentação" },
    "vendedor": { "id_vinculo": "40000000-0000-4000-8000-000000000001", "nome_completo": "Maria da Silva", "moradia": "Bloco B - Apto 302" },
    "imagens": []
  }],
  "paginacao": { "pagina": 1, "limite": 20, "total": 1, "total_paginas": 1 }
}
```

Erros: `401 UNAUTHENTICATED`; `403 ACCOUNT_SUSPENDED`, `MEMBERSHIP_REQUIRED`
ou `FORBIDDEN_CROSS_TENANT`; `400 VALIDATION_ERROR` ou `CONDOMINIUM_REQUIRED`;
`404 CONDOMINIO_NOT_FOUND` para a seleção indisponível do super admin.

Exemplos manuais com placeholders:

```bash
API='http://localhost:3000/api/produtos'

# Morador ativo: 200
curl -i "$API" -H 'Authorization: Bearer <TOKEN_MORADOR_ATIVO>'

# Morador pendente: 403 MEMBERSHIP_REQUIRED
curl -i "$API" -H 'Authorization: Bearer <TOKEN_MORADOR_PENDENTE>'

# Busca em nome ou descrição
curl -i --get "$API" --data-urlencode 'busca=bolo' \
  -H 'Authorization: Bearer <TOKEN_MORADOR_ATIVO>'

# Categoria
curl -i "$API?id_categoria=<UUID_CATEGORIA>" \
  -H 'Authorization: Bearer <TOKEN_MORADOR_ATIVO>'

# Paginação
curl -i "$API?pagina=2&limite=2" \
  -H 'Authorization: Bearer <TOKEN_MORADOR_ATIVO>'

# Cross-tenant: 403 FORBIDDEN_CROSS_TENANT
curl -i "$API?id_condominio=<UUID_OUTRO_CONDOMINIO>" \
  -H 'Authorization: Bearer <TOKEN_MORADOR_ATIVO>'

# Super admin: uma vitrine explicitamente selecionada
curl -i "$API?id_condominio=<UUID_CONDOMINIO_ATIVO>" \
  -H 'Authorization: Bearer <TOKEN_SUPER_ADMIN>'
```

Validação automatizada:

```bash
npm run build --workspace backend
npm run test:produtos --workspace backend
ONBOARDING_TEST_DATABASE_URL='postgresql://<USUARIO_LOCAL>@127.0.0.1:<PORTA>/porta_onboarding_teste' \
  npm run test:produtos:integration --workspace backend
```

Os testes unitários usam banco simulado. A integração usa PostgreSQL local
descartável descrito no onboarding, JWTs locais e apenas JWKS simulado. Cobre
todos os estados de vínculo, isolamento, busca combinada, categoria inativa,
preço, estoque zero, anúncio próprio, paginação, imagens seguras e ausência de
mutações na leitura. Uma suspensão real do vendedor confirma que seu produto
desaparece sem alteração de `produto.ativo` e que ele perde o acesso à vitrine.

Nenhum DDL foi alterado, nenhuma migration foi criada e `schema.prisma` não foi
editado. Criação/edição/detalhe de produto, categorias HTTP, Storage, pedidos,
chat e frontend não foram implementados nesta etapa. `npm run dev` continua
como comando principal na raiz.

## Categorias ativas da vitrine

`GET /api/categorias` exige JWT válido. Morador e admin local precisam de vínculo
ATIVO; sem ele, recebem `403 MEMBERSHIP_REQUIRED`. Super admin acessa sem vínculo
e sem informar condomínio. Produtos e categorias compartilham a função
`autorizarAcessoVitrine`, extraída do service de produtos. O middleware global de
autenticação permanece igual, incluindo `401 UNAUTHENTICATED` para token ausente
ou inválido e `403 ACCOUNT_SUSPENDED` para conta suspensa, inclusive super admin.

Categorias são globais: uma única consulta em `categoria_produto` aplica
`ativo = true`, ordena por `nome ASC` e seleciona apenas `id_categoria` e `nome`.
Categorias sem produtos também aparecem. Não há carregamento de relações,
contagem, paginação ou busca. Não existem entradas funcionais para validar com
Zod; parâmetros extras de query são ignorados, como em outras consultas sem
filtros (`GET /api/vinculos/me`). `id_condominio` não altera a lista.

O envelope segue a coleção da vitrine, com `dados` diretamente como array:

```json
{
  "dados": [
    { "id_categoria": "30000000-0000-4000-8000-000000000001", "nome": "Alimentação" },
    { "id_categoria": "30000000-0000-4000-8000-000000000002", "nome": "Bazar" }
  ]
}
```

Sem categorias ativas, retorna `200` com `{"dados":[]}`. O UUID retornado pode
ser usado no filtro existente `GET /api/produtos?id_categoria=<UUID>`.

Exemplos manuais, com tokens fictícios a substituir:

```bash
# Morador com vínculo ATIVO: 200
curl -i http://localhost:3000/api/categorias \
  -H 'Authorization: Bearer <TOKEN_MORADOR_ATIVO>'

# Morador com vínculo PENDENTE: 403 MEMBERSHIP_REQUIRED
curl -i http://localhost:3000/api/categorias \
  -H 'Authorization: Bearer <TOKEN_MORADOR_PENDENTE>'

# Super admin, mesmo sem vínculo e sem id_condominio: 200
curl -i http://localhost:3000/api/categorias \
  -H 'Authorization: Bearer <TOKEN_SUPER_ADMIN>'
```

Validação automatizada (os scripts de teste incluem typecheck):

```bash
npm run build --workspace backend
npm run test:categorias --workspace backend
ONBOARDING_TEST_DATABASE_URL='postgresql://<USUARIO_LOCAL>@127.0.0.1:<PORTA>/porta_onboarding_teste' \
  npm run test:categorias:integration --workspace backend
```

A integração exige o banco PostgreSQL local descartável descrito no onboarding;
usa JWTs locais e JWKS simulado. Cria fixtures apenas nesse banco para validar
autorização, suspensão global, lista global ordenada e mínima, categoria inativa,
lista vazia e compatibilidade do filtro de produtos. O caso de lista vazia
desativa temporariamente categorias nesse banco e restaura as ativas em `finally`;
execute as suítes de integração em sequência.

Nenhum DDL, migration, seed ou `schema.prisma` foi alterado nesta etapa.
`npm run dev` permanece como comando principal para backend e frontend.

## Cadastro de produto

`POST /api/produtos` cria somente o registro base de produto e responde `201`.
Exige JWT válido e vínculo ATIVO, para morador ou admin local. O middleware de
autenticação já busca esse vínculo no banco em cada requisição. A autorização
`obterVinculoAtivo` é compartilhada com a vitrine e aplicada antes da validação
do body por `exigirVinculoAtivo`; o service também a aplica para proteger o caso
de uso. A leitura continua permitindo super admin sem vínculo, mas a criação
exige vínculo vendedor real e retorna `403 MEMBERSHIP_REQUIRED` para ele.

O body Zod é estrito e aceita somente:

```json
{
  "id_categoria": "30000000-0000-4000-8000-000000000001",
  "nome_produto": "Bolo de cenoura",
  "descricao": "Bolo caseiro com cobertura de chocolate",
  "preco": "25.90",
  "estoque": 4
}
```

| Campo | Regra |
| --- | --- |
| `id_categoria` | UUID obrigatório; categoria global deve existir e estar ativa |
| `nome_produto` | String obrigatória, trim, de 1 a 140 caracteres |
| `descricao` | String obrigatória, trim, não vazia; preservado o limite HTTP geral de 1 MB |
| `preco` | String decimal positiva, 1 a 10 dígitos inteiros e opcionalmente ponto com 1 ou 2 casas; máximo `9999999999.99` |
| `estoque` | Número inteiro obrigatório entre 0 e 2147483647, compatível com PostgreSQL INTEGER |

Preço numérico, vírgula, notação científica, mais de duas casas e valor zero
ou negativo são rejeitados. O service converte a string diretamente para
`Prisma.Decimal`, sem passar por `Number` ou fazer cálculos com float. A resposta
usa `toFixed(2)`, como a vitrine: `"1"` vira `"1.00"` e `"1.5"` vira `"1.50"`.

O vendedor vem exclusivamente de `req.auth.vinculo_ativo.id_vinculo`.
Condomínio é derivado desse vínculo; não existe `id_condominio` no produto/body.
Campos extras, inclusive vendedor, condomínio, UUID do produto, estado inicial,
datas e imagens, retornam `400 VALIDATION_ERROR`. UUIDs na query não são usados.
O repository escreve uma lista explícita de campos e usa os defaults do banco
para UUID, `ativo = true`, `created_at` e `updated_at`.

Categoria inexistente retorna `404 CATEGORY_NOT_FOUND`; existente mas inativa
retorna `409 CATEGORY_INACTIVE`, sem criar produto ou reativar a categoria.
Token ausente/inválido retorna `401 UNAUTHENTICATED`; conta suspensa mantém
`403 ACCOUNT_SUSPENDED`; sem vínculo ATIVO retorna `403 MEMBERSHIP_REQUIRED`.
Dados inválidos retornam `400 VALIDATION_ERROR` antes de consultar categoria.

Exemplo de resposta:

```json
{
  "dados": {
    "id_produto": "50000000-0000-4000-8000-000000000001",
    "nome_produto": "Bolo de cenoura",
    "descricao": "Bolo caseiro com cobertura de chocolate",
    "preco": "25.90",
    "estoque": 4,
    "ativo": true,
    "created_at": "2026-10-15T22:00:00.000Z",
    "categoria": {
      "id_categoria": "30000000-0000-4000-8000-000000000001",
      "nome": "Alimentação"
    }
  }
}
```

A resposta seleciona somente produto e categoria, sem consultar dados do
vendedor. Estoque zero é válido e mantém o anúncio ativo e visível na vitrine.
Não há unicidade de nome ou limite de 15 produtos. A operação faz apenas uma
gravação, sem transação interativa, imagens, Storage ou auditoria administrativa.

Não foi adicionada segunda consulta de vínculo ou lock: a autorização usa o
contexto obtido no banco nesta requisição. Em uma suspensão concorrente entre
autenticação e criação, a vitrine continua ocultando produtos de vínculo que
deixou de estar ATIVO. Categoria posteriormente inativada também oculta os
produtos históricos, preservando os registros.

Exemplos manuais: substitua o UUID abaixo por uma categoria ativa existente;
todos os tokens são placeholders fictícios. Os exemplos usam Bash e mantêm
o preço como string JSON.

```bash
API='http://localhost:3000/api/produtos'
TOKEN='<TOKEN_MORADOR_ATIVO>'
DADOS='{"id_categoria":"30000000-0000-4000-8000-000000000001","nome_produto":"Bolo","descricao":"Caseiro","preco":"25.90","estoque":4}'

# 1. Criação válida: 201
curl -i "$API" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' --data "$DADOS"

# 2. Usuário sem vínculo ativo: 403 MEMBERSHIP_REQUIRED
curl -i "$API" -H 'Authorization: Bearer <TOKEN_MORADOR_PENDENTE>' \
  -H 'Content-Type: application/json' --data "$DADOS"

# 3. Categoria UUID válida não cadastrada: 404 CATEGORY_NOT_FOUND
curl -i "$API" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"id_categoria":"00000000-0000-4000-8000-000000000000","nome_produto":"Bolo","descricao":"Caseiro","preco":"25.90","estoque":4}'

# 4. Preço com três casas: 400 VALIDATION_ERROR
curl -i "$API" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"id_categoria":"30000000-0000-4000-8000-000000000001","nome_produto":"Bolo","descricao":"Caseiro","preco":"10.999","estoque":4}'

# 5. Vendedor no body: 400 VALIDATION_ERROR
curl -i "$API" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"id_categoria":"30000000-0000-4000-8000-000000000001","nome_produto":"Bolo","descricao":"Caseiro","preco":"25.90","estoque":4,"id_vinculo_vendedor":"40000000-0000-4000-8000-000000000001"}'

# 6. Estoque zero: 201
curl -i "$API" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"id_categoria":"30000000-0000-4000-8000-000000000001","nome_produto":"Bolo","descricao":"Caseiro","preco":"25.90","estoque":0}'
```

Scripts de validação (testes incluem typecheck):

```bash
npm run build --workspace backend
npm run test:criar-produto --workspace backend
ONBOARDING_TEST_DATABASE_URL='postgresql://<USUARIO_LOCAL>@127.0.0.1:<PORTA>/porta_onboarding_teste' \
  npm run test:criar-produto:integration --workspace backend
```

A integração usa somente o PostgreSQL local descartável, JWTs locais e JWKS
simulado. Cobre criação e defaults, autorização, fraude de autoridade, preço e
estoque, ausência de efeitos laterais, isolamento, suspensão administrativa
posterior e inativação de categoria. Nenhum DDL, migration, seed ou
`schema.prisma` foi alterado. Frontend e funcionalidades posteriores permanecem
fora desta etapa. `npm run dev` continua iniciando backend e frontend na raiz.

## Meus produtos

`GET /api/produtos/me` responde `200` com os produtos do vínculo residencial
ATIVO atual. Reutiliza `autenticar`, `exigirVinculoAtivo` e `obterVinculoAtivo`
do cadastro. Sem token válido retorna `401 UNAUTHENTICATED`; sem vínculo ATIVO,
inclusive super admin, retorna `403 MEMBERSHIP_REQUIRED`; conta globalmente
suspensa mantém `403 ACCOUNT_SUSPENDED`.

O repository aplica obrigatoriamente `id_vinculo_vendedor = vínculo autenticado`
no PostgreSQL, tanto na página quanto na contagem. Não recebe UUID de vendedor,
usuário ou condomínio do cliente; esses campos extras na query retornam
`400 VALIDATION_ERROR`. Body também é rejeitado. Admin local consulta somente
seus próprios produtos. Produtos de vínculos antigos da mesma pessoa ficam
fora da consulta, pois pertencem a outro `id_vinculo` histórico.

| Query opcional | Regra |
| --- | --- |
| `pagina` | Inteiro positivo; padrão 1 |
| `limite` | Inteiro de 1 a 100; padrão 20 |
| `busca` | Trim, máximo 140 caracteres; vazia equivale a ausência; nome ou descrição, sem diferenciar caixa |
| `id_categoria` | UUID; categoria sem produtos próprios ou inexistente retorna lista vazia |
| `ativo` | Somente strings `true` ou `false`; ausente inclui ativos e inativos |

Arrays, parâmetros repetidos, valores inválidos, campos desconhecidos e
deslocamento acima do intervalo INTEGER do PostgreSQL retornam
`400 VALIDATION_ERROR`. Defaults e validações compartilhados com a vitrine
foram reutilizados, preservando o contrato anterior.

Os filtros opcionais combinam com AND, mantendo o OR de nome/descrição dentro
do vínculo permitido. Não há filtro implícito por produto ativo, categoria
ativa ou estoque. Assim, o vendedor consegue visualizar produtos pausados,
com estoque zero e associados a categorias posteriormente inativadas.

| Comportamento | `GET /api/produtos` | `GET /api/produtos/me` |
| --- | --- | --- |
| Escopo | Condomínio autorizado, incluindo outros vendedores ativos | Somente vínculo vendedor ATIVO atual |
| Produto inativo | Não aparece | Aparece sem filtro ou com `ativo=false` |
| Categoria inativa | Produto não aparece | Produto aparece, com `categoria.ativo=false` |
| Estoque zero | Aparece | Aparece |
| Super admin sem vínculo | Seleciona condomínio para leitura | `403 MEMBERSHIP_REQUIRED` |

A ordenação compartilhada com a vitrine é `created_at DESC, id_produto ASC`.
O service calcula o deslocamento e retorna o mesmo envelope `dados` +
`paginacao`; `total` representa todos os produtos que atendem aos filtros e
`total_paginas = ceil(total / limite)`. Página e contagem usam o mesmo `where`
e snapshot `RepeatableRead`, com paginação no banco.

Exemplo de resposta:

```json
{
  "dados": [{
    "id_produto": "50000000-0000-4000-8000-000000000001",
    "nome_produto": "Bolo",
    "descricao": "Caseiro",
    "preco": "25.90",
    "estoque": 0,
    "ativo": false,
    "created_at": "2026-10-14T20:00:00.000Z",
    "updated_at": "2026-10-15T20:00:00.000Z",
    "categoria": {
      "id_categoria": "30000000-0000-4000-8000-000000000001",
      "nome": "Alimentação",
      "ativo": false
    }
  }],
  "paginacao": { "pagina": 1, "limite": 20, "total": 1, "total_paginas": 1 }
}
```

Sem produtos, responde `200` com `dados: []`, `total: 0` e `total_paginas: 0`.
Página além do fim retorna array vazio e preserva os totais filtrados.
Preço mantém `Decimal.toFixed(2)` e as datas são serializadas em ISO UTC.
O select não carrega vendedor, condomínio, imagens, pedidos, chat ou histórico.
Não retorna CPF, nascimento, e-mail, UUID de usuário/vínculo, moradia ou Storage.
A rota estática `/me` está registrada antes de futuras rotas `/:id`.

Exemplos manuais com tokens fictícios:

```bash
API='http://localhost:3000/api/produtos/me'
TOKEN='<TOKEN_MORADOR_ATIVO>'

# 1. Todos os próprios produtos, ativos e inativos
curl -i "$API" -H "Authorization: Bearer $TOKEN"

# 2. Somente ativos
curl -i "$API?ativo=true" -H "Authorization: Bearer $TOKEN"

# 3. Somente inativos
curl -i "$API?ativo=false" -H "Authorization: Bearer $TOKEN"

# 4. Busca no nome ou na descrição
curl -i --get "$API" --data-urlencode 'busca=bolo' \
  -H "Authorization: Bearer $TOKEN"

# 5. Categoria; substitua pelo UUID desejado
curl -i "$API?id_categoria=30000000-0000-4000-8000-000000000001" \
  -H "Authorization: Bearer $TOKEN"

# 6. Sem vínculo ativo: 403 MEMBERSHIP_REQUIRED
curl -i "$API" -H 'Authorization: Bearer <TOKEN_MORADOR_PENDENTE>'
```

Validação automatizada (scripts de testes incluem typecheck):

```bash
npm run build --workspace backend
npm run test:meus-produtos --workspace backend
ONBOARDING_TEST_DATABASE_URL='postgresql://<USUARIO_LOCAL>@127.0.0.1:<PORTA>/porta_onboarding_teste' \
  npm run test:meus-produtos:integration --workspace backend
```

A integração usa apenas PostgreSQL local descartável, JWTs locais e JWKS
simulado. Cobre autorização, filtros combinados, paginação, privacidade,
isolamento entre vendedores e condomínios, histórico da mesma pessoa, criação
via POST e suspensão administrativa posterior. Nenhum DDL, migration, seed ou
`schema.prisma` foi alterado. Não foram implementadas edição, detalhe, alteração
de estado ou imagens. `npm run dev` permanece como comando principal na raiz.

## Edição do próprio produto

`PATCH /api/produtos/:id` responde `200` e aceita qualquer combinação não vazia
de `id_categoria`, `nome_produto`, `descricao`, `preco` e `estoque`.
O UUID da URL é validado antes da consulta ao produto. Body vazio, campo extra
ou valor inválido retorna `400 VALIDATION_ERROR`.

```json
{
  "nome_produto": "Bolo de cenoura grande",
  "preco": "29.90"
}
```

O schema PATCH deriva das regras de criação via `.partial()`, com refinamento
para exigir ao menos um campo definido. Isso reutiliza UUID, trim, nome de até
140 caracteres, descrição não vazia, preço string decimal positivo compatível
com NUMERIC(12,2) e estoque INTEGER não negativo. Nenhum default preenche campos
omitidos. Valores nulos não são aceitos para esses campos.

Reutiliza autenticação e autorização do cadastro: sem JWT válido retorna
`401 UNAUTHENTICATED`; sem vínculo ATIVO, inclusive super admin, retorna
`403 MEMBERSHIP_REQUIRED`; conta suspensa mantém `403 ACCOUNT_SUSPENDED`.
O vínculo vendedor vem exclusivamente de `req.auth.vinculo_ativo.id_vinculo`.
Admin local possui o mesmo escopo do morador e só edita seus próprios anúncios.

A leitura de ownership e o update final usam simultaneamente `id_produto` e
`id_vinculo_vendedor`. Produto inexistente, alheio, de outro condomínio ou de
vínculo histórico da mesma pessoa retorna `404 PRODUCT_NOT_FOUND`, sem expor
qual caso ocorreu. Ownership é confirmado antes de validar a nova categoria.
Se o update condicional deixar de encontrar o produto, o erro Prisma `P2025`
também vira esse mesmo `404`.

Somente os campos presentes e permitidos entram no update. Um PATCH de preço
não altera nome, descrição, estoque ou categoria. Estoque `0` é considerado
presente e salvo normalmente. Produto inativo pode ser editado; seu estado
permanece inativo. `ativo`, `id_vinculo_vendedor`, condomínio, UUID do produto,
`created_at`, `updated_at` e campos de imagem não são aceitos no body.
Parâmetros de query não escolhem vendedor nem condomínio.

Categoria é validada somente quando `id_categoria` for enviado, reutilizando
a validação do POST: inexistente retorna `404 CATEGORY_NOT_FOUND` e inativa
retorna `409 CATEGORY_INACTIVE`. Isso vale mesmo ao reenviar a categoria atual.
Se a categoria atual estiver inativa e for omitida do PATCH, outros campos
podem ser editados normalmente, mantendo `categoria.ativo = false` na resposta.

O preço usa a mesma validação monetária do POST, é convertido diretamente
para `Prisma.Decimal` e retorna com `toFixed(2)`. Não há cálculo com float.
`created_at` permanece intacto; o trigger existente `produto_set_updated_at`
atualiza `updated_at`, sem duplicação desse mecanismo no TypeScript.
Não foi adicionada transação interativa ou lock: há uma única gravação
condicionada ao produto e vínculo autenticado.

O DTO reutiliza o item de `GET /api/produtos/me`, sem dados pessoais:

```json
{
  "dados": {
    "id_produto": "50000000-0000-4000-8000-000000000001",
    "nome_produto": "Bolo de cenoura grande",
    "descricao": "Caseiro",
    "preco": "29.90",
    "estoque": 0,
    "ativo": true,
    "created_at": "2026-10-14T20:00:00.000Z",
    "updated_at": "2026-10-15T21:00:00.000Z",
    "categoria": {
      "id_categoria": "30000000-0000-4000-8000-000000000001",
      "nome": "Alimentação",
      "ativo": true
    }
  }
}
```

A edição aparece em `/produtos/me` e, quando elegível, na vitrine. Ao trocar
categoria, o anúncio passa a corresponder ao novo filtro. Edição normal não
gera auditoria administrativa nem altera imagens, Storage, pedidos ou chat.

Exemplos manuais com tokens fictícios; substitua os UUIDs pelos dados de teste:

```bash
API='http://localhost:3000/api/produtos'
PRODUTO='50000000-0000-4000-8000-000000000001'
TOKEN='<TOKEN_MORADOR_ATIVO>'

# 1. Alterar nome: 200
curl -i -X PATCH "$API/$PRODUTO" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' --data '{"nome_produto":"Novo nome"}'

# 2. Alterar preço: 200
curl -i -X PATCH "$API/$PRODUTO" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' --data '{"preco":"29.90"}'

# 3. Estoque zero: 200
curl -i -X PATCH "$API/$PRODUTO" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' --data '{"estoque":0}'

# 4. Trocar para categoria ativa: 200
curl -i -X PATCH "$API/$PRODUTO" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"id_categoria":"30000000-0000-4000-8000-000000000002"}'

# 5. Produto alheio: 404 PRODUCT_NOT_FOUND
curl -i -X PATCH "$API/<UUID_PRODUTO_ALHEIO>" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' --data '{"estoque":0}'

# 6. Body vazio: 400 VALIDATION_ERROR
curl -i -X PATCH "$API/$PRODUTO" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' --data '{}'

# 7. Estado não editável aqui: 400 VALIDATION_ERROR
curl -i -X PATCH "$API/$PRODUTO" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' --data '{"ativo":false}'
```

Validação automatizada (os testes incluem typecheck):

```bash
npm run build --workspace backend
npm run test:editar-produto --workspace backend
ONBOARDING_TEST_DATABASE_URL='postgresql://<USUARIO_LOCAL>@127.0.0.1:<PORTA>/porta_onboarding_teste' \
  npm run test:editar-produto:integration --workspace backend
```

Os testes usam banco simulado ou PostgreSQL local descartável, JWTs locais e
JWKS simulado. Cobrem PATCH parcial, campos proibidos, isolamento, produtos
inativos, categoria atual inativa, novas categorias, trigger, Decimal, estoque
zero, leitura após edição e suspensão administrativa posterior. Nenhum DDL,
migration, seed ou `schema.prisma` foi alterado. Ativação/desativação, detalhe,
imagens, exclusão e frontend permanecem fora desta etapa. `npm run dev` continua
como comando principal na raiz.

## Ativação e desativação do próprio produto

`PATCH /api/produtos/:id/status` responde `200` e aceita exclusivamente
`{"ativo":true}` ou `{"ativo":false}`. `ativo` deve ser boolean JSON real;
string, número, body vazio ou qualquer campo extra retorna
`400 VALIDATION_ERROR`. O UUID da URL reutiliza `produtoParamsSchema`.

Reutiliza autenticação, exigência de vínculo ATIVO, ownership e tratamento de
erros da edição. O vendedor vem de `req.auth.vinculo_ativo.id_vinculo`, nunca do
cliente. Leitura e update final filtram simultaneamente produto e vínculo.
Produto inexistente, alheio ou de vínculo histórico retorna
`404 PRODUCT_NOT_FOUND`. Admin local só altera o próprio anúncio. Sem vínculo,
inclusive super admin, retorna `403 MEMBERSHIP_REQUIRED`; sem token válido,
`401 UNAUTHENTICATED`; conta suspensa mantém `403 ACCOUNT_SUSPENDED`.

| Ação solicitada | Categoria | Resultado |
| --- | --- | --- |
| `ativo=false` | Ativa ou inativa | `200`, inclusive se já inativo |
| `ativo=true` | Ativa | `200`, inclusive se já ativo |
| `ativo=true` | Inativa | `409 CATEGORY_INACTIVE`, inclusive se já ativo |

A ativação usa a mesma validação de categoria da criação/edição; categoria
inexistente retorna `404 CATEGORY_NOT_FOUND`, sem tentativa de reparo. Para
trocar categoria, use a edição de conteúdo antes de ativar. Desativação não
valida disponibilidade da categoria. Estoque zero não impede nenhuma das ações
e não é modificado. A idempotência se refere ao estado solicitado; o trigger
normal pode atualizar `updated_at` também em chamadas repetidas.

O update envia apenas `{ ativo }`. UUID, vendedor, categoria, nome, descrição,
preço, estoque e `created_at` permanecem intactos; `updated_at` é atualizado pelo
trigger existente. Desativar preserva o produto no banco. Não há exclusão,
alteração de imagens, cancelamento de pedidos, histórico, conversa ou auditoria
administrativa. Não foi adicionada transação interativa, lock ou versão;
alterações legítimas concorrentes do próprio vendedor seguem last-write-wins.

O DTO e a serialização são os mesmos da edição: `dados` contém `id_produto`,
`nome_produto`, `descricao`, preço decimal em string com duas casas, `estoque`,
`ativo`, datas ISO UTC e `categoria` (`id_categoria`, `nome`, `ativo`). Nenhum
dado pessoal ou caminho de imagem é retornado. Depois de desativado, o produto
some da vitrine e continua em `/produtos/me` e `/produtos/me?ativo=false`.
Ao reativar, volta à vitrine se o vínculo vendedor estiver ATIVO e pertencer ao
condomínio autorizado. `/me` e a edição de conteúdo mantêm seus contratos.

Exemplos manuais com token fictício; substitua os UUIDs por produtos de teste
nas condições indicadas:

```bash
API='http://localhost:3000/api/produtos'
TOKEN='<TOKEN_MORADOR_ATIVO>'
PRODUTO='50000000-0000-4000-8000-000000000001'

# 1. Desativar: 200
curl -i -X PATCH "$API/$PRODUTO/status" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' --data '{"ativo":false}'

# 2. Ativar, com categoria ativa: 200
curl -i -X PATCH "$API/$PRODUTO/status" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' --data '{"ativo":true}'

# 3. Produto com categoria inativa: 409 CATEGORY_INACTIVE
curl -i -X PATCH "$API/<UUID_PRODUTO_CATEGORIA_INATIVA>/status" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  --data '{"ativo":true}'

# 4. Produto alheio: 404 PRODUCT_NOT_FOUND
curl -i -X PATCH "$API/<UUID_PRODUTO_ALHEIO>/status" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  --data '{"ativo":false}'

# 5. Boolean inválido: 400 VALIDATION_ERROR
curl -i -X PATCH "$API/$PRODUTO/status" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' --data '{"ativo":"true"}'

# 6. Produto já com estoque zero e categoria ativa: 200, estoque permanece zero
curl -i -X PATCH "$API/<UUID_PRODUTO_ESTOQUE_ZERO>/status" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  --data '{"ativo":true}'
```

Validação automatizada (os testes incluem typecheck):

```bash
npm run build --workspace backend
npm run test:status-produto --workspace backend
ONBOARDING_TEST_DATABASE_URL='postgresql://<USUARIO_LOCAL>@127.0.0.1:<PORTA>/porta_onboarding_teste' \
  npm run test:status-produto:integration --workspace backend
```

Os testes usam banco simulado ou PostgreSQL local descartável, JWTs locais e
JWKS simulado. Verificam idempotência, categoria inativa em ambos os estados,
estoque zero, isolamento, trigger, campos preservados, propriedade no update
final, visibilidade e preservação de fixtures de imagem/pedido/histórico/chat.
Nenhum DDL, migration, seed ou `schema.prisma` foi alterado; nenhuma API de
imagens, pedidos, chat, exclusão ou detalhe foi implementada.
`npm run dev` permanece como comando principal na raiz.
