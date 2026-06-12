"use client";

/**
 * help-panel.tsx, Contextual help slide-out panel
 *
 * Uses shadcn Sheet to render a keyboard-accessible slide-out on the right
 * side of the screen. Content is supplied per-page (not hardcoded here).
 * Requirements: 9.1, 9.2, 9.3, 9.4
 */

import * as React from "react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface HelpPanelProps {
  /** Controlled open state */
  open: boolean;
  /** Called when the panel requests close (overlay click, Escape, X button) */
  onOpenChange: (open: boolean) => void;
  /** Panel heading displayed at the top */
  title: string;
  /** React node, per-page help content, may include headings, lists, links */
  content: React.ReactNode;
}

export function HelpPanel({ open, onOpenChange, title, content }: HelpPanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="sm:max-w-md overflow-y-auto"
        aria-label={`${title} help panel`}
      >
        <SheetHeader className="pb-2">
          <SheetTitle>{title} Help</SheetTitle>
        </SheetHeader>
        <div
          className="px-4 pb-6 text-sm text-foreground space-y-4 leading-relaxed"
          role="region"
          aria-label={`${title} help content`}
        >
          {content}
        </div>
      </SheetContent>
    </Sheet>
  );
}
