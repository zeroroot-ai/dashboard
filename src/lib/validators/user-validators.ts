/**
 * User Input Validators
 *
 * Validation utilities for user-related inputs.
 * Includes email, display name, avatar, and other user fields.
 */

/**
 * Validation result type.
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * RFC 5322 simplified email regex pattern.
 * Handles most common email formats.
 */
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/**
 * Display name constraints.
 */
const DISPLAY_NAME_MIN_LENGTH = 1;
const DISPLAY_NAME_MAX_LENGTH = 100;

/**
 * Avatar constraints.
 */
const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/**
 * XSS prevention pattern.
 * Matches potentially dangerous HTML/script patterns.
 */
const XSS_PATTERN = /<[^>]*>|javascript:|on\w+=/gi;

/**
 * Validate email address.
 */
export function validateEmail(email: string): ValidationResult {
  if (!email) {
    return { valid: false, error: 'Email is required' };
  }

  const trimmed = email.trim().toLowerCase();

  if (trimmed.length > 254) {
    return { valid: false, error: 'Email address is too long' };
  }

  if (!EMAIL_REGEX.test(trimmed)) {
    return { valid: false, error: 'Please enter a valid email address' };
  }

  // Check for common invalid patterns
  if (trimmed.includes('..')) {
    return { valid: false, error: 'Email address contains invalid characters' };
  }

  return { valid: true };
}

/**
 * Validate display name.
 */
export function validateDisplayName(name: string): ValidationResult {
  if (!name) {
    return { valid: false, error: 'Display name is required' };
  }

  const trimmed = name.trim();

  if (trimmed.length < DISPLAY_NAME_MIN_LENGTH) {
    return { valid: false, error: 'Display name is required' };
  }

  if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
    return { valid: false, error: `Display name must be ${DISPLAY_NAME_MAX_LENGTH} characters or less` };
  }

  // Check for XSS patterns
  if (XSS_PATTERN.test(trimmed)) {
    return { valid: false, error: 'Display name contains invalid characters' };
  }

  return { valid: true };
}

/**
 * Sanitize display name by removing potentially dangerous content.
 */
export function sanitizeDisplayName(name: string): string {
  return name
    .trim()
    .replace(XSS_PATTERN, '')
    .replace(/\s+/g, ' ')
    .slice(0, DISPLAY_NAME_MAX_LENGTH);
}

/**
 * Validate avatar URL or data URL.
 */
export function validateAvatarUrl(url: string): ValidationResult {
  if (!url) {
    return { valid: true }; // Avatar is optional
  }

  const trimmed = url.trim();

  // Check for data URL
  if (trimmed.startsWith('data:')) {
    // Validate data URL format
    const match = trimmed.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
    if (!match) {
      return { valid: false, error: 'Invalid avatar data format' };
    }

    const mimeType = match[1].toLowerCase();
    if (!ALLOWED_AVATAR_TYPES.includes(mimeType)) {
      return { valid: false, error: 'Avatar must be a JPEG, PNG, GIF, or WebP image' };
    }

    // Check approximate size (base64 is ~4/3 of binary size)
    const base64Data = match[2];
    const approximateSize = (base64Data.length * 3) / 4;
    if (approximateSize > MAX_AVATAR_SIZE_BYTES) {
      return { valid: false, error: 'Avatar image is too large (max 5MB)' };
    }

    return { valid: true };
  }

  // Check for HTTPS URL
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') {
      return { valid: false, error: 'Avatar URL must use HTTPS' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid avatar URL' };
  }
}

/**
 * Validate avatar file.
 */
export function validateAvatarFile(file: File): ValidationResult {
  if (!file) {
    return { valid: true }; // Avatar is optional
  }

  if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
    return { valid: false, error: 'Avatar must be a JPEG, PNG, GIF, or WebP image' };
  }

  if (file.size > MAX_AVATAR_SIZE_BYTES) {
    return { valid: false, error: 'Avatar image is too large (max 5MB)' };
  }

  return { valid: true };
}

/**
 * Validate user status.
 */
export function validateUserStatus(status: string): ValidationResult {
  const validStatuses = ['active', 'invited', 'suspended'];

  if (!validStatuses.includes(status)) {
    return { valid: false, error: 'Invalid user status' };
  }

  return { valid: true };
}

/**
 * Validate roles array.
 */
export function validateRoles(roles: string[]): ValidationResult {
  if (!Array.isArray(roles)) {
    return { valid: false, error: 'Roles must be an array' };
  }

  if (roles.length === 0) {
    return { valid: false, error: 'At least one role is required' };
  }

  // Check for valid role ID format (alphanumeric, hyphens, underscores)
  const roleIdPattern = /^[a-zA-Z0-9_-]+$/;
  for (const role of roles) {
    if (typeof role !== 'string' || !roleIdPattern.test(role)) {
      return { valid: false, error: `Invalid role ID: ${role}` };
    }
  }

  // Check for duplicates
  const uniqueRoles = new Set(roles);
  if (uniqueRoles.size !== roles.length) {
    return { valid: false, error: 'Duplicate roles are not allowed' };
  }

  return { valid: true };
}

/**
 * Validate timezone.
 */
export function validateTimezone(timezone: string): ValidationResult {
  if (!timezone) {
    return { valid: true }; // Timezone is optional
  }

  try {
    // Use Intl to validate timezone
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid timezone' };
  }
}

/**
 * Validate language code (ISO 639-1).
 */
export function validateLanguage(language: string): ValidationResult {
  if (!language) {
    return { valid: true }; // Language is optional
  }

  // ISO 639-1 two-letter codes
  const languagePattern = /^[a-z]{2}$/;
  if (!languagePattern.test(language.toLowerCase())) {
    return { valid: false, error: 'Invalid language code' };
  }

  return { valid: true };
}

/**
 * Validate password (if local auth is used).
 */
export function validatePassword(password: string): ValidationResult {
  if (!password) {
    return { valid: false, error: 'Password is required' };
  }

  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters' };
  }

  if (password.length > 128) {
    return { valid: false, error: 'Password is too long' };
  }

  // Check for complexity (at least one of each: lowercase, uppercase, number)
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);

  if (!hasLower || !hasUpper || !hasNumber) {
    return {
      valid: false,
      error: 'Password must contain lowercase, uppercase, and numbers',
    };
  }

  return { valid: true };
}

/**
 * Validate user ID format (UUID).
 */
export function validateUserId(userId: string): ValidationResult {
  if (!userId) {
    return { valid: false, error: 'User ID is required' };
  }

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(userId)) {
    return { valid: false, error: 'Invalid user ID format' };
  }

  return { valid: true };
}

/**
 * Composite validator for user profile updates.
 */
export function validateProfileUpdate(data: {
  displayName?: string;
  avatarUrl?: string;
  timezone?: string;
  language?: string;
}): ValidationResult {
  if (data.displayName !== undefined) {
    const result = validateDisplayName(data.displayName);
    if (!result.valid) return result;
  }

  if (data.avatarUrl !== undefined) {
    const result = validateAvatarUrl(data.avatarUrl);
    if (!result.valid) return result;
  }

  if (data.timezone !== undefined) {
    const result = validateTimezone(data.timezone);
    if (!result.valid) return result;
  }

  if (data.language !== undefined) {
    const result = validateLanguage(data.language);
    if (!result.valid) return result;
  }

  return { valid: true };
}
