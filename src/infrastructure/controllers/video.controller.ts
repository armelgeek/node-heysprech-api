import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, desc, eq, not, sql } from 'drizzle-orm'
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
  categoryId: z.string().optional().openapi({
    description: 'Optional category ID to assign to the video',
    example: "1"
  }),
  difficultyId: z.string().optional().openapi({
    description: 'Optional difficulty level ID to assign to the video',
    example: "1"
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
        tags: ['Videos'],
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
            categoryId: body.categoryId ? body.categoryId : undefined,
            difficultyId: body.difficultyId ? body.difficultyId : undefined
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

          if (formData.categoryId) {
            return c.json(
              {
                success: false,
                error: 'Invalid category ID'
              },
              400
            )
          }

          if (formData.difficultyId) {
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
            categoryId: Number(formData.categoryId),
            difficultyId: Number(formData.difficultyId)
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
