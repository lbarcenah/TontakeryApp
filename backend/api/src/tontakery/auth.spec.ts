import { AuthService, hash } from './auth.service';
describe('Google corporate sign-in', () => {
  const good = {
    sub: 'google-id',
    nonce: 'nonce',
    email: 'test@vicomtech.org',
    email_verified: true,
    hd: 'vicomtech.org',
    name: 'Test',
  };
  function setup(payload: any = good) {
    const q = jest.fn().mockResolvedValue([{ id: 'user' }]);
    const db = {
      query: jest
        .fn()
        .mockResolvedValue([[{ nonce: 'nonce', verifier: 'verifier' }], 1]),
      transaction: jest.fn(async (fn) => fn({ query: q })),
    };
    const auth = new AuthService(db as any);
    const google = {
      getToken: jest
        .fn()
        .mockResolvedValue({ tokens: { id_token: 'signed-token' } }),
      verifyIdToken: jest.fn().mockResolvedValue({ getPayload: () => payload }),
    };
    (auth as any).google = google;
    const res = {
      clearCookie: jest.fn(),
      cookie: jest.fn(),
      redirect: jest.fn(),
    };
    const req = {
      query: { state: 'state', code: 'code' },
      headers: { cookie: 'tk_oauth=state' },
    };
    return { auth, db, google, res, req, q };
  }
  test('valid signed corporate account establishes a session', async () => {
    const { auth, db, res, req, google } = setup();
    await auth.callback(req as any, res as any);
    expect(google.verifyIdToken).toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM tk_oauth'),
      [hash('state')],
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'tk_session',
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    );
    expect(res.redirect).toHaveBeenCalledWith('/');
  });
  test.each([
    { ...good, hd: 'gmail.com' },
    { ...good, hd: undefined },
    { ...good, email: 'test@gmail.com' },
    { ...good, email_verified: false },
    { ...good, nonce: 'bad' },
  ])(
    'rejects noncorporate/unverified/replayed identity %#',
    async (payload) => {
      const { auth, res, req, db } = setup(payload);
      await auth.callback(req as any, res as any);
      expect(db.transaction).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/?authError=1');
    },
  );
  test('invalid state never exchanges an authorization code', async () => {
    const { auth, res, req, google } = setup();
    req.query.state = 'wrong';
    await auth.callback(req as any, res as any);
    expect(google.getToken).not.toHaveBeenCalled();
  });
  test('bad signature/audience/expiry verification cannot establish a session', async () => {
    const { auth, res, req, google, db } = setup();
    google.verifyIdToken.mockRejectedValue(new Error('Invalid token'));
    await auth.callback(req as any, res as any);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/?authError=1');
  });
});

describe('temporary trial login', () => {
  const oldEnv = { ...process.env };
  afterEach(() => { process.env = { ...oldEnv }; });
  function setup() {
    const query = jest.fn().mockResolvedValue([{ id: 'trial-user' }]);
    const db = { transaction: jest.fn(async fn => fn({ query })), query: jest.fn() };
    const auth = new AuthService(db as any);
    const req = { headers: { origin: 'http://192.168.150.109:4200' } };
    const res = { cookie: jest.fn(), json: jest.fn() };
    return { auth, db, query, req, res };
  }
  function enable() {
    process.env.NODE_ENV = 'development';
    process.env.ENABLE_TRIAL_LOGIN = 'true';
    process.env.DEV_ALLOWED_ORIGINS = 'http://192.168.150.109:4200';
  }
  test('requires explicit opt-in and is always disabled in production', async () => {
    enable(); process.env.NODE_ENV = 'production';
    let x = setup();
    expect(x.auth.trialEnabled).toBe(false);
    await expect(x.auth.trial('person@vicomtech.org', x.req as any, x.res as any)).rejects.toThrow();
    expect(x.db.transaction).not.toHaveBeenCalled();
    process.env.NODE_ENV = 'development'; delete process.env.ENABLE_TRIAL_LOGIN;
    x = setup(); expect(x.auth.trialEnabled).toBe(false);
  });
  test('normalizes email and uses a separate identity namespace', async () => {
    enable(); const x = setup();
    await x.auth.trial(' Person@Vicomtech.org ', x.req as any, x.res as any);
    expect(x.query.mock.calls[0][1]).toEqual([expect.any(String), 'trial:person@vicomtech.org', 'person@vicomtech.org', 'person (prueba)']);
    expect(x.res.cookie).toHaveBeenCalledWith('tk_session',expect.any(String),expect.objectContaining({httpOnly:true}));
  });
  test('rejects foreign email and untrusted origins', async () => {
    enable(); const x = setup();
    await expect(x.auth.trial('person@gmail.com', x.req as any,x.res as any)).rejects.toThrow('CORPORATE_EMAIL_REQUIRED');
    x.req.headers.origin = 'https://evil.example';
    await expect(x.auth.trial('person@vicomtech.org',x.req as any,x.res as any)).rejects.toThrow('INVALID_CSRF');
    expect(x.db.transaction).not.toHaveBeenCalled();
  });
  test('disabling the feature invalidates existing trial sessions', async () => {
    enable(); const x = setup();
    x.db.query.mockResolvedValue([{user_id:'trial-user',csrf:'csrf',expires_at:new Date(Date.now()+10000),google_sub:'trial:person@vicomtech.org'}]);
    await expect(x.auth.authenticate(x.req as any)).resolves.toBeUndefined();
    process.env.ENABLE_TRIAL_LOGIN = 'false';
    await expect(x.auth.authenticate(x.req as any)).rejects.toThrow('SESSION_EXPIRED');
  });
});
