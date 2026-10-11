"use client";

import { useMemo } from "react";
import type { HostView } from "@/shared/protocol";

/**
 * The address players should open.
 *
 * If the TV opened the site as "localhost", phones can't use that, so we use
 * the Wi-Fi address the game server found (e.g. http://192.168.1.5:3000/play).
 * Once the site is deployed, it's simply this site's own address.
 */
export function useJoinUrl(view: HostView) {
  return useMemo(() => {
    if (typeof window === "undefined") return view.joinUrl;
    const host = window.location.hostname;
    const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
    return isLocal ? view.joinUrl : `${window.location.origin}/play`;
  }, [view.joinUrl]);
}
