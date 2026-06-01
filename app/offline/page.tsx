import { WifiOff } from "lucide-react";

export const metadata = {
  title: "Offline — Home+",
};

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center max-w-sm space-y-4">
        <div className="inline-flex items-center justify-center size-16 rounded-full bg-muted">
          <WifiOff className="size-7 text-muted-foreground" aria-hidden />
        </div>
        <h1 className="text-2xl font-bold">Você está offline</h1>
        <p className="text-muted-foreground">
          O Home+ precisa de internet para mostrar seus dados em tempo real.
          Verifique a conexão e tente novamente.
        </p>
        <p className="text-xs text-muted-foreground">
          Esta tela ficou salva no seu dispositivo pelo Service Worker.
        </p>
      </div>
    </div>
  );
}
