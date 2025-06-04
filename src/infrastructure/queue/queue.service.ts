import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import Queue, { type Job } from 'bull'
import type { VideoRepositoryInterface } from '@/domain/repositories/video.repository.interface'
import { VideoRepository } from '../repositories/video.repository'

interface QueueJobData {
  videoId: number
  audioPath: string
  sourceLang?: string
  targetLang?: string
}

interface ProcessingResult {
  success: boolean
  stats?: {
    segments: number
    vocabulary: number
  }
  outputPath?: string
  error?: string
}
const baseDir = path.join(os.homedir(), 'heysprech-data')
export class ProcessingQueue {
  private queue: Queue.Queue<QueueJobData>
  private readonly videoRepository: VideoRepositoryInterface
  private readonly maxConcurrency: number

  constructor(maxConcurrency = 2) {
    this.maxConcurrency = maxConcurrency
    this.videoRepository = new VideoRepository()

    // Vérification que Docker est disponible
    this.validateDockerAvailability()

    this.queue = new Queue('audio processing', {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: Number.parseInt(process.env.REDIS_PORT || '6379'),
        // Ajout de la gestion des erreurs Redis
        retryDelayOnFailover: 100,
        enableReadyCheck: false,
        maxRetriesPerRequest: 3
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: 10, // Garde seulement les 10 derniers jobs complétés
        removeOnFail: 20 // Garde seulement les 20 derniers jobs échoués
      }
    })

