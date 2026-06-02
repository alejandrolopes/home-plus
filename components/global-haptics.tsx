"use client";

import { useEffect } from "react";
import { installGlobalTapHaptics } from "@/lib/haptics";

/**
 * Ativa o feedback tátil global. Roda 1x no mount; é no-op em iOS
 * (sem suporte à Vibration API) e em desktop sem hardware vibratório.
 */
export function GlobalHaptics() {
  useEffect(() => installGlobalTapHaptics(), []);
  return null;
}
