"use client";

import { useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";

export function PageTransition() {
  const pathname = usePathname();
  const previousPath = useRef(pathname);

  useLayoutEffect(() => {
    if (pathname === previousPath.current) return;
    previousPath.current = pathname;

    if (
      !pathname ||
      /^\/(profile|cover-studio|design)(\/|$)/.test(pathname) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) return;

    // Leave the page in place so navigation never remounts its controls.
    const main = document.querySelector("main");
    const animation = main?.animate?.(
      [{ opacity: 0.76 }, { opacity: 1 }],
      { duration: 200, easing: "ease-out" },
    );

    return () => animation?.cancel();
  }, [pathname]);

  return null;
}
