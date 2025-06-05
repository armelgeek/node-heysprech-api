import { z } from 'zod'

const VideoSegmentWordSchema = z.object({
  word: z.string(),
  startTime: z.number(),
  endTime: z.number(),
  confidenceScore: z.number()
})

const VideoSegmentSchema = z.object({
  id: z.number(),
  startTime: z.number(),
  endTime: z.number(),
  text: z.string(),
  translation: z.string().optional(),
  language: z.string(),
  words: z.array(VideoSegmentWordSchema)
})

const VocabularyEntrySchema = z.object({
  word: z.string(),
  occurrences: z.array(
    z.object({
      segmentId: z.number(),
      startTime: z.number(),
      endTime: z.number(),
      confidenceScore: z.number()
    })
  ),
  confidenceScoreAvg: z.number(),
  translations: z.record(z.string()).optional(),
  examples: z.array(z.string()).optional(),
  level: z.enum(['beginner', 'intermediate', 'advanced']).default('intermediate'),
  metadata: z.record(z.unknown()).optional(),
  exercises: z
    .object({
      type: z.literal('multiple_choice_pair'),
      level: z.enum(['beginner', 'intermediate', 'advanced']).default('intermediate'),
      de_to_fr: z.object({
        question: z.object({
          de: z.string(),
          fr: z.string()
        }),
        word_to_translate: z.string(),
        correct_answer: z.string(),
        options: z.array(z.string())
      }),
      fr_to_de: z.object({
        question: z.object({
          de: z.string(),
          fr: z.string()
        }),
        word_to_translate: z.string(),
        correct_answer: z.string(),
        options: z.array(z.string())
      })
    })
    .optional(),
  pronunciations: z
    .array(
      z.object({
        file: z.string(),
        type: z.string(),
        language: z.string()
      })
    )
    .optional()
})

export const VideoSchema = z.object({
  id: z.number().optional(),
  title: z.string(),
  originalFilename: z.string(),
  filePath: z.string(),
  fileSize: z.number(),
  language: z.string().default('de'),
  transcriptionStatus: z.enum(['pending', 'processing', 'completed', 'failed']).default('pending'),
  queueJobId: z.string().optional(),
  errorMessage: z.string().optional(),
  tempInfoFile: z.string().optional(),
  transcriptionFile: z.string().optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
  processedAt: z.date().optional(),
  segments: z.array(VideoSegmentSchema).optional(),
  vocabulary: z.array(VocabularyEntrySchema).optional()
})

export type Video = z.infer<typeof VideoSchema>

export class VideoModel {
  constructor(private data: Video) {
    VideoSchema.parse(data)
  }

  get id() {
    return this.data.id
  }

  get title() {
    return this.data.title
  }

  get originalFilename() {
    return this.data.originalFilename
  }

  get filePath() {
    return this.data.filePath
  }

  get fileSize() {
    return this.data.fileSize
  }

  get language() {
    return this.data.language
  }

  get transcriptionStatus() {
    return this.data.transcriptionStatus
  }

  get tempInfoFile() {
    return this.data.tempInfoFile
  }

  get transcriptionFile() {
    return this.data.transcriptionFile
  }

  get processedAt() {
    return this.data.processedAt
  }

  get errorMessage() {
    return this.data.errorMessage
  }

  get createdAt() {
    return this.data.createdAt
  }

  get updatedAt() {
    return this.data.updatedAt
  }

  get segments() {
    return this.data.segments
  }

  get vocabulary() {
    return this.data.vocabulary
  }

  static create(data: Omit<Video, 'id'>) {
    return new VideoModel(data)
  }

  updateStatus(
    status: Video['transcriptionStatus'],
    data?: {
      jobId?: string
      errorMessage?: string
      transcriptionFile?: string
    }
  ) {
    this.data.transcriptionStatus = status
    this.data.updatedAt = new Date()

    if (data?.jobId) {
      this.data.queueJobId = data.jobId
    }

    if (data?.errorMessage) {
      this.data.errorMessage = data.errorMessage
    }

    if (data?.transcriptionFile) {
      this.data.transcriptionFile = data.transcriptionFile
    }

    if (status === 'completed') {
      this.data.processedAt = new Date()
    }

    return this
  }

  toJSON(): Video {
    return this.data
  }
}
