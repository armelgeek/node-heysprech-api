import { z } from 'zod'

// Base schemas
export const videoBaseSchema = z.object({
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
  updatedAt: z.string()
})

export const audioSegmentSchema = z.object({
  id: z.number(),
  videoId: z.number(),
  startTime: z.number(),
  endTime: z.number(),
  text: z.string(),
  translation: z.string().nullable(),
  language: z.string()
})

export const wordSegmentSchema = z.object({
  id: z.number(),
  audioSegmentId: z.number(),
  word: z.string(),
  startTime: z.number(),
  endTime: z.number(),
  confidenceScore: z.number(),
  positionInSegment: z.number()
})

// Request schemas
export const createVideoSchema = z.object({
  title: z.string(),
  language: z.string().default('de'),
  youtubeId: z.string().length(11).optional()
})

export const updateVideoSchema = z.object({
  title: z.string().optional(),
  language: z.string().optional(),
  youtubeId: z.string().length(11).optional()
})

export const createAudioSegmentSchema = z.object({
  startTime: z.number().min(0),
  endTime: z.number().min(0),
  text: z.string(),
  translation: z.string().optional(),
  language: z.string().default('de')
})

export const updateAudioSegmentSchema = z.object({
  startTime: z.number().optional(),
  endTime: z.number().optional(),
  text: z.string().optional(),
  translation: z.string().optional(),
  language: z.string().optional()
})

export const createWordSegmentSchema = z.object({
  word: z.string(),
  startTime: z.number().min(0),
  endTime: z.number().min(0),
  confidenceScore: z.number(),
  positionInSegment: z.number().min(1)
})

// Response schemas
export const videoResponseSchema = videoBaseSchema.extend({
  audioSegments: z.array(
    audioSegmentSchema.extend({
      wordSegments: z.array(wordSegmentSchema)
    })
  )
})

export const videoListResponseSchema = z.array(
  videoBaseSchema.extend({
    segmentCount: z.number(),
    wordCount: z.number()
  })
)

export const audioSegmentResponseSchema = audioSegmentSchema.extend({
  wordSegments: z.array(wordSegmentSchema)
})

export const videoProgressSchema = z.object({
  completedSegments: z.number(),
  totalSegments: z.number(),
  progress: z.number()
})

// Types
export type Video = z.infer<typeof videoBaseSchema>
export type AudioSegment = z.infer<typeof audioSegmentSchema>
export type WordSegment = z.infer<typeof wordSegmentSchema>
export type VideoResponse = z.infer<typeof videoResponseSchema>
export type VideoListResponse = z.infer<typeof videoListResponseSchema>
export type CreateVideoRequest = z.infer<typeof createVideoSchema>
export type UpdateVideoRequest = z.infer<typeof updateVideoSchema>
export type CreateAudioSegmentRequest = z.infer<typeof createAudioSegmentSchema>
export type UpdateAudioSegmentRequest = z.infer<typeof updateAudioSegmentSchema>
export type CreateWordSegmentRequest = z.infer<typeof createWordSegmentSchema>
export type VideoProgress = z.infer<typeof videoProgressSchema>
