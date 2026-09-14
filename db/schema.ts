import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';
export const runs=sqliteTable('runs',{
 id:text('id').primaryKey(), playerId:text('player_id').notNull(), mode:text('mode').notNull(), seed:integer('seed').notNull(), createdAt:integer('created_at').notNull(), submitted:integer('submitted').notNull().default(0), tracked:integer('tracked').notNull().default(0), completed:integer('completed').notNull().default(0), shared:integer('shared').notNull().default(0), card:integer('card').notNull().default(0), ghost:text('ghost'), rules:text('rules').notNull().default('legacy'), ranked:integer('ranked').notNull().default(1), referred:integer('referred').notNull().default(0)
},t=>[index('idx_runs_player_created').on(t.playerId,t.createdAt),index('idx_runs_created').on(t.createdAt)]);
export const scores=sqliteTable('scores',{
 playerId:text('player_id').notNull(),mode:text('mode').notNull(),name:text('name').notNull(),score:integer('score').notNull(),duration:integer('duration').notNull(),won:integer('won').notNull(),rules:text('rules').notNull().default('legacy'),createdAt:integer('created_at').notNull()
},t=>[primaryKey({columns:[t.playerId,t.mode]}),index('idx_scores_mode_score').on(t.mode,t.score,t.createdAt)]);

export const rateLimits=sqliteTable('rate_limits',{key:text('key').notNull(),bucket:integer('bucket').notNull(),count:integer('count').notNull()},t=>[primaryKey({columns:[t.key,t.bucket]}),index('idx_rate_bucket').on(t.bucket)]);
