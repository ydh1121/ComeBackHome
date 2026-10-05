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

function protocolOf(urlTemplate: string): 'https:' | 'http:' | 'unknown' {
  if (urlTemplate.startsWith('https://')) return 'https:';
  if (urlTemplate.startsWith('http://')) return 'http:';
  return 'unknown';
}

export function assessProviderActivation(
  request: ProviderJsonRequest,
  secrets: ProviderSecretPresenceResolver,
): ProviderActivationAssessment {
  const protocol = protocolOf(request.urlTemplate);

  if (protocol !== 'https:') {
    return { ready: false, reason: 'INSECURE_ENDPOINT' };
  }

  if (request.security !== 'TLS_VERIFIED') {
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
