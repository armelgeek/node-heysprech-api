import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Routes } from '@/domain/types'
import { db } from '../database/db'
import { difficultyLevels, videoCategories } from '../database/schema/category.schema'

const categorySchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.enum(['video', 'exercise']),
  description: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
})

const difficultySchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().optional(),
  rank: z.number(),
  createdAt: z.string(),
  updatedAt: z.string()
})

export class CategoryController implements Routes {
  public controller: OpenAPIHono

  constructor() {
    this.controller = new OpenAPIHono()
  }

  public initRoutes() {
    // Liste toutes les catégories
    this.controller.openapi(
      createRoute({
        method: 'get',
        path: '/categories',
        tags: ['Categories'],
        summary: 'List Video Categories',
        description: 'Retrieve all available video categories',
        responses: {
          200: {
            content: {
              'application/json': {
                schema: z.array(categorySchema)
              }
            },
            description: 'List of video categories'
          }
        }
      }),
      async (c: any) => {
        const categories = await db.select().from(videoCategories)
        return c.json(categories)
      }
    )

    // Crée une nouvelle catégorie
    this.controller.openapi(
      createRoute({
        method: 'post',
        path: '/categories',
        tags: ['Categories'],
        summary: 'Create Category',
        description: 'Create a new video category',
        request: {
          body: {
            content: {
              'application/json': {
                schema: z.object({
                  name: z.string(),
                  description: z.string().optional(),
                  type: z.enum(['video', 'exercise']).default('video')
                })
              }
            }
          }
        },
        responses: {
          201: {
            content: {
              'application/json': {
                schema: categorySchema
              }
            },
            description: 'Category created successfully'
          }
        }
      }),
      async (c: any) => {
        const body = await c.req.json()
        const [category] = await db
          .insert(videoCategories)
          .values({
            name: body.name,
            description: body.description,
            type: body.type || 'video'
          })
          .returning()
        return c.json(category, 201)
      }
    )

    // Met à jour une catégorie
    this.controller.openapi(
      createRoute({
        method: 'patch',
        path: '/categories/{id}',
        tags: ['Categories'],
        summary: 'Update Category',
        description: 'Update an existing video category',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Category ID',
            schema: { type: 'number' }
          }
        ],
        request: {
          body: {
            content: {
              'application/json': {
                schema: z.object({
                  name: z.string().optional(),
                  description: z.string().optional()
                })
              }
            }
          }
        },
        responses: {
          200: {
            content: {
              'application/json': {
                schema: categorySchema
              }
            },
            description: 'Category updated successfully'
          }
        }
      }),
      async (c: any) => {
        const id = Number(c.req.param('id'))
        const body = await c.req.json()
        const [category] = await db
          .update(videoCategories)
          .set({
            name: body.name,
            description: body.description,
            updatedAt: new Date()
          })
          .where(eq(videoCategories.id, id))
          .returning()
        return c.json(category)
      }
    )

    // Liste tous les niveaux de difficulté
    this.controller.openapi(
      createRoute({
        method: 'get',
        path: '/difficulty-levels',
        tags: ['Difficulty'],
        summary: 'List Difficulty Levels',
        description: 'Retrieve all available difficulty levels',
        responses: {
          200: {
            content: {
              'application/json': {
                schema: z.array(difficultySchema)
              }
            },
            description: 'List of difficulty levels'
          }
        }
      }),
      async (c: any) => {
        const levels = await db.select().from(difficultyLevels).orderBy(difficultyLevels.rank)
        return c.json(levels)
      }
    )

    // Crée un nouveau niveau de difficulté
    this.controller.openapi(
      createRoute({
        method: 'post',
        path: '/difficulty-levels',
        tags: ['Difficulty'],
        summary: 'Create Difficulty Level',
        description: 'Create a new difficulty level',
        request: {
          body: {
            content: {
              'application/json': {
                schema: z.object({
                  name: z.string(),
                  description: z.string().optional(),
                  rank: z.number()
                })
              }
            }
          }
        },
        responses: {
          201: {
            content: {
              'application/json': {
                schema: difficultySchema
              }
            },
            description: 'Difficulty level created successfully'
          }
        }
      }),
      async (c: any) => {
        const body = await c.req.json()
        const [level] = await db
          .insert(difficultyLevels)
          .values({
            name: body.name,
            description: body.description,
            rank: body.rank
          })
          .returning()
        return c.json(level, 201)
      }
    )

    // Met à jour un niveau de difficulté
    this.controller.openapi(
      createRoute({
        method: 'patch',
        path: '/difficulty-levels/{id}',
        tags: ['Difficulty'],
        summary: 'Update Difficulty Level',
        description: 'Update an existing difficulty level',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Difficulty Level ID',
            schema: { type: 'number' }
          }
        ],
        request: {
          body: {
            content: {
              'application/json': {
                schema: z.object({
                  name: z.string().optional(),
                  description: z.string().optional(),
                  rank: z.number().optional()
                })
              }
            }
          }
        },
        responses: {
          200: {
            content: {
              'application/json': {
                schema: difficultySchema
              }
            },
            description: 'Difficulty level updated successfully'
          }
        }
      }),
      async (c: any) => {
        const id = Number(c.req.param('id'))
        const body = await c.req.json()
        const [level] = await db
          .update(difficultyLevels)
          .set({
            name: body.name,
            description: body.description,
            rank: body.rank,
            updatedAt: new Date()
          })
          .where(eq(difficultyLevels.id, id))
          .returning()
        return c.json(level)
      }
    )
  }

  public getRouter() {
    return this.controller
  }
}
