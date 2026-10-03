/**
 * Canonical financial metrics → XBRL tags, in priority order.
 * The first tag that has a value for a given period wins; the chosen tag is stored with the value so the
 * mapping is visible to users. Companies (especially banks and insurers) may use none of these tags; the
 * metric is then simply unavailable — never zero.
 */

export type StatementKind = "income" | "balance" | "cashflow" | "shares";

export interface MetricDef {
  metric: string;
  label: string;
  statement: StatementKind;
  /** duration = flow over a period; instant = balance at a point in time */
  periodKind: "duration" | "instant";
  unit: "currency" | "shares" | "per_share";
  tags: string[]; // "taxonomy:Tag"
  note?: string;
}

export const METRICS: MetricDef[] = [
  {
    metric: "revenue",
    label: "Revenue",
    statement: "income",
    periodKind: "duration",
    unit: "currency",
    tags: [
      "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
      "us-gaap:Revenues",
      "us-gaap:SalesRevenueNet",
      "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax",
      "us-gaap:RevenuesNetOfInterestExpense",
    ],
  },
  { metric: "costOfRevenue", label: "Cost of revenue", statement: "income", periodKind: "duration", unit: "currency", tags: ["us-gaap:CostOfRevenue", "us-gaap:CostOfGoodsAndServicesSold", "us-gaap:CostOfGoodsSold"] },
  { metric: "grossProfit", label: "Gross profit", statement: "income", periodKind: "duration", unit: "currency", tags: ["us-gaap:GrossProfit"] },
  { metric: "researchAndDevelopment", label: "Research & development", statement: "income", periodKind: "duration", unit: "currency", tags: ["us-gaap:ResearchAndDevelopmentExpense", "us-gaap:ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"] },
  { metric: "operatingIncome", label: "Operating income", statement: "income", periodKind: "duration", unit: "currency", tags: ["us-gaap:OperatingIncomeLoss"] },
  { metric: "interestExpense", label: "Interest expense", statement: "income", periodKind: "duration", unit: "currency", tags: ["us-gaap:InterestExpense", "us-gaap:InterestExpenseNonoperating", "us-gaap:InterestExpenseDebt"] },
  { metric: "netIncome", label: "Net income", statement: "income", periodKind: "duration", unit: "currency", tags: ["us-gaap:NetIncomeLoss", "us-gaap:ProfitLoss", "us-gaap:NetIncomeLossAvailableToCommonStockholdersBasic"] },
  { metric: "dilutedShares", label: "Diluted weighted-average shares", statement: "shares", periodKind: "duration", unit: "shares", tags: ["us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding"] },
  { metric: "dilutedEps", label: "Diluted EPS", statement: "income", periodKind: "duration", unit: "per_share", tags: ["us-gaap:EarningsPerShareDiluted"] },

  { metric: "cash", label: "Cash and cash equivalents", statement: "balance", periodKind: "instant", unit: "currency", tags: ["us-gaap:CashAndCashEquivalentsAtCarryingValue", "us-gaap:CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "us-gaap:Cash"] },
  { metric: "currentAssets", label: "Current assets", statement: "balance", periodKind: "instant", unit: "currency", tags: ["us-gaap:AssetsCurrent"] },
  { metric: "totalAssets", label: "Total assets", statement: "balance", periodKind: "instant", unit: "currency", tags: ["us-gaap:Assets"] },
  { metric: "currentLiabilities", label: "Current liabilities", statement: "balance", periodKind: "instant", unit: "currency", tags: ["us-gaap:LiabilitiesCurrent"] },
  { metric: "totalLiabilities", label: "Total liabilities", statement: "balance", periodKind: "instant", unit: "currency", tags: ["us-gaap:Liabilities"] },
  { metric: "shortTermDebt", label: "Short-term debt (incl. current portion of long-term debt)", statement: "balance", periodKind: "instant", unit: "currency", tags: ["us-gaap:DebtCurrent", "us-gaap:LongTermDebtCurrent", "us-gaap:ShortTermBorrowings"] },
  { metric: "longTermDebt", label: "Long-term debt (non-current)", statement: "balance", periodKind: "instant", unit: "currency", tags: ["us-gaap:LongTermDebtNoncurrent", "us-gaap:LongTermDebtAndCapitalLeaseObligations"] },
  { metric: "equity", label: "Shareholders' equity", statement: "balance", periodKind: "instant", unit: "currency", tags: ["us-gaap:StockholdersEquity", "us-gaap:StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"] },
  { metric: "sharesOutstanding", label: "Shares outstanding", statement: "shares", periodKind: "instant", unit: "shares", tags: ["dei:EntityCommonStockSharesOutstanding", "us-gaap:CommonStockSharesOutstanding"] },

  { metric: "operatingCashFlow", label: "Operating cash flow", statement: "cashflow", periodKind: "duration", unit: "currency", tags: ["us-gaap:NetCashProvidedByUsedInOperatingActivities", "us-gaap:NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"] },
  {
    metric: "capex",
    label: "Capital expenditures",
    statement: "cashflow",
    periodKind: "duration",
    unit: "currency",
    tags: ["us-gaap:PaymentsToAcquirePropertyPlantAndEquipment", "us-gaap:PaymentsToAcquireProductiveAssets"],
    note: "Reported as a positive cash outflow (payments to acquire property, plant and equipment). Some companies classify capitalized software or finance leases separately; those are not included.",
  },
  { metric: "buybacks", label: "Share repurchases", statement: "cashflow", periodKind: "duration", unit: "currency", tags: ["us-gaap:PaymentsForRepurchaseOfCommonStock"] },
  { metric: "dividendsPaid", label: "Dividends paid", statement: "cashflow", periodKind: "duration", unit: "currency", tags: ["us-gaap:PaymentsOfDividends", "us-gaap:PaymentsOfDividendsCommonStock"] },
  { metric: "debtIssued", label: "Debt issued", statement: "cashflow", periodKind: "duration", unit: "currency", tags: ["us-gaap:ProceedsFromIssuanceOfLongTermDebt", "us-gaap:ProceedsFromIssuanceOfDebt"] },
  { metric: "debtRepaid", label: "Debt repaid", statement: "cashflow", periodKind: "duration", unit: "currency", tags: ["us-gaap:RepaymentsOfLongTermDebt", "us-gaap:RepaymentsOfDebt"] },
];

export const METRIC_BY_NAME = new Map(METRICS.map((m) => [m.metric, m]));

/** taxonomy:Tag -> canonical metric (first mapping wins). */
export const TAG_TO_METRIC = new Map<string, string>();
for (const m of METRICS) for (const t of m.tags) if (!TAG_TO_METRIC.has(t)) TAG_TO_METRIC.set(t, m.metric);

export const MAPPED_TAGS: ReadonlySet<string> = new Set(TAG_TO_METRIC.keys());

export const ANNUAL_FORMS = new Set(["10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"]);
export const QUARTERLY_FORMS = new Set(["10-Q", "10-Q/A"]);
