import type { ProviderJsonRequest } from './transport';
import type { ProviderSecretName } from './transport';

export type ProviderActivationBlockReason =
  | 'MISSING_SECRET'
  | 'INSECURE_ENDPOINT'
  | 'UNVERIFIED_TRANSPORT';

export interface ProviderSecretPresenceResolver {
  has(secretName: ProviderSecretName): boolean;
}

export interface ProviderActivationAssessment {
  ready: boolean;
  reason?: ProviderActivationBlockReason;
}

const DOCUMENTED_HTTP_HOSTS = new Set([
  'ws.bus.go.kr',
  'swopenapi.seoul.go.kr',
  'openapi.seoul.go.kr',
]);

function parsedUrl(urlTemplate: string): URL | null {
  try {
    return new URL(urlTemplate.replace(/\{[^}]+\}/g, 'placeholder'));
  } catch {
    return null;
  }
}

export function isDocumentedOfficialHttpEndpoint(urlTemplate: string): boolean {
  const url = parsedUrl(urlTemplate);
  return Boolean(
    url &&
    url.protocol === 'http:' &&
    DOCUMENTED_HTTP_HOSTS.has(url.hostname.toLocaleLowerCase()),
  );
}

export function assessProviderActivation(
  request: ProviderJsonRequest,
  secrets: ProviderSecretPresenceResolver,
): ProviderActivationAssessment {
  const url = parsedUrl(request.urlTemplate);
  if (!url) return { ready: false, reason: 'INSECURE_ENDPOINT' };

  if (request.security === 'TLS_VERIFIED') {
    if (url.protocol !== 'https:') {
      return { ready: false, reason: 'INSECURE_ENDPOINT' };
    }
  } else if (request.security === 'DOCUMENTED_HTTP_REQUIRES_VALIDATION') {
    if (!isDocumentedOfficialHttpEndpoint(request.urlTemplate)) {
      return { ready: false, reason: 'UNVERIFIED_TRANSPORT' };
    }
  } else {
    return { ready: false, reason: 'UNVERIFIED_TRANSPORT' };
  }

  if (!secrets.has(request.auth.secretName)) {
    return { ready: false, reason: 'MISSING_SECRET' };
  }

  return { ready: true };
}

export function assertProviderActivationReady(
  request: ProviderJsonRequest,
  secrets: ProviderSecretPresenceResolver,
): void {
  const assessment = assessProviderActivation(request, secrets);
  if (!assessment.ready) {
    throw new Error('Provider activation blocked: ' + assessment.reason);
  }
}
