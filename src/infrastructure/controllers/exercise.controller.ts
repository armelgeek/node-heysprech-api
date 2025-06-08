import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Routes } from '@/domain/types'
import { ExerciseDataSchema, HintSchema, MediaSchema } from '../../domain/types/exercise.types'
import { db } from '../database/db'
import {
  exerciseHints,
  exerciseMedia,
  exerciseOptions,
  exerciseQuestions,
  exercises,
  wordEntries
} from '../database/schema/exercise.schema'
import { videos } from '../database/schema/video.schema'

// Schema for exercise creation request
const CreateExerciseSchema = z.object({
  videoId: z.number(),
  wordId: z.number(),
  exerciseData: ExerciseDataSchema
})

// Schema for exercise update request
const UpdateExerciseSchema = z.object({
  exerciseData: ExerciseDataSchema.optional(),
  hints: z.array(HintSchema).optional(),
  media: z.array(MediaSchema).optional()
})

// Response schemas
const ExerciseResponseSchema = z.object({
  id: z.number(),
  videoId: z.number(),
  wordId: z.number(),
  type: z.enum([
    'multiple_choice_pair',
    'fill_in_blank',
    'sentence_formation',
    'listening_comprehension',
    'phrase_matching'
  ]),
  level: z.enum(['beginner', 'intermediate', 'advanced']),
  exerciseData: ExerciseDataSchema,
  hints: z.array(HintSchema).optional(),
  media: z.array(MediaSchema).optional(),
  createdAt: z.string()
})

const ErrorResponseSchema = z.object({
  success: z.boolean(),
  error: z.string()
})

const SuccessResponseSchema = z.object({
  success: z.boolean(),
  message: z.string()
})

export class ExerciseController implements Routes {
  public controller: OpenAPIHono

  constructor() {
    this.controller = new OpenAPIHono()
    this.initRoutes()
  }

  public getController() {
    return this.controller
  }

