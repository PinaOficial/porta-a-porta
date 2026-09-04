import { requireSuperadmin } from "@/lib/auth";
import {
  conflict,
  createErrorResponse,
  notFound,
  validationError,
} from "@/lib/http/errors";
import { desativarUsuario } from "@/lib/repositories/administracao.repository";
import { usuarioIdSchema } from "@/lib/validations/administracao";

type Context = { params: Promise<{ usuarioId: string }> };

export async function DELETE(_request: Request, context: Context) {
  try {
    const currentUser = await requireSuperadmin();
    const parsed = usuarioIdSchema.safeParse((await context.params).usuarioId);
    if (!parsed.success) throw validationError(parsed.error);
    if (parsed.data === currentUser.id) {
      throw conflict("Você não pode desativar a própria conta.");
    }
    if (!(await desativarUsuario(parsed.data))) {
      throw notFound("Usuário ativo não encontrado.");
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    return createErrorResponse(error, "Erro ao desativar usuário.");
  }
}
