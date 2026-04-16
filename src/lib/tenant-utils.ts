/**
 * Tenant Utility Functions
 * Pure utility functions for tenant-related operations
 */

import type { Tenant, TenantRole } from '@/src/types/tenant';

// ============================================================================
// Color Generation
// ============================================================================

/**
 * Generates a consistent hex color from a tenant name using a hash function.
 * The same name will always produce the same color.
 *
 * @param name - The tenant name to generate a color for
 * @returns A hex color string (e.g., '#3B82F6')
 *
 * @example
 * generateTenantColor('acme-corp') // Returns '#A1B2C3'
 */
export function generateTenantColor(name: string): string {
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    const char = name.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  // Convert hash to a pleasant color in the HSL color space
  // Use hue range that produces nice colors (avoiding yellow/brown)
  const hue = Math.abs(hash % 360);
  const saturation = 65 + (Math.abs(hash >> 8) % 20); // 65-85%
  const lightness = 45 + (Math.abs(hash >> 16) % 15); // 45-60%

  // Convert HSL to RGB then to Hex
  const h = hue / 360;
  const s = saturation / 100;
  const l = lightness / 100;

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
  const g = Math.round(hue2rgb(p, q, h) * 255);
  const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validation result for tenant name
 */
export interface TenantNameValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates a tenant name against the naming rules:
 * - 3-64 characters long
 * - Lowercase letters, numbers, and hyphens only
 * - Cannot start or end with a hyphen
 * - No consecutive hyphens
 *
 * @param name - The tenant name to validate
 * @returns Validation result with error message if invalid
 *
 * @example
 * validateTenantName('my-team') // { valid: true }
 * validateTenantName('My-Team') // { valid: false, error: 'Must be lowercase...' }
 */
export function validateTenantName(name: string): TenantNameValidationResult {
  if (!name) {
    return { valid: false, error: 'Name is required' };
  }

  if (name.length < 3) {
    return { valid: false, error: 'Name must be at least 3 characters' };
  }

  if (name.length > 64) {
    return { valid: false, error: 'Name must be less than 64 characters' };
  }

  if (name !== name.toLowerCase()) {
    return { valid: false, error: 'Name must be lowercase' };
  }

  if (!/^[a-z0-9-]+$/.test(name)) {
    return { valid: false, error: 'Name can only contain lowercase letters, numbers, and hyphens' };
  }

  if (name.startsWith('-') || name.endsWith('-')) {
    return { valid: false, error: 'Name cannot start or end with a hyphen' };
  }

  if (name.includes('--')) {
    return { valid: false, error: 'Name cannot contain consecutive hyphens' };
  }

  return { valid: true };
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Formats a tenant for display purposes.
 *
 * @param tenant - The tenant to format
 * @returns A formatted display string
 *
 * @example
 * formatTenantDisplay(tenant) // Returns 'Acme Corp (acme-corp)'
 */
export function formatTenantDisplay(tenant: Tenant): string {
  return `${tenant.displayName} (${tenant.name})`;
}

/**
 * Extracts 1-2 letter initials from a tenant's display name.
 *
 * @param displayName - The display name to extract initials from
 * @returns 1-2 uppercase letters
 *
 * @example
 * getTenantInitials('Acme Corp') // Returns 'AC'
 * getTenantInitials('Security') // Returns 'SE'
 * getTenantInitials('X') // Returns 'X'
 */
export function getTenantInitials(displayName: string): string {
  if (!displayName) return '?';

  const words = displayName.trim().split(/\s+/);

  if (words.length === 1) {
    // Single word: take first two characters
    return words[0].substring(0, 2).toUpperCase();
  }

  // Multiple words: take first character of first two words
  return (words[0][0] + (words[1]?.[0] || '')).toUpperCase();
}

// ============================================================================
// Permissions
// ============================================================================

/**
 * Session interface for permission checks
 */
interface Session {
  user?: {
    tenants?: string[];
    role?: TenantRole;
    roles?: string[];
  };
}

/**
 * Checks if a user has access to a tenant (regardless of role).
 *
 * @param session - The user's session
 * @param tenantId - The tenant ID to check
 * @returns Whether the user has access to the tenant
 */
export function hasTenantAccess(session: Session | null, tenantId: string): boolean {
  if (!session?.user?.tenants) return false;
  return session.user.tenants.includes(tenantId);
}

// ============================================================================
// Color Contrast
// ============================================================================

/**
 * Calculates the relative luminance of a color.
 *
 * @param hexColor - Hex color string (e.g., '#3B82F6')
 * @returns Relative luminance value (0-1)
 */
function getRelativeLuminance(hexColor: string): number {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Calculates the contrast ratio between two colors.
 *
 * @param color1 - First hex color
 * @param color2 - Second hex color
 * @returns Contrast ratio (1-21)
 */
export function getContrastRatio(color1: string, color2: string): number {
  const lum1 = getRelativeLuminance(color1);
  const lum2 = getRelativeLuminance(color2);
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Validates that a foreground color has sufficient contrast against a background
 * according to WCAG 2.1 AA standards.
 *
 * @param foreground - Foreground hex color
 * @param background - Background hex color
 * @param level - WCAG level ('AA' requires 4.5:1, 'AAA' requires 7:1)
 * @returns Whether the contrast meets the specified WCAG level
 *
 * @example
 * ensureColorContrast('#FFFFFF', '#3B82F6', 'AA') // Returns true (ratio > 4.5)
 */
export function ensureColorContrast(
  foreground: string,
  background: string,
  level: 'AA' | 'AAA' = 'AA'
): boolean {
  const ratio = getContrastRatio(foreground, background);
  const minRatio = level === 'AAA' ? 7 : 4.5;
  return ratio >= minRatio;
}

/**
 * Returns a text color (black or white) that provides the best contrast
 * against the given background color.
 *
 * @param backgroundColor - The background color to contrast against
 * @returns '#000000' or '#FFFFFF' for optimal readability
 */
export function getContrastingTextColor(backgroundColor: string): string {
  const luminance = getRelativeLuminance(backgroundColor);
  return luminance > 0.179 ? '#000000' : '#FFFFFF';
}

// ============================================================================
// URL Helpers
// ============================================================================

/**
 * Generates a tenant-scoped URL path.
 *
 * @param basePath - The base path (e.g., '/missions')
 * @param tenantId - The tenant ID to scope to
 * @returns Tenant-scoped path (e.g., '/t/acme-corp/missions')
 */
export function getTenantScopedPath(basePath: string, tenantId: string): string {
  const cleanPath = basePath.startsWith('/') ? basePath : `/${basePath}`;
  return `/t/${tenantId}${cleanPath}`;
}

/**
 * Extracts tenant ID from a tenant-scoped URL path.
 *
 * @param path - The URL path (e.g., '/t/acme-corp/missions')
 * @returns The tenant ID or null if not a tenant-scoped path
 */
export function extractTenantFromPath(path: string): string | null {
  const match = path.match(/^\/t\/([^/]+)/);
  return match ? match[1] : null;
}
