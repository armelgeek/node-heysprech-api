import { boolean, integer, jsonb, pgEnum, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core'

import type { Action, Subject } from '../../../domain/types/permission.type'

export const exerciseTypeEnum = pgEnum('exercise_type', ['multiple_choice_pair'])
export const languageDirectionEnum = pgEnum('language_direction', ['de_to_fr', 'fr_to_de'])
export const languageLevelEnum = pgEnum('language_level', ['beginner', 'intermediate', 'advanced'])

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  firstname: text('firstname'),
  lastname: text('lastname'),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull(),
  image: text('image'),
  role: text('role').notNull().default('user'),
  banned: boolean('banned').notNull().default(false),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires'),
  isAdmin: boolean('is_admin').notNull().default(false),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull()
})

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  impersonatedBy: text('impersonated_by').references(() => users.id)
})

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull()
})

export const verifications = pgTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at')
})

export const activityLogs = pgTable('activity_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),
  timestamp: timestamp('timestamp').notNull().defaultNow(),
  ipAddress: varchar('ip_address', { length: 45 })
})

export const roles = pgTable('roles', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull()
})

export const roleResources = pgTable('role_resources', {
  id: text('id').primaryKey(),
  roleId: text('role_id')
    .notNull()
    .references(() => roles.id, { onDelete: 'cascade' }),
  resourceType: text('resource_type').notNull().$type<Subject>(),
  actions: jsonb('actions').notNull().$type<Action[]>(),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull()
})

export const userRoles = pgTable('user_roles', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  roleId: text('role_id')
    .notNull()
    .references(() => roles.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull()
})

export const exercises = pgTable('exercises', {
  id: serial('id').primaryKey(),
  wordId: integer('word_id').notNull(),
  type: exerciseTypeEnum('type').notNull(),
  level: languageLevelEnum('level').notNull(),
  createdAt: timestamp('created_at').defaultNow()
})

export const exerciseQuestions = pgTable('exercise_questions', {
  id: serial('id').primaryKey(),
  exerciseId: integer('exercise_id')
    .notNull()
    .references(() => exercises.id, { onDelete: 'cascade' }),
  direction: languageDirectionEnum('direction').notNull(),
  questionDe: text('question_de').notNull(),
  questionFr: text('question_fr').notNull(),
  wordToTranslate: varchar('word_to_translate', { length: 255 }).notNull(),
  correctAnswer: varchar('correct_answer', { length: 255 }).notNull()
})

export const exerciseOptions = pgTable('exercise_options', {
  id: serial('id').primaryKey(),
  questionId: integer('question_id')
    .notNull()
    .references(() => exerciseQuestions.id, { onDelete: 'cascade' }),
  optionText: varchar('option_text', { length: 255 }).notNull(),
  isCorrect: boolean('is_correct').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow()
})

export const wordEntries = pgTable('word_entries', {
  id: serial('id').primaryKey(),
  word: varchar('word', { length: 255 }).notNull(),
  language: varchar('language', { length: 10 }).notNull(),
  translations: jsonb('translations').notNull(),
  examples: jsonb('examples').notNull(),
  level: languageLevelEnum('level').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
})

export const pronunciations = pgTable('pronunciations', {
  id: serial('id').primaryKey(),
  wordId: integer('word_id')
    .notNull()
    .references(() => wordEntries.id, { onDelete: 'cascade' }),
  filePath: varchar('file_path', { length: 1000 }).notNull(),
  type: varchar('type', { length: 50 }).notNull(),
  language: varchar('language', { length: 10 }).notNull(),
  createdAt: timestamp('created_at').defaultNow()
})
