import type { Role } from './profile';

/**
 * Every privileged action in the app. Screens and UI pieces check capabilities
 * through `can()` instead of comparing role strings inline, so access rules live
 * in one place.
 */
export type Capability =
  | 'view_events'
  | 'browse_events'
  | 'scan_attendance'
  | 'manage_own_events'
  | 'manage_all_events'
  | 'manage_users'
  | 'correct_attendance'
  | 'view_reports';

const MATRIX: Record<Capability, Role[]> = {
  view_events: ['student', 'teacher', 'admin'],
  browse_events: ['student'],
  scan_attendance: ['student'],
  manage_own_events: ['teacher'],
  manage_all_events: ['admin'],
  manage_users: ['admin'],
  correct_attendance: ['admin'],
  view_reports: ['admin'],
};

export function can(role: Role | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return MATRIX[capability].includes(role);
}

/** Human-readable description of each profile, used on the Profile screen. */
export const ROLE_INFO: Record<
  Role,
  {
    title: string;
    tagline: string;
    accent: string;
    privileges: string[];
  }
> = {
  student: {
    title: 'Student Profile',
    tagline: 'Scan event QR codes and keep track of your attendance.',
    accent: '#4A90D9',
    privileges: [
      'View available events',
      'Scan an event QR code to record attendance',
      'View your personal attendance history',
      'Edit your display name',
    ],
  },
  teacher: {
    title: 'Teacher Profile',
    tagline: 'Create events and monitor who attended.',
    accent: '#2E7D5B',
    privileges: [
      'Create, edit and delete your events',
      'Generate and display event QR codes',
      'Monitor live attendance records',
      'View per-event attendance summaries',
    ],
  },
  admin: {
    title: 'Administrator Profile',
    tagline: 'Oversee users, events and attendance across the system.',
    accent: '#8E44AD',
    privileges: [
      'Manage users and assign roles',
      'Manage every event in the system',
      'View overall attendance and reports',
      'Correct or delete attendance records',
    ],
  },
};

export const ROLE_ORDER: Role[] = ['student', 'teacher', 'admin'];
