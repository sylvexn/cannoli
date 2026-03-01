/**
 * Pokemon Showdown login server endpoints.
 *
 * These endpoints implement the PS login protocol so our Elysia backend
 * can serve as the login server for a private PS game server.
 *
 * The PS client/game server expects responses prefixed with `]` before JSON.
 * This is a PS protocol quirk to prevent JSONP-style attacks.
 */
import { Elysia } from 'elysia';
import {
  authenticateUser, signAssertion, toUserid,
  createPsSession, validatePsSid, destroyPsSession, parsePsSid,
  psSidCookieString, clearPsSidCookieString, getKeyId,
} from '../lib/ps-login';

/** PS responses are prefixed with `]` before JSON */
function psJson(data: object): string {
  return ']' + JSON.stringify(data);
}

/** Build a text/plain response with optional Set-Cookie */
function psResponse(body: string, cookie?: string): Response {
  const headers: Record<string, string> = { 'Content-Type': 'text/plain' };
  if (cookie) headers['Set-Cookie'] = cookie;
  return new Response(body, { headers });
}

export const psLoginRoutes = new Elysia()

  /**
   * POST /api/ps/login — Authenticate and return assertion.
   *
   * PS client sends: name, pass, challstr (as form-urlencoded or JSON)
   * Returns: ]{actionsuccess, assertion, curuser}
   */
  .post('/api/ps/login', ({ body, request }) => {
    const { name, pass, challstr } = body as { name?: string; pass?: string; challstr?: string };

    if (!name || !pass || !challstr) {
      return psResponse(psJson({ actionsuccess: false, assertion: false }));
    }

    const user = authenticateUser(name, pass);
    if (!user) {
      return psResponse(psJson({ actionsuccess: false, assertion: false }));
    }

    const userid = toUserid(name);
    const assertion = signAssertion(challstr, userid);
    if (!assertion) {
      return psResponse(psJson({ actionsuccess: false, assertion: false }));
    }

    // Create PS session + set sid cookie
    const ip = request.headers.get('x-forwarded-for') || '127.0.0.1';
    const { sidCookie } = createPsSession(name, ip);

    return psResponse(
      psJson({
        actionsuccess: true,
        assertion,
        curuser: { loggedin: true, username: user.username, userid },
      }),
      psSidCookieString(sidCookie),
    );
  })

  /**
   * GET/POST /api/ps/upkeep — Session check + assertion renewal.
   *
   * PS client calls this on page load with the sid cookie.
   * If valid, returns a new assertion (without needing password).
   */
  .all('/api/ps/upkeep', ({ request }) => {
    const cookieHeader = request.headers.get('cookie') ?? undefined;
    const sidValue = parsePsSid(cookieHeader);

    const url = new URL(request.url);
    const challstr = url.searchParams.get('challstr');

    if (!sidValue) {
      return psResponse(psJson({ loggedin: false, username: '' }));
    }

    const userid = validatePsSid(sidValue);
    if (!userid) {
      return psResponse(
        psJson({ loggedin: false, username: '' }),
        clearPsSidCookieString(),
      );
    }

    let assertion: string | undefined;
    if (challstr) {
      const signed = signAssertion(challstr, userid);
      if (signed) assertion = signed;
    }

    return psResponse(psJson({
      loggedin: true,
      username: userid,
      ...(assertion ? { assertion } : {}),
    }));
  })

  /**
   * POST /api/ps/getassertion — Get assertion for an existing session.
   *
   * Returns a raw assertion string (not JSON-wrapped).
   */
  .all('/api/ps/getassertion', ({ request }) => {
    const url = new URL(request.url);
    const userid = url.searchParams.get('userid');
    const challstr = url.searchParams.get('challstr');

    if (!userid || !challstr) {
      return psResponse(';;Pokemon Showdown requires authentication');
    }

    const cookieHeader = request.headers.get('cookie') ?? undefined;
    const sidValue = parsePsSid(cookieHeader);

    if (!sidValue) {
      return psResponse(';;Session cookie not found');
    }

    const sessionUserid = validatePsSid(sidValue);
    if (!sessionUserid || sessionUserid !== toUserid(userid)) {
      return psResponse(';;Session invalid or userid mismatch');
    }

    const assertion = signAssertion(challstr, sessionUserid);
    if (!assertion) {
      return psResponse(';;Failed to sign assertion');
    }

    return psResponse(assertion);
  })

  /**
   * POST /api/ps/logout — Destroy PS session.
   */
  .post('/api/ps/logout', ({ request }) => {
    const cookieHeader = request.headers.get('cookie') ?? undefined;
    const sidValue = parsePsSid(cookieHeader);
    if (sidValue) destroyPsSession(sidValue);

    return psResponse(
      psJson({ actionsuccess: true }),
      clearPsSidCookieString(),
    );
  })

  /**
   * GET /api/ps/key — Public key info for game server config.
   */
  .get('/api/ps/key', () => ({
    keyId: getKeyId(),
    note: 'Set PS_RSA_PUBLIC_KEY env var on the game server. This endpoint is for reference only.',
  }));
