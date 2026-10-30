import { MigrationInterface, QueryRunner } from 'typeorm';

export class Tontakery1793200000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE tk_users (id uuid PRIMARY KEY, google_sub text NOT NULL UNIQUE, email text NOT NULL, name text NOT NULL);
      CREATE TABLE tk_sessions (token_hash text PRIMARY KEY, user_id uuid REFERENCES tk_users(id) ON DELETE CASCADE, csrf text NOT NULL, expires_at timestamptz NOT NULL);
      CREATE TABLE tk_oauth (state_hash text PRIMARY KEY, nonce text NOT NULL, verifier text NOT NULL, expires_at timestamptz NOT NULL);
      CREATE TABLE tk_rounds (id uuid PRIMARY KEY, starts_at timestamptz NOT NULL UNIQUE, ends_at timestamptz NOT NULL UNIQUE, closed boolean NOT NULL DEFAULT false);
      CREATE TABLE tk_messages (id uuid PRIMARY KEY, round_id uuid NOT NULL REFERENCES tk_rounds(id), user_id uuid NOT NULL REFERENCES tk_users(id), body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 500), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), request_key uuid NOT NULL, UNIQUE(user_id, request_key), UNIQUE(id, round_id));
      CREATE TABLE tk_votes (round_id uuid NOT NULL REFERENCES tk_rounds(id), user_id uuid NOT NULL REFERENCES tk_users(id), message_id uuid NOT NULL, PRIMARY KEY(round_id, user_id), FOREIGN KEY(message_id, round_id) REFERENCES tk_messages(id, round_id));
      CREATE TABLE tk_winners (round_id uuid NOT NULL REFERENCES tk_rounds(id), message_id uuid NOT NULL REFERENCES tk_messages(id), user_id uuid NOT NULL REFERENCES tk_users(id), author_name text NOT NULL, body text NOT NULL, votes integer NOT NULL CHECK (votes > 0), PRIMARY KEY(round_id, message_id));
      CREATE INDEX ON tk_messages(round_id, created_at);
      CREATE INDEX ON tk_votes(message_id);
      CREATE INDEX ON tk_sessions(expires_at);
    `);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(
      'DROP TABLE tk_winners, tk_votes, tk_messages, tk_rounds, tk_oauth, tk_sessions, tk_users',
    );
  }
}
