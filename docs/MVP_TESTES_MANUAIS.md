# Roteiro manual do MVP — ambiente e contas de teste

Referência: [auditoria integrada](MVP_AUDITORIA_FINAL.md), Prompt 28, 16/10/2026. Este documento é um roteiro para execução posterior pela equipe. **A execução manual remota não foi realizada pelo agente.** O resultado da auditoria local não substitui a configuração/homologação do Supabase de demonstração.

## Antes de começar

1. Usar exclusivamente um ambiente de teste, com banco, Auth e bucket separados de produção. O responsável deve confirmar o destino antes de qualquer preparação. Não usar pessoas, e-mails pessoais, CPFs reais ou senhas reaproveitadas.
2. Seguir a configuração existente no README e database/README.md. O schema já deve estar preparado; este roteiro não autoriza novos DDL, migrations ou resets. Vínculos administrativos e super admin precisam estar provisionados pelo responsável autorizado: a aplicação não cria super admin por tela.
3. Conferir `.env.example`: backend recebe DATABASE_URL/SUPABASE_SECRET_KEY; frontend recebe apenas VITE_API_URL, VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY. Nunca copiar segredo para VITE. CORS_ORIGIN deve corresponder à origem exata do browser, inclusive localhost versus 127.0.0.1.
4. Confirmar bucket **product-images privado**, permissões do usuário PostgreSQL do backend e configuração de confirmação/redirect de e-mail do Auth. Para testar confirmação, usar caixas/aliases controlados de teste que consigam receber mensagens; exemplos `@exemplo.test` abaixo são identificadores fictícios e não recebem e-mail.
5. Iniciar `npm run dev` na raiz. Abrir frontend, normalmente http://localhost:5173, e conferir GET http://localhost:3000/api/health com status ok/projeto porta-a-porta. Não esperar API de domínio funcionar sem Bearer.
6. Ter dois condomínios ativos, **X e Y**, uma categoria ativa e, se disponível no ambiente preparado, uma categoria inativa. Usar fotos fictícias JPEG/PNG/WEBP, uma imagem quebrada/inválida e arquivo acima de 5 MiB. Nenhum documento pessoal.
7. Abrir contextos independentes para pessoas diferentes (perfis do navegador ou anônimos separados). Duas abas normais do mesmo contexto compartilham Auth: usar isso somente no cenário L.

| Identidade lógica | Exemplo fictício | Estado inicial necessário |
| --- | --- | --- |
| A, comprador novo | a@exemplo.test | Credencial Auth; ainda sem onboarding, depois morador X |
| B, vendedor | b@exemplo.test | Morador ATIVO de X |
| C, outro condomínio | c@exemplo.test | Morador ATIVO de Y |
| AX | admin.x@exemplo.test | ATIVO e admin de X |
| AY | admin.y@exemplo.test | ATIVO e admin de Y |
| S | super@exemplo.test | Super admin global, sem residência |

Cada identidade tem UUID próprio. Registrar os IDs de teste necessários ao roteiro, nunca tokens/senhas. Usar CPFs **fictícios** e exclusivos com 11 dígitos conforme a massa acordada para o ambiente. O backend atual não valida dígitos verificadores; não transformar esse ponto em divergência artificial de teste.

## Como registrar cada resultado

Usar uma linha por caso com: data/ambiente, versão/commit quando disponível, identidade lógica/papel, navegador/viewport, passos, esperado, observado, PASSOU/FALHOU/NÃO EXECUTADO e evidência sanitizada. Em falha HTTP, anotar método, path, status e código de erro; remover Authorization, cookies, token de URL, CPF, senha e dados pessoais de capturas/logs. Não anexar exportação HAR sem sanitização.

Ao encontrar possível P0/P1, parar o cenário afetado e registrar o estado; não tentar consertar dados apagando histórico. Comparar com o contrato real e abrir achado com reprodução. Resultado desconhecido de criação de pedido deve ser conferido em Meus Pedidos antes de novo envio.

## A — Auth, onboarding e aprovação

**Pré-condições:** A sem domínio, AX autorizado em X; catálogo com X ativo.

