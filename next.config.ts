import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfjs-dist"],
  // Libera acesso ao dev server pela LAN (ex.: outro device na mesma rede).
  // Sem isso, Next 16 retorna 403 em assets dev e quebra o HMR via IP.
  allowedDevOrigins: ["192.168.15.135", "192.168.15.*", "*.local"],
};

export default nextConfig;
