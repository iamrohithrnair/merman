export type PrismToken = string | { type: string; alias?: string | string[]; content: PrismToken | PrismToken[] }
export const languages: Record<string, unknown>
export function tokenize(code: string, grammar: unknown): PrismToken[]