1. Como visitante, abrir /vitrine, /pedidos e /admin por URL. Esperado: Login, sem conteúdo privado antes de resolver a sessão.
2. Fazer cadastro com credencial fictícia controlada. Se o projeto exige confirmação, conferir orientação, receber e abrir o link e retornar ao aplicativo. Se a política permite sessão imediata, seguir ao onboarding. Testar as duas políticas somente em ambientes de teste preparados para isso, sem mudar produção.
3. No Login, tentar senha incorreta e e-mail não confirmado. Esperado: erro apropriado, formulário preservado, nenhuma navegação protegida. Entrar corretamente; atualizar a página sem flash de Login depois da restauração.
4. No onboarding, pesquisar X, avançar/voltar páginas (limite máximo 50; UI usa 20), buscar nome inexistente e limpar busca. Selecionar X e preencher nome, CPF fictício, data ISO pelo campo de data e moradia.
5. Enviar; evitar duplo clique. Esperado: 201, PENDENTE, tela aguardando aprovação. No Network, body somente nome_completo/cpf/data_nascimento/id_condominio/moradia, sem credenciais/autoridade. Validar erro por campo sem perder os demais valores.
6. Em contexto AX, abrir Solicitações pendentes e aprovar A, confirmando a ação. Esperado: PATCH sem body, item sai da fila após 200. Em A, Atualizar status: vínculo ATIVO e vitrine de X.
7. Atualizar a página, sair/entrar e visitar rota inexistente. Esperado: sessão/estado coerentes, sem loop. Se onboarding já foi concluído em outra aba, conflito deve refazer estado, não recriar identidade.

**Registrar:** IDs fictícios de A/vínculo/X, códigos HTTP e estados antes/depois. Rejeição/encerramento não devem oferecer um novo POST de residência ou onboarding inexistente no contrato.

## B/C — Vitrine, publicação, edição, imagens e compra

**Pré-condições:** A e B ATIVOS em X, categoria ativa, produto fictício de B com preço inicial 25,90 e estoque 4.

1. Como B, abrir Meus Produtos → Novo produto. Validar nome/descrição, categoria, preço decimal e estoque inteiro; criar. Esperado: POST com cinco campos editáveis; preço string e estoque número, sem tenant/vendedor/imagens.
2. Editar somente descrição/preço. Esperado: PATCH não vazio com somente diferenças. Sem alterações, não enviar PATCH. Categoria que ficou inativa pode ser mantida omitindo id_categoria; trocar categoria/ativar exige categoria ativa. Desativar e reativar com estoque zero não inventa proibição extra.
3. Adicionar uma foto por vez. Esperado: multipart campo imagem, browser define boundary, JPEG/PNG/WEBP até 5 MiB. Depois de 201, leitura fornece signed URL. Testar tipo/tamanho inválido; preservar produto e permitir corrigir seleção.
4. Excluir uma imagem, cancelar uma confirmação e repetir para confirmar. Esperado: cancelamento não envia DELETE; confirmação recebe 204 sem parse JSON; registro some após nova leitura e produto continua. Falha parcial não apaga anúncio. Repetir exclusão já removida deve reconciliar IMAGE_NOT_FOUND.
5. Como A, buscar/categorizar/paginar vitrine; refresh e voltar/avançar preservam filtros. Abrir produto diretamente por ID e recarregar. Conferir vendedor/moradia, galeria/alt/placeholder, estoque zero visível e pedido desabilitado quando necessário.
6. B deve ver seu anúncio como próprio e poder editar; A/AX não podem editar o anúncio de B por URL. Admin local não ganha ownership.
7. Em A, preencher quantidade 2 e horário futuro local. Antes do envio, B pode alterar o preço para 30,00. Esperado: estimativa inicial 51,80 não é autoridade; confirmação real do POST mostra total 60,00 congelado, status SOLICITADO, ID e chat disponível em Meus Pedidos. Body apenas produto/quantidade/horário com timezone.
8. Consumir estoque em outro contexto antes do envio: INSUFFICIENT_STOCK deve atualizar detalhe e quantidade, sem mensagem de pedido criado. Testar produto removido da vitrine e 404 por ID.
9. Simular perda de rede durante envio somente com massa controlada. Esperado: não anunciar sucesso, não repetir POST, manter campos e orientar Conferir Meus Pedidos antes de tentar novamente; a resposta pode ter sido perdida após commit.

