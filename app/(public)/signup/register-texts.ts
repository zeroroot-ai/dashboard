// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The texts of the registration form of the approval rung (dashboard#267,
 * ADR-0074).
 *
 * Written in the style of the approved texts (D25, D55, D56, D65): short
 * sentences, active voice, no promise the code does not keep. Each one waits
 * for the owner in `release/final-session.md` of the docs repo.
 */

export const REGISTER_TEXT = {
  title: "Register",
  intro:
    "An administrator approves each registration. You can sign in after the approval.",
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  workspaceName: "Company name",
  password: "Password",
  passwordConfirm: "Confirm password",
  submit: "Register",
  submitting: "Registering...",
  doneTitle: "Registration received",
  doneBody:
    "An administrator decides on your registration. You can sign in after the approval.",
  signIn: "Sign in",
  haveAccount: "Already have an account?",
  accountExists: "An account already exists for this email address. Sign in instead.",
  rateLimited: "Too many registrations. Try again later.",
  invalid: "Check the fields and try again.",
  closed: "Registration is not open on this installation.",
  unavailable: "We could not register you. Try again in a moment.",
  breached:
    "That password has appeared in a data breach. Choose a different one.",
} as const;
