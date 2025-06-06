import { boolean, integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'
import { exercises, wordEntries } from './exercise.schema'
import { users } from './schema'
import { videos } from './video.schema'

export const userProgress = pgTable('user_progress', {
  id: serial('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  level: integer('level').notNull().default(1),
  totalXp: integer('total_xp').notNull().default(0),
  currentStreak: integer('current_streak').notNull().default(0),
  lastActivity: timestamp('last_activity').defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
})

export const exerciseCompletions = pgTable('exercise_completions', {
  id: serial('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  exerciseId: integer('exercise_id')
    .notNull()
    .references(() => exercises.id, { onDelete: 'cascade' }),
  score: integer('score').notNull(),
  timeTaken: integer('time_taken'), // en secondes
  isCorrect: boolean('is_correct').notNull().default(false),
  completedAt: timestamp('completed_at').notNull().defaultNow()
})

export const userVocabulary = pgTable('user_vocabulary', {
  id: serial('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  wordId: integer('word_id')
    .notNull()
    .references(() => wordEntries.id, { onDelete: 'cascade' }),
  masteryLevel: integer('mastery_level').notNull().default(0),
  nextReview: timestamp('next_review'),
  lastReviewed: timestamp('last_reviewed'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
})

export const videoProgress = pgTable('video_progress', {
  id: serial('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  videoId: integer('video_id')
    .notNull()
    .references(() => videos.id, { onDelete: 'cascade' }),
  watchedSeconds: integer('watched_seconds').notNull().default(0),
  isCompleted: boolean('is_completed').notNull().default(false),
  lastWatched: timestamp('last_watched').defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
})
