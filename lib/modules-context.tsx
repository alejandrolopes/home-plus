"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

const EnabledModulesContext = createContext<Set<string>>(new Set());

export function ModulesProvider({
  enabled,
  children,
}: {
  enabled: string[];
  children: ReactNode;
}) {
  const set = useMemo(() => new Set(enabled), [enabled]);
  return (
    <EnabledModulesContext.Provider value={set}>
      {children}
    </EnabledModulesContext.Provider>
  );
}

/** Hook para componentes client: true se o módulo está habilitado na org. */
export function useModule(key: string): boolean {
  const set = useContext(EnabledModulesContext);
  return set.has(key);
}

/** Hook para componentes client que precisam do conjunto inteiro. */
export function useEnabledModules(): Set<string> {
  return useContext(EnabledModulesContext);
}
