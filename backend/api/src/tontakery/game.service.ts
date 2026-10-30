import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { Events } from './events';
import { nextEnd, roundBounds } from './time';
@Injectable()
export class GameService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(GameService.name);
  constructor(
    private db: DataSource,
    private events: Events,
  ) {}
  async onModuleInit() {
    await this.reconcile();
    this.timer = setInterval(
      () =>
        void this.reconcile().catch(() =>
          this.logger.error('Round reconciliation failed'),
        ),
      1000,
    );
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
  // The shared lock covers creation/recovery; the row lock also serializes all writes with closing.
  private async lock(q: EntityManager) {
    await q.query('SELECT pg_advisory_xact_lock(91827364)');
  }
  private async now(q: EntityManager): Promise<Date> {
    return (await q.query('SELECT clock_timestamp() AS now'))[0].now;
  }
  private async close(q: EntityManager, round: any) {
    await q.query(
      `INSERT INTO tk_winners(round_id, message_id, user_id, author_name, body, votes)
      SELECT $1, m.id, m.user_id, u.name, m.body, c.votes FROM tk_messages m JOIN tk_users u ON u.id=m.user_id
      JOIN (SELECT message_id, count(*)::integer AS votes FROM tk_votes WHERE round_id=$1 GROUP BY message_id) c ON c.message_id=m.id
      WHERE c.votes=(SELECT max(n) FROM (SELECT count(*) n FROM tk_votes WHERE round_id=$1 GROUP BY message_id) counts)
      ON CONFLICT DO NOTHING`,
      [round.id],
    );
    await q.query('UPDATE tk_rounds SET closed=true WHERE id=$1', [round.id]);
  }
  async reconcile() {
    const changed = await this.db.transaction(async (q) => {
      await this.lock(q);
      const now = await this.now(q);
      let [last] = await q.query(
        'SELECT * FROM tk_rounds ORDER BY starts_at DESC LIMIT 1 FOR UPDATE',
      );
      let changed = false;
      if (!last) {
        const { start, end } = roundBounds(now);
        [last] = await q.query(
          'INSERT INTO tk_rounds(id,starts_at,ends_at) VALUES($1,$2,$3) RETURNING *',
          [randomUUID(), start, end],
        );
        changed = true;
      }
      while (last.ends_at <= now) {
        if (!last.closed) {
          await this.close(q, last);
          changed = true;
        }
        const start = last.ends_at;
        [last] = await q.query(
          'INSERT INTO tk_rounds(id,starts_at,ends_at) VALUES($1,$2,$3) RETURNING *',
          [randomUUID(), start, nextEnd(start)],
        );
      }
      return changed;
    });
    if (changed) {
      this.logger.log('Daily rounds synchronized');
      this.events.emit('round');
    }
  }
  private async allowance(q: EntityManager, userId: string, round: any) {
    const [result] = await q.query(
      `SELECT EXISTS(SELECT 1 FROM tk_winners w JOIN tk_rounds r ON r.id=w.round_id WHERE w.user_id=$1 AND r.ends_at=$2) AS bonus`,
      [userId, round.starts_at],
    );
    return result.bonus ? 2 : 1;
  }
  async current(userId: string) {
    await this.reconcile();
    return this.db.transaction(async (q) => {
      await this.lock(q);
      const [r] = await q.query(
        'SELECT * FROM tk_rounds WHERE NOT closed ORDER BY starts_at DESC LIMIT 1',
      );
      const messages = await q.query(
        `SELECT id, body, created_at AS "createdAt", (user_id=$2) AS mine FROM tk_messages WHERE round_id=$1 ORDER BY created_at,id`,
        [r.id, userId],
      );
      const [vote] = await q.query(
        'SELECT message_id FROM tk_votes WHERE round_id=$1 AND user_id=$2',
        [r.id, userId],
      );
      return {
        id: r.id,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        serverTime: await this.now(q),
        messages,
        remaining:
          (await this.allowance(q, userId, r)) -
          messages.filter((m) => m.mine).length,
        voteId: vote?.message_id ?? null,
      };
    });
  }
  private async writable(q: EntityManager, roundId: string) {
    await this.lock(q);
    const [r] = await q.query(
      'SELECT * FROM tk_rounds WHERE id=$1 FOR UPDATE',
      [roundId],
    );
    const now = await this.now(q);
    if (!r || r.closed || r.ends_at <= now || r.starts_at > now)
      throw new ConflictException('ROUND_CLOSED');
    return r;
  }
  async publish(
    userId: string,
    roundId: string,
    body: string,
    requestKey: string,
  ) {
    body = body.trim();
    if (!body || [...body].length > 500)
      throw new BadRequestException('INVALID_MESSAGE');
    await this.reconcile();
    const result = await this.db.transaction(async (q) => {
      const r = await this.writable(q, roundId);
      const [previous] = await q.query(
        'SELECT id,round_id,body FROM tk_messages WHERE user_id=$1 AND request_key=$2',
        [userId, requestKey],
      );
      if (previous) {
        if (previous.round_id !== roundId || previous.body !== body)
          throw new ConflictException('IDEMPOTENCY_CONFLICT');
        return { id: previous.id };
      }
      const [count] = await q.query(
        'SELECT count(*)::integer AS n FROM tk_messages WHERE round_id=$1 AND user_id=$2',
        [roundId, userId],
      );
      if (count.n >= (await this.allowance(q, userId, r)))
        throw new ConflictException('MESSAGE_LIMIT');
      const id = randomUUID();
      await q.query(
        'INSERT INTO tk_messages(id,round_id,user_id,body,request_key) VALUES($1,$2,$3,$4,$5)',
        [id, roundId, userId, body, requestKey],
      );
      return { id };
    });
    this.events.emit('message');
    return result;
  }
  async vote(userId: string, roundId: string, messageId: string) {
    await this.reconcile();
    await this.db.transaction(async (q) => {
      await this.writable(q, roundId);
      const [m] = await q.query(
        'SELECT user_id FROM tk_messages WHERE id=$1 AND round_id=$2',
        [messageId, roundId],
      );
      if (!m) throw new BadRequestException('MESSAGE_NOT_FOUND');
      if (m.user_id === userId) throw new BadRequestException('OWN_VOTE');
      await q.query(
        'INSERT INTO tk_votes(round_id,user_id,message_id) VALUES($1,$2,$3) ON CONFLICT(round_id,user_id) DO UPDATE SET message_id=EXCLUDED.message_id',
        [roundId, userId, messageId],
      );
    });
    this.events.emit('personal', userId);
    return { ok: true };
  }
  async history(page: number) {
    await this.reconcile();
    const rounds = await this.db.query(
      'SELECT id,ends_at AS "endsAt" FROM tk_rounds WHERE closed ORDER BY ends_at DESC LIMIT 21 OFFSET $1',
      [page * 20],
    );
    const hasMore = rounds.length > 20;
    const items = await Promise.all(
      rounds
        .slice(0, 20)
        .map(async (r) => ({
          ...r,
          winners: await this.db.query(
            'SELECT author_name AS "authorName", body, votes FROM tk_winners WHERE round_id=$1 ORDER BY author_name,message_id',
            [r.id],
          ),
        })),
    );
    return { items, hasMore };
  }
}
