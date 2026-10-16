# Estrutura de pastas — Porta a Porta

```text
porta-a-porta/
├── AGENTS.md
├── ESTRUTURA_DE_PASTAS.md
├── GUIA_PASSO_A_PASSO_SUPABASE_PRISMA.md
├── PROMPT_CODEX_EXEMPLO_PRODUTOS.md
├── README.md
├── package.json
├── .gitignore
│
├── database/
│   ├── 00_ddl_base.sql
│   ├── 01_usuario_prisma.sql
│   ├── 02_seed_categorias.sql
│   ├── alteracoes/
│   └── README.md
│
├── backend/
│   ├── .env.example
│   ├── package.json
│   ├── tsconfig.json
│   ├── prisma.config.ts
│   ├── prisma/
│   │   └── schema.prisma
│   └── src/
│       ├── app.ts
│       ├── server.ts
│       ├── config/
│       │   └── env.ts
│       ├── lib/
│       │   ├── prisma.ts
│       │   └── supabase.ts
│       ├── middlewares/
│       │   ├── autenticar.ts
│       │   ├── autorizar.ts
│       │   ├── validar.ts
│       │   └── error-handler.ts
│       ├── routes/
│       │   └── index.ts
│       ├── types/
│       │   └── express.d.ts
│       └── modules/
│           ├── usuarios/
│           ├── condominios/
│           ├── vinculos/
│           ├── categorias/
│           ├── produtos/
│           ├── pedidos/
│           ├── chat/
│           ├── administracao/
│           └── auditoria/
│
└── frontend/
    ├── .env.example
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── App.tsx
        ├── main.tsx
        ├── components/
        │   └── ui/
        ├── lib/
        │   ├── api.ts
        │   └── supabase.ts
        └── features/
            ├── auth/
            ├── onboarding/
            ├── condominios/
            ├── produtos/
            ├── pedidos/
            ├── chat/
            ├── administracao/
            └── perfil/
```

Cada módulo do backend possui diretamente:

```text
<item>.model.ts
<item>.schema.ts
<item>.repository.ts
<item>.service.ts
<item>.controller.ts
<item>.routes.ts
```

Não há subpastas `models/`, `controllers/` etc. por módulo enquanto não houver necessidade real.
