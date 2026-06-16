import { Elysia } from 'elysia';
import { parseSessionToken, validateSession } from '../lib/auth';

export interface AuthUser {
  id: string;
  username: string;
  role: 'dev' | 'admin' | 'user' | 'bot';
  mustChangePassword: boolean;
  active: boolean;
  createdAt: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  tertiaryColor?: string | null;
  displayName?: string | null;
  bio?: string | null;
  avatarPath?: string | null;
}

export const authPlugin = new Elysia({ name: 'auth' })
  .derive(({ request }) => {
    const cookieHeader = request.headers.get('cookie') ?? undefined;
    const token = parseSessionToken(cookieHeader);
    const user = token ? validateSession(token) : null;
    return { user: user as AuthUser | null, sessionToken: token };
  });
