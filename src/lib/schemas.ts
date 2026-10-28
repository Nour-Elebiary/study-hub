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

// ---------------------------------------------------------------------------
// M2 workspace forms (spec sections 5, 6)
// ---------------------------------------------------------------------------

export const nodeKindSchema = z.enum([
  "core",
  "course_home",
  "section",
  "note",
]);
export type NodeKind = z.infer<typeof nodeKindSchema>;

export const nodeStatusSchema = z.enum(["draft", "in_review", "published"]);
export type NodeStatus = z.infer<typeof nodeStatusSchema>;

export const createNodeSchema = z.object({
  course_id: z.uuid(),
  parent_id: z.uuid().nullable(),
  area: contentAreaSchema,
  kind: z.enum(["section", "note"]),
  title: z.string().trim().min(1, "Give it a title.").max(160),
  template_id: z.string().max(40).optional(),
});

export const renameNodeSchema = z.object({
  node_id: z.uuid(),
  title: z.string().trim().min(1, "Give it a title.").max(160),
});

export const reorderNodeSchema = z.object({
  node_id: z.uuid(),
  direction: z.enum(["up", "down"]),
});

export const saveDraftSchema = z.object({
  node_id: z.uuid(),
  body_md: z.string().max(500_000, "This note is too long."),
});

export const saveVersionSchema = z.object({
  node_id: z.uuid(),
  body_md: z.string().max(500_000, "This note is too long."),
  change_note: z.string().trim().max(300).optional().default(""),
});

export const setNodeStatusSchema = z
  .object({
    node_id: z.uuid(),
    status: nodeStatusSchema,
    // Required when sending a note back from review (spec section 6).
    send_back_comment: z.string().trim().max(2000).optional(),
  })
  .refine(
    (data) =>
      data.status !== "draft" || (data.send_back_comment ?? "").length > 0,
    {
      message: "Write what needs to change before sending it back.",
      path: ["send_back_comment"],
    },
  );

export const assignNodeSchema = z.object({
  node_id: z.uuid(),
  assigned_to: z.uuid().nullable(),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker.")
    .optional()
    .or(z.literal("")),
});

export const softDeleteNodeSchema = z.object({
  node_id: z.uuid(),
});

export const restoreVersionSchema = z.object({
  node_id: z.uuid(),
  version_no: z.number().int().min(1),
});

export const setNodeTagsSchema = z.object({
  node_id: z.uuid(),
  tags: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .min(1)
        .max(40)
        .regex(
          /^[a-z0-9\u0600-\u06FF_-]+$/,
          "Letters, digits, hyphen or underscore.",
        ),
    )
    .max(20, "Use at most 20 tags."),
});

export const addCommentSchema = z.object({
  node_id: z.uuid(),
  parent_id: z.uuid().nullable(),
  body: z.string().trim().min(1, "Write your comment.").max(4000),
});

export const resolveCommentSchema = z.object({
  comment_id: z.uuid(),
  resolved: z.boolean(),
});

export const searchSchema = z.object({
  q: z.string().trim().max(200).optional().default(""),
  course_id: z.uuid().optional().or(z.literal("")),
  area: contentAreaSchema.optional().or(z.literal("")),
  status: nodeStatusSchema.optional().or(z.literal("")),
  tag: z.string().trim().max(40).optional().or(z.literal("")),
});

export const lockSchema = z.object({
  node_id: z.uuid(),
});

export type SearchValues = z.infer<typeof searchSchema>;

// ---------------------------------------------------------------------------
// M3 assets (spec sections 5, 6, 10, 11 rule 4)
// ---------------------------------------------------------------------------

export const assetKindSchema = z.enum([
  "image",
  "pdf",
  "audio",
  "video",
  "document",
  "other",
]);
export type AssetKind = z.infer<typeof assetKindSchema>;

export const assetStorageSchema = z.enum(["supabase", "drive", "link"]);
export type AssetStorage = z.infer<typeof assetStorageSchema>;

/** A Drive or web link replaces an oversized upload (spec section 6). */
export const addLinkAssetSchema = z.object({
  course_id: z.uuid(),
  node_id: z.uuid().nullable(),
  kind: assetKindSchema,
  storage: z.enum(["drive", "link"]),
  url: z.url("Enter a valid link.").max(2048),
  title: z.string().trim().min(1, "Give it a title.").max(200),
});

/** After the browser uploads to Storage, the action records the row. */
export const registerUploadSchema = z.object({
  course_id: z.uuid(),
  node_id: z.uuid().nullable(),
  kind: assetKindSchema,
  path_or_url: z.string().min(1).max(1024),
  title: z.string().trim().min(1, "Give it a title.").max(200),
  mime: z.string().min(1).max(120),
  size_bytes: z.number().int().positive().max(10_485_760),
});

/** Rename, and toggle the two student flags (spec section 10). */
export const updateAssetSchema = z.object({
  asset_id: z.uuid(),
  title: z.string().trim().min(1, "Give it a title.").max(200).optional(),
  student_visible: z.boolean().optional(),
  student_downloadable: z.boolean().optional(),
});

/** Replace: a new upload (already in Storage) or a new link. */
export const replaceAssetSchema = z.object({
  asset_id: z.uuid(),
  storage: assetStorageSchema,
  path_or_url: z.string().min(1).max(2048),
  mime: z.string().min(1).max(120),
  size_bytes: z.number().int().positive().max(10_485_760).nullable(),
});

export const deleteAssetSchema = z.object({
  asset_id: z.uuid(),
});

/** Browser OCR (M5) and transcripts (M6) write text back through the server. */
export const saveAssetTextSchema = z.object({
  asset_id: z.uuid(),
  field: z.enum(["ocr_text", "transcript_text"]),
  text: z.string().max(1_000_000),
});
