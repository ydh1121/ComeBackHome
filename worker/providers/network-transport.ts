import type { ProviderSecretBindings } from './contracts';
import { assertProviderActivationReady, isDocumentedOfficialHttpEndpoint, type ProviderSecretPresenceResolver } from './security';
import type {
  ProviderAuthReference,
  ProviderJsonRequest,
  ProviderBinaryResponse,
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
  }
}

function applyPathSecret(
  urlTemplate: string,
  auth: ProviderAuthReference,
  secret: string,
): string {
  return auth.placement === 'path'
    ? urlTemplate.replace(auth.target, encodeURIComponent(secret))
    : urlTemplate;
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

  private async request(
    request: ProviderJsonRequest,
    context: ProviderRequestContext | undefined,
    accept: string,
  ): Promise<Response> {
    assertProviderActivationReady(request, this.secrets);

    const secret = this.secrets.resolve(request.auth.secretName);
    if (!secret) {
      throw new Error('Provider activation blocked: MISSING_SECRET');
    }

    const materialized = applyPathSecret(
      replacePathParams(request.urlTemplate, request.pathParams),
      request.auth,
      secret,
    );
    const url = new URL(materialized);
    const headers = new Headers({ Accept: accept });

    for (const [name, raw] of Object.entries(request.query ?? {})) {
      const values = Array.isArray(raw) ? raw : [raw];
      for (const value of values) url.searchParams.append(name, value);
    }

    applySecret(url, headers, request.auth, secret);
    assertNoUnresolvedPathTokens(url);

    if (
      url.protocol !== 'https:' &&
      !(
        request.security === 'DOCUMENTED_HTTP_REQUIRES_VALIDATION' &&
        isDocumentedOfficialHttpEndpoint(url.toString())
      )
    ) {
      throw new Error('Provider activation blocked: INSECURE_ENDPOINT');
    }

    const response = await this.providerFetch(url.toString(), {
      method: request.method,
      headers,
      signal: context?.signal,
    });

    if (!response.ok) {
      // A numeric upstream error code is safe diagnostic evidence. Never
      // expose upstream messages, request URLs, private coordinates or keys.
      // Kakao may return HTTP 400 for quota (-10), unlike typical HTTP 429.
      let numericCode: number | null = null;
      if (request.source === 'kakao-map' && request.capability === 'public-transit-routing') {
        try {
          const body: unknown = await response.json();
          const code = body && typeof body === 'object' && 'code' in body
            ? (body as { code?: unknown }).code : null;
          if (typeof code === 'number' && Number.isSafeInteger(code) && code >= -10000 && code <= 10000) {
            numericCode = code;
          }
        } catch {
          // The upstream body is diagnostic-only; never override HTTP failure.
        }
      }
      throw new Error(
        'Provider request failed: ' +
        request.source + '/' + request.capability +
        ' HTTP ' + response.status +
        (numericCode == null ? '' : ' CODE ' + numericCode),
      );
    }

    return response;
  }

  async getJson(
    request: ProviderJsonRequest,
    context?: ProviderRequestContext,
  ): Promise<unknown> {
    return (await this.request(request, context, 'application/json')).json();
  }

  async getText(
    request: ProviderJsonRequest,
    context?: ProviderRequestContext,
  ): Promise<string> {
    return (await this.request(
      request,
      context,
      'application/xml, text/xml;q=0.9, application/json;q=0.8, */*;q=0.1',
    )).text();
  }

  async getBytes(
    request: ProviderJsonRequest,
    context?: ProviderRequestContext,
  ): Promise<ProviderBinaryResponse> {
    const response = await this.request(request, context, 'image/png');
    return {
      body: await response.arrayBuffer(),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
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
