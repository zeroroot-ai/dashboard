/**
 * Single source of truth for the product name (dashboard#704).
 *
 * The product is **Zero Root AI**. The dashboard previously hardcoded the
 * pre-rebrand name in ~18 files (header status flasher, sidebar, logo, page
 * titles, AI prompts, onboarding templates, chat personas). Every brand-chrome
 * reference now reads from here; `scripts/check-no-legacy-product-name.mjs`
 * fails CI if the pre-rebrand name reappears.
 */

/** Full product name, e.g. for titles, the header status indicator, the logo. */
export const PRODUCT_NAME = "Zero Root AI";

/** Short product name, without the "AI" suffix. */
export const PRODUCT_NAME_SHORT = "Zero Root";
