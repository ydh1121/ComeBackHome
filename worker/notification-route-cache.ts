import type { ArrivalEtaRoute } from '../src/application/services/ArrivalEtaCalculator';
import type { D1DatabaseLike } from './runtime-types';
import { seoulDate } from '../src/domain/product-time';

// Persist only the selected route's duration and a verified local access ID.
// Names, addresses, coordinates and complete provider responses are excluded.
export interface NotificationRouteSnapshot extends ArrivalEtaRoute {
  id: string;
  realtimeOriginAccessPointId?: string;
}
export interface NotificationRouteCacheEntry {
  contextHash: string;
  route: NotificationRouteSnapshot | null;
  expiresAt: string;
  retryAfter: string;
}
export interface NotificationRouteCache {
  get(personId: string): Promise<NotificationRouteCacheEntry | null>;
  acquire(personId: string, contextHash: string, now: Date): Promise<string | null>;
  reserveRequest(personId: string, token: string, now: Date): Promise<boolean>;
  complete(personId: string, token: string, route: NotificationRouteSnapshot | null, now: Date, retryAt: Date): Promise<void>;
}
export const NOTIFICATION_ROUTE_POLICY = {
  successTtlMs: 24 * 60 * 60_000,
  failureBackoffMs: 30 * 60_000,
  leaseMs: 2 * 60_000,
  maxRequestsPerPersonDay: 24,
  prepareBeforeEndMs: 15 * 60_000,
  commuteWindowMs: 4 * 60 * 60_000,
} as const;

export function nextSeoulDay(now: Date): Date {
  return new Date(Date.parse(seoulDate(now) + 'T00:00:00+09:00') + 86_400_000);
}

export class D1NotificationRouteCache implements NotificationRouteCache {
  constructor(private readonly db: D1DatabaseLike) {}

  async get(personId: string): Promise<NotificationRouteCacheEntry | null> {
    const row = await this.db.prepare(`SELECT context_hash, route_json, expires_at, retry_after
      FROM notification_route_cache WHERE person_id = ?1`).bind(personId).first<{
      context_hash: string; route_json: string | null; expires_at: string; retry_after: string;
    }>();
    if (!row) return null;
    let route: NotificationRouteSnapshot | null = null;
    try {
      const parsed = row.route_json ? JSON.parse(row.route_json) as NotificationRouteSnapshot : null;
      if (parsed && typeof parsed.id === 'string' && Number.isFinite(parsed.totalMinutes) && parsed.totalMinutes >= 0) route = parsed;
    } catch { /* An invalid snapshot cannot become a confirmed ETA. */ }
    return { contextHash: row.context_hash, route, expiresAt: row.expires_at, retryAfter: row.retry_after };
  }

  async acquire(personId: string, contextHash: string, now: Date): Promise<string | null> {
    const token = crypto.randomUUID();
    const iso = now.toISOString();
    const result = await this.db.prepare(`INSERT INTO notification_route_cache
      (person_id, context_hash, route_json, fetched_at, expires_at, retry_after, lease_until, lease_token, request_day, request_count)
      VALUES (?1, ?2, NULL, NULL, ?3, ?3, ?4, ?5, ?6, 0)
      ON CONFLICT(person_id) DO UPDATE SET
        context_hash = excluded.context_hash,
        route_json = CASE WHEN notification_route_cache.context_hash = excluded.context_hash THEN notification_route_cache.route_json ELSE NULL END,
        expires_at = excluded.expires_at, retry_after = excluded.retry_after,
        lease_until = excluded.lease_until, lease_token = excluded.lease_token
      WHERE notification_route_cache.lease_until <= ?3
        AND (notification_route_cache.context_hash <> ?2 OR
          (notification_route_cache.expires_at <= ?3 AND notification_route_cache.retry_after <= ?3))
      RETURNING lease_token`).bind(personId, contextHash, iso,
        new Date(now.getTime() + NOTIFICATION_ROUTE_POLICY.leaseMs).toISOString(), token, seoulDate(now))
      .first<{ lease_token: string }>();
    return result?.lease_token === token ? token : null;
  }

  async reserveRequest(personId: string, token: string, now: Date): Promise<boolean> {
    const row = await this.db.prepare(`UPDATE notification_route_cache SET
      request_count = CASE WHEN request_day = ?3 THEN request_count + 1 ELSE 1 END,
      request_day = ?3
      WHERE person_id = ?1 AND lease_token = ?2 AND lease_until > ?4
        AND (request_day <> ?3 OR request_count < ?5)
      RETURNING request_count`).bind(personId, token, seoulDate(now), now.toISOString(),
        NOTIFICATION_ROUTE_POLICY.maxRequestsPerPersonDay).first<{ request_count: number }>();
    return !!row;
  }

  async complete(personId: string, token: string, route: NotificationRouteSnapshot | null, now: Date, retryAt: Date): Promise<void> {
    const iso = now.toISOString();
    await this.db.prepare(`UPDATE notification_route_cache SET route_json = ?3, fetched_at = ?4,
      expires_at = ?5, retry_after = ?6, lease_until = ?4, lease_token = NULL
      WHERE person_id = ?1 AND lease_token = ?2`).bind(personId, token, route ? JSON.stringify(route) : null, iso,
        route ? new Date(now.getTime() + NOTIFICATION_ROUTE_POLICY.successTtlMs).toISOString() : iso,
        retryAt.toISOString()).run();
  }
}
