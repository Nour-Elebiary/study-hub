"use client";

import { useState } from "react";
import { finishTourAction } from "@/app/(leader)/tour/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STEPS = [
  {
    title: "1. Your courses",
    body: "Open Courses to see the classes you work on. You only ever see the courses you were added to.",
  },
  {
    title: "2. Your areas",
    body: "Inside a course, you can work in the areas your administrator gave you — for example official materials or quiz prep.",
  },
  {
    title: "3. Notes and more",
    body: "Notes, reviews and uploads arrive in the next update. You will also be able to add your own AI key later from the AI tab — totally optional.",
  },
];

/**
 * The 3-step first-run tour (spec section 6). Shown once; the leader's
 * "Done" sets tour_done on their own profile.
 */
export function FirstRunTour() {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          Welcome — three things to know
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm">{current.body}</p>
        <div className="flex items-center justify-between">
          <p aria-hidden className="text-muted-foreground text-xs">
            {step + 1} of {STEPS.length}
          </p>
          <div className="flex gap-2">
            {!isLast && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setStep((s) => s + 1)}
              >
                Next
              </Button>
            )}
            <form action={finishTourAction}>
              <Button type="submit" size="sm">
                {isLast ? "Done" : "Skip tour"}
              </Button>
            </form>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
