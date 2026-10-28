"use client";

import { useActionState } from "react";
import {
  archiveCourseAction,
  createCourseAction,
  renameCourseAction,
  type CourseActionState,
} from "@/app/admin/courses/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmPasswordField } from "@/app/admin/leaders/create-leader-form";

type LeaderOption = { id: string; displayName: string };

export function CreateCourseForm({ leaders }: { leaders: LeaderOption[] }) {
  const [state, action, pending] = useActionState<CourseActionState, FormData>(
    createCourseAction,
    null,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New course</CardTitle>
        <CardDescription>
          The code appears in links and lists (for example MATH-101).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="code">Course code</Label>
            <Input
              id="code"
              name="code"
              required
              maxLength={20}
              autoComplete="off"
              className="uppercase"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" required maxLength={120} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="semester">Semester (optional)</Label>
            <Input
              id="semester"
              name="semester"
              maxLength={40}
              placeholder="2026 Term 1"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="owner_id">Owner (optional, can set later)</Label>
            <Select name="owner_id">
              <SelectTrigger id="owner_id" className="w-full">
                <SelectValue placeholder="No owner yet" />
              </SelectTrigger>
              <SelectContent>
                {leaders.map((leader) => (
                  <SelectItem key={leader.id} value={leader.id}>
                    {leader.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {state && "error" in state && state.error && (
            <p role="alert" className="text-destructive text-sm">
              {state.error}
            </p>
          )}
          {state && "needsPassword" in state && state.needsPassword && (
            <ConfirmPasswordField />
          )}
          <Button type="submit" disabled={pending} className="mt-2">
            {pending ? "Creating…" : "Create course"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function CourseRowActions({
  courseId,
  title,
  semester,
  archived,
}: {
  courseId: string;
  title: string;
  semester: string;
  archived: boolean;
}) {
  const [renameState, submitRename, pendingRename] = useActionState<
    CourseActionState,
    FormData
  >(renameCourseAction, null);
  const [archiveState, submitArchive, pendingArchive] = useActionState<
    CourseActionState,
    FormData
  >(archiveCourseAction, null);

  return (
    <div className="grid gap-3">
      <form
        action={submitRename}
        className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      >
        <input type="hidden" name="course_id" value={courseId} />
        <div className="grid gap-1">
          <Label htmlFor={`title-${courseId}`}>Title</Label>
          <Input
            id={`title-${courseId}`}
            name="title"
            defaultValue={title}
            required
            maxLength={120}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`semester-${courseId}`}>Semester</Label>
          <Input
            id={`semester-${courseId}`}
            name="semester"
            defaultValue={semester}
            maxLength={40}
          />
        </div>
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={pendingRename}
        >
          {pendingRename ? "Saving…" : "Rename"}
        </Button>
      </form>

      <form action={submitArchive}>
        <input type="hidden" name="course_id" value={courseId} />
        <input type="hidden" name="archived" value={(!archived).toString()} />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={pendingArchive}
        >
          {archived ? "Unarchive" : "Archive"}
        </Button>
      </form>

      {(renameState && "error" in renameState && renameState.error) ||
      (archiveState && "error" in archiveState && archiveState.error) ? (
        <p role="alert" className="text-destructive text-sm">
          {(renameState && "error" in renameState && renameState.error) ||
            (archiveState && "error" in archiveState && archiveState.error)}
        </p>
      ) : null}

      {(renameState &&
        "needsPassword" in renameState &&
        renameState.needsPassword) ||
      (archiveState &&
        "needsPassword" in archiveState &&
        archiveState.needsPassword) ? (
        <form
          action={
            renameState && "needsPassword" in renameState
              ? submitRename
              : submitArchive
          }
          className="grid gap-2"
        >
          <input type="hidden" name="course_id" value={courseId} />
          {renameState && "needsPassword" in renameState && (
            <>
              <input type="hidden" name="title" value={title} />
              <input type="hidden" name="semester" value={semester} />
            </>
          )}
          {archiveState && "needsPassword" in archiveState && (
            <input
              type="hidden"
              name="archived"
              value={(!archived).toString()}
            />
          )}
          <ConfirmPasswordField />
          <Button type="submit" size="sm">
            Confirm and continue
          </Button>
        </form>
      ) : null}
    </div>
  );
}
