import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Criar conta</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <SignupForm />
        <p className="text-sm text-muted-foreground text-center">
          Já tem conta?{" "}
          <Link href="/login" className="font-medium text-foreground hover:underline">
            Entrar
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
