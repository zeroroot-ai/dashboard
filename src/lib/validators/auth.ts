/**
 * Single source of truth for auth-related validation.
 *
 * Both the signup form (client) and the signUpAction Server Action
 * (server) import these schemas, so a rule change can never silently
 * drift between the two layers. The Auth.js Credentials provider in
 * auth.ts mirrors the same complexity rules as a defence-in-depth final
 * check.
 */

import * as z from "zod";

export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .regex(/[A-Z]/, "Must contain an uppercase letter")
  .regex(/[a-z]/, "Must contain a lowercase letter")
  .regex(/[0-9]/, "Must contain a number")
  .regex(/[^A-Za-z0-9]/, "Must contain a special character");

export const signupSchema = z
  .object({
    companyName: z
      .string()
      .min(2, "Company name must be at least 2 characters")
      .max(100, "Company name must be 100 characters or fewer"),
    email: z.string().email("Please enter a valid email address"),
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm your password"),
    tosAccepted: z.literal(true, {
      errorMap: () => ({ message: "You must accept the Terms of Service to continue" }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type SignupInput = z.infer<typeof signupSchema>;

export const signinSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type SignInInput = z.infer<typeof signinSchema>;
