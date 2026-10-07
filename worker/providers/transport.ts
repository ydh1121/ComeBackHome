import type { ProviderRequestContext, ProviderSecretBindings, ProviderSourceId } from './contracts';

export type ProviderSecretName = keyof ProviderSecretBindings;
export type ProviderRequestSecurity = 'TLS_VERIFIED' | 'DOCUMENTED_HTTP_REQUIRES_VALIDATION';

export interface ProviderAuthReference {
  secretName: ProviderSecretName;
  placement: 'header' | 'query' | 'path';
  target: string;
  prefix?: string;
}

export interface ProviderJsonRequest {
  source: ProviderSourceId;
  capability: string;
  method: 'GET';
  urlTemplate: string;
  query?: Record<string, string | string[]>;
  pathParams?: Record<string, string>;
  auth: ProviderAuthReference;
  security: ProviderRequestSecurity;
}

export interface ProviderBinaryResponse {
  body: ArrayBuffer;
  contentType: string;
}

export interface ProviderJsonTransport {
  getJson(
    request: ProviderJsonRequest,
    context?: ProviderRequestContext,
  ): Promise<unknown>;
  getText?(
    request: ProviderJsonRequest,
    context?: ProviderRequestContext,
  ): Promise<string>;
  getBytes(
    request: ProviderJsonRequest,
    context?: ProviderRequestContext,
  ): Promise<ProviderBinaryResponse>;
}
