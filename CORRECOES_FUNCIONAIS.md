# Correções funcionais — 12/11/2026

## Alterações aplicadas

1. **Produto (frontend + backend):** nome do produto requer pelo menos 3 caracteres, assim como no formulário que já havia sido ajustado.
2. **Descrição (frontend + backend):** limite de 10.000 caracteres. Respeita o teste preexistente que aceita descrições com 10.000 caracteres, mas barra entradas maiores; o textarea tem o mesmo limite.
3. **Cadastro residencial (frontend + backend):** nome completo exige ao menos 3 caracteres; data de nascimento futura é rejeitada. A comparação usa data UTC na validação, com o mesmo critério nos dois lados.
4. **Formulários:** mensagens de erro do campo são limpas quando ele é editado, em Produto, Onboarding, Pedido, Criação e Edição de Condomínios.
5. **Segurança de entrega:** `.gitignore` também ignora `.env.local` e variantes locais de ambos os projetos.
6. **Testes:** adicionadas verificações para os novos limites nos testes de schema.

## Decisões preservadas

- **CPF:** a checagem dos dígitos verificadores não foi introduzida; o projeto usa CPFs fictícios em diversos testes, e a regra precisa ser aprovada antes de alterar esse contrato.
- **Vitrine durante carregamento:** mantido o comportamento existente de exibir resultados anteriores durante uma atualização. É uma decisão de UX, não um bug confirmado.
- **Modo demo:** mantido no código para que continue disponível localmente; não foi ativado em produção. Verifique as alterações temporárias antes de fazer commit no repositório principal.
- **Backend/Supabase:** a execução real com banco de dados ainda exige configurações válidas; nada foi simulado no backend.

## Aplicar no computador

Recomendado: descompacte **porta-a-porta-somente-correcoes.zip** dentro da pasta `C:\Users\Super Estagiário\porta-a-porta`, substituindo os arquivos de mesmo nome. Isso preserva seus `.env`, `.env.local`, dependências e demais mudanças locais. Faça backup ou commit das alterações antes de substituir arquivos.

No VS Code, mantenha o terminal do Vite aberto ou reinicie com `npm.cmd run dev --workspace frontend` se estiver parado. Para rodar os testes, depois de ter as dependências instaladas: `npm.cmd run test --workspace frontend`, `npm.cmd run test:onboarding --workspace backend` e `npm.cmd run test:criar-produto --workspace backend` (os testes de backend podem exigir Prisma gerado/configuração local).

Os arquivos foram verificados estaticamente; os testes automatizados não foram executados neste ambiente sem as dependências instaladas.
