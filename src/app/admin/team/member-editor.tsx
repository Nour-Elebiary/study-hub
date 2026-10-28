"use client";

import { useActionState } from "react";
import {
  removeMembershipAction,
  saveMembershipAction,
  type MembershipActionState,
} from "@/app/admin/team/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { courseRoles, contentAreas } from "@/lib/schemas";

export type MemberRow = {
  userId: string;
  displayName: string;
  role: string;
  areas: string[];
  validFrom: string | null;
  validUntil: string | null;
};

function AreaCheckboxes({
  memberId,
  selected,
}: {
  memberId: string;
  selected: string[];
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {contentAreas.map((area) => (
        <label
          key={area}
          className="flex items-center gap-2 text-sm"
          htmlFor={`area-${memberId}-${area}`}
        >
          <Checkbox
            id={`area-${memberId}-${area}`}
            name="areas"
            value={area}
            defaultChecked={selected.includes(area)}
          />
          {area.replaceAll("_", " ")}
        </label>
      ))}
    </div>
  );
}

/** Edit one membership: role, areas, optional validity dates. */
export function MemberEditor({
  courseId,
  member,
}: {
  courseId: string;
  member: MemberRow;
}) {
  const [saveState, submitSave, pendingSave] = useActionState<
    MembershipActionState,
    FormData
  >(saveMembershipAction, null);
  const [removeState, submitRemove, pendingRemove] = useActionState<
    MembershipActionState,
    FormData
  >(removeMembershipAction, null);

  return (
    <div className="grid gap-3 rounded-md border p-3">
      <p className="font-medium">{member.displayName}</p>
      <form action={submitSave} className="grid gap-3">
        <input type="hidden" name="course_id" value={courseId} />
        <input type="hidden" name="user_id" value={member.userId} />

        <div className="grid gap-1">
          <Label htmlFor={`role-${member.userId}`}>Role</Label>
          <Select name="role" defaultValue={member.role}>
            <SelectTrigger id={`role-${member.userId}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {courseRoles.map((role) => (
                <SelectItem key={role} value={role}>
                  {role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1">
          <Label>Areas this leader may work in</Label>
          <AreaCheckboxes memberId={member.userId} selected={member.areas} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <Label htmlFor={`from-${member.userId}`}>From (optional)</Label>
            <Input
              id={`from-${member.userId}`}
              name="valid_from"
              type="date"
              defaultValue={member.validFrom ?? ""}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`until-${member.userId}`}>Until (optional)</Label>
            <Input
              id={`until-${member.userId}`}
              name="valid_until"
              type="date"
              defaultValue={member.validUntil ?? ""}
            />
          </div>
        </div>

        {(saveState && "error" in saveState && saveState.error) ||
        (removeState && "error" in removeState && removeState.error) ? (
          <p role="alert" className="text-destructive text-sm">
            {(saveState && "error" in saveState && saveState.error) ||
              (removeState && "error" in removeState && removeState.error)}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={pendingSave}>
            {pendingSave ? "Saving…" : "Save member"}
          </Button>
        </div>
      </form>
      <form action={submitRemove}>
        <input type="hidden" name="course_id" value={courseId} />
        <input type="hidden" name="user_id" value={member.userId} />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={pendingRemove}
        >
          {pendingRemove ? "Removing…" : "Remove from course"}
        </Button>
      </form>
    </div>
  );
}

/** Add a leader to the course. */
export function AddMemberForm({
  courseId,
  candidates,
}: {
  courseId: string;
  candidates: { id: string; displayName: string }[];
}) {
  const [state, action, pending] = useActionState<
    MembershipActionState,
    FormData
  >(saveMembershipAction, null);

  if (candidates.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Every active leader is already a member. Create more leaders on the
        Leaders page.
      </p>
    );
  }

  return (
    <form action={action} className="grid gap-3 rounded-md border p-3">
      <input type="hidden" name="course_id" value={courseId} />
      <div className="grid gap-1">
        <Label htmlFor="add-user">Leader</Label>
        <Select name="user_id" required>
          <SelectTrigger id="add-user" className="w-full">
            <SelectValue placeholder="Pick a leader" />
          </SelectTrigger>
          <SelectContent>
            {candidates.map((leader) => (
              <SelectItem key={leader.id} value={leader.id}>
                {leader.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="add-role">Role</Label>
        <Select name="role" defaultValue="contributor">
          <SelectTrigger id="add-role" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {courseRoles.map((role) => (
              <SelectItem key={role} value={role}>
                {role}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1">
        <Label>Areas</Label>
        <AreaCheckboxes memberId="new" selected={[]} />
      </div>
      {state && "error" in state && state.error && (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      )}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : "Add to course"}
      </Button>
    </form>
  );
}
