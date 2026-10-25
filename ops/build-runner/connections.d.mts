import type { CatalogueOffer, CatalogueOptions } from './catalogue.mjs';

export type StockSubscriptionOffer = Extract<CatalogueOffer, { route: 'openai-codex' | 'claude' }>;
export function stockSubscriptionOffers(settingsPath?: string, options?: CatalogueOptions): Promise<StockSubscriptionOffer[]>;
export function connectionCommand(args: string[]): Promise<void>;
