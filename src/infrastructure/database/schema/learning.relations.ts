import { relations } from 'drizzle-orm'
import {
  exerciseCompletions,
  userProgress,
  userVocabulary,
  videoExercises,
  videoProgress,
  videoSegments,
  videoWords
} from './learning.schema'
import { users } from './schema'
import { videos } from './video.schema'

export const userProgressRelations = relations(userProgress, ({ one }) => ({
  user: one(users, {
    fields: [userProgress.userId],
    references: [users.id]
  })
}))

export const videoSegmentsRelations = relations(videoSegments, ({ one }) => ({
  video: one(videos, {
    fields: [videoSegments.videoId],
    references: [videos.id]
  })
}))

export const videoWordsRelations = relations(videoWords, ({ one }) => ({
  video: one(videos, {
    fields: [videoWords.videoId],
    references: [videos.id]
  }),
  segment: one(videoSegments, {
    fields: [videoWords.segmentId],
    references: [videoSegments.id]
  })
}))

export const videoExercisesRelations = relations(videoExercises, ({ one }) => ({
  video: one(videos, {
    fields: [videoExercises.videoId],
    references: [videos.id]
  }),
  segment: one(videoSegments, {
    fields: [videoExercises.segmentId],
    references: [videoSegments.id]
  })
}))

export const exerciseCompletionsRelations = relations(exerciseCompletions, ({ one }) => ({
  user: one(users, {
    fields: [exerciseCompletions.userId],
    references: [users.id]
  }),
  video: one(videos, {
    fields: [exerciseCompletions.videoId],
    references: [videos.id]
  })
}))

export const userVocabularyRelations = relations(userVocabulary, ({ one }) => ({
  user: one(users, {
    fields: [userVocabulary.userId],
    references: [users.id]
  }),
  word: one(videoWords, {
    fields: [userVocabulary.wordId],
    references: [videoWords.id]
  }),
  video: one(videos, {
    fields: [userVocabulary.videoId],
    references: [videos.id]
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
  lastSegment: one(videoSegments, {
    fields: [videoProgress.lastSegmentWatched],
    references: [videoSegments.id]
  })
}))
