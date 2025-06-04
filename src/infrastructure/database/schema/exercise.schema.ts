import { integer, jsonb, pgTable } from 'drizzle-orm/pg-core'

export interface Exercise {
  type: string
  level: string
  questions: {
    direction: string
    questionDe: string
    questionFr: string
    wordToTranslate: string
    correctAnswer: string
    options: string[]
  }[]
}

// Table temporaire pour l'importation des exercices
export const tempExercises = pgTable('temp_exercises', {
  id: integer('id').primaryKey(),
  wordId: integer('word_id').notNull(),
  data: jsonb('data').notNull().$type<Exercise>()
})
