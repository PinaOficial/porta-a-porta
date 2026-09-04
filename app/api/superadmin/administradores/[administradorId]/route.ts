import { requireSuperadmin } from "@/lib/auth";
import { createErrorResponse, notFound, validationError } from "@/lib/http/errors";
import { revogarAdministrador } from "@/lib/repositories/administracao.repository";
import { administradorIdSchema } from "@/lib/validations/administracao";

type Context = { params: Promise<{ administradorId: string }> };

export async function DELETE(_request: Request, context: Context) {
  try {
    await requireSuperadmin();
    const parsed = administradorIdSchema.safeParse(
      (await context.params).administradorId,
    );
    if (!parsed.success) throw validationError(parsed.error);
    if (!(await revogarAdministrador(parsed.data))) {
      throw notFound("Administrador ativo não encontrado.");
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    return createErrorResponse(error, "Erro ao revogar administrador.");
  }
}
