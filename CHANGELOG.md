# Changelog

Todas as mudanças relevantes do Home+ são registradas aqui.

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/);
versionamento por [SemVer](https://semver.org/lang/pt-BR/) (`MAJOR.MINOR.PATCH`).

## [Não lançado]

## [0.2.0] - 2026-07-21

### Mudado

- **Cartão de crédito simplificado.** A ideia de "fatura" foi substituída por
  "gastos no cartão". A tela de Cartões mostra, por cartão, quanto você gastou
  no mês e quanto ainda deve (saldo devedor) — sem fatura, sem pendências, sem
  antecipação. Objetivo: uso simples por famílias.
- **Pagar cartão virou uma transferência** da conta para o cartão: abate o
  "Você deve", baixa o saldo da conta de origem e não conta como gasto novo (o
  gasto já foi a compra). Pagamento parcial é só um valor menor.
- **Importação trata pagamentos automaticamente.** "Pagamento de fatura" (conta)
  e "Pagamento recebido" (cartão) recebem a categoria "Pagamento de cartão",
  que é excluída dos relatórios — o pagamento não é mais contado duas vezes.

### Corrigido

- Importação não exige mais confirmar a categoria de todos os lançamentos antes
  de importar (linhas entram como "Sem categoria" e podem ser ajustadas depois).
- Deduplicação de importação passa a usar FITID + número da parcela — o Nubank
  reusa o mesmo FITID em parcelas consecutivas, o que fazia perder parcelas.
- Total da fatura recalculado sempre da soma real dos lançamentos (fonte única
  de verdade), corrigindo dessincronizações ao editar/excluir/pagar.
- Exibição: cifrão duplicado ("R$ R$") nas antecipações aplicadas.

## [0.1.0]

- Versão inicial: contas, lançamentos, categorias, cartões (modelo de fatura),
  importação OFX/CSV, transferências, reembolsos, relatórios e multi-família.
