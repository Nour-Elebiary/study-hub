import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { requireSession } from "@/lib/dal";
import { contentAreas, nodeStatusSchema, searchSchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Search" };

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  in_review: "In review",
  published: "Published",
};

const AREA_LABELS: Record<string, string> = Object.fromEntries(
  contentAreas.map((a) => [a, a.replaceAll("_", " ")]),
);

type SearchResult = {
  id: string;
  courseId: string | null;
  courseTitle: string | null;
  title: string;
  area: string;
  status: string;
};

/**
 * Search (spec section 6): finds words in titles and note bodies, in English
 * and Arabic (the `simple` text-search configuration does not stem, so both
 * languages match as typed). Filters: course, area, status, tag.
 */
export default async function SearchPage({
  searchParams,
}: PageProps<"/search">) {
  await requireSession();
  const raw = await searchParams;
  const parsed = searchSchema.safeParse({
    q: typeof raw.q === "string" ? raw.q : undefined,
    course_id: typeof raw.course === "string" ? raw.course : undefined,
    area: typeof raw.area === "string" ? raw.area : undefined,
    status: typeof raw.status === "string" ? raw.status : undefined,
    tag: typeof raw.tag === "string" ? raw.tag : undefined,
  });
  const filters = parsed.success ? parsed.data : { q: "" };

  const supabase = await createClient();

  const { data: courses } = await supabase
    .from("courses")
    .select("id, code, title")
    .order("code");

  let query = supabase
    .from("nodes")
    .select("id, course_id, area, kind, title, status, courses(title)")
    .is("deleted_at", null)
    .neq("kind", "core")
    .order("updated_at", { ascending: false })
    .limit(50);

  if (filters.q) {
    // websearch mode accepts plain words; quotes and minus-words work too.
    query = query.textSearch("search", filters.q, { type: "websearch" });
  }
  if (filters.course_id) {
    query = query.eq("course_id", filters.course_id);
  }
  if (filters.area) {
    query = query.eq("area", filters.area);
  }
  if (filters.status) {
    query = query.eq("status", filters.status);
  }

  let results: SearchResult[] = [];
  let notice: string | null = null;

  if (filters.tag) {
    // Two-step tag filter: tag name → node ids → filter the main query.
    const { data: tag } = await supabase
      .from("tags")
      .select("id")
      .eq("name", filters.tag)
      .maybeSingle();
    if (tag) {
      const { data: links } = await supabase
        .from("node_tags")
        .select("node_id")
        .eq("tag_id", tag.id);
      const ids = (links ?? []).map((l) => l.node_id);
      if (ids.length > 0) {
        query = query.in("id", ids);
      } else {
        notice = `No notes carry the tag #${filters.tag}.`;
      }
    } else {
      notice = `No tag named #${filters.tag} exists yet.`;
    }
  }

  if (!notice) {
    const { data: rows } = await query;
    results = (rows ?? []).map((r) => ({
      id: r.id,
      courseId: r.course_id,
      courseTitle:
        (
          r as unknown as {
            courses?: { title?: string } | null;
          }
        ).courses?.title ?? null,
      title: r.title,
      area: r.area,
      status: r.status,
    }));
    if (results.length === 0 && (filters.q || filters.tag)) {
      notice = "Nothing matched. Try fewer words.";
    }
  }

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">Search</h1>

      <form className="grid gap-3" action="/search">
        <div className="grid gap-1">
          <Label htmlFor="q">Search words</Label>
          <Input
            id="q"
            name="q"
            defaultValue={filters.q}
            placeholder="For example: photosynthesis البناء الضوئي"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <Label htmlFor="course">Course</Label>
            <Select name="course" defaultValue={filters.course_id || ""}>
              <SelectTrigger id="course" className="w-full">
                <SelectValue placeholder="All courses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All courses</SelectItem>
                {(courses ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="area">Area</Label>
            <Select name="area" defaultValue={filters.area || ""}>
              <SelectTrigger id="area" className="w-full">
                <SelectValue placeholder="All areas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All areas</SelectItem>
                {contentAreas.map((a) => (
                  <SelectItem key={a} value={a}>
                    {AREA_LABELS[a]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="status">Status</Label>
            <Select name="status" defaultValue={filters.status || ""}>
              <SelectTrigger id="status" className="w-full">
                <SelectValue placeholder="Any status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Any status</SelectItem>
                {nodeStatusSchema.options.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="tag">Tag</Label>
            <Input
              id="tag"
              name="tag"
              defaultValue={filters.tag}
              placeholder="quiz1"
            />
          </div>
        </div>
        <Button type="submit" className="w-fit">
          Search
        </Button>
      </form>

      {notice && (
        <p role="status" className="text-muted-foreground text-sm">
          {notice}
        </p>
      )}

      <ul className="grid gap-2">
        {results.map((r) => (
          <li key={r.id} className="rounded-md border px-3 py-2 text-sm">
            <Link
              href={
                r.courseId
                  ? `/courses/${r.courseId}/nodes/${r.id}`
                  : `/courses/${r.id}`
              }
              className="font-medium underline underline-offset-4"
              dir="auto"
            >
              {r.title || "Untitled note"}
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {r.courseTitle && (
                <span className="text-muted-foreground">{r.courseTitle}</span>
              )}
              <Badge variant="outline">{AREA_LABELS[r.area] ?? r.area}</Badge>
              <Badge variant="secondary">{STATUS_LABELS[r.status]}</Badge>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
