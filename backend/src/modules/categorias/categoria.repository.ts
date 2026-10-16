import { prisma } from "../../lib/prisma.js";
import type { CategoriaVitrine } from "./categoria.model.js";

export async function buscarCategoriaPorId(idCategoria: string) {
  return prisma.categoria_produto.findUnique({
    where: { id_categoria: idCategoria },
    select: { id_categoria: true, ativo: true },
  });
}

export async function listarCategoriasAtivas(): Promise<CategoriaVitrine[]> {
  return prisma.categoria_produto.findMany({
    where: { ativo: true },
    orderBy: { nome: "asc" },
    select: { id_categoria: true, nome: true },
  });
}
