import { getRequestConfig } from "next-intl/server";

/**
 * i18n request config (spec section 12 stack: next-intl). English-only in
 * v1 — see docs/QUESTIONS.md #24. The locale is fixed here; adding a second
 * language later means reading a cookie or URL segment in this function and
 * adding a `messages/<locale>.json` file. Nothing else needs to change.
 */
export default getRequestConfig(async () => ({
  locale: "en",
  messages: (await import("../../messages/en.json")).default,
}));
