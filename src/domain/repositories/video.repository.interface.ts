import type { Video, VideoModel } from '@/domain/models/video.model'
import type { ExerciseData, PronunciationData } from '@/domain/types/exercise.types'

export interface VideoSegment {
  startTime: number
  endTime: number
  text: string
  translation?: string
  language: string
  words: Array<{
    word: string
    startTime: number
    endTime: number
    confidenceScore: number
  }>
}

export interface VideoRepositoryInterface {
  insertVideo: (videoData: Omit<Video, 'id'>) => Promise<number>
  updateVideoStatus: (
    videoId: number,
    status: Video['transcriptionStatus'],
    data?: {
      jobId?: string
      errorMessage?: string
      transcriptionFile?: string
    }
  ) => Promise<void>
  logProcessingStep: (
    videoId: number,
    step: string,
    status: 'started' | 'completed' | 'failed',
    message?: string | null
  ) => Promise<void>
  getVideoById: (id: number) => Promise<VideoModel | null>
  getRecentVideos: (limit?: number) => Promise<VideoModel[]>
  deleteVideo: (id: number) => Promise<void>
  insertAudioSegments: (segments: VideoSegment[], videoId: number, language: string) => Promise<number[]>
  loadTranscriptionData: (
    videoId: number,
    transcriptionFile: string
  ) => Promise<{
    segments: number
    vocabulary: number
    language: string
  }>
  insertExercises: (exercises: ExerciseData[], word: string) => Promise<void>
  insertPronunciations: (pronunciations: PronunciationData[], word: string) => Promise<void>
}
