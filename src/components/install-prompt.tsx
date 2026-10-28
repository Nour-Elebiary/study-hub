"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
};

const noopSubscribe = () => () => {};

/** True when the app already runs as an installed app (no banner needed). */
function useStandalone(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () =>
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari reports standalone through this legacy property.
      Boolean(
        (window.navigator as Navigator & { standalone?: boolean }).standalone,
      ),
    () => false, // server snapshot: assume not installed
  );
}

/** True when the visitor dismissed the banner earlier (remembered). */
function useDismissed(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => window.localStorage.getItem("sh_install_dismissed") === "1",
    () => false,
  );
}

/** True on iPhone/iPad/iPod, where install works through the Share menu. */
function useIsIos(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => /iphone|ipad|ipod/i.test(window.navigator.userAgent),
    () => false,
  );
}

/**
 * The install experience (spec section 10): Android/desktop get a real
 * install prompt; iPhone gets a short how-to (Share, then Add to Home
 * Screen). No push notifications are promised anywhere — iOS support for
 * them is unreliable. Hidden once installed or dismissed (remembered).
 */
export function InstallPrompt() {
  const standalone = useStandalone();
  const rememberedDismiss = useDismissed();
  const isIos = useIsIos();
  const [dismissed, setDismissed] = useState(false);
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);

  useEffect(() => {
    const onInstallPrompt = (event: Event) => {
      // Taking control of the prompt lets us offer install at a calm moment
      // instead of the browser shouting on first load.
      event.preventDefault();
      setInstallEvent(event as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    return () =>
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
  }, []);

  function dismiss() {
    setDismissed(true);
    window.localStorage.setItem("sh_install_dismissed", "1");
  }

  if (standalone || rememberedDismiss || dismissed) return null;

  if (installEvent) {
    return (
      <div
        role="region"
        aria-label="Install Study Hub"
        className="bg-muted fixed inset-x-3 bottom-3 z-50 flex items-center justify-between gap-3 rounded-lg border p-3 shadow-sm"
      >
        <p className="text-sm font-medium">
          Add Study Hub to your home screen?
        </p>
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            onClick={() => {
              void installEvent.prompt();
              setDismissed(true);
            }}
          >
            Install
          </Button>
          <Button size="sm" variant="ghost" onClick={dismiss}>
            Not now
          </Button>
        </div>
      </div>
    );
  }

  if (isIos) {
    return (
      <div
        role="region"
        aria-label="Install Study Hub"
        className="bg-muted fixed inset-x-3 bottom-3 z-50 rounded-lg border p-3 text-sm shadow-sm"
      >
        <p className="font-medium">Add Study Hub to your home screen</p>
        <p className="text-muted-foreground mt-1">
          In Safari, tap <strong>Share</strong>, then choose{" "}
          <strong>Add to Home Screen</strong>.
        </p>
        <Button size="sm" variant="ghost" onClick={dismiss} className="mt-2">
          Got it
        </Button>
      </div>
    );
  }

  return null;
}
