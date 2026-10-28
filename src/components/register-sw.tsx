"use client";

import { useEffect } from "react";

/**
 * Registers the service worker (spec section 10: offline reading). Only in
 * production — a caching worker during development would serve stale pages
 * and mask real errors.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // A failed registration only means no offline reading; the site
        // itself keeps working. Nothing to show the user.
      });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
