import type { Video, VideoModel } from '@/domain/models/video.model'

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
  insertAudioSegments: (segments: any[], videoId: number, language: string) => Promise<number[]>
  loadTranscriptionData: (
    videoId: number,
    transcriptionFile: string
  ) => Promise<{
    segments: number
    vocabulary: number
    language: string
  }>
  insertExercises: (exercises: any[], word: string) => Promise<void>
  insertPronunciations: (pronunciations: any[], word: string) => Promise<void>
}
