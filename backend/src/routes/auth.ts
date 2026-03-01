import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import {
  hashPassword, verifyPassword,
  createSession, deleteSession,
  sessionCookieString, clearSessionCookieString,
} from '../lib/auth';
import { createPsSession, psSidCookieString, clearPsSidCookieString } from '../lib/ps-login';

export const authRoutes = new Elysia()

  .post('/api/auth/login', async ({ body, request, set }) => {
    const { username, password } = body as { username: string; password: string };
    if (!username || !password) {
      set.status = 400;
      return { error: 'Username and password required' };
    }

    const user = db.select().from(schema.users)
      .where(eq(schema.users.username, username.toLowerCase().trim()))
      .get();

    if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
      set.status = 401;
      return { error: 'Invalid username or password' };
    }

    const token = createSession(user.id);

    // SSO bridge: also create a PS session so sim.cannoli.live auto-authenticates
    const ip = request.headers.get('x-forwarded-for') || '127.0.0.1';
    const { sidCookie } = createPsSession(user.username, ip);

    const headers = new Headers();
    headers.append('Content-Type', 'application/json');
    headers.append('Set-Cookie', sessionCookieString(token));
    headers.append('Set-Cookie', psSidCookieString(sidCookie));

    return new Response(JSON.stringify({
      user: {
        id: String(user.id),
        username: user.username,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
        active: user.active,
        createdAt: user.createdAt,
      },
    }), { headers });
  })

  .post('/api/auth/logout', ({ sessionToken }) => {
    if (sessionToken) deleteSession(sessionToken);

    const headers = new Headers();
    headers.append('Content-Type', 'application/json');
    headers.append('Set-Cookie', clearSessionCookieString());
    headers.append('Set-Cookie', clearPsSidCookieString());

    return new Response(JSON.stringify({ success: true }), { headers });
  })

  .get('/api/auth/me', ({ user, set }) => {
    if (!user) {
      set.status = 401;
      return { user: null };
    }
    return { user };
  })

  .post('/api/auth/change-password', ({ body, user, set }) => {
    const { currentPassword, newPassword } = body as { currentPassword: string; newPassword: string };

    if (!user) {
      set.status = 401;
      return { error: 'Not authenticated' };
    }
    if (!currentPassword || !newPassword) {
      set.status = 400;
      return { error: 'Current and new password required' };
    }
    if (newPassword.length < 4) {
      set.status = 400;
      return { error: 'Password must be at least 4 characters' };
    }

    const dbUser = db.select().from(schema.users)
      .where(eq(schema.users.id, parseInt(user.id)))
      .get();
    if (!dbUser || !verifyPassword(currentPassword, dbUser.passwordHash)) {
      set.status = 403;
      return { error: 'Current password is incorrect' };
    }

    db.update(schema.users)
      .set({ passwordHash: hashPassword(newPassword), mustChangePassword: false })
      .where(eq(schema.users.id, dbUser.id))
      .run();

    return { success: true };
  });
