import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Signed download links for the private assets bucket (spec section 10 rule
 * 3): links expire after 10 minutes and force a download, so a shared link
 * stops working quickly and files never open inline in the browser.
 */
const SIGNED_URL_SECONDS = 10 * 60;

export async function createSignedAssetUrl(
  storagePath: string,
  fileName: string,
): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.storage
    .from("assets")
    .createSignedUrl(storagePath, SIGNED_URL_SECONDS, {
      download: fileName || true,
    });
  return data?.signedUrl ?? null;
}
