import "server-only";
import { prisma } from "@/lib/db/prisma";

export function listarCategorias() {
  return prisma.categorias_produto.findMany({ orderBy: { nome: "asc" } });
}
