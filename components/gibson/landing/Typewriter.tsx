"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
  className?: string;
}

type AnimationPhase = "typing" | "pausing" | "deleting" | "switching";

export function Typewriter({
  messages,
  typingSpeed = 65,
  deletingSpeed = 35,
  pauseDuration = 2500,
  instantDelete = false,
  className,
}: TypewriterProps) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [messageIndex, setMessageIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState("");
  const [phase, setPhase] = useState<AnimationPhase>("typing");
  const [announcedText, setAnnouncedText] = useState("");

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detect and watch prefers-reduced-motion on mount
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

  // Core animation loop
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
        // Finished typing — announce the full message to screen readers
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

  // Reduced-motion: render all messages statically, stacked
  if (reducedMotion) {
    return (
      <div className={cn("flex flex-col items-center gap-3", className)}>
        {messages.map((msg, i) => (
          <div key={i} className="flex flex-wrap items-center justify-center gap-2">
            <Badge
              variant="outline"
              className="border-green-500/60 text-green-400 shadow-[0_0_6px_rgba(34,197,94,0.35)] shrink-0"
            >
              {msg.label}
            </Badge>
            <span className="font-mono text-glow-green-soft">{msg.text}</span>
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
      {/* Visually-hidden live region — only updated when a full message completes */}
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
        className="border-green-500/60 text-green-400 shadow-[0_0_6px_rgba(34,197,94,0.35)] mt-0.5 shrink-0"
      >
        {currentLabel}
      </Badge>

      {/* aria-hidden so screen readers only hear the sr-only live region */}
      <span aria-hidden="true" className="flex items-center font-mono">
        <span className="text-glow-green-soft">{displayedText}</span>
        <span
          aria-hidden="true"
          className="ml-px text-green-400 animate-[typewriter-blink_1s_step-end_infinite]"
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
