import { relations } from 'drizzle-orm/relations'
import {
  accounts,
  activityLogs,
  audioSegments,
  completedSegments,
  exerciseCompletions,
  exerciseOptions,
  exerciseQuestions,
  exercises,
  processingLogs,
  pronunciations,
  roleResources,
  roles,
  sessions,
  userProgress,
  userRoles,
  users,
  userVocabulary,
  videoExercises,
  videoProgress,
  videos,
  videoSegments,
  videoWords,
  wordEntries,
  wordSegments
} from './schema'

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id]
  })
}))

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  activityLogs: many(activityLogs),
  sessions_userId: many(sessions, {
    relationName: 'sessions_userId_users_id'
  }),
  sessions_impersonatedBy: many(sessions, {
    relationName: 'sessions_impersonatedBy_users_id'
  }),
  userRoles: many(userRoles),
  userProgresses: many(userProgress),
  userVocabularies: many(userVocabulary),
  videoProgresses: many(videoProgress),
  exerciseCompletions: many(exerciseCompletions)
}))

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  user: one(users, {
    fields: [activityLogs.userId],
    references: [users.id]
  })
}))

export const roleResourcesRelations = relations(roleResources, ({ one }) => ({
  role: one(roles, {
    fields: [roleResources.roleId],
    references: [roles.id]
  })
}))

export const rolesRelations = relations(roles, ({ many }) => ({
  roleResources: many(roleResources),
  userRoles: many(userRoles)
}))

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user_userId: one(users, {
    fields: [sessions.userId],
    references: [users.id],
    relationName: 'sessions_userId_users_id'
  }),
  user_impersonatedBy: one(users, {
    fields: [sessions.impersonatedBy],
    references: [users.id],
    relationName: 'sessions_impersonatedBy_users_id'
  })
}))

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id]
  }),
  role: one(roles, {
    fields: [userRoles.roleId],
    references: [roles.id]
  })
}))

export const videoSegmentsRelations = relations(videoSegments, ({ one, many }) => ({
  video: one(videos, {
    fields: [videoSegments.videoId],
    references: [videos.id]
  }),
  videoWords: many(videoWords),
  videoExercises: many(videoExercises),
  videoProgresses: many(videoProgress)
}))

export const videosRelations = relations(videos, ({ many }) => ({
  videoSegments: many(videoSegments),
  audioSegments: many(audioSegments),
  processingLogs: many(processingLogs),
  completedSegments: many(completedSegments),
  videoWords: many(videoWords),
  userVocabularies: many(userVocabulary),
  videoExercises: many(videoExercises),
  videoProgresses: many(videoProgress),
  exerciseCompletions: many(exerciseCompletions)
}))

export const audioSegmentsRelations = relations(audioSegments, ({ one, many }) => ({
  video: one(videos, {
    fields: [audioSegments.videoId],
    references: [videos.id]
  }),
  wordSegments: many(wordSegments),
  completedSegments: many(completedSegments)
}))

export const processingLogsRelations = relations(processingLogs, ({ one }) => ({
  video: one(videos, {
    fields: [processingLogs.videoId],
    references: [videos.id]
  })
}))

export const wordSegmentsRelations = relations(wordSegments, ({ one }) => ({
  audioSegment: one(audioSegments, {
    fields: [wordSegments.audioSegmentId],
    references: [audioSegments.id]
  })
}))

export const completedSegmentsRelations = relations(completedSegments, ({ one }) => ({
  video: one(videos, {
    fields: [completedSegments.videoId],
    references: [videos.id]
  }),
  audioSegment: one(audioSegments, {
    fields: [completedSegments.segmentId],
    references: [audioSegments.id]
  })
}))

export const videoWordsRelations = relations(videoWords, ({ one, many }) => ({
  video: one(videos, {
    fields: [videoWords.videoId],
    references: [videos.id]
  }),
  videoSegment: one(videoSegments, {
    fields: [videoWords.segmentId],
    references: [videoSegments.id]
  }),
  userVocabularies: many(userVocabulary)
}))

export const exerciseQuestionsRelations = relations(exerciseQuestions, ({ one, many }) => ({
  exercise: one(exercises, {
    fields: [exerciseQuestions.exerciseId],
    references: [exercises.id]
  }),
  exerciseOptions: many(exerciseOptions)
}))

export const exercisesRelations = relations(exercises, ({ many }) => ({
  exerciseQuestions: many(exerciseQuestions),
  exerciseCompletions: many(exerciseCompletions)
}))

export const exerciseOptionsRelations = relations(exerciseOptions, ({ one }) => ({
  exerciseQuestion: one(exerciseQuestions, {
    fields: [exerciseOptions.questionId],
    references: [exerciseQuestions.id]
  })
}))

export const pronunciationsRelations = relations(pronunciations, ({ one }) => ({
  wordEntry: one(wordEntries, {
    fields: [pronunciations.wordId],
    references: [wordEntries.id]
  })
}))

export const wordEntriesRelations = relations(wordEntries, ({ many }) => ({
  pronunciations: many(pronunciations)
}))

export const userProgressRelations = relations(userProgress, ({ one }) => ({
  user: one(users, {
    fields: [userProgress.userId],
    references: [users.id]
  })
}))

export const userVocabularyRelations = relations(userVocabulary, ({ one }) => ({
  user: one(users, {
    fields: [userVocabulary.userId],
    references: [users.id]
  }),
  videoWord: one(videoWords, {
    fields: [userVocabulary.wordId],
    references: [videoWords.id]
  }),
  video: one(videos, {
    fields: [userVocabulary.videoId],
    references: [videos.id]
  })
}))

export const videoExercisesRelations = relations(videoExercises, ({ one }) => ({
  video: one(videos, {
    fields: [videoExercises.videoId],
    references: [videos.id]
  }),
  videoSegment: one(videoSegments, {
    fields: [videoExercises.segmentId],
    references: [videoSegments.id]
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
  }),
  videoSegment: one(videoSegments, {
    fields: [videoProgress.lastSegmentWatched],
    references: [videoSegments.id]
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
  }),
  video: one(videos, {
    fields: [exerciseCompletions.videoId],
    references: [videos.id]
  })
}))
