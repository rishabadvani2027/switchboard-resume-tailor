/** AI providers users can bring their own key for. Shared by the server and the settings page. */
export const BYOK_PROVIDERS = {
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4.1-mini', keyHint: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys' },
  anthropic: { label: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-4-5', keyHint: 'sk-ant-…', keyUrl: 'https://console.anthropic.com/settings/keys' },
  gemini: { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-2.5-flash', keyHint: 'AIza…', keyUrl: 'https://aistudio.google.com/app/apikey' },
  openrouter: { label: 'OpenRouter (100+ models)', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-4.1-mini', keyHint: 'sk-or-…', keyUrl: 'https://openrouter.ai/keys' },
  groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', keyHint: 'gsk_…', keyUrl: 'https://console.groq.com/keys' },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', keyHint: 'sk-…', keyUrl: 'https://platform.deepseek.com/api_keys' },
  mistral: { label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', defaultModel: 'mistral-large-latest', keyHint: '', keyUrl: 'https://console.mistral.ai/api-keys' },
} as const;

export type ByokProviderId = keyof typeof BYOK_PROVIDERS;
