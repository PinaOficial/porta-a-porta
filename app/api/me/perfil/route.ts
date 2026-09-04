import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { badRequest, createErrorResponse, notFound, validationError } from "@/lib/http/errors";
import { atualizarPerfil, buscarPerfil } from "@/lib/repositories/perfil.repository";
import { updatePerfilSchema } from "@/lib/validations/perfil";

function toPerfilDto(perfil: NonNullable<Awaited<ReturnType<typeof buscarPerfil>>>) {
  return { id: perfil.id, nome: perfil.nome, dataNascimento: perfil.data_nascimento, vinculos: perfil.condomino_apartamentos.map((vinculo) => ({ vinculoId: vinculo.id, tipoVinculo: vinculo.tipo_vinculo, condominio: { id: vinculo.apartamentos.condominio_id, nome: vinculo.apartamentos.condominios.nome }, apartamento: { id: vinculo.apartamentos.id, numero: vinculo.apartamentos.numero, bloco: vinculo.apartamentos.bloco } })) };
}

export async function GET() {
  try {
    const user = await requireAuth();
    if (!user.condominoId) throw notFound("Perfil de condomino nao encontrado.");
    const perfil = await buscarPerfil(user.condominoId);
    if (!perfil) throw notFound("Perfil de condomino nao encontrado.");
    return NextResponse.json({ data: toPerfilDto(perfil) });
  } catch (error) { return createErrorResponse(error, "Erro ao buscar perfil."); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireAuth();
    if (!user.condominoId) throw notFound("Perfil de condomino nao encontrado.");
    const body = await request.json().catch(() => { throw badRequest("JSON invalido."); });
    const result = updatePerfilSchema.safeParse(body);
    if (!result.success) throw validationError(result.error);
    const perfil = await atualizarPerfil(user.condominoId, result.data);
    return NextResponse.json({ data: { id: perfil.id, nome: perfil.nome, dataNascimento: perfil.data_nascimento } });
  } catch (error) { return createErrorResponse(error, "Erro ao atualizar perfil."); }
}
