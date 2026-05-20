"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface TypewriterMessage {
  label: string;
  text: string;
}

export interface TypewriterProps {
  messages: TypewriterMessage[];
  typingSpeed?: number;
  deletingSpeed?: number;
  pauseDuration?: number;
  /** If true, clear the message in one frame instead of backspacing char-by-char. */
  instantDelete?: boolean;
  /**
   * Whole-word matches against this list paint as `text-highlight` (brand
   * primary). Everything else stays `text-foreground`. Case-sensitive;
   * longest matches win (the regex sorts by length internally). Use for
   * proper nouns — tool names, product names, CLI commands.
   */
  highlightTerms?: readonly string[];
  className?: string;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderWithHighlights(text: string, re: RegExp | null): ReactNode {
  if (!re) return <span className="text-foreground">{text}</span>;
  const parts = text.split(re);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      return (
        <span key={i} className="text-highlight">
          {part}
        </span>
      );
    }
    return (
      <span key={i} className="text-foreground">
        {part}
      </span>
    );
  });
}

type AnimationPhase = "typing" | "pausing" | "deleting" | "switching";

export function Typewriter({
  messages,
  typingSpeed = 65,
  deletingSpeed = 35,
  pauseDuration = 2500,
  instantDelete = false,
  highlightTerms,
  className,
}: TypewriterProps) {
  /**
   * Compile the highlight regex once per term-list change. Longest terms
   * first so "gibson mission submit" wins over a bare "gibson". The capture
   * group is what makes split() return matches interleaved with non-matches.
   */
  const highlightRe = useMemo(() => {
    if (!highlightTerms || highlightTerms.length === 0) return null;
    const sorted = [...highlightTerms].sort((a, b) => b.length - a.length);
    return new RegExp(`(${sorted.map(escapeRegex).join("|")})`, "g");
  }, [highlightTerms]);

  const [reducedMotion, setReducedMotion] = useState(false);
  const [messageIndex, setMessageIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState("");
  const [phase, setPhase] = useState<AnimationPhase>("typing");
  const [announcedText, setAnnouncedText] = useState("");

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setReducedMotion(e.matches);
    };

    mq.addEventListener("change", handleChange);
    return () => mq.removeEventListener("change", handleChange);
  }, []);

  const clearPending = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (reducedMotion || messages.length === 0) return;

    const currentMessage = messages[messageIndex];
    const fullText = currentMessage.text;

    clearPending();

    if (phase === "typing") {
      if (displayedText.length < fullText.length) {
        timeoutRef.current = setTimeout(() => {
          setDisplayedText(fullText.slice(0, displayedText.length + 1));
        }, typingSpeed);
      } else {
        setAnnouncedText(`${currentMessage.label}: ${fullText}`);
        setPhase("pausing");
      }
    } else if (phase === "pausing") {
      timeoutRef.current = setTimeout(() => {
        setPhase("deleting");
      }, pauseDuration);
    } else if (phase === "deleting") {
      if (instantDelete) {
        setDisplayedText("");
        setPhase("switching");
      } else if (displayedText.length > 0) {
        timeoutRef.current = setTimeout(() => {
          setDisplayedText(displayedText.slice(0, -1));
        }, deletingSpeed);
      } else {
        setPhase("switching");
      }
    } else if (phase === "switching") {
      setMessageIndex((prev) => (prev + 1) % messages.length);
      setPhase("typing");
    }

    return clearPending;
  }, [
    reducedMotion,
    messages,
    messageIndex,
    displayedText,
    phase,
    typingSpeed,
    deletingSpeed,
    pauseDuration,
    instantDelete,
    clearPending,
  ]);

  if (reducedMotion) {
    return (
      <div className={cn("flex flex-col items-center gap-3", className)}>
        {messages.map((msg, i) => (
          <div key={i} className="flex flex-wrap items-center justify-center gap-2">
            <Badge
              variant="outline"
              className="border-highlight/60 text-highlight shrink-0"
            >
              {msg.label}
            </Badge>
            <span className="font-mono">
              {renderWithHighlights(msg.text, highlightRe)}
            </span>
          </div>
        ))}
      </div>
    );
  }

  const currentLabel = messages[messageIndex]?.label ?? "";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-center gap-2 min-h-[4rem] md:min-h-[3rem]",
        className,
      )}
    >
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcedText}
      </span>

      <Badge
        variant="outline"
        className="border-highlight/60 text-highlight mt-0.5 shrink-0"
      >
        {currentLabel}
      </Badge>

      <span aria-hidden="true" className="flex items-center font-mono">
        <span>{renderWithHighlights(displayedText, highlightRe)}</span>
        <span
          aria-hidden="true"
          className="ml-px text-highlight animate-[typewriter-blink_1s_step-end_infinite]"
        >
          |
        </span>
      </span>

      <style>{`
        @keyframes typewriter-blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
