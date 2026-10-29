import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthRoot';
import { cardArtCache, CardArtError } from './card-art-cache';
import { clearHouseholdCache, householdCacheEnabled } from './cache';

/** Only mounted beneath AuthRoot; cached bytes never substitute for a verified session. */
export function useCardArt(card: { id: string; imageFileId?: string | null }) {
  const { user, checking } = useAuth();
  const key = user && card.imageFileId ? JSON.stringify([user.id, card.id, card.imageFileId]) : '';
  const [image, setImage] = useState<{ key: string; url: string } | null>(null);
  useEffect(() => {
    let active = true, serial = 0, denied = false, url: string | null = null;
    const release = () => { if (url) URL.revokeObjectURL(url); url = null; };
    const invalidate = () => { serial++; release(); setImage(null); };
    const load = (cacheEnabled: boolean) => {
      if (!user || !card.imageFileId || checking || denied) return;
      const version = ++serial;
      void cardArtCache.load(user.id, card.id, card.imageFileId, cacheEnabled).then(blob => {
        if (!active || version !== serial || denied) return;
        release(); url = URL.createObjectURL(blob); setImage({ key, url });
      }).catch(error => {
        if (!active || version !== serial) return;
        if (error instanceof CardArtError && [401, 403].includes(error.status)) {
          denied = true;
          clearHouseholdCache();
          if (error.status === 401) window.dispatchEvent(new Event('cbh-auth-expired'));
        }
      });
    };
    const clear = (event: Event) => {
      invalidate();
      // User cache controls erase stored bytes, not the ability to view a card.
      // Security invalidation must never start another fetch or revive old bytes.
      if ((event as CustomEvent<{ reason?: string }>).detail?.reason === 'user') load(false);
      else denied = true;
    };
    window.addEventListener('cbh-household-cache-cleared', clear);
    setImage(null);
    load(householdCacheEnabled());
    return () => { active = false; serial++; release(); window.removeEventListener('cbh-household-cache-cleared', clear); };
  }, [user?.id, checking, card.id, card.imageFileId, key]);
  return { url: !checking && image?.key === key ? image.url : null };
}
