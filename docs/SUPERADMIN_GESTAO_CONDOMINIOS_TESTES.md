# Testes da gestão de condomínios — Prompt 30

Execução local em 30/10/2026. Regras e contratos em [SUPERADMIN_GESTAO_CONDOMINIOS.md](SUPERADMIN_GESTAO_CONDOMINIOS.md).

## Pré-condições e segurança do ambiente

Node 22.14, dependências existentes e PostgreSQL 18 local. Banco criado exclusivamente para esta execução: `porta_onboarding_teste`, 127.0.0.1:55430, cluster temporário `TEMP/porta-p30-pg`. DDL do repositório, sem modificar Supabase, credenciais reais, `.env` ou schema Prisma. Integrações validam allowlist antes de importar Prisma. Não executar resets junto a outra suíte/jornada usando o mesmo banco. Suítes antigas podem pressupor massa limpa entre arquivos.

Runner Playwright instalado somente em `TEMP/porta-p30-browser`, Chrome instalado em headless. TLS do npm verificado usando certificados públicos já confiados pelo Windows via arquivo temporário; nenhuma verificação TLS foi desabilitada. Build de browser usa somente `http://auth.porta.test`, `http://api.porta.test/api` e publishable key fictícia, com preview local 127.0.0.1:5176. Em Windows, PLAYWRIGHT_MODULE deve ser URL `file:///.../index.mjs`; PLAYWRIGHT_CHROMIUM_EXECUTABLE permite usar o Chrome existente. Capturas agora usam `os.tmpdir()` em vez de caminho Unix fixo.

## Comandos

```powershell
# PowerShell: ajustar PATH apenas nesta sessão, se necessário.
$env:PATH = 'C:\nvm\v22.14.0;' + $env:PATH
$env:ONBOARDING_TEST_DATABASE_URL = 'postgresql://porta_test@127.0.0.1:55430/porta_onboarding_teste'
npm.cmd run build
npm.cmd run test:gestao-condominios --workspace backend
npm.cmd run test:gestao-condominios:integration --workspace backend
npm.cmd test --workspace frontend

# Depois do build/preview fictício descrito acima e com Playwright disponível:
node frontend/tests/fluxos.browser.mjs
node frontend/tests/mvp.integrado.browser.mjs
```

Os 31 scripts backend preexistentes também são regressão; os dois novos elevam o total a 33. Todos compilam tsconfig.test.json. Não há lint configurado nem script genérico test/typecheck de backend. Build inclui tipos, mas não substitui testes.

## Cobertura executável desta etapa

| Jornada | Passos e resultado esperado | Evidência |
| --- | --- | --- |
| Autorização | Sem Bearer →401; morador/local com claims forjadas →403 nas quatro rotas; super suspenso → ACCOUNT_SUSPENDED | Nova integração HTTP/PG; guards de navegador preexistentes |
| Consulta | Buscar/paginar/filtrar ativos e inativos, nome/UUID estáveis, sem PII; destino comum omite inativos | Integração e navegador P30 |
| Cadastro anterior | Cadastrar, encontrar, onboarding PENDENTE, aprovar sem admin prévio e promover explicitamente | Integração navegador MVP/P29 preservada |
| Edição | Abrir por ID/refresh, normalizar CEP, enviar só diferença e versão; inválidos não gravam | Unidade, integração e navegador P30 |
| Conflito | Dois PATCH da versão antiga: exatamente um sucesso e um 409; rascunho preservado, recarga explícita | PostgreSQL real + navegador; jornada integrada P30 |
| Confirmação | Cancelar/Escape não escreve; confirmar envia ativo desejado/motivo; duplo clique só um PATCH | Navegador P30 |
| No-op | Estado atual + versão atual →200, sem UPDATE/auditoria; versão velha →409 | Integração PG |
| Auditoria | Diferenças/ator corretos; motivo em mudança de estado; falha de audit reverte edição e status | Integração PG com falha injetada apenas na escrita da auditoria |
| Desativar ocupado | Preservar vínculos/admin/produto/pedido/chat; impedir entrada direta e aprovação; manter consulta/rejeição/suspensão explícita | Integração HTTP/PG e jornada navegador P30 |
| Continuidade | Morador de inativo continua vitrine, histórico e envio de chat; saída para ativo continua sujeita a pedidos abertos | Integração nova; regressões de transferência/último admin |
| Reativar | Nova elegibilidade, pendência não aprovada automaticamente, suspensões preservadas | Integração HTTP/PG e navegador P30 |
| Corridas | Onboarding, solicitação de transferência, aprovação inicial e aprovação de transferência, em ambas as ordens contra desativação | Oito cenários PG reais, barreiras após lock e espera comprovada por pg_stat_activity |
| Rede/validação | Preservar inputs, sem sucesso/retry presumido; resultado incerto requer conferência por leitura | Navegador P30 e infraestrutura de API existente |
| Teclado/mobile | Labels, foco no modal, Tab/Escape, devolução de foco e ausência de overflow com textos máximos | Navegador P30 em 360/1280; catálogo P29 em 360/390/768/1280 |

