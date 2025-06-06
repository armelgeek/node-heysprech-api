import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { eq } from 'drizzle-orm'
import { html } from 'hono/html'
import { VideoService } from '@/application/services/video.service'
import { db } from '../database/db'
import {
  exerciseOptions,
  exerciseQuestions,
  exercises,
  pronunciations,
  wordEntries
} from '../database/schema/exercise.schema'
import { audioSegments, videos, wordSegments } from '../database/schema/video.schema'
import type { Routes } from '../../domain/types'

const baseDir = path.join(os.homedir(), 'heysprech-data')

const errorResponseSchema = z
  .object({
    success: z.boolean(),
    error: z.string()
  })
  .openapi('ErrorResponse')

const successResponseSchema = z
  .object({
    success: z.boolean(),
    message: z.string()
  })
  .openapi('SuccessResponse')

const videoSchema = z
  .object({
    id: z.number(),
    title: z.string(),
    originalFilename: z.string(),
    fileSize: z.number(),
    duration: z.number().optional(),
    youtubeId: z.string().length(11).optional(),
    language: z.string(),
    categoryId: z.number().optional(),
    difficultyId: z.number().optional(),
    transcriptionStatus: z.enum(['pending', 'processing', 'completed', 'failed']),
    errorMessage: z.string().optional(),
    createdAt: z.string(),
    processedAt: z.string().optional()
  })
  .openapi('Video')

const queueStatusSchema = z
  .object({
    waiting: z.number(),
    active: z.number(),
    completed: z.number(),
    failed: z.number()
  })
  .openapi('QueueStatus')

// Request Schemas
const uploadRequestSchema = z.object({
  language: z.string().default('de').openapi({
    description: 'The language of the audio file',
    example: 'de'
  }),
  title: z.string().optional().openapi({
    description: 'Optional title for the audio file',
    example: 'My Audio File'
  }),
  youtubeId: z.string().length(11).optional().openapi({
    description: 'Optional YouTube video ID for reference',
    example: 'dQw4w9WgXcQ'
  }),
  categoryId: z.number().optional().openapi({
    description: 'Optional category ID to assign to the video',
    example: 1
  }),
  difficultyId: z.number().optional().openapi({
    description: 'Optional difficulty level ID to assign to the video',
    example: 1
  }),
  audioFile: z.custom<File>().openapi({
    type: 'string',
    format: 'binary',
    description: 'The audio file to process'
  })
})

const uploadResponseSchema = z.object({
  success: z.boolean().openapi({
    description: 'Whether the upload was successful',
    example: true
  }),
  videoId: z.number().openapi({
    description: 'The ID of the uploaded video',
    example: 123
  }),
  filename: z.string().openapi({
    description: 'The name of the uploaded file',
    example: 'audio-recording.mp3'
  }),
  size: z.number().openapi({
    description: 'Size of the uploaded file in bytes',
    example: 1048576
  }),
  message: z.string().openapi({
    description: 'Status message about the upload',
    example: 'File added to processing queue'
  })
})

export class VideoController implements Routes {
  public controller: OpenAPIHono
  app: any
  videoService: VideoService

  constructor() {
    this.controller = new OpenAPIHono()
    this.videoService = new VideoService()
  }

