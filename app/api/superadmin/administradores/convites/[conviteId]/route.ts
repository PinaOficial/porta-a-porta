import { requireSuperadmin } from "@/lib/auth";
import { createErrorResponse, notFound, validationError } from "@/lib/http/errors";
import { cancelarConviteAdmin } from "@/lib/repositories/convites-admin.repository";
import { conviteAdminIdSchema } from "@/lib/validations/administracao";

type Context = { params: Promise<{ conviteId: string }> };

export async function DELETE(_request: Request, context: Context) {
  try {
    await requireSuperadmin();
    const parsed = conviteAdminIdSchema.safeParse((await context.params).conviteId);
    if (!parsed.success) throw validationError(parsed.error);
    if (!(await cancelarConviteAdmin(parsed.data))) {
      throw notFound("Autorização pendente não encontrada.");
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    return createErrorResponse(error, "Erro ao cancelar autorização administrativa.");
  }
}
