"use client";

import { useEffect } from "react";

/**
 * Registra o Service Worker no client. Roda 1x quando o componente monta.
 * Em dev (NODE_ENV=development) o SW seria intrusivo (HMR + cache colidem),
 * então só registra em produção.
 */
export function SWRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const register = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      } catch (e) {
        // Falha silenciosa — app funciona sem SW
        console.warn("SW register failed:", e);
      }
    };
    // Espera o load pra não atrapalhar TTI
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