## Resultados e limitações

| Verificação final | Resultado |
| --- | --- |
| `npm run build` na raiz | PASSOU, backend + frontend/TypeScript |
| 31 scripts backend anteriores | 487/487 aprovados após reexecuções descritas abaixo |
| `test:gestao-condominios` | 4/4 aprovados |
| `test:gestao-condominios:integration` | 15/15 aprovados, incluindo oito corridas reais |
| `npm test --workspace frontend` | 64/64 aprovados |
| `node frontend/tests/fluxos.browser.mjs` | 182/182 aprovados, incluindo dez novos P30 |
| `node frontend/tests/mvp.integrado.browser.mjs` | 1/1 aprovado, com extensão P30 real e jornadas anteriores |
| `git diff --check` | PASSOU |

Total: **753 testes finais aprovados** (506 backend, 64 frontend Node, 182 navegador com domínio simulado e uma jornada integrada local). Reexecuções não entram na soma. Sem falhas/skips finais. A jornada integrada inclui conflito real com edição externa, preservação de rascunho, recarga, edição, desativação com auditoria, permanência de morador/admin e reativação; mantém produto/estoque/chat/transferência e suspensão global/local anteriores.

As primeiras falhas novas eram do helper de teste, que enviava Content-Type JSON em PATCH sem body. Corrigido o helper, as oito corridas passaram com locks reais. O navegador identificou perda de foco porque abrir o diálogo provocava nova consulta e removia o botão de origem; o efeito da lista agora depende apenas dos filtros/versão relevantes, e o diálogo tem foco inicial/ciclo/restauração comprovados.

Uma suíte antiga de onboarding falhou porque acumulamos massa de vários arquivos e ela procura seu condomínio apenas na primeira página; com banco descartável limpo passou 9/9, sem modificar seu teste/regra. A suíte antiga de imagens recebeu ECONNRESET no JPEG truncado de 11 bytes. Diagnóstico mínimo com Express/Multer confirmou bloqueio do Avast WebShield: URL local `http://127.0.0.1:46154/upload`, resposta 403 com categoria malicious_content e mensagem de conteúdo detectado como malicioso. Nenhuma proteção foi desativada. A fixture foi substituída por JPEG branco válido 1×1 gerado localmente com System.Drawing; preservados nome adversarial `../../minha foto (1).svg`, MIME, paths aleatórios, ordens, DTOs e demais asserções. Reexecução integral passou 37/37. Isso não altera código de upload nem promete decodificação completa em produção.

Build conserva avisos não bloqueantes de chunk >500 kB/anotações Zod; integração conserva aviso de depreciação do pg por queries concorrentes, sem falha. Nenhuma dependência foi adicionada ao repositório. Captura mobile do diálogo com texto máximo foi inspecionada visualmente; verificações automatizadas não encontraram overflow em 360/1280 e o catálogo anterior continua testado em 360/390/768/1280.

Logs: `TEMP/porta-p30-test-*.log` (regressão anterior), `porta-p30-final-test-onboarding-integration.log`, `porta-p30-imagem-fixture-valida.log`, `porta-p30-final-test-gestao-condominios-integration.log`, `porta-p30-browser-completo.log`, `porta-p30-integrado-final.log` e `porta-p30-build-final.log`. Capturas: `porta-p30-dialogo-360.png` e `porta-p30-dialogo-1280.png`. Massa/cluster temporários são exclusivos desta execução; serviços são encerrados ao concluir.

Teste manual remoto e leitor de tela/dispositivo físico não foram executados; os cenários locais são automatizados, não homologação remota. Estado final desta etapa: `PROMPT_30_STATUS = COMPLETE`, para entrega local revisável, com configuração Supabase remota ainda sujeita à homologação descrita no MVP.
