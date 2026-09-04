import {
  ApiError,
  badRequest,
  conflict,
  unauthorized,
} from "@/lib/http/errors";

type SupabaseAuthErrorLike = {
  message: string;
  status?: number;
};

export function mapSupabaseAuthError(
  error: SupabaseAuthErrorLike,
  fallbackMessage: string,
): ApiError {
  const normalizedMessage = error.message.toLowerCase();

  if (error.status === 401 || normalizedMessage.includes("invalid login")) {
    return unauthorized("Credenciais inválidas.");
  }

  if (
    normalizedMessage.includes("already registered") ||
    normalizedMessage.includes("already been registered") ||
    normalizedMessage.includes("user already exists")
  ) {
    return conflict("Já existe uma conta com este email.");
  }

  if (error.status === 400 || error.status === 422) {
    return badRequest(fallbackMessage);
  }

  return new ApiError(500, fallbackMessage);
}
