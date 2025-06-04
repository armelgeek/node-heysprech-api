import fs from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { ProcessingQueue } from '@/infrastructure/queue/queue.service'
import { VideoRepository } from '@/infrastructure/repositories/video.repository'
import type { VideoModel } from '@/domain/models/video.model'
import type { VideoRepositoryInterface } from '@/domain/repositories/video.repository.interface'

export class VideoService {
  private baseDir: string
  videoRepository: VideoRepositoryInterface
  queue: ProcessingQueue

  constructor() {
    this.baseDir = path.join(homedir(), 'sprech-audios')
    this.videoRepository = new VideoRepository()
    this.queue = new ProcessingQueue()
    this.createDirectories().catch((error) => {
      console.error('Error creating directories:', error)
    })
  }

  async createDirectories() {
    const baseDirs = ['temp', 'transcriptions', 'audios']
    const langDirs = ['fr', 'en', 'de']
    
    try {
      // Créer le dossier racine
      await fs.mkdir(this.baseDir, { recursive: true })
      
      // Créer les dossiers de base
      for (const dir of baseDirs) {
        await fs.mkdir(path.join(this.baseDir, dir), { recursive: true })
      }

      // Créer les dossiers de langue
      for (const lang of langDirs) {
        await fs.mkdir(path.join(this.baseDir, lang), { recursive: true })
      }
    } catch (error) {
      console.warn(`Erreur lors de la création des dossiers:`, error)
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
    } = {}
  ): Promise<VideoModel> {
    const language = options.language || 'de'
    
    // Assurons-nous que le fichier est dans le bon dossier
    const newAudioPath = path.join(this.baseDir, language, `${Date.now()}-${file.originalname}`)
    if (file.path !== newAudioPath) {
      await fs.copyFile(file.path, newAudioPath)
      await fs.unlink(file.path).catch(() => {}) // Supprime l'ancien fichier s'il existe
    }

    const tempInfoFile = path.join(this.baseDir, 'temp', `info_${Date.now()}.txt`)
    const videoInfo = {
      originalFilename: file.originalname,
      filePath: newAudioPath,
      fileSize: file.size,
      language,
      title: options.title || file.originalname,
      uploadedAt: new Date().toISOString()
    }

    await fs.writeFile(tempInfoFile, JSON.stringify(videoInfo, null, 2))

    const videoId = await this.videoRepository.insertVideo({
      title: options.title || file.originalname,
      originalFilename: file.originalname,
      filePath: newAudioPath,
      fileSize: file.size,
      language,
      tempInfoFile,
      transcriptionStatus: 'pending'
    })

    const job = await this.queue.addVideo({
      videoId,
      audioPath: newAudioPath
    })

    const video = await this.videoRepository.getVideoById(videoId)
    if (video) {
      await this.videoRepository.updateVideoStatus(videoId, 'pending', {
        jobId: job.id.toString()
      })
      await this.videoRepository.logProcessingStep(videoId, 'upload', 'completed', `Fichier: ${file.originalname}`)
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
}
