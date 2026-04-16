/**
 * User Type Definitions
 * Core interfaces and types for user management and team administration
 */

// ============================================================================
// User Status
// ============================================================================

/**
 * Status of a user account in the system.
 */
export type UserStatus = 'active' | 'invited' | 'suspended';

/**
 * User status display configuration for UI.
 */
export const USER_STATUS_CONFIG: Record<UserStatus, {
  label: string;
  color: string;
  description: string;
}> = {
  active: {
    label: 'Active',
    color: 'green',
    description: 'User has full access to the system',
  },
  invited: {
    label: 'Invited',
    color: 'yellow',
    description: 'User has been invited but has not accepted yet',
  },
  suspended: {
    label: 'Suspended',
    color: 'red',
    description: 'User access has been temporarily disabled',
  },
};

// ============================================================================
// User Preferences
// ============================================================================

/**
 * Email notification preferences for a user.
 */
export interface EmailNotificationSettings {
  /** Notify when missions complete */
  missionCompletion: boolean;
  /** Alert on new findings (by severity threshold) */
  findingAlerts: boolean;
  /** Notify for team invitations */
  teamInvitations: boolean;
  /** Send weekly activity summary */
  weeklySummary: boolean;
  /** Delivery timing preference */
  deliveryTime: 'immediate' | 'daily' | 'weekly';
}

/**
 * In-app notification preferences for a user.
 */
export interface InAppNotificationSettings {
  /** Show notifications for mission status changes */
  missionStatusChanges: boolean;
  /** Show notifications for new findings */
  newFindings: boolean;
  /** Show notifications when mentioned */
  mentions: boolean;
}

/**
 * Complete user preferences.
 */
export interface UserPreferences {
  /** Email notification settings */
  emailNotifications: EmailNotificationSettings;
  /** In-app notification settings */
  inAppNotifications: InAppNotificationSettings;
  /** User's preferred timezone (IANA format, e.g., "America/New_York") */
  timezone?: string;
  /** User's preferred language (ISO 639-1 code, e.g., "en", "es") */
  language?: string;
}

/**
 * Default user preferences for new users.
 */
export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  emailNotifications: {
    missionCompletion: true,
    findingAlerts: true,
    teamInvitations: true,
    weeklySummary: true,
    deliveryTime: 'immediate',
  },
  inAppNotifications: {
    missionStatusChanges: true,
    newFindings: true,
    mentions: true,
  },
  timezone: undefined,
  language: undefined,
};

// ============================================================================
// Core User Entity
// ============================================================================

/**
 * Core user entity representing a user in the system.
 */
/**
 * Role reference object (used in some API responses).
 */
export interface RoleRef {
  id: string;
  name: string;
  displayName?: string;
}

export interface User {
  /** Unique user identifier (UUID) */
  id: string;
  /** RFC 5322 validated email address */
  email: string;
  /** User's display name */
  displayName: string;
  /** Avatar image URL or data URL */
  avatarUrl?: string | null;
  /** Organization/tenant ID the user belongs to */
  tenantId?: string;
  /** Array of assigned role IDs or role objects */
  roles: string[] | RoleRef[];
  /** OIDC 'sub' claim (if SSO user) */
  oidcSubject?: string;
  /** SSO provider name */
  ssoProvider?: string | null;
  /** Account status */
  status: UserStatus;
  /** When the user was created (ISO 8601 timestamp) */
  createdAt: string;
  /** When the user was last updated (ISO 8601 timestamp) */
  updatedAt?: string;
  /** When the user last logged in (ISO 8601 timestamp) */
  lastLoginAt?: string;
  /** When the user was last active (ISO 8601 timestamp) */
  lastActiveAt?: string;
  /** User ID of the person who invited this user */
  invitedBy?: string;
  /** Extensible metadata */
  metadata?: Record<string, unknown>;
  /** User preferences */
  preferences?: UserPreferences;
  /** Whether MFA is enabled */
  mfaEnabled?: boolean;
}

