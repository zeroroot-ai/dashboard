// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const TABLET_BREAKPOINT = 1200;

/**
 * Subscribe to a max-width media query. useSyncExternalStore reads the
 * browser state during render, so no effect sets state, and the server
 * snapshot is false, as the old hook returned before its first effect.
 */
function useMaxWidth(breakpoint: number): boolean {
  const query = `(max-width: ${breakpoint - 1}px)`;
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return React.useSyncExternalStore(
    subscribe,
    () => window.innerWidth < breakpoint,
    () => false,
  );
}

export function useIsMobile() {
  return useMaxWidth(MOBILE_BREAKPOINT);
}

export function useIsTablet() {
  return useMaxWidth(TABLET_BREAKPOINT);
}
