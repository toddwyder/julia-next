export interface StockSubscriptionOffer {
  route: 'openai-codex' | 'claude';
  modelId: string;
  name: string;
  company: 'OpenAI' | 'Anthropic';
  service: 'ChatGPT plan' | 'Claude subscription';
  codingCapable: true;
  supportedEfforts: Array<'low' | 'medium' | 'high'>;
  wire: 'responses' | 'messages';
}
export function stockSubscriptionOffers(settingsPath?: string): Promise<StockSubscriptionOffer[]>;
export function connectionCommand(args: string[]): Promise<void>;
