import { relations } from 'drizzle-orm'
import { integer, pgTable, serial, timestamp } from 'drizzle-orm/pg-core'
import { difficultyLevels, videoCategories } from './category.schema'
import { videos } from './video.schema'

export const videoToCategoryMap = pgTable('video_to_category_map', {
  id: serial('id').primaryKey(),
  videoId: integer('video_id')
    .notNull()
    .references(() => videos.id, { onDelete: 'cascade' }),
  categoryId: integer('category_id')
    .notNull()
    .references(() => videoCategories.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow()
})

export const videoToDifficultyMap = pgTable('video_to_difficulty_map', {
  id: serial('id').primaryKey(),
  videoId: integer('video_id')
    .notNull()
    .references(() => videos.id, { onDelete: 'cascade' }),
  difficultyId: integer('difficulty_id')
    .notNull()
    .references(() => difficultyLevels.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow()
})

export const videoToCategoryRelations = relations(videoToCategoryMap, ({ one }) => ({
  video: one(videos, {
    fields: [videoToCategoryMap.videoId],
    references: [videos.id]
  }),
  category: one(videoCategories, {
    fields: [videoToCategoryMap.categoryId],
    references: [videoCategories.id]
  })
}))

export const videoToDifficultyRelations = relations(videoToDifficultyMap, ({ one }) => ({
  video: one(videos, {
    fields: [videoToDifficultyMap.videoId],
    references: [videos.id]
  }),
  difficulty: one(difficultyLevels, {
    fields: [videoToDifficultyMap.difficultyId],
    references: [difficultyLevels.id]
  })
}))

export const videoRelations = relations(videos, ({ many }) => ({
  videoToCategories: many(videoToCategoryMap),
  videoToDifficulties: many(videoToDifficultyMap)
}))

export const categoryRelations = relations(videoCategories, ({ many }) => ({
  videoToCategories: many(videoToCategoryMap)
}))

export const difficultyRelations = relations(difficultyLevels, ({ many }) => ({
  videoToDifficulties: many(videoToDifficultyMap)
}))
