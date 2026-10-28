"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  createNodeAction,
  reorderNodeAction,
  softDeleteNodeAction,
  type NodeActionState,
} from "@/app/(leader)/courses/[courseId]/nodes/actions";
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
import { contentAreas, type CourseRole } from "@/lib/schemas";
import { noteTemplates } from "@/lib/templates";
import type { TreeNode } from "@/app/(leader)/courses/[courseId]/page";

const AREA_LABELS: Record<string, string> = Object.fromEntries(
  contentAreas.map((a) => [a, a.replaceAll("_", " ")]),
);

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  in_review: "In review",
  published: "Published",
};

function statusBadgeVariant(status: string) {
  if (status === "published") return "default" as const;
  if (status === "in_review") return "secondary" as const;
  return "outline" as const;
}

/**
 * The content tree (spec section 6): areas as branches, sections and notes
 * underneath, collapsible, with up/down reorder buttons and create-from-
 * template forms. Mobile-first: an indented outline, no drag handles.
 */
export function ContentTree({
  courseId,
  nodes,
  myRole,
  myAreas,
  isAdmin,
}: {
  courseId: string;
  nodes: TreeNode[];
  myRole: CourseRole | null;
  myAreas: string[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [openAreas, setOpenAreas] = useState<Record<string, boolean>>({});
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [createdNodeId, setCreatedNodeId] = useState<string | null>(null);

  // When a note is created, open it right away.
  useEffect(() => {
    if (createdNodeId) {
      router.push(`/courses/${courseId}/nodes/${createdNodeId}`);
    }
  }, [createdNodeId, courseId, router]);

  const canWrite = (area: string) =>
    isAdmin ||
    myRole === "owner" ||
    ((myRole === "editor" || myRole === "contributor") &&
      myAreas.includes(area));

  const byArea = useMemo(() => {
    const map = new Map<string, TreeNode[]>();
    for (const area of contentAreas) map.set(area, []);
    for (const node of nodes) {
      if (node.parentId === null) map.get(node.area)?.push(node);
    }
    return map;
  }, [nodes]);

  const childrenOf = useMemo(() => {
    const map = new Map<string, TreeNode[]>();
    for (const node of nodes) {
      if (node.parentId !== null) {
        const list = map.get(node.parentId) ?? [];
        list.push(node);
        map.set(node.parentId, list);
      }
    }
    return map;
  }, [nodes]);

  function move(nodeId: string, direction: "up" | "down") {
    const formData = new FormData();
    formData.set("node_id", nodeId);
    formData.set("direction", direction);
    void reorderNodeAction(null, formData);
  }

  function remove(nodeId: string) {
    const formData = new FormData();
    formData.set("node_id", nodeId);
    void softDeleteNodeAction(null, formData);
  }

  function renderNode(node: TreeNode, depth: number) {
    const children = childrenOf.get(node.id) ?? [];
    return (
      <li key={node.id} className="grid gap-0.5">
        <div className="group flex items-center gap-1 rounded-md px-1 py-0.5">
          <span
            aria-hidden
            className="text-muted-foreground w-4 shrink-0 text-center text-xs"
          >
            {node.kind === "section" ? (children.length > 0 ? "▾" : "▸") : "•"}
          </span>
          <Link
            href={`/courses/${courseId}/nodes/${node.id}`}
            className="hover:bg-muted min-w-0 flex-1 truncate rounded px-1 py-1.5 text-sm"
          >
            {node.kind === "section" ? (
              <span className="font-medium">{node.title}</span>
            ) : (
              node.title || "Untitled note"
            )}
          </Link>
          <Badge variant={statusBadgeVariant(node.status)} className="text-xs">
            {STATUS_LABELS[node.status]}
          </Badge>
          {canWrite(node.area) && (
            <span className="flex shrink-0 gap-0.5 opacity-40 group-hover:opacity-100">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                onClick={() => move(node.id, "up")}
                aria-label={`Move ${node.title} up`}
              >
                ↑
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                onClick={() => move(node.id, "down")}
                aria-label={`Move ${node.title} down`}
              >
                ↓
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                onClick={() => remove(node.id)}
                aria-label={`Delete ${node.title}`}
              >
                ✕
              </Button>
            </span>
          )}
        </div>
        {node.kind === "section" && children.length > 0 && (
          <ul className="grid gap-0.5">
            {children.map((child) => renderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <div className="grid gap-4">
      {contentAreas.map((area) => {
        const roots = byArea.get(area) ?? [];
        const open = openAreas[area] ?? roots.length > 0;
        return (
          <section key={area} className="rounded-lg border">
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <button
                type="button"
                className="flex items-center gap-2 text-sm font-semibold"
                onClick={() => setOpenAreas((s) => ({ ...s, [area]: !open }))}
                aria-expanded={open}
              >
                <span aria-hidden>{open ? "▾" : "▸"}</span>
                {AREA_LABELS[area]}
                <span className="text-muted-foreground font-normal">
                  ({roots.length})
                </span>
              </button>
              {canWrite(area) && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setCreatingIn(creatingIn === area ? null : area)
                  }
                >
                  + New
                </Button>
              )}
            </div>
            {creatingIn === area && (
              <CreateNodeForm
                courseId={courseId}
                area={area}
                onCreated={setCreatedNodeId}
                onCancel={() => setCreatingIn(null)}
              />
            )}
            {open && roots.length > 0 && (
              <ul className="grid gap-0.5 px-2 pb-2">
                {roots.map((node) => renderNode(node, 0))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Create a section or a note from a template, inside one area. */
function CreateNodeForm({
  courseId,
  area,
  onCreated,
  onCancel,
}: {
  courseId: string;
  area: string;
  onCreated: (nodeId: string) => void;
  onCancel: () => void;
}) {
  const [state, action, pending] = useActionState<NodeActionState, FormData>(
    createNodeAction,
    null,
  );
  const [kind, setKind] = useState<"note" | "section">("note");

  useEffect(() => {
    if (state && "ok" in state && state.nodeId) {
      onCreated(state.nodeId);
    }
  }, [state, onCreated]);

  return (
    <form action={action} className="grid gap-3 border-t px-3 py-3">
      <input type="hidden" name="course_id" value={courseId} />
      <input type="hidden" name="area" value={area} />
      <input type="hidden" name="parent_id" value="" />
      <input type="hidden" name="kind" value={kind} />
      <div className="grid gap-1">
        <Label htmlFor={`title-${area}`}>Title</Label>
        <Input id={`title-${area}`} name="title" required maxLength={160} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1">
          <Label htmlFor={`kind-${area}`}>Type</Label>
          <Select
            defaultValue="note"
            onValueChange={(v) => setKind(v as "note" | "section")}
          >
            <SelectTrigger id={`kind-${area}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="note">Note</SelectItem>
              <SelectItem value="section">Section</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {kind === "note" && (
          <div className="grid gap-1">
            <Label htmlFor={`template-${area}`}>Template</Label>
            <Select name="template_id" defaultValue="">
              <SelectTrigger id={`template-${area}`} className="w-full">
                <SelectValue placeholder="Empty note" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Empty note</SelectItem>
                {noteTemplates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      {state && "error" in state && state.error && (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Creating…" : "Create"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
