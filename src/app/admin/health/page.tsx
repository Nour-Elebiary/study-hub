import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminOrCourseOwner } from "@/lib/admin-auth";
import {
  databaseBytesUsed,
  oversizedAssets,
  staleDrafts,
  storageBytesUsed,
  unownedNotes,
  usageVerdict,
  visibleCourseIds,
  type HealthItem,
} from "@/lib/health";
import { readSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Content health" };

const LIST_CAP = 10;

function ItemList({ items }: { items: HealthItem[] }) {
  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">Nothing to flag.</p>;
  }
  return (
    <ul className="grid gap-2" data-testid="health-list">
      {items.slice(0, LIST_CAP).map((item) => (
        <li
          key={item.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
        >
          <div>
            <Link
              href={`/courses/${item.courseId}`}
              className="font-medium underline underline-offset-4"
            >
              {item.title}
            </Link>
            <p className="text-muted-foreground text-xs">
              {item.courseTitle} — {item.detail}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function UsageBar({
  label,
  usedBytes,
  limitMb,
}: {
  label: string;
  usedBytes: number;
  limitMb: number;
}) {
  const verdict = usageVerdict(usedBytes, limitMb);
  const usedMb = usedBytes / (1024 * 1024);
  const levelClass =
    verdict.level === "full"
      ? "bg-destructive"
      : verdict.level === "warn"
        ? "bg-yellow-500"
        : "bg-primary";
  return (
    <div className="grid gap-1">
      <p className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {usedMb.toFixed(0)} MB of {limitMb.toLocaleString()} MB ({verdict.pct}
          %)
        </span>
      </p>
      <div
        role="progressbar"
        aria-valuenow={Math.min(verdict.pct, 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} use`}
        className="bg-muted h-2 w-full overflow-hidden rounded-full"
      >
        <div
          className={`h-full rounded-full ${levelClass}`}
          style={{ width: `${Math.min(verdict.pct, 100)}%` }}
        />
      </div>
      {verdict.level !== "ok" && (
        <p className="text-sm" role="alert">
          {verdict.level === "full"
            ? "The limit is reached — free up space or upgrade the plan."
            : "Over 70% — keep an eye on this."}
        </p>
      )}
    </div>
  );
}

/**
 * The Content health screen (spec section 9): stale drafts, notes with no
 * owner, files over the size gate, and free-tier use with a warning at 70%.
 * Admins see every course; owners see only their own.
 */
export default async function HealthPage() {
  const session = await requireAdminOrCourseOwner();
  const isAdmin = session.profile.global_role === "admin";

  const settings = await readSettings();
  const maxFileMb = Number(settings["max_file_mb"]) || 10;
  const dbLimitMb = Number(settings["db_limit_mb"]) || 500;
  const storageLimitMb = Number(settings["storage_limit_mb"]) || 1024;

  const courses = await visibleCourseIds(isAdmin, session.userId);
  const courseIds = courses.map((c) => c.id);

  const [drafts, unowned, oversized, dbBytes, storageBytes] = await Promise.all(
    [
      staleDrafts(courseIds),
      unownedNotes(courseIds),
      oversizedAssets(courseIds, maxFileMb),
      databaseBytesUsed().catch(() => 0),
      storageBytesUsed(courseIds).catch(() => 0),
    ],
  );

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-bold">Content health</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {isAdmin
            ? "A check-up for every course."
            : "A check-up for the courses you own."}
        </p>
      </div>

      <div className="rounded-md border p-4">
        <h2 className="text-sm font-semibold">Free-tier use</h2>
        <div className="mt-3 grid gap-4">
          <UsageBar label="Database" usedBytes={dbBytes} limitMb={dbLimitMb} />
          <UsageBar
            label="File storage"
            usedBytes={storageBytes}
            limitMb={storageLimitMb}
          />
        </div>
      </div>

      <div className="rounded-md border p-4">
        <h2 className="text-sm font-semibold">
          Drafts older than 14 days ({drafts.length})
        </h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Work started but not finished — assign an owner or finish it.
        </p>
        <div className="mt-3">
          <ItemList items={drafts} />
        </div>
      </div>

      <div className="rounded-md border p-4">
        <h2 className="text-sm font-semibold">
          Notes with no owner ({unowned.length})
        </h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Notes nobody is assigned to finish.
        </p>
        <div className="mt-3">
          <ItemList items={unowned} />
        </div>
      </div>

      <div className="rounded-md border p-4">
        <h2 className="text-sm font-semibold">
          Files over the {maxFileMb} MB gate ({oversized.length})
        </h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Files larger than the upload limit — check where they came from.
        </p>
        <div className="mt-3">
          <ItemList items={oversized} />
        </div>
      </div>
    </div>
  );
}