  public initRoutes() {
    // Get all exercises for a video
    this.controller.openapi(
      createRoute({
        method: 'get',
        path: '/videos/{videoId}/exercises',
        tags: ['Exercises'],
        summary: 'Get Exercises by Video',
        description: 'Retrieve all exercises associated with a specific video',
        parameters: [
          {
            name: 'videoId',
            in: 'path',
            required: true,
            schema: { type: 'number' },
            description: 'The ID of the video'
          }
        ],
        responses: {
          200: {
            content: {
              'application/json': {
                schema: z.array(ExerciseResponseSchema)
              }
            },
            description: 'List of exercises for the video'
          },
          404: {
            content: {
              'application/json': {
                schema: ErrorResponseSchema
              }
            },
            description: 'Video not found'
          },
          500: {
            content: {
              'application/json': {
                schema: ErrorResponseSchema
              }
            },
            description: 'Server error'
          }
        }
      }),
      async (c: any) => {
        const videoId = Number(c.req.param('videoId'))

        if (Number.isNaN(videoId)) {
          return c.json({ success: false, error: 'Invalid video ID' }, 400)
        }

        try {
          // Verify video exists
          const video = await db.query.videos.findFirst({
            where: eq(videos.id, videoId)
          })

          if (!video) {
            return c.json({ success: false, error: 'Video not found' }, 404)
          }

          // Get exercises with related data
          const exerciseResults = await db.query.exercises.findMany({
            where: eq(exercises.videoId, videoId),
            with: {
              questions: {
                with: {
                  options: true
                }
              },
              hints: true,
              media: true,
              wordEntry: true
            }
          })

          const formattedExercises = exerciseResults.map((exercise) => ({
            id: exercise.id,
            videoId,
            wordId: exercise.wordId,
            type: exercise.type,
            level: exercise.level,
            exerciseData: this.formatExerciseData(exercise),
            hints: exercise.hints?.map((h) => ({ text: h.hintText })),
            media: exercise.media?.map((m) => ({ type: m.mediaType, url: m.mediaUrl })),
            createdAt: exercise.createdAt?.toISOString()
          }))

          return c.json(formattedExercises)
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    // Create a new exercise
    this.controller.openapi(
      createRoute({
        method: 'post',
        path: '/exercises',
        tags: ['Exercises'],
        summary: 'Create Exercise',
        description: 'Create a new exercise for a video and word',
        request: {
          body: {
            content: {
              'application/json': {
                schema: CreateExerciseSchema
              }
            }
          }
        },
        responses: {
          201: {
            content: {
              'application/json': {
                schema: ExerciseResponseSchema
              }
            },
            description: 'Exercise created successfully'
          },
          400: {
            content: {
              'application/json': {
                schema: ErrorResponseSchema
              }
            },
            description: 'Invalid request data'
          },
          500: {
            content: {
              'application/json': {
                schema: ErrorResponseSchema
              }
            },
            description: 'Server error'
          }
        }
      }),
      async (c: any) => {
        try {
          const body = await c.req.json()
          const result = CreateExerciseSchema.safeParse(body)

          if (!result.success) {
            return c.json(
              {
                success: false,
                error: `Invalid data: ${result.error.message}`
              },
              400
            )
          }

          const { videoId, wordId, exerciseData } = result.data

          // Verify video and word exist
          const video = await db.query.videos.findFirst({
            where: eq(videos.id, videoId)
          })

          if (!video) {
            return c.json({ success: false, error: 'Video not found' }, 404)
          }

          const word = await db.query.wordEntries.findFirst({
            where: eq(wordEntries.id, wordId)
          })

          if (!word) {
            return c.json({ success: false, error: 'Word not found' }, 404)
          }

          // Create exercise
          const [newExercise] = await db
            .insert(exercises)
            .values({
              wordId,
              videoId,
              type: exerciseData.type,
              level: exerciseData.level,
              metadata: exerciseData
            })
            .returning()

          // Handle different exercise types
          await this.createExerciseQuestions(newExercise.id, exerciseData)

          return c.json(
            {
              id: newExercise.id,
              videoId,
              wordId,
              type: newExercise.type,
              level: newExercise.level,
              exerciseData,
              createdAt: newExercise.createdAt?.toISOString()
            },
            201
          )
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    // Update an exercise
    this.controller.openapi(
      createRoute({
        method: 'put',
        path: '/exercises/{exerciseId}',
        tags: ['Exercises'],
        summary: 'Update Exercise',
        description: 'Update an existing exercise',
        parameters: [
          {
            name: 'exerciseId',
            in: 'path',
            required: true,
            schema: { type: 'number' },
            description: 'The ID of the exercise to update'
          }
        ],
        request: {
          body: {
            content: {
              'application/json': {
                schema: UpdateExerciseSchema
              }
            }
          }
        },
        responses: {
          200: {
            content: {
              'application/json': {
                schema: ExerciseResponseSchema
              }
            },
            description: 'Exercise updated successfully'
          },
          404: {
            content: {
              'application/json': {
                schema: ErrorResponseSchema
              }
            },
            description: 'Exercise not found'
          },
          500: {
            content: {
              'application/json': {
                schema: ErrorResponseSchema
              }
            },
            description: 'Server error'
          }
        }
      }),
      async (c: any) => {
        const exerciseId = Number(c.req.param('exerciseId'))

        if (Number.isNaN(exerciseId)) {
          return c.json({ success: false, error: 'Invalid exercise ID' }, 400)
        }

        try {
          const body = await c.req.json()
          const result = UpdateExerciseSchema.safeParse(body)

          if (!result.success) {
            return c.json(
              {
                success: false,
                error: `Invalid data: ${result.error.message}`
              },
              400
            )
          }

          // Check if exercise exists
          const existingExercise = await db.query.exercises.findFirst({
            where: eq(exercises.id, exerciseId)
          })

          if (!existingExercise) {
            return c.json({ success: false, error: 'Exercise not found' }, 404)
          }

          const { exerciseData, hints, media } = result.data

          // Update exercise data if provided
          if (exerciseData) {
            await db
              .update(exercises)
              .set({
                type: exerciseData.type || existingExercise.type,
                level: exerciseData.level || existingExercise.level,
                metadata: exerciseData
              })
              .where(eq(exercises.id, exerciseId))
          }

          // Update hints if provided
          if (hints) {
            // Delete existing hints
            await db.delete(exerciseHints).where(eq(exerciseHints.exerciseId, exerciseId))

            // Insert new hints
            if (hints.length > 0) {
              await db.insert(exerciseHints).values(
                hints.map((hint) => ({
                  exerciseId,
                  hintText: hint.text
                }))
              )
            }
          }

          // Update media if provided
          if (media) {
            // Delete existing media
            await db.delete(exerciseMedia).where(eq(exerciseMedia.exerciseId, exerciseId))

            // Insert new media
            if (media.length > 0) {
              await db.insert(exerciseMedia).values(
                media.map((m) => ({
                  exerciseId,
                  mediaType: m.type,
                  mediaUrl: m.url
                }))
              )
            }
          }

          // Fetch updated exercise
          const updatedExercise = await db.query.exercises.findFirst({
            where: eq(exercises.id, exerciseId),
            with: {
              questions: { with: { options: true } },
              hints: true,
              media: true
            }
          })

          return c.json({
            id: updatedExercise!.id,
            videoId: updatedExercise!.videoId,
            wordId: updatedExercise!.wordId,
            type: updatedExercise!.type,
            level: updatedExercise!.level,
            exerciseData: this.formatExerciseData(updatedExercise!),
            hints: updatedExercise!.hints?.map((h) => ({ text: h.hintText })),
            media: updatedExercise!.media?.map((m) => ({ type: m.mediaType, url: m.mediaUrl })),
            createdAt: updatedExercise!.createdAt?.toISOString()
          })
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    // Delete an exercise
    this.controller.openapi(
      createRoute({
        method: 'delete',
        path: '/exercises/{exerciseId}',
        tags: ['Exercises'],
        summary: 'Delete Exercise',
        description: 'Delete an exercise and all its related data',
        parameters: [
          {
            name: 'exerciseId',
            in: 'path',
            required: true,
            schema: { type: 'number' },
            description: 'The ID of the exercise to delete'
          }
        ],
        responses: {
          200: {
            content: {
              'application/json': {
                schema: SuccessResponseSchema
              }
            },
            description: 'Exercise deleted successfully'
          },
          404: {
            content: {
              'application/json': {
                schema: ErrorResponseSchema
              }
            },
            description: 'Exercise not found'
          },
          500: {
            content: {
              'application/json': {
                schema: ErrorResponseSchema
              }
            },
            description: 'Server error'
          }
        }
      }),
      async (c: any) => {
        const exerciseId = Number(c.req.param('exerciseId'))

        if (Number.isNaN(exerciseId)) {
          return c.json({ success: false, error: 'Invalid exercise ID' }, 400)
        }

        try {
          const existingExercise = await db.query.exercises.findFirst({
            where: eq(exercises.id, exerciseId)
          })

          if (!existingExercise) {
            return c.json({ success: false, error: 'Exercise not found' }, 404)
          }

          // Delete exercise (cascade will handle related records)
          await db.delete(exercises).where(eq(exercises.id, exerciseId))

          return c.json({
            success: true,
            message: 'Exercise deleted successfully'
          })
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )
  }

  private async createExerciseQuestions(exerciseId: number, exerciseData: any) {
    switch (exerciseData.type) {
      case 'multiple_choice_pair':
        // Handle multiple choice questions
        if (exerciseData.de_to_fr) {
          const [question] = await db
            .insert(exerciseQuestions)
            .values({
              exerciseId,
              direction: 'de_to_fr',
              questionDe: exerciseData.de_to_fr.question.de,
              questionFr: exerciseData.de_to_fr.question.fr,
              wordToTranslate: exerciseData.de_to_fr.word_to_translate,
              correctAnswer: exerciseData.de_to_fr.correct_answer
            })
            .returning()

          // Add options
          const options = exerciseData.de_to_fr.options.map((option: string) => ({
            questionId: question.id,
            optionText: option,
            isCorrect: option === exerciseData.de_to_fr.correct_answer
          }))
          await db.insert(exerciseOptions).values(options)
        }

        if (exerciseData.fr_to_de) {
          const [question] = await db
            .insert(exerciseQuestions)
            .values({
              exerciseId,
              direction: 'fr_to_de',
              questionDe: exerciseData.fr_to_de.question.de,
              questionFr: exerciseData.fr_to_de.question.fr,
              wordToTranslate: exerciseData.fr_to_de.word_to_translate,
              correctAnswer: exerciseData.fr_to_de.correct_answer
            })
            .returning()

          // Add options
          const options = exerciseData.fr_to_de.options.map((option: string) => ({
            questionId: question.id,
            optionText: option,
            isCorrect: option === exerciseData.fr_to_de.correct_answer
          }))
          await db.insert(exerciseOptions).values(options)
        }
        break

      // For other exercise types, we would handle them differently
      // For now, we store the data in metadata
      default:
        // The exercise data is already stored in the metadata field
        break
    }
  }

  private formatExerciseData(exercise: any) {
    // Return the metadata which contains the exercise data
    return exercise.metadata || exercise
  }
}
