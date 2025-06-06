import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { eq, sql, desc, and, not } from 'drizzle-orm'
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

interface TimingUpdateResult {
  segment: {
    id: number;
    startTime: number;
    endTime: number;
  };
  words: Array<{
    id: number;
    startTime: number;
    endTime: number;
    confidenceScore: number;
  }>;
}

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
        path: '/videos',
        tags: ['Videos'],
        summary: 'Get All Videos',
        description: 'Retrieve a simplified list of all videos with basic information and counts',
        responses: {
          200: {
            description: 'List of videos with essential information',
            content: {
              'application/json': {
                schema: z.array(
                  z.object({
                    id: z.number(),
                    title: z.string(),
                    originalFilename: z.string(), 
                    fileSize: z.number(),
                    duration: z.number().nullable(),
                    language: z.string(),
                    youtubeId: z.string().nullable(),
                    transcriptionStatus: z.string(),
                    createdAt: z.string(),
                    segmentCount: z.number(),
                    wordCount: z.number()
                  })
                )
              }
            }
          },
          500: {
            description: 'Server error',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }),
      async (c: any) => {
        try {
          // Query to get basic video info along with segment and word counts
          const result = await db
            .select({
              id: videos.id,
              title: videos.title,
              originalFilename: videos.originalFilename,
              fileSize: videos.fileSize,
              duration: videos.duration,
              language: videos.language,
              youtubeId: videos.youtubeId,
              transcriptionStatus: videos.transcriptionStatus,
              createdAt: videos.createdAt,
              segmentCount: sql<number>`count(distinct ${audioSegments.id})`,
              wordCount: sql<number>`count(distinct ${wordSegments.id})`
            })
            .from(videos)
            .leftJoin(audioSegments, eq(audioSegments.videoId, videos.id))
            .leftJoin(wordSegments, eq(wordSegments.audioSegmentId, audioSegments.id))
            .groupBy(
              videos.id,
              videos.title,
              videos.originalFilename,
              videos.fileSize,
              videos.duration,
              videos.language,
              videos.youtubeId,
              videos.transcriptionStatus,
              videos.createdAt
            )
            .orderBy(desc(videos.createdAt))

          return c.json(result)
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'get',
        path: '/audio-segments',
        tags: ['Audio'],
        summary: 'Get All Audio Segments',
        description: 'Retrieve all audio segments from all videos',
        responses: {
          200: {
            description: 'List of all audio segments',
            content: {
              'application/json': {
                schema: z.array(
                  z.object({
                    id: z.number(),
                    videoId: z.number(),
                    startTime: z.number(),
                    endTime: z.number(),
                    text: z.string(),
                    translation: z.string().nullable(),
                    language: z.string()
                  })
                )
              }
            }
          },
          500: {
            description: 'Server error',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }),
      async (c: any) => {
        try {
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
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'get',
        path: '/word-segments',
        tags: ['Word Segments'],
        summary: 'Get All Word Segments',
        description: 'Retrieve all word segments from all audio segments',
        responses: {
          200: {
            description: 'List of all word segments',
            content: {
              'application/json': {
                schema: z.array(
                  z.object({
                    id: z.number(),
                    audioSegmentId: z.number(),
                    word: z.string(),
                    startTime: z.number(),
                    endTime: z.number(),
                    confidenceScore: z.number(),
                    positionInSegment: z.number()
                  })
                )
              }
            }
          },
          500: {
            description: 'Server error',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }),
      async (c: any) => {
        try {
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
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'get',
        path: '/word-entries',
        tags: ['Words'],
        summary: 'Get All Word Entries',
        description: 'Retrieve all word entries with their translations and examples',
        responses: {
          200: {
            description: 'List of all word entries',
            content: {
              'application/json': {
                schema: z.array(
                  z.object({
                    id: z.number(),
                    word: z.string(),
                    language: z.string(),
                    translations: z.array(z.string()),
                    examples: z.array(z.string()),
                    level: z.string(),
                    metadata: z.record(z.unknown())
                  })
                )
              }
            }
          },
          500: {
            description: 'Server error',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }),
      async (c) => {
        try {
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
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'get',
        path: '/exercises',
        tags: ['Exercises'],
        summary: 'Get All Exercises',
        description: 'Retrieve all exercises and their details',
        responses: {
          200: {
            description: 'List of all exercises',
            content: {
              'application/json': {
                schema: z.array(
                  z.object({
                    id: z.number(),
                    wordId: z.number(),
                    type: z.string(),
                    level: z.string(),
                    createdAt: z.string().datetime()
                  })
                )
              }
            }
          },
          500: {
            description: 'Server error',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }),
      async (c: any) => {
        try {
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
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'get',
        path: '/exercise-questions',
        tags: ['Exercises'],
        summary: 'Get All Exercise Questions',
        description: 'Retrieve all exercise questions with their details',
        responses: {
          200: {
            description: 'List of all exercise questions',
            content: {
              'application/json': {
                schema: z.array(
                  z.object({
                    id: z.number(),
                    exerciseId: z.number(),
                    direction: z.string(),
                    questionDe: z.string(),
                    questionFr: z.string(),
                    wordToTranslate: z.string(),
                    correctAnswer: z.string()
                  })
                )
              }
            }
          },
          500: {
            description: 'Server error',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }),
      async (c: any) => {
        try {
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
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'get',
        path: '/exercise-options',
        tags: ['Exercises'],
        summary: 'Get All Exercise Options',
        description: 'Retrieve all exercise options for multiple choice questions',
        responses: {
          200: {
            description: 'List of all exercise options',
            content: {
              'application/json': {
                schema: z.array(
                  z.object({
                    id: z.number(),
                    questionId: z.number(),
                    optionText: z.string(),
                    isCorrect: z.boolean()
                  })
                )
              }
            }
          },
          500: {
            description: 'Server error',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }),
      async (c: any) => {
        try {
          const result = await db
            .select({
              id: exerciseOptions.id,
              questionId: exerciseOptions.questionId,
              optionText: exerciseOptions.optionText,
              isCorrect: exerciseOptions.isCorrect
            })
            .from(exerciseOptions)
          return c.json(result)
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    // Delete all videos endpoint with OpenAPI documentation
    this.controller.openapi(
      createRoute({
        method: 'delete',
        path: '/videos/all',
        tags: ['Videos'],
        summary: 'Delete All Videos',
        description: 'Delete all videos, their files, and associated data from the system',
        responses: {
          200: {
            content: {
              'application/json': {
                schema: successResponseSchema
              }
            },
            description: 'All videos and associated data deleted successfully'
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
          await this.videoService.deleteAllVideos()
          return c.json({
            success: true,
            message: 'All videos and associated data have been deleted'
          })
        } catch (error: any) {
          console.error('Error deleting all videos:', error)
          return c.json(
            {
              success: false,
              error: `Failed to delete videos: ${error.message}`
            },
            500
          )
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'get',
        path: '/pronunciations',
        tags: ['Pronunciations'],
        summary: 'Get All Pronunciations',
        description: 'Retrieve all word pronunciation audio files',
        responses: {
          200: {
            description: 'List of all pronunciation files',
            content: {
              'application/json': {
                schema: z.array(
                  z.object({
                    id: z.number(),
                    wordId: z.number(),
                    filePath: z.string(),
                    type: z.string(),
                    language: z.string()
                  })
                )
              }
            }
          },
          500: {
            description: 'Server error',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }),
      async (c: any) => {
        try {
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
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )


      async (c: any) => {
        try {
          await this.videoService.deleteAllVideos()
          return c.json({
            success: true,
            message: 'All videos and associated data have been deleted'
          })
        } catch (error: any) {
          console.error('Error deleting all videos:', error)
          return c.json(
            {
              success: false,
              error: `Failed to delete videos: ${error.message}`
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
            level: exercises.level
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
        description: 'Delete all videos, their files, and associated data from the system',
        responses: {
          200: {
            content: {
              'application/json': {
                schema: successResponseSchema
              }
            },
            description: 'All videos and associated data deleted successfully'
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
          await this.videoService.deleteAllVideos()
          return c.json({
            success: true,
            message: 'All videos and associated data have been deleted'
          })
        } catch (error: any) {
          console.error('Error deleting all videos:', error)
          return c.json(
            {
              success: false, 
              error: `Failed to delete videos: ${error.message}`
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
      async (c: any) => {
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
      async (c: any) => {
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
      async (c: any) => {
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

    this.controller.openapi(
      createRoute({
        method: 'get',
        path: '/videos/{id}',
        tags: ['Videos'],
        summary: 'Get Single Video',
        description: 'Retrieve a specific video with its audio segments and word segments',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'The ID of the video to retrieve',
            schema: { type: 'number' }
          }
        ],
        responses: {
          200: {
            description: 'Video with its segments',
            content: {
              'application/json': {
                schema: z.object({
                  id: z.number(),
                  title: z.string(),
                  originalFilename: z.string(),
                  filePath: z.string(),
                  fileSize: z.number(),
                  duration: z.number().nullable(),
                  language: z.string(),
                  youtubeId: z.string().nullable(),
                  transcriptionStatus: z.string(),
                  createdAt: z.string(),
                  updatedAt: z.string(),
                  audioSegments: z.array(
                    z.object({
                      id: z.number(),
                      startTime: z.number(),
                      endTime: z.number(),
                      text: z.string(),
                      translation: z.string().nullable(),
                      language: z.string(),
                      wordSegments: z.array(
                        z.object({
                          id: z.number(),
                          word: z.string(),
                          startTime: z.number(),
                          endTime: z.number(),
                          confidenceScore: z.number(),
                          positionInSegment: z.number()
                        })
                      )
                    })
                  )
                })
              }
            }
          },
          400: {
            description: 'Invalid video ID',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          },
          404: {
            description: 'Video not found',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          },
          500: {
            description: 'Server error',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }),
      async (c: any) => {
        const videoId = Number(c.req.param('id'))

        if (Number.isNaN(videoId)) {
          return c.json({ success: false, error: 'Invalid video ID' }, 400)
        }

        try {
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
            .leftJoin(audioSegments, eq(audioSegments.videoId, videos.id))
            .leftJoin(wordSegments, eq(wordSegments.audioSegmentId, audioSegments.id))
            .where(eq(videos.id, videoId))
            .orderBy(wordSegments.startTime, wordSegments.endTime)

          if (result.length === 0) {
            return c.json({ success: false, error: 'Video not found' }, 404)
          }

          // Structure the response like the list endpoint
          const video = {
            ...result[0].video,
            audioSegments: []
          }

          result.forEach((row) => {
            if (row.audioSegment) {
              const existingAudioSegment = video.audioSegments.find((segment) => segment.id === row.audioSegment?.id)

              if (!existingAudioSegment) {
                video.audioSegments.push({
                  ...row.audioSegment,
                  wordSegments: []
                })
              }

              if (row.wordSegment) {
                const audioSegment = video.audioSegments.find((segment) => segment.id === row.audioSegment?.id)
                if (audioSegment && !audioSegment.wordSegments.some((ws) => ws.id === row.wordSegment?.id)) {
                  let inserted = false
                  // Insert word segment in correct position
                  for (let i = 0; i < audioSegment.wordSegments.length; i++) {
                    if (audioSegment.wordSegments[i].positionInSegment > row.wordSegment.positionInSegment) {
                      audioSegment.wordSegments.splice(i, 0, row.wordSegment)
                      inserted = true
                      break
                    }
                  }
                  // If not inserted, add to the end
                  if (!inserted) {
                    audioSegment.wordSegments.push(row.wordSegment)
                  }
                }
              }
            }
          })

          return c.json(video)
        } catch (error: any) {
          console.error('Error fetching video:', error)
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    // Add new segment
    this.controller.openapi(
      createRoute({
        method: 'post',
        path: '/videos/{videoId}/segments',
        tags: ['Videos'],
        summary: 'Add New Segment',
        description: 'Add a new audio segment to a video',
        parameters: [
          {
            name: 'videoId',
            in: 'path',
            required: true,
            description: 'The ID of the video',
            schema: { type: 'number' }
          }
        ],
        request: {
          body: {
            content: {
              'application/json': {
                schema: z.object({
                  startTime: z.number().min(0).openapi({
                    description: 'Start time of the segment in seconds'
                  }),
                  endTime: z.number().min(0).openapi({
                    description: 'End time of the segment in seconds'
                  }),
                  text: z.string().openapi({
                    description: 'Text content of the segment'
                  }),
                  translation: z.string().optional().openapi({
                    description: 'Optional translation of the text'
                  }),
                  language: z.string().default('de').openapi({
                    description: 'Language of the segment text'
                  })
                })
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Segment added successfully',
            content: {
              'application/json': {
                schema: z.object({
                  success: z.boolean(),
                  segment: z.object({
                    id: z.number(),
                    videoId: z.number(),
                    startTime: z.number(),
                    endTime: z.number(),
                    text: z.string(),
                    translation: z.string().optional(),
                    language: z.string()
                  })
                })
              }
            }
          },
          400: {
            description: 'Invalid request',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }),
      async (c: any) => {
        const videoId = Number(c.req.param('videoId'))
        if (Number.isNaN(videoId)) {
          return c.json({ success: false, error: 'Invalid video ID' }, 400)
        }

        try {
          const body = await c.req.json()
          const startTime = body.startTime * 1000 // Convert to milliseconds 
          const endTime = body.endTime * 1000
          
          // Validate times
          if (startTime >= endTime) {
            return c.json({ 
              success: false,
              error: 'End time must be greater than start time'
            }, 400)
          }

          // Check for overlapping segments
          const existingSegments = await db
            .select({
              id: audioSegments.id,
              startTime: audioSegments.startTime,
              endTime: audioSegments.endTime
            })
            .from(audioSegments)
            .where(eq(audioSegments.videoId, videoId))

          const hasOverlap = existingSegments.some(segment => 
            (startTime >= segment.startTime && startTime < segment.endTime) ||
            (endTime > segment.startTime && endTime <= segment.endTime) ||
            (startTime <= segment.startTime && endTime >= segment.endTime)
          )

          if (hasOverlap) {
            return c.json({
              success: false,
              error: 'New segment overlaps with existing segments'
            }, 400) 
          }

          const [result] = await db
            .insert(audioSegments)
            .values({
              videoId,
              startTime, 
              endTime,
              text: body.text,
              translation: body.translation,
              language: body.language
            })
            .returning({
              id: audioSegments.id,
              videoId: audioSegments.videoId,
              startTime: audioSegments.startTime,
              endTime: audioSegments.endTime,
              text: audioSegments.text,
              translation: audioSegments.translation,
              language: audioSegments.language
            })

          return c.json({
            success: true,
            segment: {
              ...result,
              startTime: result.startTime / 1000, // Convert back to seconds
              endTime: result.endTime / 1000
            }
          })

        } catch (error: any) {
          return c.json({
            success: false,
            error: `Failed to add segment: ${error.message}`
          }, 500)
        }
      }
    )

    // Update segment
    this.controller.openapi(
      createRoute({
        method: 'patch',
        path: '/videos/{videoId}/segments/{segmentId}',
        tags: ['Videos'],
        summary: 'Update Segment',
        description: 'Update an existing audio segment',
        parameters: [
          {
            name: 'videoId',
            in: 'path',
            required: true,
            description: 'The ID of the video',
            schema: { type: 'number' }
          },
          {
            name: 'segmentId',
            in: 'path',
            required: true,
            description: 'The ID of the segment to update',
            schema: { type: 'number' }
          }
        ],
        request: {
          body: {
            content: {
              'application/json': {
                schema: z.object({
                  startTime: z.number().min(0).optional().openapi({
                    description: 'Start time of the segment in seconds'
                  }),
                  endTime: z.number().min(0).optional().openapi({
                    description: 'End time of the segment in seconds'
                  }),
                  text: z.string().optional().openapi({
                    description: 'Text content of the segment'
                  }),
                  translation: z.string().optional().openapi({
                    description: 'Translation of the text'
                  })
                })
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Segment updated successfully',
            content: {
              'application/json': {
                schema: z.object({
                  success: z.boolean(),
                  segment: z.object({
                    id: z.number(),
                    videoId: z.number(),
                    startTime: z.number(),
                    endTime: z.number(),
                    text: z.string(),
                    translation: z.string().optional(),
                    language: z.string()
                  })
                })
              }
            },
            description: 'Segment updated successfully'
          },
          404: {
            description: 'Segment not found',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }),
      async (c: any) => {
        const videoId = Number(c.req.param('videoId'))
        const segmentId = Number(c.req.param('segmentId'))
        
        if (Number.isNaN(videoId) || Number.isNaN(segmentId)) {
          return c.json({ success: false, error: 'Invalid ID' }, 400)
        }

        try {
          const body = await c.req.json()
          const updateData: Record<string, any> = {}

          // Convert times to milliseconds if provided
          if (typeof body.startTime === 'number') {
            updateData.startTime = body.startTime * 1000
          }
          if (typeof body.endTime === 'number') {
            updateData.endTime = body.endTime * 1000
          }
          if (body.text !== undefined) {
            updateData.text = body.text
          }
          if (body.translation !== undefined) {
            updateData.translation = body.translation
          }

          // Validate times if both are being updated
          if (updateData.startTime !== undefined && updateData.endTime !== undefined) {
            if (updateData.startTime >= updateData.endTime) {
              return c.json({
                success: false,
                error: 'End time must be greater than start time'
              }, 400)
            }
          }

          // Check for overlapping segments, excluding current segment
          if (updateData.startTime !== undefined || updateData.endTime !== undefined) {
            const segment = await db
              .select()
              .from(audioSegments)
              .where(eq(audioSegments.id, segmentId))
              .limit(1)

            if (!segment.length) {
              return c.json({
                success: false,
                error: 'Segment not found'
              }, 404)
            }

            const newStartTime = updateData.startTime ?? segment[0].startTime
            const newEndTime = updateData.endTime ?? segment[0].endTime

            const existingSegments = await db
              .select({
                id: audioSegments.id,
                startTime: audioSegments.startTime,
                endTime: audioSegments.endTime
              })
              .from(audioSegments)
              .where(
                and(
                  eq(audioSegments.videoId, videoId),
                  not(eq(audioSegments.id, segmentId))
                )
              )

            const hasOverlap = existingSegments.some(seg => 
              (newStartTime >= seg.startTime && newStartTime < seg.endTime) ||
              (newEndTime > seg.startTime && newEndTime <= seg.endTime) ||
              (newStartTime <= seg.startTime && newEndTime >= seg.endTime)
            )

            if (hasOverlap) {
              return c.json({
                success: false,
                error: 'Updated segment would overlap with existing segments'
              }, 400)
            }
          }

          const [updated] = await db
            .update(audioSegments)
            .set(updateData)
            .where(
              and(
                eq(audioSegments.id, segmentId),
                eq(audioSegments.videoId, videoId)
              )
            )
            .returning({
              id: audioSegments.id,
              videoId: audioSegments.videoId,
              startTime: audioSegments.startTime,
              endTime: audioSegments.endTime,
              text: audioSegments.text,
              translation: audioSegments.translation,
              language: audioSegments.language
            })

          if (!updated) {
            return c.json({
              success: false,
              error: 'Segment not found'
            }, 404)
          }

          return c.json({
            success: true,
            segment: {
              ...updated,
              startTime: updated.startTime / 1000, // Convert back to seconds
              endTime: updated.endTime / 1000
            }
          })

        } catch (error: any) {
          return c.json({
            success: false,
            error: `Failed to update segment: ${error.message}`
          }, 500)
        }
      }
    )

    // Delete segment
    this.controller.openapi(
      createRoute({
        method: 'delete',
        path: '/videos/{videoId}/segments/{segmentId}',
        tags: ['Videos'],
        summary: 'Delete Segment',
        description: 'Delete an audio segment and its associated words',
        parameters: [
          {
            name: 'videoId',
            in: 'path',
            required: true,
            description: 'The ID of the video',
            schema: { type: 'number' }
          },
          {
            name: 'segmentId',
            in: 'path', 
            required: true,
            description: 'The ID of the segment to delete',
            schema: { type: 'number' }
          }
        ],
        responses: {
          200: {
            description: 'Segment deleted successfully',
            content: {
              'application/json': {
                schema: successResponseSchema
              }
            }
          },
          404: {
            description: 'Segment not found',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }),
      async (c: any) => {
        const videoId = Number(c.req.param('videoId'))
        const segmentId = Number(c.req.param('segmentId'))

        if (Number.isNaN(videoId) || Number.isNaN(segmentId)) {
          return c.json({ success: false, error: 'Invalid ID' }, 400)
        }

        try {
          // Delete segment will cascade delete associated words
          const result = await db
            .delete(audioSegments)
            .where(
              and(
                eq(audioSegments.id, segmentId),
                eq(audioSegments.videoId, videoId)
              )
            )
            .returning({ id: audioSegments.id })

          if (!result.length) {
            return c.json({
              success: false,
              error: 'Segment not found'
            }, 404)
          }

          return c.json({
            success: true,
            message: 'Segment and associated data deleted successfully'
          })

        } catch (error: any) {
          return c.json({
            success: false,
            error: `Failed to delete segment: ${error.message}`
          }, 500)
        }
      }
    )

    // Add word to segment
    this.controller.openapi(
      createRoute({
        method: 'post',
        path: '/videos/{videoId}/segments/{segmentId}/words',
        tags: ['Videos'],
        summary: 'Add Word to Segment',
        description: 'Add a new word to an existing audio segment',
        parameters: [
          {
            name: 'videoId',
            in: 'path',
            required: true,
            description: 'The ID of the video',
            schema: { type: 'number' }
          },
          {
            name: 'segmentId',
            in: 'path',
            required: true,
            description: 'The ID of the segment',
            schema: { type: 'number' }
          }
        ],
        request: {
          body: {
            content: {
              'application/json': {
                schema: z.object({
                  word: z.string().openapi({
                    description: 'The word text'
                  }),
                  startTime: z.number().min(0).openapi({
                    description: 'Start time of the word in seconds'
                  }),
                  endTime: z.number().min(0).openapi({
                    description: 'End time of the word in seconds'
                  }),
                  confidenceScore: z.number().min(0).max(1).openapi({
                    description: 'Confidence score between 0 and 1'
                  })
                })
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Word added successfully',
            content: {
              'application/json': {
                schema: z.object({
                  success: z.boolean(),
                  wordSegment: z.object({
                    id: z.number(),
                    audioSegmentId: z.number(),
                    word: z.string(),
                    startTime: z.number(),
                    endTime: z.number(),
                    confidenceScore: z.number()
                  })
                })
              }
            }
          },
          400: {
            description: 'Invalid request',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          },
          404: {
            description: 'Segment not found',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }),
      async (c: any) => {
        const videoId = Number(c.req.param('videoId'))
        const segmentId = Number(c.req.param('segmentId'))

        if (Number.isNaN(videoId) || Number.isNaN(segmentId)) {
          return c.json({ success: false, error: 'Invalid ID' }, 400)
        }

        try {
          const body = await c.req.json()
          
          // Verify segment exists and belongs to video
          const segment = await db
            .select()
            .from(audioSegments)
            .where(
              and(
                eq(audioSegments.id, segmentId),
                eq(audioSegments.videoId, videoId)
              )
            )
            .limit(1)
          
          if (!segment.length) {
            return c.json({
              success: false,
              error: 'Segment not found or does not belong to this video'
            }, 404)
          }

          const startTime = body.startTime * 1000
          const endTime = body.endTime * 1000

          // Validate times
          if (startTime >= endTime) {
            return c.json({
              success: false,
              error: 'End time must be greater than start time'
            }, 400)
          }

          // Validate word is within segment bounds
          if (startTime < segment[0].startTime || endTime > segment[0].endTime) {
            return c.json({
              success: false,
              error: 'Word times must be within segment bounds'
            }, 400)
          }

          // Check for overlapping words
          const existingWords = await db
            .select({
              startTime: wordSegments.startTime,
              endTime: wordSegments.endTime
            })
            .from(wordSegments)
            .where(eq(wordSegments.audioSegmentId, segmentId))

          const hasOverlap = existingWords.some(word =>
            (startTime >= word.startTime && startTime < word.endTime) ||
            (endTime > word.startTime && endTime <= word.endTime) ||
            (startTime <= word.startTime && endTime >= word.endTime)
          )

          if (hasOverlap) {
            return c.json({
              success: false,
              error: 'Word would overlap with existing words'
            }, 400)
          }

          // Calculate position
          const positionResult = await db
            .select({ 
              maxPosition: sql<number>`COALESCE(MAX(${wordSegments.positionInSegment}), 0)`
            })
            .from(wordSegments)
            .where(eq(wordSegments.audioSegmentId, segmentId))

          const position = (positionResult[0]?.maxPosition ?? 0) + 1

          // Add the word
          const [result] = await db
            .insert(wordSegments)
            .values({
              audioSegmentId: segmentId,
              word: body.word,
              startTime,
              endTime,
              confidenceScore: Math.round(body.confidenceScore * 1000),
              positionInSegment: position
            })
            .returning({
              id: wordSegments.id,
              audioSegmentId: wordSegments.audioSegmentId,
              word: wordSegments.word,
              startTime: wordSegments.startTime,
              endTime: wordSegments.endTime,
              confidenceScore: wordSegments.confidenceScore
            })

          return c.json({
            success: true,
            wordSegment: {
              ...result,
              startTime: result.startTime / 1000,
              endTime: result.endTime / 1000,
              confidenceScore: result.confidenceScore / 1000
            }
          })

        } catch (error: any) {
          return c.json({
            success: false,
            error: `Failed to add word: ${error.message}`
          }, 500)
        }
      }
    )

    // Delete word
    this.controller.openapi(
      createRoute({
        method: 'delete',
        path: '/videos/{videoId}/segments/{segmentId}/words/{wordId}',
        tags: ['Videos'],
        summary: 'Delete Word',
        description: 'Delete a word from an audio segment',
        parameters: [
          {
            name: 'videoId',
            in: 'path',
            required: true,
            description: 'The ID of the video',
            schema: { type: 'number' }
          },
          {
            name: 'segmentId',
            in: 'path',
            required: true,
            description: 'The ID of the segment',
            schema: { type: 'number' }
          },
          {
            name: 'wordId',
            in: 'path',
            required: true,
            description: 'The ID of the word to delete',
            schema: { type: 'number' }
          }
        ],
        responses: {
          200: {
            description: 'Word deleted successfully',
            content: {
              'application/json': {
                schema: successResponseSchema
              }
            }
          },
          404: {
            description: 'Word not found',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }),
      async (c: any) => {
        const videoId = Number(c.req.param('videoId'))
        const segmentId = Number(c.req.param('segmentId'))
        const wordId = Number(c.req.param('wordId'))

        if (Number.isNaN(videoId) || Number.isNaN(segmentId) || Number.isNaN(wordId)) {
          return c.json({ success: false, error: 'Invalid ID' }, 400)
        }

        try {
          // Verify segment exists and belongs to video
          const segment = await db
            .select()
            .from(audioSegments)
            .where(
              and(
                eq(audioSegments.id, segmentId),
                eq(audioSegments.videoId, videoId)
              )
            )
            .limit(1)

          if (!segment.length) {
            return c.json({
              success: false,
              error: 'Segment not found or does not belong to this video'
            }, 404)
          }

          const result = await db
            .delete(wordSegments)
            .where(
              and(
                eq(wordSegments.id, wordId),
                eq(wordSegments.audioSegmentId, segmentId)
              )
            )
            .returning({ id: wordSegments.id })

          if (!result.length) {
            return c.json({
              success: false,
              error: 'Word not found or does not belong to this segment'
            }, 404)
          }

          return c.json({
            success: true,
            message: 'Word deleted successfully'
          })

        } catch (error: any) {
          return c.json({
            success: false,
            error: `Failed to delete word: ${error.message}`
          }, 500)
        }
      }
    )

    // Update segment translation
    this.controller.openapi(
      createRoute({
        method: 'patch',
        path: '/videos/{videoId}/segments/{segmentId}/translation',
        tags: ['Videos'],
        summary: 'Update Segment Translation',
        description: 'Update or add translation for a segment',
        parameters: [
          {
            name: 'videoId',
            in: 'path',
            required: true,
            description: 'The ID of the video',
            schema: { type: 'number' }
          },
          {
            name: 'segmentId', 
            in: 'path',
            required: true,
            description: 'The ID of the segment',
            schema: { type: 'number' }
          }
        ],
        request: {
          body: {
            content: {
              'application/json': {
                schema: z.object({
                  translation: z.string().openapi({
                    description: 'The translation text'
                  })
                })
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Translation updated successfully',
            content: {
              'application/json': {
                schema: z.object({
                  success: z.boolean(),
                  segment: z.object({
                    id: z.number(),
                    text: z.string(),
                    translation: z.string()
                  })
                })
              }
            }
          },
          404: {
            description: 'Segment not found',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }),
      async (c: any) => {
        const videoId = Number(c.req.param('videoId'))
        const segmentId = Number(c.req.param('segmentId'))

        if (Number.isNaN(videoId) || Number.isNaN(segmentId)) {
          return c.json({ success: false, error: 'Invalid ID' }, 400)
        }

        try {
          const body = await c.req.json()

          const [updated] = await db
            .update(audioSegments)
            .set({
              translation: body.translation
            })
            .where(
              and(
                eq(audioSegments.id, segmentId),
                eq(audioSegments.videoId, videoId)
              )
            )
            .returning({
              id: audioSegments.id,
              text: audioSegments.text,
              translation: audioSegments.translation
            })

          if (!updated) {
            return c.json({
              success: false,
              error: 'Segment not found'
            }, 404)
          }

          return c.json({
            success: true,
            segment: updated
          })

        } catch (error: any) {
          return c.json({
            success: false,
            error: `Failed to update translation: ${error.message}`
          }, 500)
        }
      }
    )

    // Update segment timings and metadata
    this.controller.openapi(
      createRoute({
        method: 'patch',
        path: '/videos/{videoId}/segments/{segmentId}/timing',
               tags: ['Videos'],
        summary: 'Update Segment Timing',
        description: 'Update timing for a segment and its words',
        parameters: [
          {
            name: 'videoId',
            in: 'path',
            required: true,
            description: 'The ID of the video',
            schema: { type: 'number' }
          },
          {
            name: 'segmentId',
            in: 'path',
            required: true,
            description: 'The ID of the segment',
            schema: { type: 'number' }
          }
        ],
        request: {
          body: {
            content: {
              'application/json': {
                schema: z.object({
                  startTime: z.number().min(0).openapi({
                    description: 'New start time in seconds'
                  }),
                  endTime: z.number().min(0).openapi({
                    description: 'New end time in seconds'
                  }),
                  words: z.array(
                    z.object({
                      id: z.number(),
                      startTime: z.number().min(0),
                      endTime: z.number().min(0),
                      confidenceScore: z.number().min(0).max(1)
                    })
                  ).optional().openapi({
                    description: 'Updated timing for words in the segment'
                  })
                })
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Timing updated successfully',
            content: {
              'application/json': {
                schema: z.object({
                  success: z.boolean(),
                  segment: z.object({
                    id: z.number(),
                    startTime: z.number(),
                    endTime: z.number(),
                    words: z.array(z.object({
                      id: z.number(),
                      startTime: z.number(),
                      endTime: z.number(),
                      confidenceScore: z.number()
                    }))
                  })
                })
              }
            }
          },
          400: {
            description: 'Invalid timing values',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          },
          404: {
            description: 'Segment or word not found',
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            }
          }
        }
      }),
      async (c: any) => {
        const videoId = Number(c.req.param('videoId'))
        const segmentId = Number(c.req.param('segmentId'))

        if (Number.isNaN(videoId) || Number.isNaN(segmentId)) {
          return c.json({ success: false, error: 'Invalid ID' }, 400)
        }

        try {
          const body = await c.req.json()
          const startTime = body.startTime * 1000 // Convert to milliseconds
          const endTime = body.endTime * 1000

          // Validate times
          if (startTime >= endTime) {
            return c.json({
              success: false,
              error: 'End time must be greater than start time'
            }, 400)
          }

          // Check for overlapping segments
          const existingSegments = await db
            .select({
              id: audioSegments.id,
              startTime: audioSegments.startTime,
              endTime: audioSegments.endTime
            })
            .from(audioSegments)
            .where(
              and(
                eq(audioSegments.videoId, videoId),
                not(eq(audioSegments.id, segmentId))
              )
            )

          const hasOverlap = existingSegments.some(segment =>
            (startTime >= segment.startTime && startTime < segment.endTime) ||
            (endTime > segment.startTime && endTime <= segment.endTime) ||
            (startTime <= segment.startTime && endTime >= segment.endTime)
          )

          if (hasOverlap) {
            return c.json({
              success: false,
              error: 'Segment timing would overlap with other segments'
            }, 400)
          }

          let result = await db.transaction(async (tx) => {
            // Update segment timing
            const [updatedSegment] = await tx
              .update(audioSegments)
              .set({
                startTime,
                endTime
              })
              .where(
                and(
                  eq(audioSegments.id, segmentId),
                  eq(audioSegments.videoId, videoId)
                )
              )
              .returning({
                id: audioSegments.id,
                startTime: audioSegments.startTime,
                endTime: audioSegments.endTime
              })

            if (!updatedSegment) {
              throw new Error('Segment not found')
            }

            let updatedWords = []

            if (body.words && body.words.length > 0) {
              // Validate word times are within segment bounds
              for (const word of body.words) {
                const wordStartTime = word.startTime * 1000
                const wordEndTime = word.endTime * 1000

                if (wordStartTime < startTime || wordEndTime > endTime) {
                  throw new Error('Word times must be within segment bounds')
                }

                // Update the word
                const [updatedWord] = await tx
                  .update(wordSegments)
                  .set({
                    startTime: wordStartTime,
                    endTime: wordEndTime,
                    confidenceScore: Math.round(word.confidenceScore * 1000)
                  })
                  .where(
                    and(
                      eq(wordSegments.id, word.id),
                      eq(wordSegments.audioSegmentId, segmentId)
                    )
                  )
                  .returning({
                    id: wordSegments.id,
                    startTime: wordSegments.startTime,
                    endTime: wordSegments.endTime,
                    confidenceScore: wordSegments.confidenceScore
                  })

                if (!updatedWord) {
                  throw new Error(`Word with ID ${word.id} not found`)
                }

                updatedWords.push(updatedWord)
              }
            }

            return {
              segment: updatedSegment,
              words: updatedWords
            }
          })

          // Convert times back to seconds for response
          return c.json({
            success: true,
            segment: {
              id: result.segment.id,
              startTime: result.segment.startTime / 1000,
              endTime: result.segment.endTime / 1000,
              words: result.words.map(word => ({
                id: word.id,
                startTime: word.startTime / 1000,
                endTime: word.endTime / 1000,
                confidenceScore: word.confidenceScore / 1000
              }))
            }
          })

        } catch (error: any) {
          return c.json({
            success: false,
            error: `Failed to update timing: ${error.message}`
          }, error.message.includes('not found') ? 404 : 500)
        }
      }
    )

    // ...rest of routes...
  }

  public getRouter() {
    return this.controller
  }
}
