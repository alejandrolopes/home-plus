"use client";

/**
 * Pequeno helper de vibração tátil.
 *
 * Realidade:
 *  - Android Chrome/Firefox suporta `navigator.vibrate()` nativamente.
 *  - iOS Safari **bloqueia** essa API por decisão da Apple; não há jeito
 *    confiável de acionar o Taptic Engine via web. Há truques com Web
 *    Audio que funcionam em alguns iPhones, mas são inconsistentes
 *    (e podem incomodar o usuário com cliques que não esperava).
 *
 * Estratégia: se o navegador expor `navigator.vibrate`, vibra; caso
 * contrário, no-op silencioso. Sem trick de audio (preserva a
 * intenção do usuário e bateria).
 */
export function vibrate(durationMs: number = 8): void {
  if (typeof navigator === "undefined") return;
  // navigator.vibrate retorna boolean (false em iOS). A chamada é segura.
  try {
    (navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean })
      .vibrate?.(durationMs);
  } catch {
    // silencioso
  }
}

/**
 * Hook que vibra quando o usuário clica em qualquer link interno ou botão
 * do tipo submit/button. Default ligado em dispositivos com `vibrate` API.
 */
export function installGlobalTapHaptics(): () => void {
  if (typeof navigator === "undefined") return () => {};
  const supported = typeof navigator.vibrate === "function";
  if (!supported) return () => {};

  const onPointerDown = (e: PointerEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    // Apenas elementos interativos
    const tappable = target.closest(
      'a, button, [role="button"], input[type="checkbox"], input[type="radio"], input[type="submit"], [data-haptic]',
    );
    if (!tappable) return;
    vibrate(6);
  };
  document.addEventListener("pointerdown", onPointerDown, { passive: true });
  return () => document.removeEventListener("pointerdown", onPointerDown);
}