// ============================================================================
// User Profile
// ============================================================================

/**
 * User profile for display and self-service editing.
 * Excludes sensitive fields like OIDC subject and internal metadata.
 */
export interface UserProfile {
  /** User ID */
  id: string;
  /** Email address */
  email: string;
  /** Display name */
  displayName: string;
  /** Avatar URL */
  avatarUrl?: string | null;
  /** Tenant ID */
  tenantId?: string;
  /** Tenant display name for context */
  tenantName?: string;
  /** Assigned roles (IDs or role objects) */
  roles?: string[] | RoleRef[];
  /** Permission strings */
  permissions?: string[];
  /** Account status */
  status?: UserStatus;
  /** Account creation date */
  createdAt: string;
  /** Last login date */
  lastLoginAt?: string;
  /** Last password change date */
  lastPasswordChange?: string;
  /** Whether MFA is enabled */
  mfaEnabled?: boolean;
  /** Notification preferences (simple form) */
  notificationPreferences?: {
    email?: boolean;
    browser?: boolean;
    slack?: boolean;
  };
  /** User preferences */
  preferences?: UserPreferences;
}

/**
 * Data for updating user profile.
 */
export interface UpdateUserProfileRequest {
  /** New display name */
  displayName?: string;
  /** New avatar URL or base64 data URL */
  avatarUrl?: string;
  /** Updated preferences */
  preferences?: Partial<UserPreferences>;
  /** Simplified notification preferences */
  notificationPreferences?: {
    email?: boolean;
    browser?: boolean;
    slack?: boolean;
  };
}

// ============================================================================
// User Filter and Query Types
// ============================================================================

/**
 * Filters for querying users/team members.
 */
export interface UserFilter {
  /** Search by name or email */
  search?: string;
  /** Filter by status */
  status?: UserStatus;
  /** Filter by role ID */
  roleId?: string;
  /** Filter by tenant ID (for cross-tenant queries) */
  tenantId?: string;
  /** Filter by creation date range start */
  createdAfter?: string;
  /** Filter by creation date range end */
  createdBefore?: string;
  /** Filter by last login date range start */
  lastLoginAfter?: string;
  /** Filter by last login date range end */
  lastLoginBefore?: string;
}

/**
 * Sorting options for user queries.
 */
export interface UserSort {
  /** Field to sort by */
  field: 'displayName' | 'email' | 'createdAt' | 'lastLoginAt' | 'status';
  /** Sort direction */
  direction: 'asc' | 'desc';
}

/**
 * Pagination parameters for user queries.
 */
export interface UserPagination {
  /** Page number (1-based) */
  page: number;
  /** Items per page */
  limit: number;
}

/**
 * Complete query parameters for user listing.
 */
export interface UserQueryParams {
  /** Filters to apply */
  filters?: UserFilter;
  /** Sorting options */
  sort?: UserSort;
  /** Pagination */
  pagination: UserPagination;
}

// ============================================================================
// Team Member Types
// ============================================================================

/**
 * Team member representation with additional context.
 * Extends User with team-specific information.
 */
export interface TeamMember extends User {
  /** Role names (resolved from role IDs) */
  roleNames?: string[];
  /** When the user joined this tenant */
  joinedAt?: string;
  /** Who added this user to the tenant */
  addedBy?: string;
  /** Current online/active status */
  isOnline?: boolean;
  /** Recent activity count (missions run, findings viewed) */
  recentActivityCount?: number;
}

/**
 * Pagination info block returned in list responses.
 */
export interface UserPaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages?: number;
}

/**
 * Response for listing team members.
 */
export interface ListTeamMembersResponse {
  /** Team member list (canonical field) */
  members?: TeamMember[];
  /** Team member list (alias used by some API responses) */
  users?: TeamMember[];
  /** Total count matching filters */
  total?: number;
  /** Current page */
  page?: number;
  /** Items per page */
  limit?: number;
  /** Whether there are more results */
  hasMore?: boolean;
  /** Pagination info block */
  pagination?: UserPaginationInfo;
}

