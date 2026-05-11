import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Entrar</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <LoginForm />
        <p className="text-sm text-muted-foreground text-center">
          Não tem conta?{" "}
          <Link href="/signup" className="font-medium text-foreground hover:underline">
            Criar conta
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
