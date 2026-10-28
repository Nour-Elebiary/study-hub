import { z } from "zod";

// Spec section 11.1: password minimum 10 characters.
export const passwordSchema = z.string().min(10, "Use at least 10 characters.");

// Spec section 4: the six content areas of every course.
export const contentAreas = [
  "official_materials",
  "student_notes",
  "quiz_exam_prep",
  "external_resources",
  "glossary",
  "open_questions",
] as const;

export type ContentArea = (typeof contentAreas)[number];

// Spec section 4: course roles.
export const courseRoles = [
  "owner",
  "editor",
  "contributor",
  "reviewer",
] as const;

export type CourseRole = (typeof courseRoles)[number];

export const courseRoleSchema = z.enum(courseRoles);
export const contentAreaSchema = z.enum(contentAreas);

export const signInSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: passwordSchema,
});

// Reset-password flow: two fields must match.
export const changePasswordSchema = z
  .object({
    password: passwordSchema,
    confirm: z.string().min(10, "Use at least 10 characters."),
  })
  .refine((data) => data.password === data.confirm, {
    message: "The two passwords do not match.",
    path: ["confirm"],
  });

export type SignInValues = z.infer<typeof signInSchema>;
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

// ---------------------------------------------------------------------------
// M1 admin forms (spec sections 4, 5, 9)
// ---------------------------------------------------------------------------

export const leaderCreateSchema = z.object({
  display_name: z.string().trim().min(2, "Enter the leader's name.").max(80),
  email: z.email("Enter a valid email address."),
});

export const courseCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[A-Z0-9][A-Z0-9-]{1,19}$/,
      "Use 2-20 letters, digits or hyphens (for example MATH-101).",
    ),
  title: z.string().trim().min(2, "Enter a course title.").max(120),
  semester: z.string().trim().max(40).optional().default(""),
  owner_id: z.uuid().optional(),
});

export const courseRenameSchema = z.object({
  course_id: z.uuid(),
  title: z.string().trim().min(2, "Enter a course title.").max(120),
  semester: z.string().trim().max(40).optional().default(""),
});

export const courseArchiveSchema = z.object({
  course_id: z.uuid(),
  archived: z.boolean(),
});

export const membershipSchema = z
  .object({
    course_id: z.uuid(),
    user_id: z.uuid(),
    role: courseRoleSchema,
    areas: z.array(contentAreaSchema).min(1, "Pick at least one area."),
    valid_from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker.")
      .optional()
      .or(z.literal("")),
    valid_until: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker.")
      .optional()
      .or(z.literal("")),
  })
  .refine(
    (data) =>
      !data.valid_from ||
      !data.valid_until ||
      data.valid_from <= data.valid_until,
    {
      message: "The start date must come before the end date.",
      path: ["valid_until"],
    },
  );

export const membershipRemoveSchema = z.object({
  course_id: z.uuid(),
  user_id: z.uuid(),
});

// The admin's own password, typed to confirm a sensitive action.
export const confirmPasswordSchema = z.object({
  confirm_password: passwordSchema,
});
