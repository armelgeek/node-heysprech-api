import { relations } from 'drizzle-orm'
import { exerciseOptions, exerciseQuestions, exercises, pronunciations, wordEntries } from './exercise.schema'
import { roles, userRoles } from './schema'

export * from './schema'
export * from './exercise.schema'
export * from './video.schema'

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

export { exerciseOptions, exerciseQuestions, exercises, pronunciations, wordEntries }
