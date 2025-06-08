import { relations } from 'drizzle-orm'
import {
  exerciseHints,
  exerciseMedia,
  exerciseOptions,
  exerciseQuestions,
  exercises,
  pronunciations,
  wordEntries
} from './exercise.schema'
import { videos } from './video.schema'

export const exerciseRelations = relations(exercises, ({ one, many }) => ({
  wordEntry: one(wordEntries, {
    fields: [exercises.wordId],
    references: [wordEntries.id]
  }),
  video: one(videos, {
    fields: [exercises.videoId],
    references: [videos.id]
  }),
  questions: many(exerciseQuestions),
  hints: many(exerciseHints),
  media: many(exerciseMedia)
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

export const exerciseHintsRelations = relations(exerciseHints, ({ one }) => ({
  exercise: one(exercises, {
    fields: [exerciseHints.exerciseId],
    references: [exercises.id]
  })
}))

export const exerciseMediaRelations = relations(exerciseMedia, ({ one }) => ({
  exercise: one(exercises, {
    fields: [exerciseMedia.exerciseId],
    references: [exercises.id]
  })
}))
