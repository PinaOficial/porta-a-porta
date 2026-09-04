import { UsersPage } from "@/components/administration/users-page";

export default async function AdministrationUsersPage(
  props: PageProps<"/administracao/usuarios">,
) {
  const searchParams = await props.searchParams;
  const rawCondominiumId = searchParams.condominioId;
  const initialCondominiumId = Array.isArray(rawCondominiumId)
    ? rawCondominiumId[0]
    : rawCondominiumId;
  return <UsersPage initialCondominiumId={initialCondominiumId} />;
}
