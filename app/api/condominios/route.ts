import { NextResponse } from "next/server";

import {
  criarCondominio,
  listarCondominios,
} from "@/lib/repositories/condominios.repository";

import { createCondominioSchema } from "@/lib/validations/condominios";

export async function GET() {
  try {
    const condominios = await listarCondominios();

    return NextResponse.json({
      data: condominios,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error: "Erro ao buscar condomínios.",
      },
      {
        status: 500,
      },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const result = createCondominioSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        {
          error: "Dados inválidos.",
          details: result.error.flatten().fieldErrors,
        },
        {
          status: 400,
        },
      );
    }

    const condominio = await criarCondominio(result.data);

    return NextResponse.json(
      {
        data: condominio,
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error: "Erro ao criar condomínio.",
      },
      {
        status: 500,
      },
    );
  }
}
