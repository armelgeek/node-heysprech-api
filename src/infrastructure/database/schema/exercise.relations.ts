import { relations } from 'drizzle-orm'
import { exerciseOptions, exerciseQuestions, exercises, pronunciations, wordEntries } from './exercise.schema'

export const exerciseRelations = relations(exercises, ({ one, many }) => ({
  wordEntry: one(wordEntries, {
    fields: [exercises.wordId],
    references: [wordEntries.id]
  }),
  questions: many(exerciseQuestions)
}))

export const exerciseQuestionsRelations = relations(exerciseQuestions, ({ one, many }) => ({
  exercise: one(exercises, {
    fields: [exerciseQuestions.exerciseId],
    references: [exercises.id]
  }),
  options: many(exerciseOptions)
}))

export const exerciseOptionsRelations = relations(exerciseOptions, ({ one }) => ({
  question: one(exerciseQuestions, {
    fields: [exerciseOptions.questionId],
    references: [exerciseQuestions.id]
  })
}))

export const wordEntriesRelations = relations(wordEntries, ({ many }) => ({
  exercises: many(exercises),
  pronunciations: many(pronunciations)
}))

export const pronunciationsRelations = relations(pronunciations, ({ one }) => ({
  wordEntry: one(wordEntries, {
    fields: [pronunciations.wordId],
    references: [wordEntries.id]
  })
}))
