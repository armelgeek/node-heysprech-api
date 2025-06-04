import { promises as fs } from 'node:fs'
import { eq, sql } from 'drizzle-orm'
import { VideoModel, type Video } from '@/domain/models/video.model'
import type { VideoRepositoryInterface } from '@/domain/repositories/video.repository.interface'
import { db } from '../database/db'
import { audioSegments, processingLogs, videos, wordSegments } from '../database/schema/video.schema'
import { BaseRepository } from './base.repository'

interface TranscriptionSegment {
  start: number
  end: number
  text: string
  translation?: string
  words?: Array<{
    word: string
    start: number
    end: number
    score: number
  }>
}

export class VideoRepository extends BaseRepository<typeof videos> implements VideoRepositoryInterface {
  constructor() {
    super(videos)
  }

  private validateNumber(value: unknown, defaultValue: number = 0): number {
    const num = Number(value)
    return Number.isNaN(num) ? defaultValue : num
  }

  private validateTime(time: unknown): number {
    return Math.floor(this.validateNumber(time) * 1000)
  }

  private validateScore(score: unknown): number {
    return Math.floor(this.validateNumber(score) * 1000)
  }

  async insertVideo(videoData: Omit<Video, 'id'>): Promise<number> {
    const [result] = await db
      .insert(videos)
      .values({
        title: videoData.title,
        originalFilename: videoData.originalFilename,
        filePath: videoData.filePath,
        fileSize: videoData.fileSize,
        language: videoData.language || 'de',
        transcriptionStatus: 'pending',
        tempInfoFile: videoData.tempInfoFile
      })
      .returning({ id: videos.id })

    return result.id
  }

  async updateVideoStatus(
    videoId: number,
    status: Video['transcriptionStatus'],
    data?: {
      jobId?: string
      errorMessage?: string
      transcriptionFile?: string
    }
  ): Promise<void> {
    const updateData: Record<string, unknown> = {
      transcriptionStatus: status,
      updatedAt: new Date()
    }

    if (data?.jobId) {
      updateData.queueJobId = data.jobId
    }
    if (data?.errorMessage) {
      updateData.errorMessage = data.errorMessage
    }
    if (data?.transcriptionFile) {
      updateData.transcriptionFile = data.transcriptionFile
    }
    if (status === 'completed') {
      updateData.processedAt = new Date()
    }

    await db.update(videos).set(updateData).where(eq(videos.id, videoId))
  }

  async logProcessingStep(
    videoId: number,
    step: string,
    status: 'started' | 'completed' | 'failed',
    message: string | null = null
  ): Promise<void> {
    await db.insert(processingLogs).values({
      videoId,
      step,
      status,
      message: message || undefined
    })
  }

  async getVideoById(id: number): Promise<VideoModel | null> {
    const [result] = await db.select().from(videos).where(eq(videos.id, id)).limit(1)

    return result ? new VideoModel(this.mapVideoFromDb(result)) : null
  }

  async getRecentVideos(limit: number = 20): Promise<VideoModel[]> {
    const results = await db
      .select()
      .from(videos)
      .orderBy(sql`${videos.createdAt} DESC`)
      .limit(limit)

    return results.map((video) => new VideoModel(this.mapVideoFromDb(video)))
  }

  async deleteVideo(id: number): Promise<void> {
    await db.delete(videos).where(eq(videos.id, id))
  }

  async insertAudioSegments(segments: TranscriptionSegment[], videoId: number, language: string): Promise<number[]> {
    const audioSegmentIds: number[] = []

    await db.transaction(async (tx) => {
      for (const segment of segments) {
        const [audioSegment] = await tx
          .insert(audioSegments)
          .values({
            videoId,
            startTime: this.validateTime(segment.start),
            endTime: this.validateTime(segment.end),
            text: segment.text || '',
            language,
            translation: segment.translation
          })
          .returning({ id: audioSegments.id })

        const audioSegmentId = audioSegment.id
        audioSegmentIds.push(audioSegmentId)

        if (segment.words && segment.words.length > 0) {
          const wordValues = segment.words.map((word, index) => ({
            audioSegmentId,
            word: word.word || '',
            startTime: this.validateTime(word.start),
            endTime: this.validateTime(word.end),
            confidenceScore: this.validateScore(word.score),
            positionInSegment: index + 1
          }))

          await tx.insert(wordSegments).values(wordValues)
        }
      }
    })

    return audioSegmentIds
  }

  async loadTranscriptionData(
    videoId: number,
    transcriptionFile: string
  ): Promise<{
    segments: number
    vocabulary: number
    language: string
  }> {
    try {
      const fileContent = await fs.readFile(transcriptionFile, 'utf8')
      const jsonData = JSON.parse(fileContent)

      let segmentsInserted = 0
      let vocabularyInserted = 0

      if (Array.isArray(jsonData.segments)) {
        await this.insertAudioSegments(jsonData.segments, videoId, jsonData.language || 'de')
        segmentsInserted = jsonData.segments.length
      }

      if (Array.isArray(jsonData.vocabulary)) {
        vocabularyInserted = jsonData.vocabulary.length
      }

      return {
        segments: segmentsInserted,
        vocabulary: vocabularyInserted,
        language: jsonData.language || 'de'
      }
    } catch (error) {
      throw new Error(`Erreur lors du chargement de la transcription: ${(error as Error).message}`)
    }
  }

  private mapVideoFromDb(dbVideo: typeof videos.$inferSelect): Video {
    return {
      id: dbVideo.id,
      title: dbVideo.title,
      originalFilename: dbVideo.originalFilename,
      filePath: dbVideo.filePath,
      fileSize: typeof dbVideo.fileSize === 'number' && !Number.isNaN(dbVideo.fileSize) ? dbVideo.fileSize : 0,
      language: dbVideo.language,
      transcriptionStatus: dbVideo.transcriptionStatus ?? 'pending',
      queueJobId: dbVideo.queueJobId || undefined,
      errorMessage: dbVideo.errorMessage || undefined,
      tempInfoFile: dbVideo.tempInfoFile || undefined,
      transcriptionFile: dbVideo.transcriptionFile || undefined,
      createdAt: dbVideo.createdAt || undefined,
      updatedAt: dbVideo.updatedAt || undefined,
      processedAt: dbVideo.processedAt || undefined
    }
  }
}
