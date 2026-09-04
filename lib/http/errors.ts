import { NextResponse } from "next/server";
import { ZodError } from "zod";

type ErrorDetails = Record<string, string[] | undefined> | undefined;

export class ApiError extends Error {
  readonly status: number;
  readonly details?: ErrorDetails;

  constructor(status: number, message: string, details?: ErrorDetails) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export function badRequest(message: string, details?: ErrorDetails) {
  return new ApiError(400, message, details);
}

export function unauthorized(message = "Não autenticado.") {
  return new ApiError(401, message);
}

export function forbidden(message = "Acesso negado.") {
  return new ApiError(403, message);
}

export function notFound(message = "Recurso não encontrado.") {
  return new ApiError(404, message);
}

export function methodNotAllowed(message = "Operação não permitida.") {
  return new ApiError(405, message);
}

export function conflict(message = "Conflito de estado.") {
  return new ApiError(409, message);
}

export function validationError(error: ZodError) {
  return badRequest("Dados inválidos.", error.flatten().fieldErrors);
}

export function createUnexpectedErrorResponse(
  fallbackMessage: string,
  error: unknown,
) {
  console.error(error);

  return NextResponse.json(
    {
      error: fallbackMessage,
    },
    {
      status: 500,
    },
  );
}

export function createErrorResponse(
  error: unknown,
  fallbackMessage: string,
) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        error: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
      {
        status: error.status,
      },
    );
  }

  return createUnexpectedErrorResponse(fallbackMessage, error);
}
