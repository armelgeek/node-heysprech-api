import type { Video } from '../models/video.model'
import type { ExerciseData } from '../types/exercise.types'
import type { Context } from 'hono'

export interface VideoRequest
  extends Context<{
    Bindings: {
      DATABASE_URL: string
      WHISPER_API_KEY: string
      DEEPL_API_KEY: string
    }
  }> {
  user?: {
    id: string
  }
}

export interface VideoResponse extends Video {
  audioSegments: AudioSegment[]
}

export interface AudioSegment {
  id: number
  videoId: number
  startTime: number
  endTime: number
  text: string
  translation?: string
  language: string
  wordSegments: WordSegment[]
}

export interface WordSegment {
  id: number
  audioSegmentId: number
  word: string
  startTime: number
  endTime: number
  confidenceScore: number
  positionInSegment: number
}

export interface VideoUploadOptions {
  language?: string
  title?: string
  youtubeId?: string
  categoryId?: number
  difficultyId?: number
}

export interface UploadResponse {
  success: boolean
  videoId: number
  filename: string
  size: number
  message: string
}

export interface ErrorResponse {
  success: false
  error: string
}

export interface SuccessResponse {
  success: true
  message: string
}

export interface VideoSegmentProgress {
  segmentId: number
  isCompleted: boolean
  watchedSeconds: number
  exercisesCompleted: number
  totalExercises: number
}

export interface VideoLearningStatus {
  completedExercises: number
  masteredWords: number
  totalSegments: number
  progress: number
  lastActivity?: string
}

export interface ExercisesByDirection {
  [direction: string]: ExerciseData[]
}
