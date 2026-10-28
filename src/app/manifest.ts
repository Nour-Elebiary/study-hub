import type { MetadataRoute } from "next";

/**
 * Web app manifest (spec section 10): makes Study Hub installable on
 * Android/desktop and defines the app-like look when launched from the home
 * screen. Students land on /s; leaders on / — start_url "/" serves both.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Study Hub",
    short_name: "Study Hub",
    description: "Course materials for leaders and students.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#171717",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
