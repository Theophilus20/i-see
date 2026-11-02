import { useEffect, useState } from 'react';

/**
 * A blob: URL for a Blob that stays valid while the component shows it.
 * Created in an effect (not a memo), so React's mount/unmount checks cannot revoke
 * a URL that is still on screen — the cause of a broken image after leaving and coming back.
 */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}
