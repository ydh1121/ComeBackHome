import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthRoot';
import { cardArtCache, CardArtError } from './card-art-cache';
import { clearHouseholdCache, householdCacheEnabled } from './cache';

/** Only mounted beneath AuthRoot; cached bytes never substitute for a verified session. */
export function useCardArt(card: { id: string; imageFileId?: string | null }) {
  const { user } = useAuth();
  const key = user && card.imageFileId ? JSON.stringify([user.id, card.id, card.imageFileId]) : '';
  const [image, setImage] = useState<{ key: string; url: string } | null>(null);
  useEffect(() => {
    let active = true, url: string | null = null;
    const release = () => { if (url) URL.revokeObjectURL(url); url = null; };
    const clear = () => { active = false; release(); setImage(null); };
    window.addEventListener('cbh-household-cache-cleared', clear);
    setImage(null);
    if (user && card.imageFileId) {
      void cardArtCache.load(user.id, card.id, card.imageFileId, householdCacheEnabled()).then(blob => {
        if (!active) return;
        url = URL.createObjectURL(blob); setImage({ key, url });
      }).catch(error => {
        if (!active) return;
        if (error instanceof CardArtError && [401, 403].includes(error.status)) {
          clearHouseholdCache();
          if (error.status === 401) window.dispatchEvent(new Event('cbh-auth-expired'));
        }
      });
    }
    return () => { active = false; release(); window.removeEventListener('cbh-household-cache-cleared', clear); };
  }, [user?.id, card.id, card.imageFileId, key]);
  return { url: image?.key === key ? image.url : null };
}
