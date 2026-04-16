/**
 * Invitation Validators
 *
 * Validation utilities for invitation-related inputs.
 * Includes token, email, expiration, and bulk invitation validation.
 */

import { validateEmail, validateRoles } from './user-validators';

/**
 * Validation result type.
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Invitation token constraints.
 */
const TOKEN_MIN_LENGTH = 32;
const TOKEN_MAX_LENGTH = 128;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Expiration constraints.
 */
const MIN_EXPIRATION_HOURS = 1;
const MAX_EXPIRATION_DAYS = 30;
const DEFAULT_EXPIRATION_DAYS = 7;

/**
 * Bulk invitation constraints.
 */
const MAX_BULK_INVITATIONS = 50;

/**
 * Validate invitation token.
 */
export function validateInvitationToken(token: string): ValidationResult {
  if (!token) {
    return { valid: false, error: 'Invitation token is required' };
  }

  const trimmed = token.trim();

  if (trimmed.length < TOKEN_MIN_LENGTH) {
    return { valid: false, error: 'Invalid invitation token' };
  }

  if (trimmed.length > TOKEN_MAX_LENGTH) {
    return { valid: false, error: 'Invalid invitation token' };
  }

  if (!TOKEN_PATTERN.test(trimmed)) {
    return { valid: false, error: 'Invalid invitation token format' };
  }

  return { valid: true };
}

/**
 * Validate invitation expiration date.
 */
export function validateExpiration(expiresAt: string | Date): ValidationResult {
  if (!expiresAt) {
    return { valid: false, error: 'Expiration date is required' };
  }

  const expirationDate = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;

  if (isNaN(expirationDate.getTime())) {
    return { valid: false, error: 'Invalid expiration date' };
  }

  const now = new Date();

  // Check if already expired
  if (expirationDate <= now) {
    return { valid: false, error: 'Invitation has expired' };
  }

  // Check if within acceptable range
  const maxExpiration = new Date();
  maxExpiration.setDate(maxExpiration.getDate() + MAX_EXPIRATION_DAYS);

  if (expirationDate > maxExpiration) {
    return { valid: false, error: `Expiration cannot exceed ${MAX_EXPIRATION_DAYS} days` };
  }

  return { valid: true };
}

/**
 * Calculate expiration date from days.
 */
export function calculateExpiration(days: number = DEFAULT_EXPIRATION_DAYS): Date {
  const expiration = new Date();
  expiration.setDate(expiration.getDate() + Math.min(days, MAX_EXPIRATION_DAYS));
  return expiration;
}

/**
 * Validate invitation message.
 */
export function validateInvitationMessage(message: string): ValidationResult {
  if (!message) {
    return { valid: true }; // Message is optional
  }

  const trimmed = message.trim();

  if (trimmed.length > 500) {
    return { valid: false, error: 'Message must be 500 characters or less' };
  }

  // Check for potentially malicious content
  const xssPattern = /<[^>]*>|javascript:|on\w+=/gi;
  if (xssPattern.test(trimmed)) {
    return { valid: false, error: 'Message contains invalid characters' };
  }

  return { valid: true };
}

/**
 * Validate single invitation request.
 */
export function validateInvitationRequest(data: {
  email: string;
  roles: string[];
  message?: string;
  expiresInDays?: number;
}): ValidationResult {
  // Validate email
  const emailResult = validateEmail(data.email);
  if (!emailResult.valid) {
    return emailResult;
  }

  // Validate roles
  const rolesResult = validateRoles(data.roles);
  if (!rolesResult.valid) {
    return rolesResult;
  }

  // Validate message
  if (data.message !== undefined) {
    const messageResult = validateInvitationMessage(data.message);
    if (!messageResult.valid) {
      return messageResult;
    }
  }

  // Validate expiration days
  if (data.expiresInDays !== undefined) {
    if (typeof data.expiresInDays !== 'number' || data.expiresInDays < 1) {
      return { valid: false, error: 'Expiration must be at least 1 day' };
    }
    if (data.expiresInDays > MAX_EXPIRATION_DAYS) {
      return { valid: false, error: `Expiration cannot exceed ${MAX_EXPIRATION_DAYS} days` };
    }
  }

  return { valid: true };
}

/**
 * Validate bulk invitation request.
 */
