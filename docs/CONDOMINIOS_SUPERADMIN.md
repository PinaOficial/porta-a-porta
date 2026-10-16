# Cadastro de condomínios — Prompt 29

Entrega de 16/10/2026. Superadmin cadastra condomínios; administrador local e morador não cadastram. Escopo: criação e consulta do catálogo ativo, sem edição/desativação/exclusão, ViaCEP, vínculo/privilégio automático, mudança estrutural ou deploy.

## Contrato e persistência

`POST /api/admin/condominios`, JWT Supabase válido, conta não suspensa, super_admin resolvido na tabela. Middleware `autenticar` → `exigirSuperAdmin()` → Zod estrito → controller → service administrativo → repository de condomínios. Service também exige `auth.super_admin === true`. Claims, body e query não fornecem autoridade.

Body contém somente `nome_residencial` (trim, 1..160), `cep` (string de oito dígitos) e `endereco` (trim, 1..255). Campos extras são rejeitados. Sucesso **201**:

```json
{"dados":{"id_condominio":"<UUID_GERADO>","nome_residencial":"Residencial Exemplo","cep":"72000000","endereco":"Rua Fictícia, 29","ativo":true,"created_at":"2026-10-16T20:00:00.000Z"}}
```

DTO/select explícito. UUID/ativo/data usam defaults existentes do PostgreSQL; created_at serializa ISO UTC. DDL e Prisma confirmam VARCHAR(160/8/255), CHECK CEP e ausência de unicidade por CEP/nome. Não houve SQL, migration, db push, introspecção ou edição de schema.

Service abre transação Prisma ReadCommitted e grava exatamente condomínio + auditoria `CREATE_CONDOMINIUM` pelo helper existente. Ator é req.auth.id_usuario; entidade `condominio`; entidade_id e id_condominio usam UUID criado; metadata `{ativo:true}`, sem endereço/nome/dados pessoais. Falha em qualquer escrita rejeita a transação inteira. Nenhuma identidade, perfil, vínculo, super_admin, produto ou pedido é criado nesse POST.

Erros: 400 VALIDATION_ERROR (parser/Zod); 401 UNAUTHENTICATED; 403 FORBIDDEN ou ACCOUNT_SUSPENDED; 500 INTERNAL_ERROR sanitizado. Nenhum conflito artificial por nome/CEP repetido. POST não é idempotente.

## Interface e ciclo residencial

`/admin` oferece Condomínios apenas ao super, com link para `/admin/condominios`. GuardAdmin com `somenteSuper` protege URL/refresh; mantém administração local existente. Página oferece catálogo ativo, busca/página na URL, estados loading/empty/error/retry e formulário com três labels, validação Zod, CEP 00000-000 normalizado para oito dígitos, cancelar e trava de submit.

Client tipado reutiliza api.ts/Bearer. Após 201 mostra dados reais e relê catálogo pelo nome na página 1; confirmação contém o ID criado mesmo se nomes repetidos/paginação dificultarem a localização. Novo cadastro exige abrir novamente o formulário. Em 400 mantém entradas/erros por campo; 403 refaz acesso. Rede/5xx/resposta ilegível informa resultado incerto e orienta conferir catálogo antes de liberar reenvio explícito; não repete POST automaticamente. Identidade/papel alterados desmontam estado privado; leituras usam AbortController.

Não existe GET administrativo novo. `GET /api/condominios` continua autenticado, ativo, busca/paginação no banco, dados[]/paginacao raiz, limite máximo 50 (UI 20). Seletores de onboarding/transferência não têm cache persistente e refazem consulta ao montar/buscar/atualizar. Novo destino aceita onboarding PENDENTE/admin=false, super aprova primeiro morador sem admin local prévio e promove explicitamente pelo PATCH já existente. Super continua sem residência fictícia.

## Arquivos criados/alterados

