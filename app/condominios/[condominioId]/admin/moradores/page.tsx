import { redirect } from "next/navigation";

export default async function ResidentsPage(
  props: PageProps<"/condominios/[condominioId]/admin/moradores">,
) {
  const { condominioId } = await props.params;
  redirect(`/administracao/usuarios?condominioId=${condominioId}`);
}
