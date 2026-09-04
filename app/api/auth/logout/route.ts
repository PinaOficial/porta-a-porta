import { createErrorResponse } from "@/lib/http/errors";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST() {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signOut();

    if (error) {
      throw error;
    }

    return new Response(null, {
      status: 204,
    });
  } catch (error) {
    return createErrorResponse(error, "Erro ao encerrar sessão.");
  }
}