- Backend: `modules/administracao/administracao.{routes,controller,service}.ts`; `modules/condominios/condominio.{schema,model,repository}.ts`; `backend/package.json` (dois scripts).
- Novos testes: `backend/tests/criar-condominio.test.ts` e `criar-condominio.integration.test.ts`.
- Fixtures antigas em `status-produto.integration.test.ts` e `imagem-produto.integration.test.ts`: horário combinado fixo em 2026 já passado foi trocado por data futura em 2099, preservando constraint/regras.
- Frontend: nova `features/administracao/CondominiosAdminPage.tsx`; `AdminPage.tsx`; `features/condominios/condominio.{api,schema,types}.ts`; `routes/AppRoutes.tsx`; estilos limitados à página.
- Testes frontend: `infra.test.ts`, `fluxos.browser.mjs`, `mvp.integrado.browser.mjs`.
- Documentação: `AGENTS.md`, `BACKEND_INVENTARIO.md`, `FRONTEND_HANDOFF.md`, adendos em `MVP_AUDITORIA_FINAL.md`/`MVP_TESTES_MANUAIS.md` e este relatório. Evidência histórica preservada.

## Reprodução e validação

Scripts reais: `npm run build` na raiz; `npm test --workspace frontend`; todos os 31 scripts test:* de backend/package.json, incluindo `test:criar-condominio` e `test:criar-condominio:integration`. Todos compilam os respectivos testes TypeScript; não há script genérico de typecheck/test no backend ou lint frontend.

Banco exclusivo desta execução: `/tmp/porta-p29-pg`, 127.0.0.1:55449, porta_onboarding_teste, DDL existente. Allowlist local é conferida antes de importar Prisma. Runner temporário `/tmp/porta-p29-regressao.py` limpa somente massa desse banco entre suítes. Nenhum teste destrutivo usa Supabase remoto. Playwright/Chromium instalados somente em `/tmp/porta-p29-browser`, sem dependência nova no repositório.

Build do navegador com configuração fictícia (sem alterar .env):

```bash
VITE_SUPABASE_URL=http://auth.porta.test \
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_EXEMPLO_TESTE \
VITE_API_URL=http://api.porta.test/api npm run build
npm run preview --workspace frontend -- --host 127.0.0.1 --port 5176 --strictPort

FRONTEND_TEST_URL=http://127.0.0.1:5176 \
PLAYWRIGHT_BROWSERS_PATH=/tmp/porta-p29-browser/browsers \
PLAYWRIGHT_MODULE=/tmp/porta-p29-browser/node_modules/playwright/index.mjs \
node frontend/tests/fluxos.browser.mjs

# Executar separadamente do runner que limpa o banco:
ONBOARDING_TEST_DATABASE_URL=postgresql://renan@127.0.0.1:55449/porta_onboarding_teste \
FRONTEND_TEST_URL=http://127.0.0.1:5176 \
PLAYWRIGHT_BROWSERS_PATH=/tmp/porta-p29-browser/browsers \
PLAYWRIGHT_MODULE=/tmp/porta-p29-browser/node_modules/playwright/index.mjs \
node frontend/tests/mvp.integrado.browser.mjs
```

## Exemplos curl (tokens fictícios)

```bash
# 201: somente um superadmin real, provisionado na tabela, pode criar.
curl -i http://localhost:3000/api/admin/condominios \
  -H 'Authorization: Bearer TOKEN_SUPERADMIN_FICTICIO' \
  -H 'Content-Type: application/json' \
  -d '{"nome_residencial":"Residencial Exemplo","cep":"72000000","endereco":"Rua Fictícia, 29"}'

# 401: sem Bearer.
curl -i http://localhost:3000/api/admin/condominios \
  -H 'Content-Type: application/json' \
  -d '{"nome_residencial":"Residencial Exemplo","cep":"72000000","endereco":"Rua Fictícia, 29"}'

# 403: token de administrador local autenticado, sem papel super na tabela.
curl -i http://localhost:3000/api/admin/condominios \
  -H 'Authorization: Bearer TOKEN_ADMIN_LOCAL_FICTICIO' \
  -H 'Content-Type: application/json' \
  -d '{"nome_residencial":"Residencial Exemplo","cep":"72000000","endereco":"Rua Fictícia, 29"}'
```

Substituir placeholders em ambiente autorizado; tokens literais fictícios não são JWT válidos. Não registrar credenciais reais.


## Resultados executados nesta etapa

Build da raiz passou para ambos os workspaces e TypeScript strict. Frontend Node: **64/64**. Backend: **487/487**, 167 unitários e 320 HTTP/PostgreSQL, nos 31 scripts abaixo. Não se somam reexecuções à contagem.

