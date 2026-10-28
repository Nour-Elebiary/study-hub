"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export type ChangedNode = {
  courseId: string;
  courseTitle: string;
  nodeId: string;
  title: string;
  updatedAt: string;
};

const STORAGE_PREFIX = "studyhub:seen:";

function readSeen(courseId: string): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + courseId);
    return raw ? Number(raw) : 0;
  } catch {
    return 0;
  }
}

function writeSeen(courseId: string, time: number) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + courseId, String(time));
  } catch {
    // Private browsing without storage — the list simply stays as-is.
  }
}

/**
 * "Changed since I last opened the course" (spec section 6). The last-visit
 * times live in this browser's storage — no database table, no tracking on
 * other devices. Opening a course page marks it as seen (VisitMarker).
 */
export function ChangedSinceVisit({ nodes }: { nodes: ChangedNode[] }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    // Read the browser storage after mount, outside the synchronous effect
    // body (React compiler rule: no setState directly in an effect).
    const id = requestAnimationFrame(() => setNow(Date.now()));
    return () => cancelAnimationFrame(id);
  }, []);

  const changed = useMemo(() => {
    if (now === null) return [];
    return nodes.filter(
      (n) => new Date(n.updatedAt).getTime() > readSeen(n.courseId),
    );
  }, [nodes, now]);

  if (now === null) {
    // Avoid a flash of "nothing changed" before the browser storage is read.
    return null;
  }

  const courses = [...new Set(changed.map((n) => n.courseId))];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Changed since you last opened the course
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        {changed.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing new.</p>
        ) : (
          <>
            {courses.map((courseId) => (
              <div key={courseId} className="grid gap-1">
                <p className="text-muted-foreground text-xs font-medium uppercase">
                  {changed.find((n) => n.courseId === courseId)?.courseTitle}
                </p>
                <ul className="grid gap-1">
                  {changed
                    .filter((n) => n.courseId === courseId)
                    .map((n) => (
                      <li key={n.nodeId} className="text-sm">
                        <Link
                          href={`/courses/${courseId}/nodes/${n.nodeId}`}
                          className="underline underline-offset-4"
                          dir="auto"
                        >
                          {n.title || "Untitled note"}
                        </Link>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => {
                const time = Date.now();
                for (const courseId of courses) writeSeen(courseId, time);
                setNow(Date.now());
              }}
            >
              Mark all as seen
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Placed on a course page: records the visit so the home list can compare. */
export function VisitMarker({ courseId }: { courseId: string }) {
  useEffect(() => {
    writeSeen(courseId, Date.now());
  }, [courseId]);
  return null;
}
