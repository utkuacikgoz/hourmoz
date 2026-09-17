import {sqliteTable, text, integer, index, primaryKey} from 'drizzle-orm/sqlite-core';
export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    playerId: text('player_id').notNull(),
    mode: text('mode').notNull(),
    seed: integer('seed').notNull(),
    createdAt: integer('created_at').notNull(),
    submitted: integer('submitted').notNull().default(0),
    tracked: integer('tracked').notNull().default(0),
    completed: integer('completed').notNull().default(0),
    shared: integer('shared').notNull().default(0),
    card: integer('card').notNull().default(0),
    ghost: text('ghost'),
    rules: text('rules').notNull().default('legacy'),
    ranked: integer('ranked').notNull().default(1),
    referred: integer('referred').notNull().default(0),
    visitId: text('visit_id'),
  },
  t => [index('idx_runs_player_created').on(t.playerId, t.createdAt), index('idx_runs_created').on(t.createdAt)],
);
export const scores = sqliteTable(
  'scores',
  {
    playerId: text('player_id').notNull(),
    mode: text('mode').notNull(),
    name: text('name').notNull(),
    score: integer('score').notNull(),
    duration: integer('duration').notNull(),
    won: integer('won').notNull(),
    rules: text('rules').notNull().default('legacy'),
    createdAt: integer('created_at').notNull(),
  },
  t => [primaryKey({columns: [t.playerId, t.mode]}), index('idx_scores_mode_score').on(t.mode, t.score, t.createdAt)],
);

export const rateLimits = sqliteTable(
  'rate_limits',
  {key: text('key').notNull(), bucket: integer('bucket').notNull(), count: integer('count').notNull()},
  t => [primaryKey({columns: [t.key, t.bucket]}), index('idx_rate_bucket').on(t.bucket)],
);

export const visits = sqliteTable(
  'visits',
  {
    id: text('id').primaryKey(),
    playerId: text('player_id').notNull(),
    createdAt: integer('created_at').notNull(),
    source: text('source').notNull(),
    sponsorId: text('sponsor_id'),
    sponsorViewed: integer('sponsor_viewed').notNull().default(0),
    sponsorClicked: integer('sponsor_clicked').notNull().default(0),
    bookingClicked: integer('booking_clicked').notNull().default(0),
  },
  t => [index('idx_visits_created').on(t.createdAt), index('idx_visits_player_created').on(t.playerId, t.createdAt)],
);

export const sponsorSlots = sqliteTable(
  'sponsor_slots',
  {
    id: text('id').primaryKey(),
    playerId: text('player_id').notNull(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    startDay: text('start_day').notNull(),
    days: integer('days').notNull(),
    amount: integer('amount').notNull(),
    status: text('status').notNull().default('checkout'),
    testMode: integer('test_mode').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    sessionId: text('session_id'),
    paymentIntent: text('payment_intent'),
    paidAt: integer('paid_at'),
    hidden: integer('hidden').notNull().default(0),
  },
  t => [
    index('idx_slots_status_start').on(t.status, t.startDay),
    index('idx_slots_player_created').on(t.playerId, t.createdAt),
  ],
);
// One row per booked UTC day and environment: the primary key makes double booking impossible.
export const sponsorDays = sqliteTable(
  'sponsor_days',
  {
    day: text('day').notNull(),
    testMode: integer('test_mode').notNull().default(0),
    slotId: text('slot_id').notNull(),
  },
  t => [primaryKey({columns: [t.day, t.testMode]}), index('idx_days_slot').on(t.slotId)],
);
export const presence = sqliteTable(
  'presence',
  {
    playerId: text('player_id').primaryKey(),
    seenAt: integer('seen_at').notNull(),
  },
  t => [index('idx_presence_seen').on(t.seenAt)],
);
export const sponsorEvents = sqliteTable(
  'sponsor_events',
  {
    visitId: text('visit_id').notNull(),
    sponsorId: text('sponsor_id').notNull(),
    viewed: integer('viewed').notNull().default(0),
    clicked: integer('clicked').notNull().default(0),
  },
  t => [primaryKey({columns: [t.visitId, t.sponsorId]})],
);
