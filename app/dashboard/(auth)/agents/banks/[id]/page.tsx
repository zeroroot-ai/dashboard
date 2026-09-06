// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

import { use } from "react";
import { BankDetailContent } from "@/components/gibson/banks/BankDetailContent";

export default function BankDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <BankDetailContent bankId={id} />;
}