**Registrar:** ID do produto/pedido de teste, string monetária recebida, estoque observado, retorno do upload/delete e horário UTC/local. URLs assinadas expiram; não registrá-las como identificador permanente. Validar expiração real/renovação por GET no ambiente remoto, pois a auditoria local simulou Storage.

## D — Aceite, chat e conclusão

**Pré-condições:** pedido SOLICITADO de A para B.

1. B abre Meus Pedidos, filtra Vendas/SOLICITADO e aceita. A atualiza seus pedidos. Esperado: ACEITO e histórico coerente; B não recebe Cancelar como vendedor.
2. A abre Conversar por link e por /pedidos/:id/chat em URL direta. Enviar texto com espaços nas extremidades e caracteres parecidos com HTML. Esperado: trim, texto escapado, 201 antes de confirmar envio e uma única mensagem após refetch.
3. Validar vazio/limite 1000, erro de rede preservando texto e atualização manual. Paginação é da mais antiga para a mais recente; Ir para as últimas mensagens usa a última página. Conferir rolagem/foco depois de enviar/carregar mais, inclusive com teclado virtual.
4. B conclui com confirmação. Esperado: CONCLUIDO permanece no histórico e estoque não é restituído. Pedido terminal não encerra chat automaticamente. Se houver conversa ENCERRADA preparada, ela permite leitura e bloqueia composição/CHAT_CLOSED.
5. S pode ler a conversa pelo ID conforme contrato, sem compositor de envio como observador. AX/C alheios não podem ler chat de A.

**Registrar:** transições, ordem de histórico, IDs de mensagens de teste sem conteúdo privado e diferenças entre estado do pedido e da conversa.

## E — Cancelar/recusar e restituir uma vez

**Pré-condições:** dois pedidos novos de A para B, estoque conhecido antes da reserva.

1. A cancela um pedido SOLICITADO (e repetir em outro ACEITO, se desejado); B recusa outro SOLICITADO. Confirmar impacto.
2. Esperado: CANCELADO/RECUSADO, histórico adicional e estoque devolvido uma única vez após resposta/refetch. Não deve existir devolução otimista antes da API confirmar.
3. Repetir a ação ou usar uma tela antiga. Esperado: 409 INVALID_ORDER_TRANSITION, nova leitura e nenhum retry automático de escrita. Estado terminal continua visível nos filtros/histórico.

**Registrar:** estoque inicial, reserva e estoque final. Não testar dupla restituição editando estoque diretamente no banco.

## F/G — Transferência e pedidos abertos

**Pré-condições:** A ATIVO em X, destino Y ativo e AY autorizado em Y. Manter um anúncio fictício de A em X para conferir desativação futura.

1. Com um pedido SOLICITADO/ACEITO de A ainda aberto, abrir Perfil → Solicitar transferência. O condomínio atual deve estar desabilitado. Selecionar Y e nova moradia.
2. Enviar. Esperado: somente id_condominio/moradia; 201 cria PENDENTE em Y e mantém ATIVO em X. Vitrine e anúncios de X continuam utilizáveis. Perfil mostra ambos e não oferece segunda solicitação.
3. AY tenta aprovar. Esperado: OPEN_ORDERS_BLOCK_TRANSFER, PENDENTE continua e não há encerramento/desativação parcial. Não há lista nova de pedidos de terceiros nessa tela.
4. Resolver o pedido aberto com as partes; AY atualiza a fila e aprova explicitamente. A usa Atualizar perfil/estado. Esperado: novo ATIVO em Y, sem herdar admin; vínculo X ENCERRADO, anúncios antigos inativos e com vínculo vendedor original.
5. Navegar à vitrine/Meus Produtos: não manter dados de X como atuais. Abrir Meus Pedidos/chat anteriores: histórico de X permanece, com valor congelado e contraparte/moradia originais.
6. Tratar SAME_CONDOMINIUM/MEMBERSHIP_PENDING pela mensagem/refetch real. Rejeitar a transferência, em cenário separado, não deve encerrar residência antiga.

