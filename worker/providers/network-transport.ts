import type { ProviderSecretBindings } from './contracts';
import { assertProviderActivationReady, type ProviderSecretPresenceResolver } from './security';
import type {
  ProviderAuthReference,
  ProviderJsonRequest,
  ProviderJsonTransport,
  ProviderSecretName,
} from './transport';
import type { ProviderRequestContext } from './contracts';

export interface ProviderSecretResolver extends ProviderSecretPresenceResolver {
  resolve(secretName: ProviderSecretName): string | undefined;
}

export type ProviderFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

function replacePathParams(
  urlTemplate: string,
  pathParams: Record<string, string> | undefined,
): string {
  let result = urlTemplate;
  for (const [name, value] of Object.entries(pathParams ?? {})) {
    result = result.replaceAll('{' + name + '}', encodeURIComponent(value));
  }
  return result;
}

function applySecret(
  url: URL,
  headers: Headers,
  auth: ProviderAuthReference,
  secret: string,
): void {
  const value = (auth.prefix ?? '') + secret;

  if (auth.placement === 'header') {
    headers.set(auth.target, value);
    return;
  }

  if (auth.placement === 'query') {
    url.searchParams.set(auth.target, value);
    return;
  }

  url.pathname = url.pathname.replace(
    auth.target,
    encodeURIComponent(secret),
  );
}

function assertNoUnresolvedPathTokens(url: URL): void {
  if (/\{[^}]+\}/.test(url.pathname)) {
    throw new Error('Provider request contains unresolved path parameters.');
  }
}

export class SecureProviderJsonTransport implements ProviderJsonTransport {
  constructor(
    private readonly providerFetch: ProviderFetch,
    private readonly secrets: ProviderSecretResolver,
  ) {}

  async getJson(
    request: ProviderJsonRequest,
    context?: ProviderRequestContext,
  ): Promise<unknown> {
    assertProviderActivationReady(request, this.secrets);

    const secret = this.secrets.resolve(request.auth.secretName);
    if (!secret) {
      throw new Error('Provider activation blocked: MISSING_SECRET');
    }

    const materialized = replacePathParams(request.urlTemplate, request.pathParams);
    const url = new URL(materialized);
    const headers = new Headers({ Accept: 'application/json' });

    for (const [name, value] of Object.entries(request.query ?? {})) {
      url.searchParams.set(name, value);
    }

    applySecret(url, headers, request.auth, secret);
    assertNoUnresolvedPathTokens(url);

    if (url.protocol !== 'https:') {
      throw new Error('Provider activation blocked: INSECURE_ENDPOINT');
    }

    const response = await this.providerFetch(url.toString(), {
      method: request.method,
      headers,
      signal: context?.signal,
    });

    if (!response.ok) {
      throw new Error(
        'Provider request failed: ' +
        request.source + '/' + request.capability +
        ' HTTP ' + response.status,
      );
    }

    return response.json();
  }
}

export class ObjectProviderSecretResolver implements ProviderSecretResolver {
  constructor(private readonly bindings: ProviderSecretBindings) {}

  has(secretName: ProviderSecretName): boolean {
    return Boolean(this.resolve(secretName));
  }

  resolve(secretName: ProviderSecretName): string | undefined {
    const value = this.bindings[secretName];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
}