  public initRoutes() {
    this.controller.use('/public/*', serveStatic({ root: baseDir }))
    this.controller.use('/audios/*', serveStatic({ root: baseDir }))
    this.controller.use('/transcriptions/*', serveStatic({ root: baseDir }))

    this.controller.get('/', (c) => {
      return c.html(this.renderHomePage())
    })

    this.controller.openapi(
      createRoute({
        method: 'post',
        path: '/v1/upload-audio',
        tags: ['Upload'],
        summary: 'Upload',
        description: 'Upload',
        request: {
          body: {
            content: {
              'multipart/form-data': {
                schema: uploadRequestSchema
              }
            }
          }
        },
        responses: {
          200: {
            content: {
              'application/json': {
                schema: uploadResponseSchema
              }
            },
            description: 'File uploaded successfully'
          },
          400: {
            content: {
              'application/json': {
                schema: z.object({
                  success: z.boolean(),
                  error: z.string()
                })
              }
            },
            description: 'Invalid request'
          }
        }
      }),
      async (c: any) => {
        try {
          const body = await c.req.parseBody()
          const file = body.audioFile

          if (!file || !(file instanceof File)) {
            return c.json(
              {
                success: false,
                error: 'Audio file is required'
              },
              400
            )
          }

          const allowedTypes = ['audio/mpeg', 'audio/wav', 'audio/x-m4a', 'video/mp4', 'video/avi', 'video/quicktime']
          if (!allowedTypes.includes(file.type)) {
            return c.json(
              {
                success: false,
                error: 'Unsupported file type. Accepted types: MP3, WAV, M4A, MP4, AVI, MOV'
              },
              400
            )
          }

          const formData = {
            language: body.language as string,
            title: body.title as string | undefined,
            youtubeId: body.youtubeId as string | undefined,
            categoryId: body.categoryId ? Number(body.categoryId) : undefined,
            difficultyId: body.difficultyId ? Number(body.difficultyId) : undefined
          }

          const result = uploadRequestSchema.safeParse(formData)
          if (!result.success) {
            return c.json(
              {
                success: false,
                error: `Invalid data: ${result.error.message}`
              },
              400
            )
          }

          // Validate category and difficulty IDs if provided
          if (formData.categoryId && Number.isNaN(formData.categoryId)) {
            return c.json(
              {
                success: false,
                error: 'Invalid category ID'
              },
              400
            )
          }

          if (formData.difficultyId && Number.isNaN(formData.difficultyId)) {
            return c.json(
              {
                success: false,
                error: 'Invalid difficulty ID'
              },
              400
            )
          }

          // Trouve un nom de fichier unique
          const getUniqueFilePath = async (baseName: string) => {
            let counter = 0
            let filePath = path.join(baseDir, 'audios', baseName)

            while (true) {
              try {
                await fs.access(filePath)
                counter++
                const ext = path.extname(baseName)
                const nameWithoutExt = path.basename(baseName, ext)
                filePath = path.join(baseDir, 'audios', `${nameWithoutExt}-${counter}${ext}`)
              } catch {
                // Le fichier n'existe pas, on peut utiliser ce nom
                return filePath
              }
            }
          }

          const tempPath = await getUniqueFilePath(file.name)
          await Bun.write(tempPath, file)

          const videoFile = {
            filename: file.name,
            originalname: file.name,
            path: tempPath,
            size: file.size
          }

          const video = await this.videoService.uploadVideo(videoFile, {
            language: formData.language,
            title: formData.title,
            youtubeId: formData.youtubeId,
            categoryId: formData.categoryId,
            difficultyId: formData.difficultyId
          })

          return c.json({
            success: true,
            videoId: video.id,
            filename: video.originalFilename,
            size: video.fileSize,
            message: 'File added to processing queue'
          })
        } catch (error: any) {
          console.error('Upload error:', error.message)
          return c.json(
            {
              success: false,
              error: `Processing error: ${error.message}`
            },
            500
          )
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'get',
        path: '/queue/status',
        tags: ['Queue'],
        summary: 'Get Queue Status',
        description: 'Retrieve current status of the processing queue',
        responses: {
          200: {
            content: {
              'application/json': {
                schema: queueStatusSchema
              }
            },
            description: 'Current queue statistics'
          },
          500: {
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            },
            description: 'Server error'
          }
        }
      }),
      async (c: any) => {
        try {
          const stats = await this.videoService.getQueueStatus()
          return c.json(stats)
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'post',
        path: '/queue/clean',
        tags: ['Queue'],
        summary: 'Clean Queue',
        description: 'Remove completed and failed jobs from the queue',
        responses: {
          200: {
            content: {
              'application/json': {
                schema: successResponseSchema
              }
            },
            description: 'Queue cleaned successfully'
          },
          500: {
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            },
            description: 'Server error'
          }
        }
      }),
      async (c: any) => {
        try {
          await this.videoService.cleanQueue()
          return c.json({
            success: true,
            message: 'Queue cleaned successfully'
          })
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'get',
        path: '/videos/recent',
        tags: ['Videos'],
        summary: 'Get Recent Videos',
        description: 'Retrieve a list of recently processed videos',
        responses: {
          200: {
            content: {
              'application/json': {
                schema: z.array(videoSchema)
              }
            },
            description: 'List of recent videos'
          },
          500: {
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            },
            description: 'Server error'
          }
        }
      }),
      async (c: any) => {
        try {
          const videos = await this.videoService.getRecentVideos(20)
          return c.json(videos)
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'delete',
        path: '/videos/info/{id}',
        tags: ['Videos'],
        summary: 'Delete Video',
        description: 'Delete a video and its associated files',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'The ID of the video to delete'
          }
        ],
        responses: {
          200: {
            content: {
              'application/json': {
                schema: successResponseSchema
              }
            },
            description: 'Video deleted successfully'
          },
          500: {
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            },
            description: 'Server error'
          }
        }
      }),
      async (c: any) => {
        const id = Number.parseInt(c.req.param('id'))
        if (Number.isNaN(id)) {
          return c.json({ success: false, error: 'Invalid video ID' }, 400)
        }
        try {
          await this.videoService.deleteVideo(id)
          return c.json({
            success: true,
            message: 'Video and associated files deleted'
          })
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'post',
        path: '/videos/{id}/retry',
        tags: ['Videos'],
        summary: 'Retry Video Processing',
        description: 'Retry processing a failed video',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'The ID of the video to retry'
          }
        ],
        responses: {
          200: {
            content: {
              'application/json': {
                schema: successResponseSchema
              }
            },
            description: 'Processing restarted successfully'
          },
          500: {
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            },
            description: 'Server error'
          }
        }
      }),
      async (c: any) => {
        const id = Number.parseInt(c.req.param('id'))
        if (Number.isNaN(id)) {
          return c.json({ success: false, error: 'Invalid video ID' }, 400)
        }
        try {
          await this.videoService.retryProcessing(id)
          return c.json({
            success: true,
            message: 'Processing restarted'
          })
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'get',
        path: '/api/videos/recent',
        tags: ['Videos'],
        summary: 'Get Recent Videos API',
        description: 'Retrieve a list of the 10 most recently processed videos',
        responses: {
          200: {
            content: {
              'application/json': {
                schema: z.array(videoSchema)
              }
            },
            description: 'List of recent videos'
          },
          500: {
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            },
            description: 'Server error'
          }
        }
      }),
      async (c: any) => {
        try {
          const videos = await this.videoService.getRecentVideos(10)
          return c.json(
            videos.map((v) => {
              const video = v.toJSON()
              return {
                id: video.id,
                title: video.title,
                originalFilename: video.originalFilename,
                duration: video.duration,
                youtubeId: video.youtubeId,
                language: video.language,
                transcriptionStatus: video.transcriptionStatus,
                errorMessage: video.errorMessage,
                createdAt: video.createdAt,
                processedAt: video.processedAt
              }
            })
          )
        } catch (error: any) {
          console.error('Error fetching recent videos:', error.message)
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    this.controller.get('/videos', async (c) => {
      const result = await db
        .select({
          video: {
            id: videos.id,
            title: videos.title,
            originalFilename: videos.originalFilename,
            filePath: videos.filePath,
            fileSize: videos.fileSize,
            duration: videos.duration,
            language: videos.language,
            duration: videos.duration,
            youtubeId: videos.youtubeId,
            transcriptionStatus: videos.transcriptionStatus,
            createdAt: videos.createdAt,
            updatedAt: videos.updatedAt
          },
          audioSegment: {
            id: audioSegments.id,
            startTime: audioSegments.startTime,
            endTime: audioSegments.endTime,
            text: audioSegments.text,
            translation: audioSegments.translation,
            language: audioSegments.language
          },
          wordSegment: {
            id: wordSegments.id,
            word: wordSegments.word,
            startTime: wordSegments.startTime,
            endTime: wordSegments.endTime,
            confidenceScore: wordSegments.confidenceScore,
            positionInSegment: wordSegments.positionInSegment
          }
        })
        .from(videos)
        .innerJoin(audioSegments, eq(audioSegments.videoId, videos.id))
        .innerJoin(wordSegments, eq(wordSegments.audioSegmentId, audioSegments.id))
        .orderBy(wordSegments.startTime, wordSegments.endTime)

      // Restructurer les résultats pour grouper les segments par vidéo
      const videosMap = new Map()

      result.forEach((row) => {
        if (!videosMap.has(row.video.id)) {
          videosMap.set(row.video.id, {
            ...row.video,
            audioSegments: []
          })
        }

        const video = videosMap.get(row.video.id)

        if (row.audioSegment) {
          const existingAudioSegment = video.audioSegments.find((segment: any) => segment.id === row.audioSegment?.id)

          if (!existingAudioSegment) {
            video.audioSegments.push({
              ...row.audioSegment,
              wordSegments: []
            })
          }

          if (row.wordSegment) {
            const audioSegment = video.audioSegments.find((segment: any) => segment.id === row.audioSegment?.id)
            if (audioSegment && !audioSegment.wordSegments.some((ws: any) => ws.id === row.wordSegment?.id)) {
              let inserted = false
              // Insérer le word segment à la bonne position
              for (let i = 0; i < audioSegment.wordSegments.length; i++) {
                if (audioSegment.wordSegments[i].positionInSegment > row.wordSegment.positionInSegment) {
                  audioSegment.wordSegments.splice(i, 0, row.wordSegment)
                  inserted = true
                  break
                }
              }
              // Si on n'a pas inséré le segment (c'est qu'il va à la fin)
              if (!inserted) {
                audioSegment.wordSegments.push(row.wordSegment)
              }
            }
          }
        }
      })

      return c.json(Array.from(videosMap.values()))
    })

    // Récupérer tous les segments audio
    this.controller.get('/audio-segments', async (c) => {
      const result = await db
        .select({
          id: audioSegments.id,
          videoId: audioSegments.videoId,
          startTime: audioSegments.startTime,
          endTime: audioSegments.endTime,
          text: audioSegments.text,
          translation: audioSegments.translation,
          language: audioSegments.language
        })
        .from(audioSegments)
      return c.json(result)
    })

    // Récupérer tous les segments de mots
    this.controller.get('/word-segments', async (c) => {
      const result = await db
        .select({
          id: wordSegments.id,
          audioSegmentId: wordSegments.audioSegmentId,
          word: wordSegments.word,
          startTime: wordSegments.startTime,
          endTime: wordSegments.endTime,
          confidenceScore: wordSegments.confidenceScore,
          positionInSegment: wordSegments.positionInSegment
        })
        .from(wordSegments)
      return c.json(result)
    })

    // Récupérer toutes les entrées de mots
    this.controller.get('/word-entries', async (c) => {
      const result = await db
        .select({
          id: wordEntries.id,
          word: wordEntries.word,
          language: wordEntries.language,
          translations: wordEntries.translations,
          examples: wordEntries.examples,
          level: wordEntries.level,
          metadata: wordEntries.metadata
        })
        .from(wordEntries)
      return c.json(result)
    })

    // Récupérer tous les exercices
    this.controller.get('/exercises', async (c) => {
      const result = await db
        .select({
          id: exercises.id,
          wordId: exercises.wordId,
          type: exercises.type,
          level: exercises.level,
          createdAt: exercises.createdAt
        })
        .from(exercises)
      return c.json(result)
    })

    // Récupérer toutes les questions d'exercices
    this.controller.get('/exercise-questions', async (c) => {
      const result = await db
        .select({
          id: exerciseQuestions.id,
          exerciseId: exerciseQuestions.exerciseId,
          direction: exerciseQuestions.direction,
          questionDe: exerciseQuestions.questionDe,
          questionFr: exerciseQuestions.questionFr,
          wordToTranslate: exerciseQuestions.wordToTranslate,
          correctAnswer: exerciseQuestions.correctAnswer
        })
        .from(exerciseQuestions)
      return c.json(result)
    })

    // Récupérer toutes les options d'exercices
    this.controller.get('/exercise-options', async (c) => {
      const result = await db
        .select({
          id: exerciseOptions.id,
          questionId: exerciseOptions.questionId,
          optionText: exerciseOptions.optionText,
          isCorrect: exerciseOptions.isCorrect
        })
        .from(exerciseOptions)
      return c.json(result)
    })

    // Supprimer toutes les vidéos et leurs données associées
    this.controller.delete('/videos/all', async (c) => {
      try {
        // Supprimer d'abord les données associées
        await db.delete(audioSegments)
        await db.delete(wordSegments)
        await db.delete(exerciseOptions)
        await db.delete(exerciseQuestions)
        await db.delete(exercises)
        await db.delete(pronunciations)
        await db.delete(wordEntries)

        // Supprimer les vidéos
        await db.delete(videos)

        return c.json({
          success: true,
          message: 'Toutes les vidéos et leurs données associées ont été supprimées'
        })
      } catch (error: any) {
        console.error('Error deleting all videos:', error)
        return c.json(
          {
            success: false,
            error: `Erreur lors de la suppression: ${error.message}`
          },
          500
        )
      }
    })

    // Récupérer toutes les prononciations
    this.controller.get('/pronunciations', async (c) => {
      const result = await db
        .select({
          id: pronunciations.id,
          wordId: pronunciations.wordId,
          filePath: pronunciations.filePath,
          type: pronunciations.type,
          language: pronunciations.language
        })
        .from(pronunciations)
      return c.json(result)
    })

    this.controller.openapi(
      createRoute({
        method: 'delete',
        path: '/videos/all',
        tags: ['Videos'],
        summary: 'Delete All Videos',
        description: 'Delete all videos and their associated data from the database',
        responses: {
          200: {
            content: {
              'application/json': {
                schema: successResponseSchema
              }
            },
            description: 'All videos successfully deleted'
          },
          500: {
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            },
            description: 'Server error'
          }
        }
      }),
      async (c: any) => {
        try {
          // Supprimer les données associées dans l'ordre pour respecter les contraintes de clés étrangères
          await db.delete(exerciseOptions)
          await db.delete(exerciseQuestions)
          await db.delete(exercises)
          await db.delete(pronunciations)
          await db.delete(wordEntries)
          await db.delete(wordSegments)
          await db.delete(audioSegments)
          await db.delete(videos)

          return c.json({
            success: true,
            message: 'Toutes les vidéos et leurs données associées ont été supprimées'
          })
        } catch (error: any) {
          console.error('Error deleting all videos:', error)
          return c.json(
            {
              success: false,
              error: `Erreur lors de la suppression: ${error.message}`
            },
            500
          )
        }
      }
    )

    // Supprimer toutes les vidéos
    this.controller.delete('/videos/all', async (c) => {
      try {
        // Supprimer les données associées dans l'ordre pour respecter les contraintes de clés étrangères
        await db.delete(exerciseOptions)
        await db.delete(exerciseQuestions)
        await db.delete(exercises)
        await db.delete(pronunciations)
        await db.delete(wordEntries)
        await db.delete(wordSegments)
        await db.delete(audioSegments)
        await db.delete(videos)

        return c.json({
          success: true,
          message: 'Toutes les vidéos et leurs données associées ont été supprimées'
        })
      } catch (error: any) {
        console.error('Error deleting all videos:', error)
        return c.json(
          {
            success: false,
            error: `Erreur lors de la suppression: ${error.message}`
          },
          500
        )
      }
    })

    // Supprimer toutes les vidéos
    this.controller.openapi(
      createRoute({
        method: 'delete',
        path: '/videos/all',
        tags: ['Videos'],
        summary: 'Delete All Videos',
        description: 'Delete all videos and their associated data from the database',
        responses: {
          200: {
            content: {
              'application/json': {
                schema: successResponseSchema
              }
            },
            description: 'All videos deleted successfully'
          },
          500: {
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            },
            description: 'Server error'
          }
        }
      }),
      async (c: any) => {
        try {
          // Supprimer d'abord les données associées (segments, exercices, etc.)
          await db.delete(audioSegments)
          await db.delete(wordSegments)
          await db.delete(exerciseOptions)
          await db.delete(exerciseQuestions)
          await db.delete(exercises)
          await db.delete(pronunciations)
          await db.delete(wordEntries)

          // Supprimer enfin les vidéos
          await db.delete(videos)

          return c.json({
            success: true,
            message: 'Toutes les vidéos et leurs données associées ont été supprimées'
          })
        } catch (error: any) {
          console.error('Error deleting all videos:', error)
          return c.json(
            {
              success: false,
              error: `Erreur lors de la suppression: ${error.message}`
            },
            500
          )
        }
      }
    )

    // Récupérer les exercices d'une vidéo avec leurs questions et options, groupés par direction
    this.controller.get('/videos/:id/exercises', async (c) => {
      const videoId = Number(c.req.param('id'))

      if (Number.isNaN(videoId)) {
        return c.json({ error: 'ID de vidéo invalide' }, 400)
      }

      // Récupérer tous les exercices liés à la vidéo en une seule requête
      const exercisesData = await db
        .select({
          audioSegment: {
            id: audioSegments.id,
            text: audioSegments.text
          },
          wordSegment: {
            id: wordSegments.id,
            word: wordSegments.word
          },
          wordEntry: {
            id: wordEntries.id,
            word: wordEntries.word,
            translations: wordEntries.translations
          },
          exercise: {
            id: exercises.id,
            type: exercises.type,
            level: exercises.level,
            wordId: exercises.wordId
          },
          question: {
            id: exerciseQuestions.id,
            direction: exerciseQuestions.direction,
            questionDe: exerciseQuestions.questionDe,
            questionFr: exerciseQuestions.questionFr,
            wordToTranslate: exerciseQuestions.wordToTranslate,
            correctAnswer: exerciseQuestions.correctAnswer
          },
          option: {
            id: exerciseOptions.id,
            optionText: exerciseOptions.optionText,
            isCorrect: exerciseOptions.isCorrect
          }
        })
        .from(audioSegments)
        .innerJoin(wordSegments, eq(wordSegments.audioSegmentId, audioSegments.id))
        .innerJoin(wordEntries, eq(wordEntries.word, wordSegments.word))
        .innerJoin(exercises, eq(exercises.wordId, wordEntries.id))
        .innerJoin(exerciseQuestions, eq(exerciseQuestions.exerciseId, exercises.id))
        .leftJoin(exerciseOptions, eq(exerciseOptions.questionId, exerciseQuestions.id))
        .where(eq(audioSegments.videoId, videoId))

      // Organiser les résultats par direction
      const exercisesByDirection: Record<string, any[]> = {
        de_to_fr: [],
        fr_to_de: []
      }

      // Grouper les options par question
      const optionsByQuestion = new Map()
      exercisesData.forEach((row) => {
        if (row.option && row.question) {
          if (!optionsByQuestion.has(row.question.id)) {
            optionsByQuestion.set(row.question.id, [])
          }
          optionsByQuestion.get(row.question.id).push({
            id: row.option.id,
            optionText: row.option.optionText,
            isCorrect: row.option.isCorrect
          })
        }
      })

      // Traiter les résultats
      const processedExercises = new Set()
      exercisesData.forEach((row) => {
        if (!row.exercise || !row.question || !row.wordEntry || !row.wordSegment) return

        const direction = row.question.direction
        if (!processedExercises.has(row.exercise.id)) {
          exercisesByDirection[direction].push({
            exercise: {
              id: row.exercise.id,
              type: row.exercise.type,
              level: row.exercise.level
            },
            word: {
              word: row.wordEntry.word,
              translations: row.wordEntry.translations
            },
            question: {
              id: row.question.id,
              direction: row.question.direction,
              questionDe: row.question.questionDe,
              questionFr: row.question.questionFr,
              wordToTranslate: row.question.wordToTranslate,
              correctAnswer: row.question.correctAnswer,
              options: optionsByQuestion.get(row.question.id) || []
            },
            segment: {
              id: row.wordSegment.id,
              word: row.wordSegment.word,
              text: row.audioSegment.text
            }
          })
          processedExercises.add(row.exercise.id)
        }
      })

      return c.json(exercisesByDirection)
    })

    this.controller.openapi(
      createRoute({
        method: 'delete',
        path: '/videos/all',
        tags: ['Videos'],
        summary: 'Delete All Videos',
        description: 'Delete all videos and their associated data from the database',
        responses: {
          200: {
            content: {
              'application/json': {
                schema: successResponseSchema
              }
            },
            description: 'All videos deleted successfully'
          },
          500: {
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            },
            description: 'Server error'
          }
        }
      }),
      async (c: any) => {
        try {
          // Supprimer d'abord les données associées (segments, exercices, etc.)
          await db.delete(audioSegments)
          await db.delete(wordSegments)
          await db.delete(exerciseOptions)
          await db.delete(exerciseQuestions)
          await db.delete(exercises)
          await db.delete(pronunciations)
          await db.delete(wordEntries)

          // Supprimer enfin les vidéos
          await db.delete(videos)

          return c.json({
            success: true,
            message: 'Toutes les vidéos et leurs données associées ont été supprimées'
          })
        } catch (error: any) {
          console.error('Error deleting all videos:', error)
          return c.json(
            {
              success: false,
              error: `Erreur lors de la suppression: ${error.message}`
            },
            500
          )
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'patch',
        path: '/videos/{id}/categorize',
        tags: ['Videos'],
        summary: 'Update Video Category and Difficulty',
        description: 'Update the category and difficulty level of a video',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'The ID of the video to update',
            schema: { type: 'number' }
          }
        ],
        request: {
          body: {
            content: {
              'application/json': {
                schema: z.object({
                  categoryId: z.number().optional().openapi({
                    description: 'The ID of the category to assign to the video'
                  }),
                  difficultyId: z.number().optional().openapi({
                    description: 'The ID of the difficulty level to assign to the video'
                  })
                })
              }
            }
          }
        },
        responses: {
          200: {
            content: {
              'application/json': {
                schema: videoSchema
              }
            },
            description: 'Video categorization updated successfully'
          },
          400: {
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            },
            description: 'Invalid request data'
          },
          404: {
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            },
            description: 'Video not found'
          },
          500: {
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            },
            description: 'Server error'
          }
        }
      }),
      async (c: any) => {
        const id = Number.parseInt(c.req.param('id'))
        if (Number.isNaN(id)) {
          return c.json({ success: false, error: 'Invalid video ID' }, 400)
        }

        try {
          const body = await c.req.json()
          const video = await this.videoService.updateVideoCategory(id, {
            categoryId: body.categoryId,
            difficultyId: body.difficultyId
          })

          if (!video) {
            return c.json({ success: false, error: 'Video not found' }, 404)
          }

          return c.json(video)
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'get',
        path: '/videos/filter',
        tags: ['Videos'],
        summary: 'Filter Videos',
        description: 'Filter videos by category and difficulty level',
        parameters: [
          {
            name: 'categoryId',
            in: 'query',
            required: false,
            description: 'Filter by video category ID',
            schema: { type: 'number' }
          },
          {
            name: 'difficultyId',
            in: 'query',
            required: false,
            description: 'Filter by difficulty level ID',
            schema: { type: 'number' }
          }
        ],
        responses: {
          200: {
            content: {
              'application/json': {
                schema: z.array(videoSchema)
              }
            },
            description: 'List of filtered videos'
          },
          400: {
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            },
            description: 'Invalid request data'
          },
          500: {
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            },
            description: 'Server error'
          }
        }
      }),
      async (c: any) => {
        try {
          const categoryId = c.req.query('categoryId') ? Number(c.req.query('categoryId')) : undefined
          const difficultyId = c.req.query('difficultyId') ? Number(c.req.query('difficultyId')) : undefined

          if (
            (categoryId !== undefined && Number.isNaN(categoryId)) ||
            (difficultyId !== undefined && Number.isNaN(difficultyId))
          ) {
            return c.json({ success: false, error: 'Invalid category or difficulty ID' }, 400)
          }

          const videos = await this.videoService.getFilteredVideos({
            categoryId,
            difficultyId
          })

          return c.json(videos)
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )
  }

  private renderHomePage() {
    return html`
      <!DOCTYPE html>
      <html>
        <head>
          <title>API Documentation</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              max-width: 800px;
              margin: 0 auto;
              padding: 40px 20px;
              line-height: 1.6;
              background-color: #f8f9fa;
            }
            .container {
              text-align: center;
              background-color: white;
              padding: 40px;
              border-radius: 10px;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            }
            .links {
              margin-top: 40px;
              display: flex;
              justify-content: center;
              gap: 20px;
              flex-wrap: wrap;
            }
            .link-button {
              display: inline-block;
              padding: 15px 30px;
              background-color: #0066cc;
              color: white;
              text-decoration: none;
              border-radius: 5px;
              font-weight: bold;
              transition: background-color 0.2s;
              min-width: 200px;
            }
            .link-button:hover {
              background-color: #0052a3;
              transform: translateY(-2px);
            }
            .description {
              color: #666;
              margin: 20px 0;
              font-size: 1.1em;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🚀 API Documentation</h1>
            <p class="description">Access the documentation and API references for the Audio Processing System</p>

            <div class="links">
              <a href="/docs" class="link-button">📚 Documentation</a>
              <a href="/api/auth/reference" class="link-button">🔧 API Reference</a>
            </div>
          </div>
        </body>
      </html>
    `
  }

  public getRouter() {
    return this.controller
  }
}
