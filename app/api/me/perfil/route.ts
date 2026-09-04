import { NextResponse } from "next/server";
import { listarCondominiosDoUsuario, requireAuth } from "@/lib/auth";
import { toPerfilDto } from "@/lib/dtos/perfil";
import { badRequest, createErrorResponse, notFound, validationError } from "@/lib/http/errors";
import { atualizarPerfil, buscarPerfil } from "@/lib/repositories/perfil.repository";
import { updatePerfilSchema } from "@/lib/validations/perfil";

export async function GET() {
  try {
    const user = await requireAuth();
    const [condominios, perfil] = await Promise.all([
      listarCondominiosDoUsuario(user),
      user.condominoId ? buscarPerfil(user.condominoId) : Promise.resolve(null),
    ]);
    return NextResponse.json({ data: toPerfilDto({ user, condominios, perfil }) });
  } catch (error) { return createErrorResponse(error, "Erro ao buscar perfil."); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireAuth();
    if (!user.condominoId) throw notFound("Perfil de condomino nao encontrado.");
    const body = await request.json().catch(() => { throw badRequest("JSON invalido."); });
    const result = updatePerfilSchema.safeParse(body);
    if (!result.success) throw validationError(result.error);
    await atualizarPerfil(user.condominoId, result.data);
    const [condominios, perfil] = await Promise.all([
      listarCondominiosDoUsuario(user),
      buscarPerfil(user.condominoId),
    ]);
    return NextResponse.json({ data: toPerfilDto({ user, condominios, perfil }) });
  } catch (error) { return createErrorResponse(error, "Erro ao atualizar perfil."); }
}
