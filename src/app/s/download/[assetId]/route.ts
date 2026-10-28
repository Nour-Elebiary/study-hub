import { NextResponse, type NextRequest } from "next/server";
import { getStudentCourseIds, getStudentScope } from "@/lib/student-access";
import { createAdminClient } from "@/lib/supabase/admin";

const SIGNED_URL_SECONDS = 10 * 60;

/**
 * Student download endpoint (spec section 10 rule 3): verifies the join
 * cookie, the asset's visibility flags and the note's course scope, then
 * redirects to a Supabase Storage signed URL that expires after 10 minutes.
 * The service-role key never reaches the browser — only the short-lived URL.
 */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/s/download/[assetId]">,
) {
  const scope = await getStudentScope();
  if (!scope) {
    return NextResponse.redirect(new URL("/s/join", _request.nextUrl));
  }

  const { assetId } = await ctx.params;

  const admin = createAdminClient();
  const { data: asset } = await admin
    .from("assets")
    .select(
      "course_id, storage, path_or_url, title, student_visible, student_downloadable",
    )
    .eq("id", assetId)
    .single();

  if (
    !asset ||
    !asset.student_visible ||
    !asset.student_downloadable ||
    asset.storage !== "supabase"
  ) {
    return new NextResponse(null, { status: 404 });
  }

  const courseIds = await getStudentCourseIds(scope);
  if (!courseIds.includes(asset.course_id)) {
    return new NextResponse(null, { status: 404 });
  }

  const { data } = await admin.storage
    .from("assets")
    .createSignedUrl(asset.path_or_url, SIGNED_URL_SECONDS, {
      download: asset.title || true,
    });
  if (!data?.signedUrl) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.redirect(data.signedUrl, 302);
}
