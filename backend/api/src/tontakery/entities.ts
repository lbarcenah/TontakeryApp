import { Column, Entity, PrimaryColumn } from 'typeorm';

// Explicit mappings document the persisted model. Migrations, not synchronize,
// own all constraints and indexes. Game writes use SQL inside locked transactions.
@Entity('tk_users')
export class User {
  @PrimaryColumn('uuid') id: string;
  @Column('text') google_sub: string;
  @Column('text') email: string;
  @Column('text') name: string;
}
@Entity('tk_sessions')
export class Session {
  @PrimaryColumn('text') token_hash: string;
  @Column('uuid') user_id: string;
  @Column('text') csrf: string;
  @Column('timestamptz') expires_at: Date;
}
@Entity('tk_oauth')
export class OAuthAttempt {
  @PrimaryColumn('text') state_hash: string;
  @Column('text') nonce: string;
  @Column('text') verifier: string;
  @Column('timestamptz') expires_at: Date;
}
@Entity('tk_rounds')
export class Round {
  @PrimaryColumn('uuid') id: string;
  @Column('timestamptz') starts_at: Date;
  @Column('timestamptz') ends_at: Date;
  @Column('boolean') closed: boolean;
}
@Entity('tk_messages')
export class Publication {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid') round_id: string;
  @Column('uuid') user_id: string;
  @Column('text') body: string;
  @Column('timestamptz') created_at: Date;
  @Column('uuid') request_key: string;
  @Column('text', { nullable: true }) author_name: string;
}
@Entity('tk_votes')
export class Vote {
  @PrimaryColumn('uuid') round_id: string;
  @PrimaryColumn('uuid') user_id: string;
  @Column('uuid') message_id: string;
}
@Entity('tk_winners')
export class Winner {
  @PrimaryColumn('uuid') round_id: string;
  @PrimaryColumn('uuid') message_id: string;
  @Column('uuid') user_id: string;
  @Column('text') author_name: string;
  @Column('text') body: string;
  @Column('integer') votes: number;
}
@Entity('tk_tags')
export class Tag {
  @PrimaryColumn('uuid') message_id: string;
  @PrimaryColumn('uuid') user_id: string;
  @PrimaryColumn('text') category: string;
  @Column('uuid') round_id: string;
}
@Entity('tk_award_months')
export class AwardMonth {
  @PrimaryColumn('text') month: string;
  @Column('timestamptz') finalized_at: Date;
}
@Entity('tk_monthly_awards')
export class MonthlyAward {
  @PrimaryColumn('text') month: string;
  @PrimaryColumn('text') category: string;
  @PrimaryColumn('uuid') message_id: string;
  @Column('text') author_name: string;
  @Column('text') body: string;
  @Column('integer') score: number;
  @Column('integer') rank: number;
}
export const entities = [
  User,
  Session,
  OAuthAttempt,
  Round,
  Publication,
  Vote,
  Winner,
  Tag,
  AwardMonth,
  MonthlyAward,
];