export function validateBulkInvitationRequest(data: {
  emails: string[];
  roles: string[];
  message?: string;
  expiresInDays?: number;
}): ValidationResult {
  // Validate emails array
  if (!Array.isArray(data.emails)) {
    return { valid: false, error: 'Emails must be an array' };
  }

  if (data.emails.length === 0) {
    return { valid: false, error: 'At least one email is required' };
  }

  if (data.emails.length > MAX_BULK_INVITATIONS) {
    return { valid: false, error: `Cannot invite more than ${MAX_BULK_INVITATIONS} users at once` };
  }

  // Validate each email
  const invalidEmails: string[] = [];
  const seenEmails = new Set<string>();

  for (const email of data.emails) {
    const normalized = email.trim().toLowerCase();

    // Check for duplicates
    if (seenEmails.has(normalized)) {
      return { valid: false, error: `Duplicate email: ${email}` };
    }
    seenEmails.add(normalized);

    // Validate format
    const result = validateEmail(email);
    if (!result.valid) {
      invalidEmails.push(email);
    }
  }

  if (invalidEmails.length > 0) {
    if (invalidEmails.length === 1) {
      return { valid: false, error: `Invalid email: ${invalidEmails[0]}` };
    }
    return { valid: false, error: `${invalidEmails.length} invalid emails` };
  }

  // Validate roles
  const rolesResult = validateRoles(data.roles);
  if (!rolesResult.valid) {
    return rolesResult;
  }

  // Validate message
  if (data.message !== undefined) {
    const messageResult = validateInvitationMessage(data.message);
    if (!messageResult.valid) {
      return messageResult;
    }
  }

  // Validate expiration days
  if (data.expiresInDays !== undefined) {
    if (typeof data.expiresInDays !== 'number' || data.expiresInDays < 1) {
      return { valid: false, error: 'Expiration must be at least 1 day' };
    }
    if (data.expiresInDays > MAX_EXPIRATION_DAYS) {
      return { valid: false, error: `Expiration cannot exceed ${MAX_EXPIRATION_DAYS} days` };
    }
  }

  return { valid: true };
}

/**
 * Check if invitation is expired.
 */
export function isInvitationExpired(expiresAt: string | Date): boolean {
  const expirationDate = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  return expirationDate <= new Date();
}

/**
 * Get time remaining until expiration.
 */
export function getTimeRemaining(expiresAt: string | Date): {
  expired: boolean;
  days: number;
  hours: number;
  minutes: number;
  display: string;
} {
  const expirationDate = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  const now = new Date();
  const diff = expirationDate.getTime() - now.getTime();

  if (diff <= 0) {
    return {
      expired: true,
      days: 0,
      hours: 0,
      minutes: 0,
      display: 'Expired',
    };
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  let display: string;
  if (days > 0) {
    display = `${days}d ${hours}h remaining`;
  } else if (hours > 0) {
    display = `${hours}h ${minutes}m remaining`;
  } else {
    display = `${minutes}m remaining`;
  }

  return { expired: false, days, hours, minutes, display };
}

/**
 * Validate invitation acceptance request.
 */
export function validateAcceptanceRequest(data: {
  token: string;
  displayName?: string;
}): ValidationResult {
  // Validate token
  const tokenResult = validateInvitationToken(data.token);
  if (!tokenResult.valid) {
    return tokenResult;
  }

  // Validate display name if provided
  if (data.displayName !== undefined && data.displayName.trim()) {
    if (data.displayName.length > 100) {
      return { valid: false, error: 'Display name must be 100 characters or less' };
    }

    // Check for XSS
    const xssPattern = /<[^>]*>|javascript:|on\w+=/gi;
    if (xssPattern.test(data.displayName)) {
      return { valid: false, error: 'Display name contains invalid characters' };
    }
  }

  return { valid: true };
}

/**
 * Validate revocation reason.
 */
export function validateRevocationReason(reason: string): ValidationResult {
  if (!reason) {
    return { valid: true }; // Reason is optional
  }

  const trimmed = reason.trim();

  if (trimmed.length > 200) {
    return { valid: false, error: 'Reason must be 200 characters or less' };
  }

  return { valid: true };
}

/**
 * Parse emails from comma/semicolon/newline separated string.
 */
export function parseEmailList(input: string): {
  valid: string[];
  invalid: string[];
} {
  const emails = input
    .split(/[,;\n]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);

  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const email of emails) {
    if (seen.has(email)) continue; // Skip duplicates
    seen.add(email);

    const result = validateEmail(email);
    if (result.valid) {
      valid.push(email);
    } else {
      invalid.push(email);
    }
  }

  return { valid, invalid };
}
