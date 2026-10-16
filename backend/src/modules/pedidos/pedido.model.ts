import type { inserirPedido, listarPedidosDosVinculos } from "./pedido.repository.js";
import type { ListaCondominios } from "../condominios/condominio.model.js";
import type { status_pedido_enum } from "../../generated/prisma/client.js";

export interface ResultadoStatusPedido {
  dados: { id_pedido: string; status_pedido: status_pedido_enum; ultima_atualizacao: string };
}

type PedidoCriado = Awaited<ReturnType<typeof inserirPedido>>;

export interface ResultadoCriacaoPedido {
  dados: Omit<PedidoCriado, "valor_pedido" | "hora_solicitacao" | "hora_combinada" | "ultima_atualizacao"> & {
    valor_pedido: string;
    hora_solicitacao: string;
    hora_combinada: string;
    ultima_atualizacao: string;
  };
}

type PedidoConsultado = Awaited<ReturnType<typeof listarPedidosDosVinculos>>["pedidos"][number];

// produto.nome_produto é metadata atual; valor_pedido é o total histórico congelado.
export type MeuPedido = Omit<ResultadoCriacaoPedido["dados"], "id_produto"> & {
  papel_usuario: "COMPRADOR" | "VENDEDOR";
  contraparte: PedidoConsultado["vinculo_condominio"]["condomino"] & { moradia: string };
  condominio: PedidoConsultado["vinculo_condominio"]["condominio"];
  historico: (Omit<PedidoConsultado["pedido_status_historico"][number], "created_at"> & { created_at: string })[];
  chat: { disponivel: boolean; status_conversa: NonNullable<PedidoConsultado["conversa"]>["status_conversa"] | null };
};

export interface MeusPedidos {
  dados: MeuPedido[];
  paginacao: ListaCondominios["paginacao"];
}