| Script backend (`npm run <nome> --workspace backend`) | Aprovados | Resultado final |
| --- | --- | --- |
| test:categorias | 3 | PASSOU |
| test:categorias:integration | 8 | PASSOU |
| test:produtos | 28 | PASSOU |
| test:produtos:integration | 19 | PASSOU |
| test:meus-produtos | 6 | PASSOU |
| test:meus-produtos:integration | 19 | PASSOU |
| test:criar-produto | 6 | PASSOU |
| test:criar-produto:integration | 14 | PASSOU |
| test:editar-produto | 8 | PASSOU |
| test:editar-produto:integration | 16 | PASSOU |
| test:status-produto | 7 | PASSOU |
| test:status-produto:integration | 18 | PASSOU |
| test:condominios | 14 | PASSOU |
| test:criar-condominio | 5 | PASSOU |
| test:criar-condominio:integration | 7 | PASSOU |
| test:onboarding | 9 | PASSOU |
| test:onboarding:integration | 9 | PASSOU |
| test:vinculos | 15 | PASSOU |
| test:vinculos:integration | 11 | PASSOU |
| test:admin-vinculos | 10 | PASSOU |
| test:admin-vinculos:integration | 11 | PASSOU |
| test:aprovar-vinculo | 9 | PASSOU |
| test:aprovar-vinculo:integration | 54 | PASSOU |
| test:rejeitar-vinculo | 5 | PASSOU |
| test:rejeitar-vinculo:integration | 20 | PASSOU |
| test:suspender-vinculo | 4 | PASSOU |
| test:suspender-vinculo:integration | 17 | PASSOU |
| test:imagem-produto | 21 | PASSOU |
| test:imagem-produto:integration | 37 | PASSOU |
| test:pedidos | 17 | PASSOU |
| test:pedidos:integration | 60 | PASSOU |

A primeira regressão de status de produto teve uma falha por data fixa de fixture já passada. Corrigida para 2099, a suíte passou 18/18; a mesma data foi corrigida preventivamente na fixture de imagem (37/37). Regras/constraints de produção ficaram intactas. A primeira execução direcionada do browser identificou uma expectativa de texto exato que incluía botão no alerta; a execução ampla identificou expectativa de URL sem query após paginação. Ambas as expectativas dos novos testes foram corrigidas. Um timeout de refresh de teste anterior passou na reprodução isolada; os resultados finais completos são registrados abaixo.

Logs locais: /tmp/porta-p29-regressao.json e test-*.log, /tmp/porta-p29-status-produto-final.log, /tmp/porta-p29-build-final.log; captura inspecionada /tmp/porta-p29-condominios.png. O build mantém avisos não bloqueantes de chunk >500 kB e anotações Zod. Não há lint frontend configurado.

Chromium completo final: **172/172**, zero falhas/skips (159 anteriores + 13 novos). Inclui guard de super/local/morador, refresh, Zod, CEP normalizado/Bearer/corpo exato, duplo clique, 400/403, resposta perdida sem retry, catálogo/retry/paginação e quatro larguras 360/390/768/1280. Captura mobile inspecionada e sem overflow com nome/endereço nos limites. Acessibilidade verificada por labels/foco/estados; sem alegar auditoria WCAG ou leitor de tela físico.

Jornada integrada final: **1/1**, zero falhas/skips. Browser → client de produção → Express → Prisma → PostgreSQL local reais; somente Auth/JWKS/Storage simulados. A extensão P29 cria pelo formulário, confere auditoria/ausência de vínculo automático, encontra o destino no onboarding por busca, cria PENDENTE, aprova sem admin prévio, confirma admin=false, promove explicitamente e comprova guard/403 de admin local. Conserva também as jornadas anteriores de produto/pedido/chat/transferência/conta global. Histórico de outros condomínios é comparado nas integrações.

Total final: **724 testes aprovados** (487 backend + 64 frontend Node + 172 Chromium com domínio simulado + 1 jornada integrada real local). Logs: /tmp/porta-p29-browser-final.log e /tmp/porta-p29-integrado-final.log. Reexecuções intermediárias não entram no total. Não há testes finais falhos ou ignorados.

**MVP_READY_FOR_USER_TESTING = YES**, para próxima rodada de homologação interna controlada. Supabase real, token emitido remotamente, permissões da conexão Prisma, confirmação/entrega de e-mail e Storage remoto continuam **não verificados nesta execução**; validar configuração real no ambiente de demonstração. Sem deploy ou garantia de produção. Preview e PostgreSQL descartável iniciados nesta tarefa foram encerrados ao concluir; evidências locais preservadas.
