import { boolean, integer, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'
import { exercises } from './exercise.schema'
import { users } from './schema'
import { videos } from './video.schema'

// Progression globale de l'utilisateur
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

// Segments de vidéo
export const videoSegments = pgTable('video_segments', {
  id: serial('id').primaryKey(),
  videoId: integer('video_id')
    .notNull()
    .references(() => videos.id, { onDelete: 'cascade' }),
  startTime: integer('start_time').notNull(),
  endTime: integer('end_time').notNull(),
  transcriptDe: text('transcript_de').notNull(),
  transcriptFr: text('transcript_fr'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
})

// Mots clés des vidéos
export const videoWords = pgTable('video_words', {
  id: serial('id').primaryKey(),
  videoId: integer('video_id')
    .notNull()
    .references(() => videos.id, { onDelete: 'cascade' }),
  segmentId: integer('segment_id').references(() => videoSegments.id, { onDelete: 'set null' }),
  wordDe: text('word_de').notNull(),
  wordFr: text('word_fr').notNull(),
  contextDe: text('context_de'),
  contextFr: text('context_fr'),
  difficultyLevel: integer('difficulty_level').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
})

// Exercices liés aux vidéos
export const videoExercises = pgTable('video_exercises', {
  id: serial('id').primaryKey(),
  videoId: integer('video_id')
    .notNull()
    .references(() => videos.id, { onDelete: 'cascade' }),
  segmentId: integer('segment_id').references(() => videoSegments.id, { onDelete: 'set null' }),
  type: text('type').notNull(),
  questionDe: text('question_de').notNull(),
  questionFr: text('question_fr'),
  correctAnswer: text('correct_answer').notNull(),
  options: jsonb('options'),
  difficultyLevel: integer('difficulty_level').notNull().default(1),
  points: integer('points').notNull().default(10),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
})

// Suivi des exercices
export const exerciseCompletions = pgTable('exercise_completions', {
  id: serial('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  exerciseId: integer('exercise_id')
    .notNull()
    .references(() => exercises.id, { onDelete: 'cascade' }),
  videoId: integer('video_id')
    .notNull()
    .references(() => videos.id, { onDelete: 'cascade' }),
  score: integer('score').notNull(),
  isCorrect: boolean('is_correct').notNull().default(false),
  completedAt: timestamp('completed_at').notNull().defaultNow()
})

// Vocabulaire personnalisé
export const userVocabulary = pgTable('user_vocabulary', {
  id: serial('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  wordId: integer('word_id')
    .notNull()
    .references(() => videoWords.id, { onDelete: 'cascade' }),
  videoId: integer('video_id')
    .notNull()
    .references(() => videos.id, { onDelete: 'cascade' }),
  masteryLevel: integer('mastery_level').notNull().default(0),
  nextReview: timestamp('next_review'),
  lastReviewed: timestamp('last_reviewed'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
})

// Progression des vidéos
export const videoProgress = pgTable('video_progress', {
  id: serial('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  videoId: integer('video_id')
    .notNull()
    .references(() => videos.id, { onDelete: 'cascade' }),
  watchedSeconds: integer('watched_seconds').notNull().default(0),
  lastSegmentWatched: integer('last_segment_watched').references(() => videoSegments.id, {
    onDelete: 'set null'
  }),
  isCompleted: boolean('is_completed').notNull().default(false),
  completedExercises: integer('completed_exercises').notNull().default(0),
  masteredWords: integer('mastered_words').notNull().default(0),
  lastWatched: timestamp('last_watched').defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
})