**Registrar:** dois IDs de vínculo de teste, estados antes/depois e anúncio antigo; não reescrever FKs para “mover” produtos/pedidos.

## H — Último admin e intervenção global

**Pré-condições:** condomínio de teste X com AX como único admin ATIVO, nenhum pedido aberto de AX. Executar depois dos cenários que dependem de AX, ou em massa exclusiva.

1. AX solicita transferência para Y; AY tenta aprovar. Esperado: LAST_ACTIVE_ADMIN, estado pendente e residência antiga preservados.
2. S inspeciona o caso e aprova conforme a política de teste. Esperado: pode intervir no bloqueio do último administrador; não ignora pedidos abertos. AX perde privilégio residencial ao mudar, novo vínculo começa admin=false.
3. Restaurar a capacidade administrativa de X promovendo outro vínculo ATIVO de teste por S, conforme procedimento autorizado. Não apagar histórico nem recriar o vínculo antigo.

**Registrar:** causa do bloqueio, autoridade que aprovou e administrador de teste que ficou responsável. Não confundir com Suspender vínculo: esse PATCH não possui bloqueio inventado de último admin.

## I — Autorização e tenant: negativos na API

**Pré-condições:** IDs fictícios de recursos de X/Y e sessões separadas. A equipe técnica deve observar Network ou executar as integrações existentes; não compartilhar tokens entre pessoas.

| Tentativa | Resultado esperado |
| --- | --- |
| A tenta vitrine de Y com id_condominio forjado | 403 FORBIDDEN_CROSS_TENANT; não recebe dados de Y |
| A/AX tentam PATCH/imagem de produto de B | Recurso negado conforme contrato; nenhum ownership administrativo |
| AX tenta lista/decisão de vínculo de Y | 403 de escopo/autoridade, sem alteração |
| C/AX não participantes tentam pedido/chat de A | ORDER_NOT_FOUND, sem dados de terceiro |
| S tenta alterar status de pedido alheio/enviar como observador | Sem bypass; envio negado, leitura conforme contrato |
| Morador tenta forjar flags no body/query/metadata | Rejeição/nenhuma concessão de privilégio |
| Token ausente, expirado, assinatura/issuer/audience incorretos | 401, sem conteúdo privado |

A URL administrativa local com condomínio estrangeiro também deve ser barrada na UI, mas isso não substitui o teste Express. Falhas inesperadas devem continuar sanitizadas, sem stack/SQL. Não usar ferramentas de teste para imprimir JWT real em logs.

## J/K — Conta global versus vínculo local

1. Como S, buscar A em Moradores e vínculos. Sem API que retorne status global, não deve haver toggle fingindo conhecer estado prévio. Suspender conta pede confirmação e usa **id_usuario**.
2. Após 200, A atualiza uma tela protegida com a mesma sessão: Conta suspensa, sem conteúdo protegido e com saída possível. Vínculos/produtos/pedidos/Auth não são alterados automaticamente por esse PATCH.
3. S reativa a conta. A recarrega/entra novamente. Esperado: conta liberada; vínculo continua no estado anterior. Se estava SUSPENSO/ENCERRADO, não vira ATIVO por reativação global.
4. Como admin local do condomínio atual de A, Suspender vínculo, confirmando que pedidos/chats serão preservados. Esperado: perde ações residenciais, conta global continua ATIVA e Meus Pedidos/chat antigos seguem disponíveis. Não oferecer reativação local inexistente.
5. Testar promover/rebaixar outro vínculo ATIVO e confirmar rebaixamento. Local não recebe autoalteração; status/morador/condomínio corretos. Aprovar/rejeitar/suspender enviam PATCH sem body; mudar admin envia só boolean.
6. Retirar privilégio de um admin com painel aberto em outra aba. No próximo 403, conteúdo administrativo sai, estado/guard são revalidados e não aparece outro tenant automaticamente.

**Registrar:** códigos e estados de conta/vínculo separadamente; resultado global compartilhado entre registros históricos da mesma pessoa, sem tratar cada vínculo como conta independente.

