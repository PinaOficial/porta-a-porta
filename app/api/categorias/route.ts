import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toCategoriaDto } from "@/lib/dtos/marketplace";
import { createErrorResponse } from "@/lib/http/errors";
import { listarCategorias } from "@/lib/repositories/catalogo.repository";

export async function GET() {
  try {
    await requireAuth();
    return NextResponse.json({ data: (await listarCategorias()).map(toCategoriaDto) });
  } catch (error) {
    return createErrorResponse(error, "Erro ao buscar categorias.");
  }
}
