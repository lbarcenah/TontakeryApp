import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import { ValidationPipe, INestApplication } from '@nestjs/common';
import request = require('supertest');
import { Tontakery1793200000000 } from './schema';
import { GameService } from './game.service';
import { Events } from './events';
import { AuthService, hash, SessionGuard } from './auth.service';
import { TontakeryController } from './controller';

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite('Tontakery against PostgreSQL', () => {
  let db: DataSource, game: GameService, events: Events, app: INestApplication;
  let clock: Date;
  let a: string, b: string, c: string;
  const schema = 'tk_test_' + randomUUID().replace(/-/g, '');
  beforeAll(async () => {
    const admin = new DataSource({
      type: 'postgres',
      url: process.env.TEST_DATABASE_URL,
    });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.destroy();
    db = new DataSource({
      type: 'postgres',
      url: process.env.TEST_DATABASE_URL,
      schema,
      extra: { options: `-c search_path=${schema}` },
      migrations: [Tontakery1793200000000],
    });
    await db.initialize();
    await db.runMigrations();
    const module = await Test.createTestingModule({
      controllers: [TontakeryController],
      providers: [
        { provide: DataSource, useValue: db },
        GameService,
        Events,
        AuthService,
        SessionGuard,
      ],
    }).compile();
    game = module.get(GameService);
    events = module.get(Events);
    clock = new Date('2026-01-01T10:00:00Z');
    jest.spyOn(game as any, 'now').mockImplementation(async () => clock);
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    game.onModuleDestroy();
  });
  afterAll(async () => {
    await app?.close();
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA ${schema} CASCADE`);
      await db.destroy();
    }
  });
  beforeEach(async () => {
    await db.query(
      'TRUNCATE tk_winners,tk_votes,tk_messages,tk_rounds,tk_sessions,tk_oauth,tk_users CASCADE',
    );
    clock = new Date('2026-01-01T10:00:00Z');
    [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    for (const [id, name] of [
      [a, 'Alice'],
      [b, 'Bob'],
      [c, 'Carol'],
    ])
      await db.query('INSERT INTO tk_users VALUES($1,$2,$3,$4)', [
        id,
        id,
        name.toLowerCase() + '@vicomtech.org',
        name,
      ]);
    await game.reconcile();
  });
  test('concurrent publishing cannot exceed the allowance', async () => {
    const r = await game.current(a);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        game.publish(a, r.id, 'Post ' + i, randomUUID()),
      ),
    );
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((await game.current(a)).remaining).toBe(0);
  });
  test('concurrent retries are idempotent and conflicting payloads are rejected', async () => {
    const r = await game.current(a),
      key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => game.publish(a, r.id, 'Hello', key)),
    );
    expect(new Set(results.map((x) => x.id)).size).toBe(1);
    expect((await game.current(a)).messages).toHaveLength(1);
    await expect(game.publish(a, r.id, 'Different', key)).rejects.toThrow(
      'IDEMPOTENCY_CONFLICT',
    );
  });
  test('votes can change, cannot target self and never leak counts or authors', async () => {
    const r = await game.current(a);
    const ma = await game.publish(a, r.id, 'A', randomUUID());
    const mb = await game.publish(b, r.id, 'B', randomUUID());
    await expect(game.vote(a, r.id, ma.id)).rejects.toThrow('OWN_VOTE');
    await game.vote(c, r.id, ma.id);
    await game.vote(c, r.id, mb.id);
    const state = await game.current(c);
    expect(state.voteId).toBe(mb.id);
    expect(state.messages[0]).toEqual({
      id: ma.id,
      body: 'A',
      createdAt: expect.any(Date),
      mine: false,
    });
    expect(await db.query('SELECT * FROM tk_votes')).toHaveLength(1);
    expect((await game.history(0)).items).toHaveLength(0);
  });
  test('all tied posts win, bonus is two and does not accumulate', async () => {
    const r = await game.current(a);
    const ma = await game.publish(a, r.id, 'A', randomUUID());
    const mb = await game.publish(b, r.id, 'B', randomUUID());
    await game.vote(a, r.id, mb.id);
    await game.vote(b, r.id, ma.id);
    clock = new Date(r.endsAt);
    await Promise.all([game.reconcile(), game.reconcile(), game.reconcile()]);
    const h = await game.history(0);
    expect(h.items).toHaveLength(1);
    expect(h.items[0].winners).toHaveLength(2);
    const next = await game.current(a);
    expect(next.remaining).toBe(2);
    expect((await game.current(b)).remaining).toBe(2);
    expect((await game.current(c)).remaining).toBe(1);
    await game.publish(a, next.id, 'First', randomUUID());
    await game.publish(a, next.id, 'Second', randomUUID());
    await expect(
      game.publish(a, next.id, 'Third', randomUUID()),
    ).rejects.toThrow('MESSAGE_LIMIT');
    clock = new Date(next.endsAt);
    await game.reconcile();
    expect((await game.current(a)).remaining).toBe(1);
  });
  test('one author winning twice gets two slots, snapshots survive a name change', async () => {
    const r = await game.current(a);
    const prior = randomUUID();
    await db.query(
      "INSERT INTO tk_rounds VALUES($1,$2::timestamptz-interval '1 day',$2,true)",
      [prior, r.startsAt],
    );
    const historicalMessage = randomUUID();
    await db.query(
      'INSERT INTO tk_messages(id,round_id,user_id,body,request_key) VALUES($1,$2,$3,$4,$5)',
      [historicalMessage, prior, a, 'Past', randomUUID()],
    );
    await db.query('INSERT INTO tk_winners VALUES($1,$2,$3,$4,$5,1)', [
      prior,
      historicalMessage,
      a,
      'Alice',
      'Past',
    ]);
    const m1 = await game.publish(a, r.id, 'One', randomUUID()),
      m2 = await game.publish(a, r.id, 'Two', randomUUID());
    await game.vote(b, r.id, m1.id);
    await game.vote(c, r.id, m2.id);
    clock = new Date(r.endsAt);
    await game.reconcile();
    await db.query("UPDATE tk_users SET name='Changed' WHERE id=$1", [a]);
    expect((await game.current(a)).remaining).toBe(2);
    const winners = (await game.history(0)).items[0].winners;
    expect(winners).toHaveLength(2);
    expect(winners.every((w) => w.authorName === 'Alice')).toBe(true);
  });
  test('empty and unvoted rounds have no winner; missed days are recovered once', async () => {
    const r = await game.current(a);
    await game.publish(a, r.id, 'Unvoted', randomUUID());
    clock = new Date('2026-01-04T10:00:00Z');
    await game.reconcile();
    await game.reconcile();
    const h = await game.history(0);
    expect(h.items).toHaveLength(3);
    expect(h.items.every((r) => r.winners.length === 0)).toBe(true);
    expect((await game.current(a)).remaining).toBe(1);
    const restarted = new GameService(db, events);
    jest.spyOn(restarted as any, 'now').mockImplementation(async () => clock);
    await restarted.reconcile();
    expect((await restarted.history(0)).items).toHaveLength(3);
  });
  test('deadline is checked after lock acquisition; late writes never move to a new round', async () => {
    const r = await game.current(a);
    const m = await game.publish(a, r.id, 'A', randomUUID());
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    await runner.query('SELECT pg_advisory_xact_lock(91827364)');
    const vote = game.vote(b, r.id, m.id);
    clock = new Date(r.endsAt);
    await runner.commitTransaction();
    await runner.release();
    await expect(vote).rejects.toThrow('ROUND_CLOSED');
    await expect(game.publish(b, r.id, 'Late', randomUUID())).rejects.toThrow(
      'ROUND_CLOSED',
    );
    expect((await game.history(0)).items[0].winners).toHaveLength(0);
  });
  test('private vote events only reach their user, public events carry no identifying data', async () => {
    const seenA: any[] = [],
      seenB: any[] = [];
    const sa = events.stream(a).subscribe((e) => seenA.push(e)),
      sb = events.stream(b).subscribe((e) => seenB.push(e));
    events.emit('personal', a);
    events.emit('message');
    expect(seenA).toEqual([
      { type: 'update', data: { kind: 'personal' } },
      { type: 'update', data: { kind: 'message' } },
    ]);
    expect(seenB).toEqual([{ type: 'update', data: { kind: 'message' } }]);
    sa.unsubscribe();
    sb.unsubscribe();
  });
  test('HTTP endpoints enforce session and CSRF, validate DTOs and disable legacy endpoints', async () => {
    const token = randomUUID(),
      csrf = randomUUID();
    await db.query(
      "INSERT INTO tk_sessions VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')",
      [hash(token), a, csrf],
    );
    const http = request(app.getHttpServer());
    await http.get('/api/rounds/current').expect(401);
    await http.get('/api/events').expect(401);
    const auth = {
      Cookie: 'tk_session=' + token,
      Origin: 'http://localhost:4200',
      'X-CSRF-Token': csrf,
    };
    const r = (await http.get('/api/rounds/current').set(auth).expect(200))
      .body;
    await http
      .post('/api/rounds/' + r.id + '/messages')
      .set('Cookie', auth.Cookie)
      .send({ body: 'Hello', requestKey: randomUUID() })
      .expect(403);
    await http
      .post('/api/rounds/' + r.id + '/messages')
      .set({ ...auth, Origin: 'https://evil.example' })
      .send({ body: 'Hello', requestKey: randomUUID() })
      .expect(403);
    await http
      .post('/api/rounds/' + r.id + '/messages')
      .set(auth)
      .send({ body: 'Hello', requestKey: randomUUID(), userId: b })
      .expect(400);
    await http
      .post('/api/rounds/' + r.id + '/messages')
      .set(auth)
      .send({ body: 'Hello', requestKey: randomUUID() })
      .expect(201);
    await http.get('/api/users').set(auth).expect(404);
    await http.get('/api/articles').set(auth).expect(404);
    await http.post('/api/auth/logout').set(auth).send({}).expect(201);
    await http.get('/api/auth/me').set(auth).expect(401);
  });
  test('OAuth state is consumed once and creates a real persisted session', async () => {
    const auth = app.get(AuthService);
    const state = randomUUID();
    await db.query(
      "INSERT INTO tk_oauth VALUES($1,$2,$3,clock_timestamp()+interval '10 minutes')",
      [hash(state), 'nonce', 'verifier'],
    );
    const google = (auth as any).google;
    const exchange = jest
      .spyOn(google, 'getToken')
      .mockResolvedValue({ tokens: { id_token: 'verified-in-test' } } as any);
    const verify = jest
      .spyOn(google, 'verifyIdToken')
      .mockResolvedValue({
        getPayload: () => ({
          sub: 'new-google-user',
          nonce: 'nonce',
          email: 'new@vicomtech.org',
          email_verified: true,
          hd: 'vicomtech.org',
          name: 'New User',
        }),
      } as any);
    try {
      const http = request(app.getHttpServer());
      const response = await http
        .get('/api/auth/google/callback')
        .query({ state, code: 'code' })
        .set('Cookie', 'tk_oauth=' + state)
        .expect(302)
        .expect('Location', '/');
      const session = (response.headers['set-cookie'] as unknown as string[])
        .find((c) => c.startsWith('tk_session='))!
        .split(';')[0];
      const me = await http
        .get('/api/auth/me')
        .set('Cookie', session)
        .expect(200);
      expect(me.body.name).toBe('New User');
      await http
        .get('/api/auth/google/callback')
        .query({ state, code: 'code' })
        .set('Cookie', 'tk_oauth=' + state)
        .expect(302)
        .expect('Location', '/?authError=1');
      expect(exchange).toHaveBeenCalledTimes(1);
    } finally {
      exchange.mockRestore();
      verify.mockRestore();
    }
  });
  test('expired sessions are rejected', async () => {
    const token = randomUUID();
    await db.query(
      "INSERT INTO tk_sessions VALUES($1,$2,$3,clock_timestamp()-interval '1 second')",
      [hash(token), a, 'csrf'],
    );
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', 'tk_session=' + token)
      .expect(401);
  });
});
