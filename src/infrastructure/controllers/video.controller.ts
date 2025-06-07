import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, desc, eq, not, sql } from 'drizzle-orm'
import { LearningProgressService } from '@/application/services/learning-progress.service'
import { VideoService } from '@/application/services/video.service'
import type { AudioSegment as AudioSegmentType } from '@/domain/interfaces/video-controller.types'
import type { Routes } from '@/domain/types'
import { db } from '../database/db'
import { audioSegments, videos, wordSegments } from '../database/schema'

const baseDir = path.join(os.homedir(), 'heysprech-data')

// Schema definitions that match our interfaces
const errorResponseSchema = z
  .object({
    success: z.literal(false),
    error: z.string()
  })
  .openapi('ErrorResponse')

const successResponseSchema = z
  .object({
    success: z.literal(true),
    message: z.string()
  })
  .openapi('SuccessResponse')

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
    // Update audio segment
    this.controller.put('/videos/:videoId/segments/:segmentId', async (c: any) => {
      const videoId: number = Number(c.req.param('videoId'))
      const segmentId: number = Number(c.req.param('segmentId'))
      const body = await c.req.json()

      if (Number.isNaN(videoId) || Number.isNaN(segmentId)) {
        return c.json({ success: false, error: 'Invalid ID' }, 400)
      }

      try {
        const [segment] = await db
          .select()
          .from(audioSegments)
          .where(and(eq(audioSegments.id, segmentId), eq(audioSegments.videoId, videoId)))

        if (!segment) {
          return c.json({ success: false, error: 'Segment not found' }, 404)
        }

        const [updated] = await db
          .update(audioSegments)
          .set({
            ...segment,
            ...body,
            translation: body.translation !== undefined ? body.translation : segment.translation
          })
          .where(and(eq(audioSegments.id, segmentId), eq(audioSegments.videoId, videoId)))
          .returning()

        return c.json(updated)
      } catch (error: any) {
        return c.json({ success: false, error: error.message }, 500)
      }
    })
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

    // Audio Segment Update Endpoint
    this.controller.openapi(
      createRoute({
        method: 'put',
        path: '/videos/{videoId}/segments/{segmentId}',
        tags: ['Audio'],
        summary: 'Update Audio Segment',
        description: 'Update the properties of an audio segment',
        parameters: [
          {
            name: 'videoId',
            in: 'path',
            required: true,
            schema: { type: 'number' },
            description: 'The ID of the video'
          },
          {
            name: 'segmentId',
            in: 'path',
            required: true,
            schema: { type: 'number' },
            description: 'The ID of the segment to update'
          }
        ],
        request: {
          body: {
            content: {
              'application/json': {
                schema: z.object({
                  startTime: z.number().optional(),
                  endTime: z.number().optional(),
                  text: z.string().optional(),
                  translation: z.string().optional(),
                  language: z.string().optional()
                })
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Audio segment updated successfully',
            content: {
              'application/json': {
                schema: z.object({
                  id: z.number(),
                  startTime: z.number(),
                  endTime: z.number(),
                  text: z.string(),
                  translation: z.string().nullable(),
                  language: z.string()
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
        try {
          const videoId: number = Number(c.req.param('videoId'))
          const segmentId: number = Number(c.req.param('segmentId'))

          if (Number.isNaN(videoId) || Number.isNaN(segmentId)) {
            return c.json({ success: false, error: 'Invalid ID' }, 400)
          }

          const body = await c.req.json()

          // Get current segment
          const segment = await db
            .select()
            .from(audioSegments)
            .where(and(eq(audioSegments.id, segmentId), eq(audioSegments.videoId, videoId)))
            .limit(1)

          if (!segment.length) {
            return c.json({ success: false, error: 'Segment not found' }, 404)
          }

          const startTime = body.startTime ?? segment[0].startTime
          const endTime = body.endTime ?? segment[0].endTime

          // Validate time range
          if (startTime >= endTime) {
            return c.json(
              {
                success: false,
                error: 'Start time must be less than end time'
              },
              400
            )
          }

          // Check for overlaps
          const existingSegments = await db
            .select()
            .from(audioSegments)
            .where(and(eq(audioSegments.videoId, videoId), not(eq(audioSegments.id, segmentId))))

          const hasOverlap = existingSegments.some((seg) => startTime < seg.endTime && endTime > seg.startTime)

          if (hasOverlap) {
            return c.json(
              {
                success: false,
                error: 'Updated segment would overlap with existing segments'
              },
              400
            )
          }

          // Update segment
          const [updatedSegment] = await db
            .update(audioSegments)
            .set({
              startTime: body.startTime ?? segment[0].startTime,
              endTime: body.endTime ?? segment[0].endTime,
              text: body.text ?? segment[0].text,
              translation: body.translation !== undefined ? body.translation : segment[0].translation,
              language: body.language ?? segment[0].language
            })
            .where(and(eq(audioSegments.id, segmentId), eq(audioSegments.videoId, videoId)))
            .returning()

          return c.json(updatedSegment)
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'post',
        path: '/videos/{videoId}/segments/{segmentId}/words',
        tags: ['Words'],
        summary: 'Add Word to Segment',
        description: 'Add a new word to an audio segment',
        parameters: [
          {
            name: 'videoId',
            in: 'path',
            required: true,
            schema: { type: 'number' },
            description: 'The ID of the video'
          },
          {
            name: 'segmentId',
            in: 'path',
            required: true,
            schema: { type: 'number' },
            description: 'The ID of the audio segment'
          }
        ],
        request: {
          body: {
            content: {
              'application/json': {
                schema: z
                  .object({
                    word: z.string(),
                    startTime: z.number().min(0),
                    endTime: z.number().min(0),
                    confidenceScore: z.number().min(0).max(1),
                    positionInSegment: z.number().int().min(1)
                  })
                  .openapi('CreateWordRequest')
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Word added successfully',
            content: {
              'application/json': {
                schema: z
                  .object({
                    id: z.number(),
                    audioSegmentId: z.number(),
                    word: z.string(),
                    startTime: z.number(),
                    endTime: z.number(),
                    confidenceScore: z.number(),
                    positionInSegment: z.number()
                  })
                  .openapi('WordResponse')
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
          const videoId = Number(c.req.param('videoId'))
          const segmentId = Number(c.req.param('segmentId'))
          const body = await c.req.json()

          if (Number.isNaN(videoId) || Number.isNaN(segmentId)) {
            return c.json({ success: false, error: 'Invalid ID' }, 400)
          }

          // Check segment exists
          const [segment] = await db
            .select()
            .from(audioSegments)
            .where(and(eq(audioSegments.id, segmentId), eq(audioSegments.videoId, videoId)))

          if (!segment) {
            return c.json({ success: false, error: 'Segment not found' }, 404)
          }

          // Add word
          const [newWord] = await db
            .insert(wordSegments)
            .values({
              audioSegmentId: segmentId,
              word: body.word,
              startTime: body.startTime,
              endTime: body.endTime,
              confidenceScore: body.confidenceScore,
              positionInSegment: body.positionInSegment
            })
            .returning()

          return c.json(newWord)
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    this.controller.delete('/videos/:videoId/segments/:segmentId/words/:wordId', async (c) => {
      try {
        const videoId = Number(c.req.param('videoId'))
        const segmentId = Number(c.req.param('segmentId'))
        const wordId = Number(c.req.param('wordId'))

        if (Number.isNaN(videoId) || Number.isNaN(segmentId) || Number.isNaN(wordId)) {
          return c.json({ success: false, error: 'Invalid ID' }, 400)
        }

        // Delete word and get its position
        const [deletedWord] = await db
          .delete(wordSegments)
          .where(and(eq(wordSegments.id, wordId), eq(wordSegments.audioSegmentId, segmentId)))
          .returning()

        if (!deletedWord) {
          return c.json({ success: false, error: 'Word not found' }, 404)
        }

        // Update positions of remaining words
        await db
          .update(wordSegments)
          .set({ positionInSegment: sql`position_in_segment - 1` })
          .where(
            and(eq(wordSegments.audioSegmentId, segmentId), sql`position_in_segment > ${deletedWord.positionInSegment}`)
          )

        return c.json({
          success: true,
          message: 'Word deleted successfully'
        })
      } catch (error: any) {
        return c.json({ success: false, error: error.message }, 500)
      }
    })

    this.controller.openapi(
      createRoute({
        method: 'delete',
        path: '/videos/{videoId}/segments/{segmentId}/words/{wordId}',
        tags: ['Words'],
        summary: 'Delete Word from Segment',
        description: 'Delete a word from an audio segment and update the position of remaining words',
        parameters: [
          {
            name: 'videoId',
            in: 'path',
            required: true,
            schema: { type: 'number' },
            description: 'The ID of the video'
          },
          {
            name: 'segmentId',
            in: 'path',
            required: true,
            schema: { type: 'number' },
            description: 'The ID of the audio segment'
          },
          {
            name: 'wordId',
            in: 'path',
            required: true,
            schema: { type: 'number' },
            description: 'The ID of the word to delete'
          }
        ],
        responses: {
          200: {
            description: 'Word deleted successfully',
            content: {
              'application/json': {
                schema: z
                  .object({
                    success: z.boolean(),
                    message: z.string()
                  })
                  .openapi('DeleteWordResponse')
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
            description: 'Word not found',
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
        try {
          const videoId = Number(c.req.param('videoId'))
          const segmentId = Number(c.req.param('segmentId'))
          const wordId = Number(c.req.param('wordId'))

          if (Number.isNaN(videoId) || Number.isNaN(segmentId) || Number.isNaN(wordId)) {
            return c.json({ success: false, error: 'Invalid ID' }, 400)
          }

          const [word] = await db
            .delete(wordSegments)
            .where(and(eq(wordSegments.id, wordId), eq(wordSegments.audioSegmentId, segmentId)))
            .returning()

          if (!word) {
            return c.json({ success: false, error: 'Word not found' }, 404)
          }

          await db
            .update(wordSegments)
            .set({ positionInSegment: sql`${wordSegments.positionInSegment} - 1` })
            .where(
              and(eq(wordSegments.audioSegmentId, segmentId), sql`position_in_segment > ${word.positionInSegment}`)
            )

          return c.json({ success: true, message: 'Word deleted successfully' })
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
        const videoId = Number(c.req.param('videoId'))

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
      async (c: any) => {
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
            audioSegments: [] as AudioSegmentType[]
          }

          result.forEach((row) => {
            if (row.audioSegment) {
              const existingAudioSegment = video.audioSegments.find((segment) => segment.id === row.audioSegment?.id)

              if (!existingAudioSegment) {
                video.audioSegments.push({
                  ...row.audioSegment,
                  videoId,
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
                      audioSegment.wordSegments.splice(i, 0, { ...row.wordSegment, audioSegmentId: audioSegment.id })
                      inserted = true
                      break
                    }
                  }
                  // If not inserted, add to the end
                  if (!inserted) {
                    audioSegment.wordSegments.push({ ...row.wordSegment, audioSegmentId: audioSegment.id })
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

          // Validate time ranges
          if (body.startTime >= body.endTime) {
            return c.json(
              {
                success: false,
                error: 'Start time must be less than end time'
              },
              400
            )
          }

          // Check for overlapping segments
          const existingSegments = await db.select().from(audioSegments).where(eq(audioSegments.videoId, videoId))

          const hasOverlap = existingSegments.some(
            (segment) => body.startTime < segment.endTime && body.endTime > segment.startTime
          )

          if (hasOverlap) {
            return c.json(
              {
                success: false,
                error: 'New segment overlaps with existing segments'
              },
              400
            )
          }

          // Insert new segment
          const [newSegment] = await db
            .insert(audioSegments)
            .values({
              videoId,
              startTime: body.startTime,
              endTime: body.endTime,
              text: body.text,
              translation: body.translation || null,
              language: body.language
            })
            .returning()

          return c.json(newSegment)
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'put',
        path: '/videos/{videoId}/segments/{segmentId}',
        tags: ['Audio'],
        summary: 'Update Audio Segment',
        description: 'Update an existing audio segment',
        parameters: [
          {
            name: 'videoId',
            in: 'path',
            required: true,
            schema: { type: 'number' },
            description: 'The ID of the video'
          },
          {
            name: 'segmentId',
            in: 'path',
            required: true,
            schema: { type: 'number' },
            description: 'The ID of the segment to update'
          }
        ],
        request: {
          body: {
            content: {
              'application/json': {
                schema: z.object({
                  startTime: z.number().optional(),
                  endTime: z.number().optional(),
                  text: z.string().optional(),
                  translation: z.string().optional(),
                  language: z.string().optional()
                })
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Audio segment updated successfully',
            content: {
              'application/json': {
                schema: z.object({
                  id: z.number(),
                  startTime: z.number(),
                  endTime: z.number(),
                  text: z.string(),
                  translation: z.string().nullable(),
                  language: z.string()
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
        const segmentId = Number(c.req.param('segmentId'))

        if (Number.isNaN(videoId) || Number.isNaN(segmentId)) {
          return c.json({ success: false, error: 'Invalid ID' }, 400)
        }
        try {
          const body = await c.req.json()
          const segment = await db
            .select()
            .from(audioSegments)
            .where(and(eq(audioSegments.id, segmentId), eq(audioSegments.videoId, videoId)))
            .limit(1)

          if (!segment.length) {
            return c.json({ success: false, error: 'Segment not found' }, 404)
          }

          const startTime = body.startTime ?? segment[0].startTime
          const endTime = body.endTime ?? segment[0].endTime

          // Validate time ranges
          if (startTime >= endTime) {
            return c.json(
              {
                success: false,
                error: 'Start time must be less than end time'
              },
              400
            )
          }

          // Check for overlapping segments (excluding current segment)
          const existingSegments = await db
            .select()
            .from(audioSegments)
            .where(and(eq(audioSegments.videoId, videoId), not(eq(audioSegments.id, segmentId))))

          const hasOverlap = existingSegments.some((seg) => startTime < seg.endTime && endTime > seg.startTime)

          if (hasOverlap) {
            return c.json(
              {
                success: false,
                error: 'Updated segment would overlap with existing segments'
              },
              400
            )
          }

          // Update segment
          const [updatedSegment] = await db
            .update(audioSegments)
            .set({
              startTime: body.startTime ?? segment[0].startTime,
              endTime: body.endTime ?? segment[0].endTime,
              text: body.text ?? segment[0].text,
              translation: body.translation !== undefined ? body.translation : segment[0].translation,
              language: body.language ?? segment[0].language
            })
            .where(and(eq(audioSegments.id, segmentId), eq(audioSegments.videoId, videoId)))
            .returning()

          return c.json(updatedSegment)
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'delete',
        path: '/videos/{videoId}/segments/{segmentId}',
        tags: ['Audio'],
        summary: 'Delete Audio Segment',
        description: 'Delete an audio segment and its associated word segments',
        parameters: [
          {
            name: 'videoId',
            in: 'path',
            required: true,
            schema: { type: 'number' },
            description: 'The ID of the video'
          },
          {
            name: 'segmentId',
            in: 'path',
            required: true,
            schema: { type: 'number' },
            description: 'The ID of the segment to delete'
          }
        ],
        responses: {
          200: {
            description: 'Audio segment deleted successfully',
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
        try {
          const videoId = Number(c.req.param('videoId'))
          const segmentId = Number(c.req.param('segmentId'))

          if (Number.isNaN(videoId) || Number.isNaN(segmentId)) {
            return c.json({ success: false, error: 'Invalid ID' }, 400)
          }

          // First delete associated word segments
          await db.delete(wordSegments).where(eq(wordSegments.audioSegmentId, segmentId))

          // Then delete the audio segment
          const result = await db
            .delete(audioSegments)
            .where(and(eq(audioSegments.id, segmentId), eq(audioSegments.videoId, videoId)))

          if (result.length === 0) {
            return c.json({ success: false, error: 'Segment not found' }, 404)
          }

          return c.json({
            success: true,
            message: 'Audio segment and associated word segments deleted successfully'
          })
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
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
            .where(and(eq(audioSegments.id, segmentId), eq(audioSegments.videoId, videoId)))
            .returning({
              id: audioSegments.id,
              text: audioSegments.text,
              translation: audioSegments.translation
            })

          if (!updated) {
            return c.json(
              {
                success: false,
                error: 'Segment not found'
              },
              404
            )
          }

          return c.json({
            success: true,
            segment: updated
          })
        } catch (error: any) {
          return c.json(
            {
              success: false,
              error: `Failed to update translation: ${error.message}`
            },
            500
          )
        }
      }
    )
  }

  public getRouter() {
    return this.controller
  }
}
