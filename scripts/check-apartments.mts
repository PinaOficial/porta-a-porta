import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client.ts";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const rows = await prisma.condominios.findMany({
  select: {
    id: true,
    nome: true,
    ativo: true,
    apartamentos: {
      select: { id: true, bloco: true, numero: true, ativo: true },
      orderBy: [{ bloco: "asc" }, { numero: "asc" }],
    },
  },
  orderBy: { nome: "asc" },
});

console.log(JSON.stringify(rows));
await prisma.$disconnect();
