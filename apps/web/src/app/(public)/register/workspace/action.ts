"use server";
import { registerWorkspaceAction } from "@/app/account-actions";
import type { AccountState } from "@/lib/account-validation";
export async function registerWorkSpace(state: AccountState, form: FormData) { return registerWorkspaceAction(state, form); }
