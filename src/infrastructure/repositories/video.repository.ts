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

  private validateTime(time: unknown): number {
    const num = Number(time)
    return Number.isNaN(num) ? 0 : Math.floor(num * 1000)
  }

  private validateScore(score: unknown): number {
    const num = Number(score)
    return Number.isNaN(num) ? 0 : Math.floor(num * 1000)
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
      console.info(`📖 [Video ${videoId}] Lecture du fichier de transcription...`)
      const fileContent = await fs.readFile(transcriptionFile, 'utf8')
      const jsonData = JSON.parse(fileContent)
      console.info(`✅ [Video ${videoId}] Fichier JSON parsé avec succès`)

      let segmentsInserted = 0
      let vocabularyInserted = 0

      console.info(`📊 [Video ${videoId}] Analyse du contenu...`)
      if (Array.isArray(jsonData.segments)) {
        console.info(`🔄 [Video ${videoId}] Importation de ${jsonData.segments.length} segments audio...`)
        await this.insertAudioSegments(jsonData.segments, videoId, jsonData.language || 'de')
        segmentsInserted = jsonData.segments.length
        console.info(`✅ [Video ${videoId}] Segments audio importés avec succès`)
      }

      if (Array.isArray(jsonData.vocabulary)) {
        console.info(`🔤 [Video ${videoId}] Traitement du vocabulaire (${jsonData.vocabulary.length} mots)...`)
        vocabularyInserted = jsonData.vocabulary.length
        console.info(`✅ [Video ${videoId}] Vocabulaire traité avec succès`)
      }

      const result = {
        segments: segmentsInserted,
        vocabulary: vocabularyInserted,
        language: jsonData.language || 'de'
      }

      console.info(`📊 [Video ${videoId}] Résumé de l'importation:
        - Segments audio: ${result.segments}
        - Mots de vocabulaire: ${result.vocabulary}
        - Langue: ${result.language}`)

      return result
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
      fileSize: dbVideo.fileSize || 0,
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
