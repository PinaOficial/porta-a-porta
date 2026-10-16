import type { categoria_produto } from "../../generated/prisma/client.js";

export type CategoriaVitrine = Pick<categoria_produto, "id_categoria" | "nome">;

export interface CategoriasVitrine {
  dados: CategoriaVitrine[];
}
