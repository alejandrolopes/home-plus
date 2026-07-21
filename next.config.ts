import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

// Versão do app (fonte da verdade: package.json) exposta ao cliente pra
// exibir na interface. Ver CHANGELOG.md.
const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as {
  version: string;
};

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfjs-dist"],
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
};

export default nextConfig;
