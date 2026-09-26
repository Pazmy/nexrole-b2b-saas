import { transactionStatusSchema } from "./transaction-rules";

export const TRANSACTION_PAGE_SIZE = 5;
export const TRANSACTION_SEARCH_LIMIT = 500;
export type TransactionSearchParams = Record<string, string | string[] | undefined>;

export function parseTransactionQuery(params: TransactionSearchParams) {
  const rawPage = typeof params.page === "string" ? params.page : "";
  const page = /^\d+$/.test(rawPage) && Number.isSafeInteger(Number(rawPage)) && Number(rawPage) > 0
    ? Number(rawPage) : 1;
  const status = transactionStatusSchema.safeParse(params.status);
  return {
    page,
    status: status.success ? status.data : "all",
    search: typeof params.search === "string" ? params.search.trim().slice(0, TRANSACTION_SEARCH_LIMIT) : "",
  };
}
