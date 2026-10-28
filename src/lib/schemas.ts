import { z } from "zod";

// Spec section 11.1: password minimum 10 characters.
export const passwordSchema = z.string().min(10, "Use at least 10 characters.");

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