    this.setupQueueProcessor()
    this.setupQueueListeners()
  }

  private setupQueueProcessor() {
    // Limite la concurrence pour éviter de surcharger le système
    this.queue.process(this.maxConcurrency, async (job: Job<QueueJobData>): Promise<ProcessingResult> => {
      const { videoId, audioPath } = job.data

      try {
        // Ensure output directories exist before processing
        await this.ensureOutputDirectories()

        // Validate audio file and get the correct path
        const validatedAudioPath = await this.validateAudioFile(audioPath)

        await this.videoRepository.logProcessingStep(videoId, 'transcription', 'started')
        await this.videoRepository.updateVideoStatus(videoId, 'processing')

        const result = await this.processAudioFile(job, videoId, validatedAudioPath)

        if (result.success) {
          await this.handleSuccessfulProcessing(videoId, result)
        }

        return result
      } catch (error: any) {
        const errorResult = await this.handleProcessingError(videoId, error)
        throw new Error(errorResult.error)
      }
    })
  }

  private async validateDockerAvailability(): Promise<void> {
    try {
      const { spawn } = await import('node:child_process')
      const dockerCheck = spawn('docker', ['--version'])

      await new Promise((resolve, reject) => {
        dockerCheck.on('close', (code) => {
          if (code === 0) {
            console.info('✅ Docker is available')
            resolve(true)
          } else {
            reject(new Error('Docker command failed'))
          }
        })
        dockerCheck.on('error', (error) => {
          reject(new Error(`Docker not found: ${error.message}`))
        })
      })
    } catch (error) {
      throw new Error(`Docker validation failed: ${error}. Please ensure Docker is installed and running.`)
    }
  }

  private async validateAudioFile(audioPath: string): Promise<string> {
    try {
      // Convert to absolute path for consistent handling
      const absolutePath = path.isAbsolute(audioPath) ? audioPath : path.join(baseDir, audioPath)

      const stats = await fs.stat(absolutePath)
      if (!stats.isFile()) {
        throw new Error(`Audio file not found: ${audioPath}`)
      }

      // If the file is in the uploads folder, move it to audios
      if (audioPath.startsWith('uploads/')) {
        const fileName = path.basename(audioPath)
        const newPath = path.join(baseDir, 'audios', fileName)
        await fs.rename(absolutePath, newPath)
        console.info(`Moved file from ${audioPath} to ${newPath}`)
        return newPath
      }

      // Check if the file is in the audios directory
      const audioDir = path.join(baseDir, 'audios')
      const resolvedAudioDir = path.resolve(audioDir)
      const resolvedFilePath = path.resolve(absolutePath)

      // Check if the file is within the audios directory
      if (!resolvedFilePath.startsWith(resolvedAudioDir + path.sep) && resolvedFilePath !== resolvedAudioDir) {
        throw new Error(`Audio file must be in the audios directory. Expected in: ${audioDir}, got: ${audioPath}`)
      }

      // Check file extension
      const ext = path.extname(absolutePath).toLowerCase()
      const supportedFormats = ['.wav', '.mp3', '.m4a', '.flac', '.ogg']
      if (!supportedFormats.includes(ext)) {
        console.warn(`Warning: Format ${ext} may not be supported. Supported: ${supportedFormats.join(', ')}`)
      }

      console.info(`✅ Audio file validated: ${resolvedFilePath}`)
      return resolvedFilePath
    } catch (error: any) {
      throw new Error(`Cannot access audio file ${audioPath}: ${error.message}`)
    }
  }

  private processAudioFile(job: Job<QueueJobData>, videoId: number, audioPath: string): Promise<ProcessingResult> {
    const { sourceLang = 'de', targetLang = 'fr' } = job.data

    return new Promise((resolve, reject) => {
      // Use the validated audio path directly
      const audioFileName = path.basename(audioPath)

      // Get absolute paths to ensure they exist
      const currentDir = baseDir
      const audiosDir = path.join(currentDir, 'audios')
      const deDir = path.join(currentDir, 'de')
      const frDir = path.join(currentDir, 'fr')
      const enDir = path.join(currentDir, 'en')

      const dockerArgs = [
        'run',
        '--rm',
        '--volume',
        `${audiosDir}:/app/audios:ro`,
        '--volume',
        `${deDir}:/app/de:rw`,
        '--volume',
        `${frDir}:/app/fr:rw`,
        '--volume',
        `${enDir}:/app/en:rw`,
        'heysprech-api',
        `/app/audios/${audioFileName}`,
        '--source-lang',
        sourceLang,
        '--target-lang',
        targetLang
      ]

      console.info(`Starting Docker sprech process for video ${videoId}:`, {
        audioFile: audioFileName,
        sourceLang,
        targetLang,
        volumes: {
          audios: audiosDir,
          de: deDir,
          fr: frDir,
          en: enDir
        }
      })

      const dockerProcess = spawn('docker', dockerArgs, {
        timeout: 600000, // 10 minutes timeout pour Docker
        stdio: ['ignore', 'pipe', 'pipe']
      })

      let stderr = ''
      let progressReported = false

      dockerProcess.stdout.on('data', (data) => {
        const output = data.toString()
        console.info(`Docker output: ${output.trim()}`)

        // Mise à jour du progrès basée sur la sortie
        if (output.includes('Processing') && !progressReported) {
          job.progress(25)
        } else if (output.includes('Transcribing') && job.progress() < 50) {
          job.progress(50)
          progressReported = true
        } else if (output.includes('Translating') && job.progress() < 75) {
          job.progress(75)
        }
      })

      dockerProcess.stderr.on('data', (data) => {
        const error = data.toString()
        stderr += error
        console.error(`Docker error: ${error.trim()}`)
      })

      dockerProcess.on('error', (error) => {
        reject(new Error(`Failed to start Docker sprech process: ${error.message}`))
      })
    })
  }

  private async handleSuccessfulProcessing(videoId: number, result: ProcessingResult): Promise<void> {
    await this.videoRepository.logProcessingStep(videoId, 'transcription', 'completed')

    await this.videoRepository.updateVideoStatus(videoId, 'completed', {
      transcriptionFile: result.outputPath
    })

    // Nettoyage amélioré des fichiers temporaires
    await this.cleanupTempFiles(videoId)

    await this.videoRepository.logProcessingStep(
      videoId,
      'database_import',
      'completed',
      `Segments: ${result.stats?.segments}, Vocabulary: ${result.stats?.vocabulary}`
    )
  }

  private async cleanupTempFiles(videoId: number): Promise<void> {
    try {
      const video = await this.videoRepository.getVideoById(videoId)
      if (video?.tempInfoFile) {
        await fs.unlink(video.tempInfoFile).catch((error) => {
          console.warn(`Could not delete temp file ${video.tempInfoFile}:`, error.message)
        })
      }
    } catch (error) {
      console.warn('Error during temp file cleanup:', error)
    }
  }

  private async handleProcessingError(videoId: number, error: any): Promise<ProcessingResult> {
    const errorMessage = error.message || 'Unknown processing error'

    await this.videoRepository.logProcessingStep(videoId, 'transcription', 'failed', errorMessage)

    await this.videoRepository.updateVideoStatus(videoId, 'failed', {
      errorMessage
    })

    return {
      success: false,
      error: errorMessage
    }
  }

  private setupQueueListeners() {
    this.queue.on('completed', (job: Job<QueueJobData>, result: ProcessingResult) => {
      console.info(`✅ Job ${job.id} completed successfully`, {
        videoId: job.data.videoId,
        stats: result.stats
      })
    })

    this.queue.on('failed', (job: Job<QueueJobData>, err: Error) => {
      console.error(`❌ Job ${job.id} failed:`, {
        videoId: job.data.videoId,
        error: err.message,
        audioPath: job.data.audioPath
      })
    })

    this.queue.on('progress', (job: Job<QueueJobData>, progress: number) => {
      console.info(`📊 Job ${job.id} progress: ${progress}%`, {
        videoId: job.data.videoId
      })
    })

    this.queue.on('stalled', (job: Job<QueueJobData>) => {
      console.warn(`⚠️ Job ${job.id} stalled`, {
        videoId: job.data.videoId
      })
    })

    // Gestion des erreurs Redis
    this.queue.on('error', (error) => {
      console.error('Queue error:', error)
    })
  }

  async addVideo(
    data: QueueJobData,
    options?: {
      priority?: number
      delay?: number
    }
  ): Promise<Job<QueueJobData>> {
    // Validation des langues supportées
    const supportedLangs = ['de', 'fr', 'en']
    const { sourceLang = 'de', targetLang = 'fr' } = data

    if (!supportedLangs.includes(sourceLang)) {
      throw new Error(`Unsupported source language: ${sourceLang}. Supported: ${supportedLangs.join(', ')}`)
    }

    if (!supportedLangs.includes(targetLang)) {
      throw new Error(`Unsupported target language: ${targetLang}. Supported: ${supportedLangs.join(', ')}`)
    }

    // Vérification des dossiers de sortie
    await this.ensureOutputDirectories()

    return this.queue.add(data, {
      priority: options?.priority || 0,
      delay: options?.delay || 0
    })
  }

  private async ensureOutputDirectories(): Promise<void> {
    const dirs = ['audios', 'de', 'fr', 'en']
    const currentDir = baseDir

    for (const dir of dirs) {
      const dirPath = path.join(currentDir, dir)
      try {
        await fs.access(dirPath, fs.constants.F_OK | fs.constants.W_OK)
        console.info(`✅ Directory exists and is writable: ${dirPath}`)
      } catch {
        try {
          await fs.mkdir(dirPath, { recursive: true })

          // Verify the directory was created and is writable
          await fs.access(dirPath, fs.constants.F_OK | fs.constants.W_OK)
          console.info(`✅ Created directory: ${dirPath}`)

          // Test write permissions by creating a temporary file
          const testFile = path.join(dirPath, '.write-test')
          await fs.writeFile(testFile, 'test')
          await fs.unlink(testFile)
        } catch (createError) {
          throw new Error(
            `Failed to create or access directory ${dirPath}: ${createError}. ` +
              `This might be due to insufficient permissions or read-only filesystem.`
          )
        }
      }
    }

    console.info('✅ All output directories are ready')
  }

  async getQueueStatus() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaiting(),
      this.queue.getActive(),
      this.queue.getCompleted(),
      this.queue.getFailed(),
      this.queue.getDelayed()
    ])

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
      concurrency: this.maxConcurrency
    }
  }

  async getJobDetails(jobId: string) {
    const job = await this.queue.getJob(jobId)
    if (!job) {
      return null
    }

    return {
      id: job.id,
      data: job.data,
      progress: job.progress(),
      state: await job.getState(),
      createdAt: new Date(job.timestamp),
      processedAt: job.processedOn ? new Date(job.processedOn) : null,
      finishedAt: job.finishedOn ? new Date(job.finishedOn) : null,
      failedReason: job.failedReason
    }
  }

  async retryFailedJobs(): Promise<number> {
    const failedJobs = await this.queue.getFailed()
    let retriedCount = 0

    for (const job of failedJobs) {
      try {
        await job.retry()
        retriedCount++
      } catch (error) {
        console.error(`Failed to retry job ${job.id}:`, error)
      }
    }

    return retriedCount
  }

  async pauseQueue(): Promise<void> {
    await this.queue.pause()
    console.info('Queue paused')
  }

  async resumeQueue(): Promise<void> {
    await this.queue.resume()
    console.info('Queue resumed')
  }

  async cleanQueue(maxAge = 24 * 60 * 60 * 1000): Promise<void> {
    // Nettoie les jobs de plus de 24h par défaut
    await this.queue.clean(maxAge, 'completed')
    await this.queue.clean(maxAge, 'failed')
    console.info(`Queue cleaned (jobs older than ${maxAge}ms removed)`)
  }

  async close(): Promise<void> {
    await this.queue.close()
    console.info('Processing queue closed')
  }

  // Méthode utilitaire pour traiter un fichier audio avec des paramètres simples
  enqueueAudioProcessing(
    videoId: number,
    audioFileName: string,
    sourceLang: string = 'de',
    targetLang: string = 'fr',
    options?: { priority?: number; delay?: number }
  ): Promise<Job<QueueJobData>> {
    const audioPath = path.join(baseDir, 'audios', audioFileName)

    return this.addVideo(
      {
        videoId,
        audioPath,
        sourceLang,
        targetLang
      },
      options
    )
  }

  // Méthode utilitaire pour obtenir des métriques
  async getMetrics() {
    const status = await this.getQueueStatus()
    const jobs = await Promise.all([
      this.queue.getActive(),
      this.queue.getWaiting(),
      this.queue.getCompleted(0, 10),
      this.queue.getFailed(0, 10)
    ])

    return {
      status,
      recentJobs: {
        active: jobs[0].map((j) => ({ id: j.id, data: j.data })),
        waiting: jobs[1].map((j) => ({ id: j.id, data: j.data })),
        recentCompleted: jobs[2].map((j) => ({ id: j.id, data: j.data })),
        recentFailed: jobs[3].map((j) => ({ id: j.id, data: j.data, reason: j.failedReason }))
      }
    }
  }
}
