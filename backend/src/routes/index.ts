import { Router } from "express";
import { categoriaRoutes } from "../modules/categorias/categoria.routes.js";
import { condominioRoutes } from "../modules/condominios/condominio.routes.js";
import { produtoRoutes } from "../modules/produtos/produto.routes.js";
import { pedidoRoutes } from "../modules/pedidos/pedido.routes.js";
import { usuarioRoutes } from "../modules/usuarios/usuario.routes.js";
import { vinculoRoutes } from "../modules/vinculos/vinculo.routes.js";
import { administracaoRoutes } from "../modules/administracao/administracao.routes.js";

export const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", projeto: "porta-a-porta" });
});

apiRouter.use("/condominios", condominioRoutes);
apiRouter.use(usuarioRoutes);
apiRouter.use("/vinculos", vinculoRoutes);
apiRouter.use("/admin", administracaoRoutes);
apiRouter.use("/produtos", produtoRoutes);
apiRouter.use("/pedidos", pedidoRoutes);
apiRouter.use("/categorias", categoriaRoutes);
