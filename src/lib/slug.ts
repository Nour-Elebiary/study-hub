/**
 * Slug generation for notes and sections (spec section 5, nodes.slug).
 * Keeps Latin letters, digits and Arabic characters so Arabic titles keep
 * readable slugs; everything else becomes a hyphen.
 */
export function slugify(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "note"
  );
}