## L — Sessão, abas e respostas atrasadas

1. Com a mesma conta em duas abas normais, sair em uma. Esperado: a outra perde conteúdo protegido via Auth, inclusive com consulta pendente.
2. Sob throttling de rede, iniciar pedido e sair antes da resposta; entrar com outra conta. Esperado: resposta anterior não altera dados, não prende em carregamento e não faz refetch em nome da conta antiga.
3. Repetir com onboarding/conflito e com ação administrativa pendente. Atualizar/voltar/avançar não deve ressuscitar formulário privado da pessoa anterior.
4. Renovação/401: conferir no Network recuperação controlada ou orientação para login, sem loop. Não repetir escrita em nome de uma identidade diferente.
5. Visitar diretamente/atualizar /perfil, /perfil/transferencia, /admin, /admin/vinculos e /admin/vinculos/pendentes com perfis autorizados e não autorizados. Sem ATIVO, pedidos/chat próprios continuam; vitrine/publicação não.

## M/N — Concorrência

**Pré-condições:** massa exclusiva, dois compradores ATIVOS de X (A e AX, por exemplo) e B vendedor. Não fazer em catálogo de demonstração de outra pessoa.

- **M:** produto com estoque 1. Abrir detalhe em dois contextos e confirmar compra simultaneamente. Esperado: somente um pedido/reserva; outro recebe conflito ou vê estoque atualizado e deixa de poder enviar. Se a segunda UI não chegou a enviar POST, registrar que a corrida HTTP não foi exercitada e usar a integração PostgreSQL existente para evidência determinística. Resolver o pedido vencedor ao terminar.
- **N:** um pedido SOLICITADO visto por A/B. A cancela enquanto B recusa. Esperado: uma decisão terminal confirmada, outra 409, um único incremento de estoque e histórico consistente. Usar cancelamento versus recusa evita confundir com duas transições sequenciais legítimas de aceite seguido de cancelamento.

Os testes automatizados de pedido.integration.test.ts sincronizam as disputas no PostgreSQL e são a referência para provar simultaneidade; cliques manuais não substituem essa garantia. Nunca retirar locks/transações para facilitar o teste.

## Roteiro responsivo e acessível

Executar em **360×800, 390×844, 768×1024 e 1280×800**, depois em celular real quando disponível. Registrar navegador/zoom/orientação. A auditoria automatizada cobriu essas larguras; teclado virtual/leitor de tela reais ainda precisam de homologação.

- Login/Cadastro/Onboarding: labels acionam os campos; Tab segue ordem; Enter envia uma vez; mensagens identificam o campo; teclado virtual não cobre permanentemente envio/erro.
- Vitrine/Detalhe/Meus Produtos: sem overflow; grids se adaptam; nome longo não vaza; preço/estoque legíveis; imagens quebradas têm placeholder/alt; links e botões têm foco visível e alvo de toque utilizável.
- Formulários de produto/pedido/transferência: valores preservados após erro, select/quantidade/data funcionam no dispositivo, loading impede duplicidade e feedback não depende apenas de cor.
- Pedidos/Chat: cards/histórico legíveis, controles acessíveis, mensagens longas quebram linha, paginação não esconde mensagem recém-enviada; conferir rolagem e compositor com teclado aberto.
- Perfil/Administração: residência atual e pendente distinguíveis; tabelas/cartões e filtros cabem no mobile; IDs longos não vazam; ações globais/local têm textos claros.
- Diálogos nativos: ler impacto antes de confirmar, cancelar não escreve, foco retorna a um local útil; quando a linha desaparece, feedback continua acessível. Testar com teclado e leitor de tela do ambiente.
- Testar zoom, modo paisagem, leitor de tela, contraste/alto contraste e navegação sem mouse. Registrar limitações sem afirmar conformidade WCAG por mera ausência de overflow.

## Limpeza e encerramento

