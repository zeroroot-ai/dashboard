// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * RegisterForm, Client Component: the registration of the APPROVAL rung
 * (ADR-0074, dashboard#267).
 *
 * One screen. The daemon's Register RPC takes the whole form, password
 * included, and an administrator approves the registration in the queue of
 * dashboard#193. So there is no mail step and no provisioning panel: a
 * success shows that an administrator decides, and nothing else.
 */

import { useState } from "react";
import { useForm, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { registerAction } from "@/app/actions/register";
import { REGISTER_TEXT } from "./register-texts";
import { registerInputSchema, type RegisterInput } from "./types";

interface RegisterFormProps {
  /** The plan id the daemon gets. The approval rung shows no plan. */
  tier: string;
}

type TextField = {
  name: Exclude<Path<RegisterInput>, "tier">;
  label: string;
  type: "text" | "email" | "password";
  autoComplete: string;
};

const FIELDS: TextField[] = [
  { name: "firstName", label: REGISTER_TEXT.firstName, type: "text", autoComplete: "given-name" },
  { name: "lastName", label: REGISTER_TEXT.lastName, type: "text", autoComplete: "family-name" },
  { name: "email", label: REGISTER_TEXT.email, type: "email", autoComplete: "email" },
  { name: "workspaceName", label: REGISTER_TEXT.workspaceName, type: "text", autoComplete: "organization" },
  { name: "password", label: REGISTER_TEXT.password, type: "password", autoComplete: "new-password" },
  {
    name: "passwordConfirm",
    label: REGISTER_TEXT.passwordConfirm,
    type: "password",
    autoComplete: "new-password",
  },
];

export function RegisterForm({ tier }: RegisterFormProps) {
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerInputSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      workspaceName: "",
      tier,
      password: "",
      passwordConfirm: "",
    },
  });
  const submitting = form.formState.isSubmitting;

  async function onSubmit(values: RegisterInput) {
    setFormError(null);
    const result = await registerAction(values);
    if (result.ok) {
      setDone(true);
      return;
    }
    setFormError(result.userMessage);
    for (const [name, message] of Object.entries(result.fieldErrors ?? {})) {
      form.setError(name as Path<RegisterInput>, { message });
    }
  }

  if (done) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12">
        <Card className="w-full max-w-md mx-auto">
          <CardHeader>
            <CardTitle className="text-2xl font-bold">{REGISTER_TEXT.doneTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground" role="status">
              {REGISTER_TEXT.doneBody}
            </p>
          </CardContent>
          <CardFooter className="flex justify-center">
            <Link href="/login" className="underline underline-offset-4 hover:no-underline font-medium">
              {REGISTER_TEXT.signIn}
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">{REGISTER_TEXT.title}</CardTitle>
          <p className="text-sm text-muted-foreground">{REGISTER_TEXT.intro}</p>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
              {formError && (
                <p className="text-sm text-destructive" role="alert">
                  {formError}
                </p>
              )}
              {FIELDS.map((f) => (
                <FormField
                  key={f.name}
                  control={form.control}
                  name={f.name}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{f.label}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type={f.type}
                          autoComplete={f.autoComplete}
                          disabled={submitting}
                          aria-required="true"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
              <Button type="submit" className="w-full" disabled={submitting} aria-busy={submitting}>
                {submitting ? REGISTER_TEXT.submitting : REGISTER_TEXT.submit}
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardFooter className="flex justify-center">
          <p className="text-sm text-muted-foreground">
            {REGISTER_TEXT.haveAccount}{" "}
            <Link href="/login" className="underline underline-offset-4 hover:no-underline font-medium">
              {REGISTER_TEXT.signIn}
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
