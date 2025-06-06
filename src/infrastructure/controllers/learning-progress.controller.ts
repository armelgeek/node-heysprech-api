import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { z } from 'zod'
import { LearningProgressService } from '../../application/services/learning-progress.service'

const progressSchema = z.object({
  id: z.number(),
  userId: z.string(),
  level: z.number(),
  totalXp: z.number(),
  currentStreak: z.number(),
  lastActivity: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})

const exerciseCompletionSchema = z.object({
  exerciseId: z.number(),
  score: z.number(),
  isCorrect: z.boolean(),
  timeTaken: z.number().optional()
})

const wordMasterySchema = z.object({
  wordId: z.number(),
  masteryLevel: z.number().min(0).max(5)
})

const videoProgressSchema = z.object({
  videoId: z.number(),
  watchedSeconds: z.number(),
  isCompleted: z.boolean().optional()
})

export class LearningProgressController {
  public controller: OpenAPIHono
  private learningProgressService: LearningProgressService

  constructor() {
    this.controller = new OpenAPIHono()
    this.learningProgressService = new LearningProgressService()
    this.initRoutes()
  }

  private initRoutes() {
    this.controller.openapi(
      createRoute({
        method: 'get',
        path: '/progress',
        tags: ['Learning Progress'],
        summary: 'Get User Progress',
        description: 'Get the current learning progress for the authenticated user',
        responses: {
          200: {
            content: {
              'application/json': {
                schema: progressSchema
              }
            },
            description: 'User progress retrieved successfully'
          }
        }
      }),
      async (c: any) => {
        const user = c.get('user')
        const progress = await this.learningProgressService.getUserProgress(user.id)
        return c.json(progress)
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'post',
        path: '/exercise-completion',
        tags: ['Learning Progress'],
        summary: 'Save Exercise Completion',
        description: 'Record the completion of an exercise',
        request: {
          body: {
            content: {
              'application/json': {
                schema: exerciseCompletionSchema
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Exercise completion recorded successfully'
          }
        }
      }),
      async (c: any) => {
        const user = c.get('user')
        const body = await c.req.json()
        await this.learningProgressService.saveExerciseCompletion(
          user.id,
          body.exerciseId,
          body.score,
          body.isCorrect,
          body.timeTaken
        )
        return c.json({ success: true })
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'post',
        path: '/vocabulary-mastery',
        tags: ['Learning Progress'],
        summary: 'Update Vocabulary Mastery',
        description: 'Update the mastery level of a word',
        request: {
          body: {
            content: {
              'application/json': {
                schema: wordMasterySchema
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Vocabulary mastery updated successfully'
          }
        }
      }),
      async (c: any) => {
        const user = c.get('user')
        const body = await c.req.json()
        await this.learningProgressService.updateVocabularyMastery(user.id, body.wordId, body.masteryLevel)
        return c.json({ success: true })
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'get',
        path: '/vocabulary-review',
        tags: ['Learning Progress'],
        summary: 'Get Words for Review',
        description: 'Get the list of words that need to be reviewed',
        responses: {
          200: {
            description: 'Words for review retrieved successfully'
          }
        }
      }),
      async (c: any) => {
        const user = c.get('user')
        const words = await this.learningProgressService.getVideoWordsForReview(user.id)
        return c.json(words)
      }
    )

    // Mettre à jour la progression d'une vidéo
    this.controller.openapi(
      createRoute({
        method: 'post',
        path: '/video-progress',
        tags: ['Learning Progress'],
        summary: 'Update Video Progress',
        description: 'Update the watching progress of a video',
        request: {
          body: {
            content: {
              'application/json': {
                schema: videoProgressSchema
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Video progress updated successfully'
          }
        }
      }),
      async (c: any) => {
        const user = c.get('user')
        const body = await c.req.json()

        if (body.isCompleted) {
          await this.learningProgressService.markVideoCompleted(user.id, body.videoId)
        } else {
          await this.learningProgressService.updateVideoProgress(user.id, body.videoId, body.watchedSeconds)
        }
        return c.json({ success: true })
      }
    )
  }

  public getRouter() {
    return this.controller
  }
}
