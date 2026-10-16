import { ApiError } from "../../lib/api";
const mensagens: Record<string, string> = {
  PRODUCT_NOT_FOUND: "Este anúncio não está disponível para sua gestão. Volte à lista de produtos.",
  MEMBERSHIP_REQUIRED: "Seu acesso residencial mudou. Estamos atualizando sua conta.",
  FORBIDDEN_CROSS_TENANT: "Seu acesso a este condomínio mudou. Estamos atualizando sua conta.",
  CATEGORY_NOT_FOUND: "A categoria escolhida não está disponível. Atualize as categorias e escolha outra.",
  CATEGORY_INACTIVE: "Esta categoria está inativa. Escolha uma categoria ativa para trocar a categoria ou ativar o anúncio.",
  VALIDATION_ERROR: "Confira os campos indicados antes de tentar novamente.",
  IMAGE_REQUIRED: "Escolha uma imagem para enviar.",
  IMAGE_TYPE_NOT_ALLOWED: "Escolha uma imagem JPEG, PNG ou WEBP válida.",
  IMAGE_TOO_LARGE: "A imagem deve ter até 5 MiB.",
  IMAGE_ORDER_EXHAUSTED: "Não é possível adicionar novas imagens a este anúncio neste momento.",
  IMAGE_UPLOAD_FAILED: "Não foi possível enviar a imagem. Confira as imagens atuais e tente novamente.",
  IMAGE_PERSISTENCE_FAILED: "Não foi possível concluir o registro da imagem. Confira as imagens atuais antes de tentar novamente.",
  IMAGE_DELETE_FAILED: "Não foi possível concluir a exclusão. As imagens serão atualizadas; você pode tentar novamente.",
  IMAGE_NOT_FOUND: "Esta imagem já não está disponível. Atualizando a lista de imagens.",
};
export const mensagemErroProduto = (erro: unknown) => erro instanceof ApiError && mensagens[erro.codigo]
  ? mensagens[erro.codigo] : "Não foi possível confirmar a operação. Verifique sua conexão antes de tentar novamente.";
