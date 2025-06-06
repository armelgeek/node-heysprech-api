import fs from 'node:fs/promises'
import path from 'node:path'
import { ProcessingQueue } from '@/infrastructure/queue/queue.service'
import { VideoRepository } from '@/infrastructure/repositories/video.repository'
import type { VideoModel } from '@/domain/models/video.model'
import type { VideoRepositoryInterface } from '@/domain/repositories/video.repository.interface'

export class VideoService {
  videoRepository: VideoRepositoryInterface
  queue: ProcessingQueue
  constructor() {
    this.videoRepository = new VideoRepository()
    this.queue = new ProcessingQueue()
    this.createDirectories().catch((error) => {
      console.error('Error creating directories:', error)
    })
  }

  async createDirectories() {
    const dirs = ['audios', 'transcriptions', 'temp']
    for (const dir of dirs) {
      try {
        await fs.mkdir(dir, { recursive: true })
      } catch (error) {
        console.warn(`Dossier ${dir} existe déjà ou erreur:`, error)
      }
    }
  }

  async uploadVideo(
    file: {
      filename: string
      originalname: string
      path: string
      size: number
    },
    options: {
      language?: string
      title?: string
      youtubeId?: string
      categoryId?: number
      difficultyId?: number
    } = {}
  ): Promise<VideoModel> {
    const tempInfoFile = path.join('temp', `info_${Date.now()}.txt`)
    const videoInfo = {
      originalFilename: file.originalname,
      filePath: file.path,
      fileSize: file.size,
      language: options.language || 'de',
      title: options.title || file.originalname,
      uploadedAt: new Date().toISOString(),
      categoryId: options.categoryId,
      difficultyId: options.difficultyId
    }

    await fs.writeFile(tempInfoFile, JSON.stringify(videoInfo, null, 2))

    const video = await this.createVideo({
      title: options.title || file.originalname,
      originalFilename: file.originalname,
      path: file.path,
      size: file.size,
      language: options.language,
      categoryId: options.categoryId,
      difficultyId: options.difficultyId
    })

    if (video) {
      await this.queue.addVideo({
        videoId: video.id!,
        audioPath: file.path
      })

      await this.videoRepository.updateVideoStatus(video.id!, 'pending')
      await this.videoRepository.logProcessingStep(video.id!, 'upload', 'completed', `Fichier: ${file.originalname}`)
    }

    return video!
  }

  getVideoById(id: number): Promise<VideoModel | null> {
    return this.videoRepository.getVideoById(id)
  }

  getRecentVideos(limit?: number): Promise<VideoModel[]> {
    return this.videoRepository.getRecentVideos(limit)
  }

  async deleteVideo(id: number): Promise<void> {
    const video = await this.videoRepository.getVideoById(id)
    if (!video) {
      throw new Error('Video not found')
    }

    const filesToDelete = [video.filePath, video.transcriptionFile, video.tempInfoFile].filter(Boolean)

    for (const filePath of filesToDelete) {
      try {
        await fs.unlink(filePath!)
      } catch {
        console.warn(`File ${filePath} already deleted or not found`)
      }
    }

    await this.videoRepository.deleteVideo(id)
  }

  async retryProcessing(id: number): Promise<void> {
    const video = await this.videoRepository.getVideoById(id)
    if (!video || video.transcriptionStatus !== 'failed') {
      throw new Error('Video not found or not in failed state')
    }

    const job = await this.queue.addVideo({
      videoId: video.id!,
      audioPath: video.filePath
    })

    await this.videoRepository.updateVideoStatus(video.id!, 'pending', {
      jobId: job.id.toString(),
      errorMessage: undefined
    })

    await this.videoRepository.logProcessingStep(video.id!, 'retry', 'started', 'Relance du traitement')
  }

  getQueueStatus(): Promise<{ waiting: number; active: number; completed: number; failed: number }> {
    return this.queue.getQueueStatus()
  }

  async cleanQueue(): Promise<void> {
    await this.queue.cleanQueue()
  }

  async updateVideoCategory(
    id: number,
    data: {
      categoryId?: number
      difficultyId?: number
    }
  ): Promise<VideoModel | null> {
    await this.videoRepository.updateVideoCategory(id, data)
    return this.videoRepository.getVideoById(id)
  }

  getVideoCategories(videoId: number): Promise<{ categoryIds: number[]; difficultyId?: number }> {
    return this.videoRepository.getVideoCategories(videoId)
  }

  getFilteredVideos(filters: { categoryId?: number; difficultyId?: number }): Promise<VideoModel[]> {
    return this.videoRepository.getFilteredVideos(filters)
  }

  async createVideo(data: {
    title: string
    originalFilename: string
    path: string
    size: number
    language?: string
    categoryId?: number
    difficultyId?: number
  }): Promise<VideoModel | null> {
    const videoId = await this.videoRepository.insertVideo({
      title: data.title,
      originalFilename: data.originalFilename,
      filePath: data.path,
      fileSize: data.size,
      language: data.language || 'de',
      transcriptionStatus: 'pending'
    })

    if (data.categoryId || data.difficultyId) {
      await this.videoRepository.updateVideoCategory(videoId, {
        categoryId: data.categoryId,
        difficultyId: data.difficultyId
      })
    }

    return this.videoRepository.getVideoById(videoId)
  }
}
