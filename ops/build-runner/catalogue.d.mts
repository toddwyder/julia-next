export type CatalogueRoute = 'claude' | 'openai-codex' | 'commandcode'
export type CatalogueWire = 'chat' | 'responses' | 'messages'
export type CatalogueEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface CatalogueOffer {
  route: CatalogueRoute
  modelId: string
  name: string
  company: string
  service: string
  codingCapable: true
  supportedEfforts: CatalogueEffort[]
  wire: CatalogueWire
}

export interface CataloguePrice {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface CatalogueModel {
  endpoint: string
  modelId: string
  wireModel: string
  protocol: CatalogueWire
  maxInputTokens: number
  maxOutputTokens: number
  publishedMaxOutputTokens: number
  price: CataloguePrice
  priceTiers?: Array<{ aboveInputTokens: number; price: CataloguePrice }>
  source: string
  boundsSource: string
  route: CatalogueRoute
  service: string
  company: string
  wire: CatalogueWire
  inputTokenEstimate: { method: 'utf8' | 'o200k_base'; multiplier: number; framingTokens: number }
  inputTokenEstimateSource: string
  cacheWriteTtl?: string
}

export interface RefusedModel {
  provider: 'anthropic' | 'openai' | 'commandcode'
  modelId: string
  reason: string
}

export interface ModelCatalogue {
  offers: CatalogueOffer[]
  models: Record<string, CatalogueModel>
  refused: RefusedModel[]
  commandCodeProviderModels: string[]
  sources: { modelsDev: string; commandCodeModels: string; commandCodePricing: string }
  connected: { anthropic: boolean; 'openai-codex': boolean; commandcode: boolean }
}

export interface CatalogueOptions {
  settingsPath?: string
  settings?: Record<string, unknown>
  fetchImpl?: typeof fetch
  commandCodeApiKey?: string
  modelsDev?: unknown
  commandCodeModels?: unknown[]
  commandCodePricing?: unknown[]
  connected?: { anthropic: boolean; 'openai-codex': boolean; commandcode: boolean }
}

export const MODELS_DEV_URL: string
export const COMMANDCODE_MODELS_URL: string
export const COMMANDCODE_PRICING_URL: string
export const REQUEST_MAX_OUTPUT_TOKENS: number
export const defaultSettingsPath: string

export function buildCatalogue(options?: Partial<Pick<CatalogueOptions, 'modelsDev' | 'commandCodeModels' | 'commandCodePricing' | 'connected'>>): Pick<ModelCatalogue, 'offers' | 'models' | 'refused' | 'commandCodeProviderModels'>
export function hydrateSettings<T extends Record<string, unknown>>(settings: T, catalogue: ModelCatalogue): T & { models: Record<string, CatalogueModel> }
export function parseCommandCodePricingPage(html: string): Array<Record<string, unknown>>
export function clearCatalogueSourceCache(): void
export function fetchModelsDev(fetchImpl?: typeof fetch): Promise<unknown>
export function fetchCommandCodeModels(apiKey: string, fetchImpl?: typeof fetch): Promise<unknown[]>
export function fetchCommandCodePricing(fetchImpl?: typeof fetch): Promise<Array<Record<string, unknown>>>
export function loadCatalogue(options?: CatalogueOptions): Promise<ModelCatalogue>
export function discoverCatalogueOffers(options?: CatalogueOptions): Promise<CatalogueOffer[]>
