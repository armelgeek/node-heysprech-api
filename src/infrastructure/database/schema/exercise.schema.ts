import { boolean, integer, jsonb, pgEnum, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core'

export const exerciseTypeEnum = pgEnum('exercise_type', ['multiple_choice_pair'])
export const languageDirectionEnum = pgEnum('language_direction', ['de_to_fr', 'fr_to_de'])
export const languageLevelEnum = pgEnum('language_level', ['beginner', 'intermediate', 'advanced'])

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
