"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { restoreVersionAction } from "@/app/(leader)/courses/[courseId]/nodes/actions";
import { Button } from "@/components/ui/button";

/** Restores an old version as a NEW version (nothing is ever overwritten). */
export function RestoreButton({
  nodeId,
  versionNo,
  canWrite,
}: {
  nodeId: string;
  versionNo: number;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canWrite) return null;

  return (
    <div className="grid gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={async () => {
          if (
            !window.confirm(
              `Restore version ${versionNo}? It becomes the newest version — nothing is deleted.`,
            )
          ) {
            return;
          }
          setBusy(true);
          setError(null);
          const fd = new FormData();
          fd.set("node_id", nodeId);
          fd.set("version_no", String(versionNo));
          const result = await restoreVersionAction(null, fd);
          setBusy(false);
          if (result && "error" in result && result.error) {
            setError(result.error);
            return;
          }
          router.refresh();
        }}
      >
        {busy ? "Restoring…" : `Restore version ${versionNo}`}
      </Button>
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
