import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { InstallPrompt } from "@/components/install-prompt";
import { RegisterServiceWorker } from "@/components/register-sw";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  // Mobile-first: designed at 360 px width first (spec section 10).
  width: "device-width",
  initialScale: 1,
  // Follows the comfort dark mode: match the page background.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export const metadata: Metadata = {
  title: {
    default: "Study Hub",
    template: "%s · Study Hub",
  },
  description: "Study Hub for leaders and students.",
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "Study Hub",
    statusBarStyle: "black-translucent",
  },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      dir="ltr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Applies the saved text size before first paint (spec section 10
            rule 6) so the page never flashes at the wrong size. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var s=localStorage.getItem('sh_text_size');if(s)document.documentElement.style.fontSize=s}catch(e){}",
          }}
        />
      </head>
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider locale={locale}>
          {children}
        </NextIntlClientProvider>
        <RegisterServiceWorker />
        <InstallPrompt />
      </body>
    </html>
  );
}
