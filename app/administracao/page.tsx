import { ArrowRight, Building2, Users } from "lucide-react";
import Link from "next/link";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const options = [
  {
    href: "/administracao/condominios",
    title: "Condomínios",
    description: "Crie, configure, visualize e gerencie os condomínios do seu escopo.",
    icon: Building2,
  },
  {
    href: "/administracao/usuarios",
    title: "Usuários",
    description: "Gerencie moradores, vínculos, administradores e autorizações.",
    icon: Users,
  },
];

export default function AdministrationPage() {
  return (
    <main className="mx-auto max-w-6xl p-5 sm:p-8">
      <h1 className="text-3xl font-semibold">Administração</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Escolha uma área para começar.
      </p>
      <div className="mt-7 grid gap-5 md:grid-cols-2">
        {options.map(({ href, title, description, icon: Icon }) => (
          <Link key={href} href={href} className="group">
            <Card className="h-full transition-colors group-hover:border-primary/45">
              <CardHeader className="flex-row items-start gap-4 space-y-0">
                <div className="rounded-xl bg-primary/10 p-3 text-primary">
                  <Icon />
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle>{title}</CardTitle>
                  <CardDescription className="mt-1">{description}</CardDescription>
                </div>
                <ArrowRight className="mt-1 text-muted-foreground transition-transform group-hover:translate-x-1" />
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
