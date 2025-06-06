import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { eq } from 'drizzle-orm'
import { LearningProgressService } from '@/application/services/learning-progress.service'
import { VideoService } from '@/application/services/video.service'
import type { WordSegment } from '@/domain/interfaces/video-controller.types'
import type { Routes } from '@/domain/types'
import { db } from '../database/db'
import {
  audioSegments,
  exerciseOptions,
  exerciseQuestions,
  exercises,
  pronunciations,
  videos,
  wordEntries,
  wordSegments
} from '../database/schema'

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

const learningStatusResponseSchema = z
  .object({
    completedExercises: z.number(),
    masteredWords: z.number(),
    totalSegments: z.number(),
    progress: z.number(),
    lastActivity: z.string().optional()
  })
  .openapi('LearningStatus')

const segmentResponseSchema = z
  .object({
    id: z.number(),
    start: z.number(),
    end: z.number(),
    text: z.string(),
    translation: z.string().optional(),
    exerciseCount: z.number(),
    wordCount: z.number()
  })
  .openapi('VideoSegment')

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
  private videoService: VideoService

  constructor() {
    this.controller = new OpenAPIHono()
    this.videoService = new VideoService()
  }

  public initRoutes(): void {
    this.controller.use('/public/*', serveStatic({ root: baseDir }))
    this.controller.use('/audios/*', serveStatic({ root: baseDir }))
    this.controller.use('/transcriptions/*', serveStatic({ root: baseDir }))

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
          const file = body.audioFile as File

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
        } catch (error: unknown) {
          const err = error as Error
          return c.json({ success: false, error: err.message }, 500)
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
        const id = Number(c.req.param('id'))
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
        const id = Number.parseInt(c.req.param('id'), 10)
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
        path: '/videos/recent',
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

    this.controller.get('/videos', async (c: any) => {
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
            if (audioSegment && !audioSegment.wordSegments.some((ws: WordSegment) => ws.id === row.wordSegment?.id)) {
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
    this.controller.get('/videos/:id/exercises', async (c: any) => {
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
      const exercisesByDirection: Record<
        string,
        Array<{
          exercise: {
            id: number
            type: string
            level: string
          }
          word: {
            word: string
            translations: string[]
          }
          question: {
            id: number
            direction: string
            questionDe: string
            questionFr: string
            wordToTranslate: string
            correctAnswer: string
            options: Array<{
              id: number
              optionText: string
              isCorrect: boolean
            }>
          }
          segment: {
            id: number
            word: string
            text: string
          }
        }>
      > = {
        de_to_fr: [],
        fr_to_de: []
      }

      // Grouper les options par question
      const optionsByQuestion: Map<
        number,
        Array<{
          id: number
          optionText: string
          isCorrect: boolean
        }>
      > = new Map()

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
              translations: row.wordEntry.translations as string[]
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
          await db.delete(audioSegments)
          await db.delete(wordSegments)
          await db.delete(exerciseOptions)
          await db.delete(exerciseQuestions)
          await db.delete(exercises)
          await db.delete(pronunciations)
          await db.delete(wordEntries)

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
        const id = Number(c.req.param('id'))
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

    this.controller.openapi(
      createRoute({
        method: 'get',
        tags: ['Learning'],
        path: '/videos/{videoId}/learning-status',

        request: {
          params: z.object({
            videoId: z.number()
          })
        },
        responses: {
          200: {
            content: {
              'application/json': {
                schema: learningStatusResponseSchema
              }
            },
            description: 'Successfully retrieved video learning status'
          },
          404: {
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            },
            description: 'Video not found'
          }
        }
      }),
      async (c: any) => {
        const user = c.get('user')
        const userId = user.id
        const videoId = c.req.param('videoId')

        const videoService = new VideoService()
        const learningService = new LearningProgressService()

        const video = await videoService.getVideoById(videoId)
        if (!video) {
          return c.json({ success: false, error: 'Video not found' }, 404)
        }

        const status = await learningService.getVideoLearningStatus(userId, videoId)
        return c.json(status)
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'get',
        tags: ['Learning'],
        path: '/videos/{videoId}/segments',
        request: {
          params: z.object({
            videoId: z.number()
          }),
          query: z.object({
            offset: z.number().default(0),
            limit: z.number().default(10)
          })
        },
        responses: {
          200: {
            content: {
              'application/json': {
                schema: z.array(segmentResponseSchema)
              }
            },
            description: 'Successfully retrieved video segments'
          }
        }
      }),
      async (c: any) => {
        const videoId = c.req.param('videoId')

        // const videoService = new VideoService()
        const learningService = new LearningProgressService()
        const segments = await learningService.getVideoSegments(videoId)
        return c.json(segments)
      }
    )

    // Mark video segment as completed
    this.controller.openapi(
      createRoute({
        method: 'post',
        tags: ['Learning'],
        path: '/videos/{videoId}/segments/{segmentId}/complete',

        request: {
          params: z.object({
            videoId: z.number(),
            segmentId: z.number()
          })
        },
        responses: {
          200: {
            content: {
              'application/json': {
                schema: successResponseSchema
              }
            },
            description: 'Successfully marked segment as completed'
          }
        }
      }),
      async (c: any) => {
        const user = c.get('user')
        const videoId = c.req.param('videoId')
        const segmentId = c.req.param('segmentId')

        const learningService = new LearningProgressService()
        await learningService.completeVideoSegment(user.id, videoId, segmentId)

        return c.json({
          success: true,
          message: 'Segment marked as completed'
        })
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'get',
        path: '/videos/learning-status',
        tags: ['Learning'],
        security: [{ bearerAuth: [] }],
        summary: 'Get User Learning Status',
        description: 'Get the overall learning progress and statistics for the authenticated user',
        responses: {
          200: {
            content: {
              'application/json': {
                schema: learningStatusResponseSchema
              }
            },
            description: 'Successfully retrieved learning status'
          },
          401: {
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            },
            description: 'User not authenticated'
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
      async (c) => {
        const user = c.get('user')
        if (!user) {
          return c.json({ success: false, error: 'Unauthorized' }, 401)
        }

        try {
          const learningService = new LearningProgressService()
          const status = await learningService.getUserProgress(user.id)
          return c.json(status)
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'get',
        path: '/videos/{id}/segments',
        tags: ['Learning'],
        summary: 'Get Video Segments',
        description: 'Get all segments of a specific video',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'ID of the video',
            schema: { type: 'number' }
          }
        ],
        responses: {
          200: {
            content: {
              'application/json': {
                schema: z.array(segmentResponseSchema)
              }
            },
            description: 'Successfully retrieved video segments'
          },
          400: {
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            },
            description: 'Invalid video ID'
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
      async (c:any) => {
        const videoId = Number(c.req.param('id'))
        if (Number.isNaN(videoId)) {
          return c.json({ success: false, error: 'Invalid video ID' }, 400)
        }

        try {
          const learningService = new LearningProgressService()
          const segments = await learningService.getVideoSegments(videoId)
          return c.json(segments)
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'post',
        path: '/videos/{id}/segments/complete',
        tags: ['Learning'],
        security: [{ bearerAuth: [] }],
        summary: 'Complete All Video Segments',
        description: 'Mark all segments of a video as completed for the authenticated user',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'ID of the video',
            schema: { type: 'number' }
          }
        ],
        responses: {
          200: {
            content: {
              'application/json': {
                schema: successResponseSchema
              }
            },
            description: 'Successfully marked all segments as completed'
          },
          400: {
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            },
            description: 'Invalid video ID'
          },
          401: {
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            },
            description: 'User not authenticated'
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
      async (c:any) => {
        const user = c.get('user')
        const videoId = Number(c.req.param('id'))

        if (Number.isNaN(videoId)) {
          return c.json({ success: false, error: 'Invalid video ID' }, 400)
        }

        try {
          await this.videoService.completeVideoSegments(videoId, user.id)
          return c.json({ success: true, message: 'Segments marked as completed' })
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'get',
        path: '/videos/{id}/progress',
        tags: ['Learning'],
        summary: 'Get Video Progress',
        description: 'Get the learning progress for a specific video for the authenticated user',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'The ID of the video',
            schema: { type: 'number' }
          }
        ],
        responses: {
          200: {
            content: {
              'application/json': {
                schema: z
                  .object({
                    completedSegments: z.number(),
                    totalSegments: z.number(),
                    progress: z.number()
                  })
                  .openapi('VideoProgress')
              }
            },
            description: 'Successfully retrieved video progress'
          },
          400: {
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            },
            description: 'Invalid video ID'
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
      async (c:any) => {
        const user = c.get('user')
        const videoId = Number(c.req.param('id'))

        if (Number.isNaN(videoId)) {
          return c.json({ success: false, error: 'Invalid video ID' }, 400)
        }

        try {
          const progress = await this.videoService.getVideoProgress(videoId, user.id)
          return c.json(progress)
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )
  }

  public getRouter() {
    return this.controller
  }
}