// ============================================================================
// User Activity Types
// ============================================================================

/**
 * Type of user activity event.
 */
export type UserActivityType =
  | 'login'
  | 'logout'
  | 'mission_started'
  | 'mission_completed'
  | 'finding_viewed'
  | 'finding_exported'
  | 'profile_updated'
  | 'role_changed'
  | 'api_key_created'
  | 'api_key_revoked'
  | 'session_revoked'
  | 'settings_change'
  | 'password_changed'
  | 'mfa_enabled'
  | 'mfa_disabled';

/**
 * User activity event record.
 */
export interface UserActivity {
  /** Activity event ID */
  id: string;
  /** User who performed the activity */
  userId?: string;
  /** Type of activity */
  type: UserActivityType;
  /** Human-readable description */
  description: string;
  /** When the activity occurred */
  timestamp: string;
  /** Additional activity-specific metadata */
  metadata: Record<string, unknown>;
  /** IP address (if available) */
  ipAddress?: string;
  /** User agent (if available) */
  userAgent?: string;
}

/**
 * Response for listing user activities.
 */
export interface ListUserActivitiesResponse {
  /** Activity events */
  activities: UserActivity[];
  /** Total count */
  total?: number;
  /** Current page */
  page?: number;
  /** Items per page */
  limit?: number;
  /** Whether there are more results */
  hasMore?: boolean;
  /** Pagination info block */
  pagination?: UserPaginationInfo;
}

// ============================================================================
// User Session Types
// ============================================================================

/**
 * Active user session information.
 */
export interface UserSession {
  /** Session ID (hashed token) */
  id: string;
  /** User ID */
  userId?: string;
  /** Device/browser information */
  deviceInfo: {
    /** Browser name and version */
    browser?: string;
    /** Operating system */
    os?: string;
    /** Device type (canonical) */
    deviceType?: 'desktop' | 'mobile' | 'tablet' | 'unknown';
    /** Device name (alias for deviceType) */
    device?: string;
  };
  /** IP address */
  ipAddress: string;
  /** Geographic location (if resolved) */
  location?: string | {
    city?: string;
    country?: string;
    countryCode?: string;
  };
  /** When the session was created */
  createdAt: string;
  /** When the session was last active */
  lastActiveAt: string;
  /** When the session expires */
  expiresAt?: string;
  /** Whether this is the current session */
  isCurrent: boolean;
}

/**
 * Response for listing user sessions.
 */
export interface ListUserSessionsResponse {
  /** Active sessions */
  sessions: UserSession[];
  /** Total count */
  total: number;
}

/**
 * Request to revoke a user session.
 */
export interface RevokeSessionRequest {
  /** Session ID to revoke */
  sessionId: string;
  /** User ID (for verification) */
  userId: string;
}

// ============================================================================
// User Management Actions
// ============================================================================

/**
 * Request to create a new user (admin only).
 */
export interface CreateUserRequest {
  /** Email address */
  email: string;
  /** Display name */
  displayName: string;
  /** Initial roles to assign */
  roles: string[];
  /** Optional welcome message */
  message?: string;
}

/**
 * Request to update a user (admin only).
 */
export interface UpdateUserRequest {
  /** User ID */
  userId: string;
  /** New display name */
  displayName?: string;
  /** New roles */
  roles?: string[];
  /** New status */
  status?: UserStatus;
}

/**
 * Request to suspend a user.
 */
export interface SuspendUserRequest {
  /** User ID to suspend */
  userId: string;
  /** Reason for suspension */
  reason: string;
}

/**
 * Request to reactivate a suspended user.
 */
export interface ReactivateUserRequest {
  /** User ID to reactivate */
  userId: string;
}

/**
 * Request to remove a user from the team.
 */
export interface RemoveUserRequest {
  /** User ID to remove */
  userId: string;
}
