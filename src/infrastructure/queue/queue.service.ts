import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { homedir } from 'node:os'
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
        // Vérification que le fichier audio existe
        await this.validateAudioFile(audioPath)

        await this.videoRepository.logProcessingStep(videoId, 'transcription', 'started')
        await this.videoRepository.updateVideoStatus(videoId, 'processing')

        const result = await this.processAudioFile(job, videoId, audioPath)

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
      // Convert /root/sprech-audios paths to correct home directory path
      let normalizedPath = audioPath
      if (audioPath.startsWith('/root/sprech-audios/')) {
        normalizedPath = path.join(homedir(), 'sprech-audios', audioPath.slice('/root/sprech-audios/'.length))
      }

      const stats = await fs.stat(normalizedPath)
      if (!stats.isFile()) {
        throw new Error(`Audio file not found: ${normalizedPath}`)
      }

      // Si le fichier est dans le dossier uploads, le déplacer vers sa destination finale
      if (normalizedPath.startsWith('uploads/')) {
        const fileName = path.basename(normalizedPath)
        const newPath = path.join(homedir(), 'sprech-audios', 'de', fileName)
        await fs.mkdir(path.dirname(newPath), { recursive: true })
        await fs.rename(normalizedPath, newPath)
        console.info(`Moved file from ${normalizedPath} to ${newPath}`)
        return newPath
      }

      // Vérification de l'extension
      const ext = path.extname(normalizedPath).toLowerCase()
      const supportedFormats = ['.wav', '.mp3', '.m4a', '.flac', '.ogg']
      if (!supportedFormats.includes(ext)) {
        console.warn(`Warning: Format ${ext} may not be supported. Supported: ${supportedFormats.join(', ')}`)
      }

      return normalizedPath
    } catch (error) {
      throw new Error(`Cannot access audio file ${audioPath}: ${error}`)
    }
  }

  private async processAudioFile(
    job: Job<QueueJobData>,
    videoId: number,
    audioPath: string
  ): Promise<ProcessingResult> {
    const { sourceLang = 'de', targetLang = 'fr' } = job.data
    const baseDir = path.join(homedir(), 'sprech-audios')

    try {
      const processPath = await this.validateAudioFile(audioPath)
      const relativePath = path.relative(baseDir, processPath)

      return new Promise((resolve, reject) => {
        // Construction de la commande Docker
        const dockerArgs = [
          'run',
          '--rm',
          '--workdir=/var/www/sprech-audios',
          '--volume',
          `${baseDir}:/var/www/sprech-audios:rw`,
          'heysprech-api',
          'python',
          '/app/cli.py',
          `${relativePath}`,
          '--source-lang',
          sourceLang,
          '--target-lang',
          targetLang
        ]

        console.info(`Starting Docker sprech process for video ${videoId}:`, {
          audioFile: path.basename(processPath),
          sourceLang,
          targetLang,
          containerPath: `/var/www/sprech-audios/${relativePath}`
        })

        const dockerProcess = spawn('docker', dockerArgs, {
          stdio: ['ignore', 'pipe', 'pipe']
        })

        let stderr = ''
        let progressReported = false

        dockerProcess.stdout.on('data', (data) => {
          const output = data.toString()
          console.info(`Docker output: ${output.trim()}`)

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

        dockerProcess.on('close', async (code: number, signal: string) => {
          try {
            if (signal) {
              reject(new Error(`Docker sprech process was killed with signal ${signal}`))
              return
            }

            if (code === 0) {
              // Le fichier de sortie sera dans le dossier correspondant à la langue cible
              const baseDir = path.join(homedir(), 'sprech-audios')
              const outputDir = path.join(baseDir, targetLang)
              const outputPath = path.join(outputDir, `${path.basename(processPath)}.json`)

              // Vérification que le fichier de sortie existe
              try {
                await fs.access(outputPath)
              } catch {
                // Essayer aussi avec l'extension originale remplacée
                const nameWithoutExt = path.parse(path.basename(processPath)).name
                const alternativeOutputPath = path.join(outputDir, `${nameWithoutExt}.json`)
                try {
                  await fs.access(alternativeOutputPath)
                  const stats = await this.videoRepository.loadTranscriptionData(videoId, alternativeOutputPath)
                  resolve({
                    success: true,
                    stats,
                    outputPath: alternativeOutputPath
                  })
                  return
                } catch {
                  reject(
                    new Error(
                      `Docker sprech completed but output file not found: ${outputPath} or ${alternativeOutputPath}`
                    )
                  )
                  return
                }
              }

              const stats = await this.videoRepository.loadTranscriptionData(videoId, outputPath)

              resolve({
                success: true,
                stats,
                outputPath
              })
            } else {
              const errorMsg = `Docker sprech command failed (code ${code}): ${stderr}`
              reject(new Error(errorMsg))
            }
          } catch (error: any) {
            reject(error)
          }
        })
      })
    } catch (error: any) {
      throw new Error(`Error in processAudioFile: ${error.message}`)
    }
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
    const baseDir = path.join(homedir(), 'sprech-audios')

    try {
      await fs.mkdir(baseDir, { recursive: true })
      for (const dir of dirs) {
        const dirPath = path.join(baseDir, dir)
        try {
          await fs.access(dirPath)
        } catch {
          await fs.mkdir(dirPath, { recursive: true })
          console.info(`Created directory: ${dirPath}`)
        }
      }
    } catch (error) {
      console.error('Error creating directories:', error)
    }
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
    const audioPath = path.join(homedir(), 'sprech-audios', 'audios', audioFileName)

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