1. Resolver pedidos de teste SOLICITADO/ACEITO por cancelamento/recusa/conclusão conforme papel e intenção. Não editar estoque diretamente para esconder diferença; investigar qualquer divergência.
2. Desativar anúncios fictícios que não devem continuar visíveis. Apagar somente imagens de teste pelo fluxo existente, se desejado; não excluir produtos, vínculos, pedidos ou mensagens históricos.
3. Reativar contas globais suspensas de teste quando combinado; isso não reativa vínculos locais. Restaurar administração dos condomínios usados com apoio de S, sem autoalteração local proibida.
4. Sair das sessões e encerrar servidores/instância PostgreSQL descartável iniciados exclusivamente para esta execução. Nunca parar um serviço compartilhado sem coordenação nem apagar banco remoto.
5. Atualizar a planilha de evidências, listar casos não executados e abrir os achados. Somente considerar homologação remota depois de conferir Auth/e-mail, bucket privado, Storage real, permissões, CORS e dispositivos — o YES da auditoria local tem alcance interno controlado.

## Adendo Prompt 29 — 16/10/2026: cadastro exclusivo de condomínios

Executar com massa fictícia em ambiente de demonstração autorizado. Não usar condomínio real para teste repetido; criação não tem exclusão/edição nesta entrega. Registrar ambiente, papel, método/status/código e evidência sanitizada conforme orientação anterior.

1. Como S, abrir Administração → Condomínios. Atualizar diretamente `/admin/condominios`: deve manter a tela após restaurar sessão, sem onboarding/residência fictícia. Consultar catálogo ativo, buscar, paginar e testar vazio/erro/retry.
2. Cadastrar nome/endereço com espaços externos e CEP `72000-000`. No Network, POST `/api/admin/condominios` deve enviar somente nome_residencial/cep/endereco, com CEP `72000000` e Bearer. Testar campos vazios, limites 160/255 e CEP inválido; erros ficam próximos dos campos. Cancelar não grava. Duplo clique produz apenas um envio.
3. Esperado: 201 com UUID, ativo=true e created_at ISO UTC; confirmação com dados reais e consulta por nome na página 1, sem depender de aparecer na primeira página sem filtro. Verificar no banco autorizado uma auditoria CREATE_CONDOMINIUM com ator S e ID do novo condomínio, sem dados pessoais/segredos no metadata. Não há vínculo/síndico automaticamente.
4. Com AX/AY e morador comum, confirmar ausência do link/formulário. Acesso direto `/admin/condominios` deve redirecionar ao destino permitido. POST HTTP direto recebe 403 FORBIDDEN, inclusive com super_admin/role/admin_condominio forjados em body/claims. Sem JWT recebe 401; S suspenso recebe 403 ACCOUNT_SUSPENDED; body extra de S recebe 400. Não usar JWT editado manualmente como prova de papel: assinatura inválida é 401.
5. Em conta nova, buscar o recém-criado no onboarding e solicitar residência. Esperado: PENDENTE/admin=false; nenhum admin local prévio exigido. S aprova primeiro morador, confirma ATIVO/admin=false e depois o promove explicitamente pela ação existente. O novo admin administra apenas esse condomínio e continua sem cadastro de condomínio (UI e POST 403).
6. Confirmar que os seletores de transferência também encontram novo destino ao buscar/refazer consulta, mantendo as regras de destino existentes. Histórico/tenant de outros condomínios não muda. Dois condomínios podem ter mesmo CEP/nome; não presumir duplicidade proibida.
7. Simular perda de resposta do POST somente com massa controlada. UI informa resultado incerto, mantém campos e bloqueia envio até verificação explícita. Conferir catálogo por busca antes de liberar reenvio; cadastro não possui idempotência HTTP. Nunca anunciar sucesso sem 201 nem repetir automaticamente.
8. Repetir teclado/foco e larguras 360/390/768/1280, incluindo nomes/endereço sem espaços nos limites. Em troca de conta durante POST, resposta antiga não deve repor dados de S. Não existe edição, exclusão, inativação ou ViaCEP para testar.

Automação local e resultados desta etapa: [CONDOMINIOS_SUPERADMIN.md](CONDOMINIOS_SUPERADMIN.md). Este adendo não afirma execução manual com Supabase real; Auth, configuração remota/permissões, entrega de e-mail e dispositivos físicos continuam pendentes para homologação.
