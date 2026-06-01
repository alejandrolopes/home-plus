import "server-only";

import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizationModules } from "@/db/schema/finance";

/**
 * Módulos opcionais do app. Cada org pode ligar/desligar via UI em
 * /configuracoes/modulos. Quando uma org ainda não tem preferência salva,
 * usa-se o `defaultEnabled` declarado aqui — então adicionar um módulo novo
 * com `defaultEnabled: true` é seguro para orgs existentes.
 *
 * Para gating, sempre prefira `isModuleEnabled(orgId, "<key>")` em rotas
 * server-side; a UI recebe o Set de keys do layout via context.
 */
export const ALL_MODULES = {
  cartoes: {
    defaultEnabled: true,
    label: "Cartões de crédito",
    description: "Faturas, antecipações e pendências de pagamento.",
  },
  reembolsos: {
    defaultEnabled: true,
    label: "Reembolsos",
    description: "Marcar lançamentos como reembolsáveis e acompanhar status.",
  },
  fidelidade: {
    defaultEnabled: true,
    label: "Fidelidade",
    description: "Dízimo (10%) e oferta de pacto sobre receitas dizimáveis.",
  },
  investimentos: {
    defaultEnabled: true,
    label: "Investimentos",
    description: "Acompanhamento de aplicações e rendimentos.",
  },
  onde_economizar: {
    defaultEnabled: true,
    label: "Onde economizar",
    description: "Análise de gastos essenciais vs supérfluos.",
  },
  transferencias: {
    defaultEnabled: true,
    label: "Transferências",
    description: "Movimentações entre contas próprias e da família.",
  },
  holerite: {
    defaultEnabled: true,
    label: "Holerite (PDF)",
    description: "Importação de contracheque em PDF para registrar proventos.",
  },
} as const;

export type ModuleKey = keyof typeof ALL_MODULES;

export const MODULE_KEYS = Object.keys(ALL_MODULES) as ModuleKey[];

function isKnownModuleKey(value: string): value is ModuleKey {
  return value in ALL_MODULES;
}

/**
 * Set de módulos habilitados para a org. Deduplica chamadas dentro do mesmo
 * request via `cache()` do React — múltiplos componentes podem chamar sem
 * preocupação com queries extra.
 */
export const getEnabledModules = cache(async function (
  orgId: string,
): Promise<Set<ModuleKey>> {
  const rows = await db
    .select({
      moduleKey: organizationModules.moduleKey,
      enabled: organizationModules.enabled,
    })
    .from(organizationModules)
    .where(eq(organizationModules.organizationId, orgId));

  const overrides = new Map<string, boolean>(
    rows.map((r) => [r.moduleKey, r.enabled]),
  );

  const enabled = new Set<ModuleKey>();
  for (const key of MODULE_KEYS) {
    const override = overrides.get(key);
    const isOn = override ?? ALL_MODULES[key].defaultEnabled;
    if (isOn) enabled.add(key);
  }
  return enabled;
});

export async function isModuleEnabled(
  orgId: string,
  module: ModuleKey,
): Promise<boolean> {
  const enabled = await getEnabledModules(orgId);
  return enabled.has(module);
}

/**
 * Atualiza o estado de um módulo. Use no server action da página de
 * configurações. Linhas inexistentes são criadas; existentes são atualizadas
 * via upsert.
 */
export async function setModuleEnabled(
  orgId: string,
  module: ModuleKey,
  enabled: boolean,
): Promise<void> {
  if (!isKnownModuleKey(module)) throw new Error(`Unknown module: ${module}`);
  await db
    .insert(organizationModules)
    .values({ organizationId: orgId, moduleKey: module, enabled })
    .onConflictDoUpdate({
      target: [organizationModules.organizationId, organizationModules.moduleKey],
      set: { enabled, updatedAt: new Date() },
    });
}
