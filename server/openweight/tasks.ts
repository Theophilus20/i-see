/**
 * Open-weight Meta models on any OpenAI-compatible host.
 *
 * Muse Spark Open (816B-A42B MoE, Muse Model License) on Baseten, Fireworks, OpenRouter
 * or your own vLLM; Muse Glimmer (30B dense, Apache 2.0) on Ollama, llama.cpp or vLLM.
 * Both read images. Structured output uses json_schema when the host supports it,
 * otherwise the schema goes in the prompt and the reply is validated and repaired here.
 * Segmentation, illustration and transcription are Meta Model API features and are
 * reported as unsupported.
 */
import type { ModelTasks } from '../../src/shared/tasks';
import { ChatTasks } from '../chat-tasks';
import type { EndpointConfig } from '../config';
import { HttpClient, type CircuitBreakers } from '../meta/http';

export class OpenWeightTasks extends ChatTasks implements ModelTasks {
  constructor(
    readonly endpoint: EndpointConfig,
    readonly client: HttpClient,
    id: string,
  ) {
    super({
      id,
      client,
      provider: providerName(endpoint),
      modelFor: () => endpoint.model,
      mode: endpoint.jsonSchema ? 'json_schema' : 'prompt',
      instructionRole: 'system',
      vision: endpoint.vision,
      reasoning: endpoint.reasoning,
      timeoutMs: 180_000,
    });
  }

  static create(endpoint: EndpointConfig, id: string, opts: { fetch?: typeof fetch; breakers?: CircuitBreakers; sleep?: (ms: number) => Promise<void> } = {}): OpenWeightTasks {
    const client = new HttpClient({
      baseUrl: endpoint.baseUrl,
      apiKey: endpoint.apiKey,
      provider: providerName(endpoint),
      fetch: opts.fetch,
      breakers: opts.breakers,
      timeoutMs: 180_000,
      sleep: opts.sleep,
    });
    return new OpenWeightTasks(endpoint, client, id);
  }
}

/** "Muse Spark Open via baseten.co" — the label shown in traces. */
export function providerName(e: EndpointConfig): string {
  let host = e.baseUrl;
  try {
    host = new URL(e.baseUrl).host;
  } catch {
    /* keep raw */
  }
  return `${e.label} via ${host}`;
}
