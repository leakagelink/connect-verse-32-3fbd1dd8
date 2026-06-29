// Prefetch avatar images for visible cards so scrolling stays smooth and
// images appear instantly when their card enters the viewport. Uses an
// in-memory Set so the same URL is never requested twice per session.
import { useEffect } from "react";

const PREFETCHED = new Set<string>();

export function prefetchAvatar(url: string | null | undefined): void {
  if (!url || typeof window === "undefined") return;
  if (PREFETCHED.has(url)) return;
  PREFETCHED.add(url);
  // Detached <img> triggers the browser's image cache without rendering.
  const img = new Image();
  img.decoding = "async";
  (img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = "low";
  img.src = url;
}

export function prefetchAvatars(urls: ReadonlyArray<string | null | undefined>): void {
  for (const u of urls) prefetchAvatar(u);
}

/** Hook: prefetch avatars whenever the list of URLs changes. */
export function useAvatarPrefetch(urls: ReadonlyArray<string | null | undefined>): void {
  // Join into a stable dep string so React only re-runs on real changes.
  const key = urls.filter(Boolean).join("|");
  useEffect(() => {
    prefetchAvatars(urls);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
