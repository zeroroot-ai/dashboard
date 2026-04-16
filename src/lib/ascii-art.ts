/**
 * ASCII Art Library for Retro Hacker Theme
 *
 * Collection of ASCII art for empty states, decorations, and loading indicators.
 */

export const ASCII_ART = {
  skull: `
    .-"""""-.
   /        \\
  |  O    O  |
  |    __    |
   \\  \\__/  /
    '-.____.-'`,

  terminal: `
  ┌──────────────────┐
  │ >_               │
  │                  │
  └──────────────────┘`,

  lock: `
      .---.
     /     \\
     | () |
    /|=====|\\
    \\|     |/
     '-----'`,

  divider: `════════════════════════════════════════`,

  loading: ['|', '/', '-', '\\'] as const,

  emptyState: `
  ╔══════════════════════════════════════╗
  ║                                      ║
  ║           NO DATA FOUND              ║
  ║                                      ║
  ║        > Run a scan to populate      ║
  ║                                      ║
  ╚══════════════════════════════════════╝`,

  shield: `
     .───.
    ╱     ╲
   │ ◉   ◉ │
   │   ▼   │
    ╲_____╱`,

  warning: `
    ╱╲
   ╱  ╲
  ╱ ⚠  ╲
 ╱______╲`,
} as const;

export type ASCIIArtKey = keyof typeof ASCII_ART;
