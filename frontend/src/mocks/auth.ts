import type { User } from '@/lib/types';

export const mockUsers: User[] = [
  {
    id: '1',
    username: 'root',
    role: 'admin',
    mustChangePassword: false,
    active: true,
    createdAt: '2025-09-01T00:00:00Z',
  },
  {
    id: '2',
    username: 'sylvex',
    role: 'admin',
    mustChangePassword: false,
    active: true,
    createdAt: '2025-09-02T00:00:00Z',
  },
  {
    id: '3',
    username: 'sparky',
    role: 'user',
    mustChangePassword: false,
    active: true,
    createdAt: '2025-09-15T00:00:00Z',
  },
  {
    id: '4',
    username: 'frosty',
    role: 'user',
    mustChangePassword: true,
    active: true,
    createdAt: '2026-03-20T00:00:00Z',
  },
  {
    id: '5',
    username: 'blaze',
    role: 'user',
    mustChangePassword: false,
    active: true,
    createdAt: '2025-10-01T00:00:00Z',
  },
  {
    id: '6',
    username: 'aqua',
    role: 'user',
    mustChangePassword: false,
    active: false,
    createdAt: '2025-09-10T00:00:00Z',
  },
];

/** Mock passwords — in real app this is server-side only */
export const mockPasswords: Record<string, string> = {
  root: 'root',
  sylvex: 'password',
  sparky: 'password',
  frosty: 'password',
  blaze: 'password',
  aqua: 'password',
};

/** Default user to be "logged in" during development */
export const mockCurrentUser = mockUsers[1]; // sylvex (admin)
