import type { Video, VideoModel } from '@/domain/models/video.model'
import type { ExerciseData, PronunciationData } from '@/domain/types/exercise.types'

export interface VideoSegment {
  start: number
  end: number
  text: string
  translation?: string
  language: string
  words: Array<{
    word: string
    start: number
    end: number
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
  updateVideoCategory: (
    videoId: number,
    data: {
      categoryId?: number
      difficultyId?: number
    }
  ) => Promise<void>
  getVideoCategories: (videoId: number) => Promise<{ categoryIds: number[]; difficultyId?: number }>
  getFilteredVideos: (filters: { categoryId?: number; difficultyId?: number }) => Promise<VideoModel[]>
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
  /**
   * Mark a list of segments as completed for a user
   */
  markSegmentsAsCompleted: (videoId: number, userId: string, segmentIds: number[]) => Promise<void>

  /**
   * Get a list of completed segment IDs for a user
   */
  getCompletedSegments: (videoId: number, userId: string) => Promise<number[]>

  /**
   * Delete all videos and associated data from the database
   */
  deleteAllVideos: () => Promise<void>
}
