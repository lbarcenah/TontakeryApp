import {
  BadRequestException,
  NotFoundException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { DataSource } from 'typeorm';
import { Request, Response } from 'express';
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
export function cookie(req: Request, name: string) {
  return (
    (req.headers.cookie || '')
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(name + '='))
      ?.slice(name.length + 1) || ''
  );
}
export type AuthRequest = Request & {
  userId: string;
  csrf: string;
  sessionExpiry: Date;
};
@Injectable()
export class AuthService {
  readonly origin = process.env.APP_ORIGIN || 'http://localhost:4200';
  private readonly production = process.env.NODE_ENV === 'production';
  private readonly google = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${this.origin}/api/auth/google/callback`,
  );
  constructor(private db: DataSource) {}
  private options(maxAge: number) {
    return {
      httpOnly: true,
      secure: this.production,
      sameSite: 'lax' as const,
      path: '/',
      maxAge,
    };
  }
  get trialEnabled() {
    return (
      ['development', 'test'].includes(process.env.NODE_ENV || '') &&
      process.env.ENABLE_TRIAL_LOGIN === 'true'
    );
  }
  allowedOrigin(origin: string | undefined) {
    const extra = this.trialEnabled
      ? (process.env.DEV_ALLOWED_ORIGINS || '')
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      : [];
    return !!origin && [this.origin, ...extra].includes(origin);
  }
  async trial(email: string, req: Request, res: Response) {
    if (!this.trialEnabled) throw new NotFoundException();
    if (!this.allowedOrigin(req.headers.origin))
      throw new ForbiddenException('INVALID_CSRF');
    email = email.trim().toLowerCase();
    if (!email.endsWith('@vicomtech.org'))
      throw new BadRequestException('CORPORATE_EMAIL_REQUIRED');
    const token = secret(),
      csrf = secret();
    await this.db.transaction(async (q) => {
      // Separate identity namespace: never impersonate or merge a verified Google account.
      const [user] = await q.query(
        'INSERT INTO tk_users(id,google_sub,email,name) VALUES($1,$2,$3,$4) ON CONFLICT(google_sub) DO UPDATE SET email=EXCLUDED.email RETURNING id',
        [
          randomUUID(),
          'trial:' + email,
          email,
          email.split('@')[0] + ' (prueba)',
        ],
      );
      await q.query(
        'DELETE FROM tk_sessions WHERE token_hash=$1 OR expires_at<clock_timestamp()',
        [hash(cookie(req, 'tk_session'))],
      );
      await q.query(
        "INSERT INTO tk_sessions VALUES($1,$2,$3,clock_timestamp()+interval '8 hours')",
        [hash(token), user.id, csrf],
      );
    });
    res.cookie('tk_session', token, this.options(8 * 3600000));
    res.json({ ok: true });
  }
  async start(res: Response) {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
      return res.redirect('/?authError=config');
    const state = secret(),
      nonce = secret(),
      verifier = secret();
    await this.db.query(
      'DELETE FROM tk_oauth WHERE expires_at < clock_timestamp()',
    );
    await this.db.query(
      "INSERT INTO tk_oauth VALUES($1,$2,$3,clock_timestamp()+interval '10 minutes')",
      [hash(state), nonce, verifier],
    );
    res.cookie('tk_oauth', state, this.options(600000));
    res.redirect(
      this.google.generateAuthUrl({
        scope: ['openid', 'email', 'profile'],
        state,
        nonce,
        hd: 'vicomtech.org',
        prompt: 'select_account',
        code_challenge: createHash('sha256')
          .update(verifier)
          .digest('base64url'),
        code_challenge_method: 'S256' as any,
      }),
    );
  }
  async callback(req: Request, res: Response) {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    res.clearCookie('tk_oauth', this.options(0));
    try {
      if (
        !state ||
        state !== cookie(req, 'tk_oauth') ||
        typeof req.query.code !== 'string'
      )
        throw new Error();
      const [attempt] = await this.db.query(
        'DELETE FROM tk_oauth WHERE state_hash=$1 AND expires_at>clock_timestamp() RETURNING *',
        [hash(state)],
      );
      // TypeORM PostgreSQL returns [rows, affected] for DELETE RETURNING.
      const flow = Array.isArray(attempt) ? attempt[0] : attempt;
      if (!flow) throw new Error();
      const { tokens } = await this.google.getToken({
        code: req.query.code,
        codeVerifier: flow.verifier,
      });
      const ticket = await this.google.verifyIdToken({
        idToken: tokens.id_token!,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const p = ticket.getPayload();
      if (
        !p ||
        p.nonce !== flow.nonce ||
        !p.email_verified ||
        p.hd !== 'vicomtech.org' ||
        !p.email?.toLowerCase().endsWith('@vicomtech.org')
      )
        throw new Error();
      const token = secret(),
        csrf = secret();
      await this.db.transaction(async (q) => {
        const [user] = await q.query(
          'INSERT INTO tk_users(id,google_sub,email,name) VALUES($1,$2,$3,$4) ON CONFLICT(google_sub) DO UPDATE SET email=EXCLUDED.email,name=EXCLUDED.name RETURNING id',
          [randomUUID(), p.sub, p.email, p.name || p.email.split('@')[0]],
        );
        await q.query(
          'DELETE FROM tk_sessions WHERE token_hash=$1 OR expires_at<clock_timestamp()',
          [hash(cookie(req, 'tk_session'))],
        );
        await q.query(
          "INSERT INTO tk_sessions VALUES($1,$2,$3,clock_timestamp()+interval '7 days')",
          [hash(token), user.id, csrf],
        );
      });
      res.cookie('tk_session', token, this.options(7 * 86400000));
      res.redirect('/');
    } catch {
      res.redirect('/?authError=1');
    }
  }
  async authenticate(req: AuthRequest) {
    const [s] = await this.db.query(
      'SELECT s.user_id,s.csrf,s.expires_at,u.google_sub FROM tk_sessions s JOIN tk_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>clock_timestamp()',
      [hash(cookie(req, 'tk_session'))],
    );
    if (!s || (s.google_sub.startsWith('trial:') && !this.trialEnabled))
      throw new UnauthorizedException('SESSION_EXPIRED');
    req.userId = s.user_id;
    req.csrf = s.csrf;
    req.sessionExpiry = s.expires_at;
  }
  async me(req: AuthRequest) {
    const [u] = await this.db.query(
      'SELECT name,email FROM tk_users WHERE id=$1',
      [req.userId],
    );
    return { ...u, csrf: req.csrf };
  }
  async logout(req: Request, res: Response) {
    await this.db.query('DELETE FROM tk_sessions WHERE token_hash=$1', [
      hash(cookie(req, 'tk_session')),
    ]);
    res.clearCookie('tk_session', this.options(0));
    res.json({ ok: true });
  }
}
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private auth: AuthService) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    await this.auth.authenticate(req);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (
        !this.auth.allowedOrigin(req.headers.origin) ||
        req.headers['x-csrf-token'] !== req.csrf
      )
        throw new ForbiddenException('INVALID_CSRF');
    }
    return true;
  }
}
