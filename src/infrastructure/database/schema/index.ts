import { relations } from 'drizzle-orm'
import { exercises, wordEntries } from './exercise.schema'
import { exerciseCompletions, userProgress, userVocabulary, videoProgress } from './learning.schema'
import { roles, userRoles, users } from './schema'
import { videos } from './video.schema'

export * from './schema'
export * from './video.schema'
export * from './learning.schema'
export * from './category.schema'
export * from './video-category.schema'
export {
  exerciseHints,
  exerciseMedia,
  exerciseOptions,
  exerciseQuestions,
  exercises,
  pronunciations,
  wordEntries
} from './exercise.schema'
export * from './learning.relations'
export * from './exercise.relations'

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(roles, {
    fields: [userRoles.userId],
    references: [roles.id]
  }),
  role: one(roles, {
    fields: [userRoles.roleId],
    references: [roles.id]
  })
}))

export const userProgressRelations = relations(userProgress, ({ one }) => ({
  user: one(users, {
    fields: [userProgress.userId],
    references: [users.id]
  })
}))

export const exerciseCompletionsRelations = relations(exerciseCompletions, ({ one }) => ({
  user: one(users, {
    fields: [exerciseCompletions.userId],
    references: [users.id]
  }),
  exercise: one(exercises, {
    fields: [exerciseCompletions.exerciseId],
    references: [exercises.id]
  })
}))

export const userVocabularyRelations = relations(userVocabulary, ({ one }) => ({
  user: one(users, {
    fields: [userVocabulary.userId],
    references: [users.id]
  }),
  word: one(wordEntries, {
    fields: [userVocabulary.wordId],
    references: [wordEntries.id]
  })
}))

export const videoProgressRelations = relations(videoProgress, ({ one }) => ({
  user: one(users, {
    fields: [videoProgress.userId],
    references: [users.id]
  }),
  video: one(videos, {
    fields: [videoProgress.videoId],
    references: [videos.id]
  })
}))
