"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Barra de progresso fininha no topo, disparada por clique em qualquer
 * <a> interno e finalizada quando o pathname muda. Pure CSS animation,
 * sem dependência externa.
 *
 * Comportamento:
 *  - Click em link interno → bar aparece, anda até ~70% num "trickle"
 *  - Quando pathname efetivamente muda, completa pra 100% e some
 *  - Click em link externo / target=_blank → ignora
 *  - Click no mesmo path → ignora (não há navegação)
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const [pendingPath, setPendingPath] = useState<string | null>(null);

  // Quando a navegação completa (pathname mudou pro que clicamos), fecha a barra
  useEffect(() => {
    if (pendingPath && pathname === pendingPath) {
      setProgress(100);
      const t = setTimeout(() => {
        setVisible(false);
        setProgress(0);
        setPendingPath(null);
      }, 180);
      return () => clearTimeout(t);
    }
  }, [pathname, pendingPath]);

  // Captura cliques em qualquer link via delegation
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return; // só botão esquerdo
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // não abre em nova aba
      const anchor = (e.target as HTMLElement | null)?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:")) return;
      if (anchor.target === "_blank") return;
      let url: URL;
      try {
        url = new URL(href, location.href);
      } catch {
        return;
      }
      if (url.origin !== location.origin) return;
      if (url.pathname === pathname) return; // mesma página

      setPendingPath(url.pathname);
      setVisible(true);
      // Pula pra 20% rápido, depois sobe lentamente até 70% enquanto carrega
      setProgress(20);
      requestAnimationFrame(() => {
        // Pequeno delay pra o transition pegar; subimos pra 70%
        setTimeout(() => setProgress(70), 50);
      });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname]);

  if (!visible) return null;

  return (
    <div
      aria-hidden
      className="fixed inset-x-0 top-0 z-[100] h-0.5 pointer-events-none"
    >
      <div
        className="h-full bg-primary"
        style={{
          width: `${progress}%`,
          transition:
            progress === 100
              ? "width 180ms ease-out, opacity 180ms ease-out"
              : "width 700ms cubic-bezier(0.16, 1, 0.3, 1)",
          opacity: progress === 100 ? 0 : 1,
          boxShadow: "0 0 8px currentColor",
        }}
      />
    </div>
  );
}
