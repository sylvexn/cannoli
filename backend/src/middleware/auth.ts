import { Elysia } from 'elysia';
import { parseSessionToken, validateSession } from '../lib/auth';

export interface AuthUser {
  id: string;
  username: string;
  role: 'dev' | 'admin' | 'user';
  mustChangePassword: boolean;
  active: boolean;
  createdAt: string | null;
}

export const authPlugin = new Elysia({ name: 'auth' })
  .derive(({ request }) => {
    const cookieHeader = request.headers.get('cookie') ?? undefined;
    const token = parseSessionToken(cookieHeader);
    const user = token ? validateSession(token) : null;
    return { user: user as AuthUser | null, sessionToken: token };
  });
