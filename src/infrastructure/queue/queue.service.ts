import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import Queue, { type Job } from 'bull'
import type { VideoRepositoryInterface } from '@/domain/repositories/video.repository.interface'
import { VideoRepository } from '../repositories/video.repository'

interface QueueJobData {
  videoId: number
  audioPath: string
}

export class ProcessingQueue {
  private queue: any

  videoRepository: VideoRepositoryInterface

  constructor() {
    this.videoRepository = new VideoRepository()
    this.queue = new Queue('audio processing', {
      redis: { host: 'localhost', port: 6379 },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        }
      }
    })

    this.setupQueueProcessor()
    this.setupQueueListeners()
  }

  private setupQueueProcessor() {
    this.queue.process(async (job: Job<QueueJobData>) => {
      const { videoId, audioPath } = job.data

      try {
        await this.videoRepository.logProcessingStep(videoId, 'transcription', 'started')
        await this.videoRepository.updateVideoStatus(videoId, 'processing')

        const sprechProcess = spawn('sprech', [audioPath])

        let stderr = ''

        sprechProcess.stdout.on('data', () => {
          job.progress(50)
        })
        sprechProcess.stderr.on('data', (data) => {
          stderr += data.toString()
        })

        return new Promise((resolve, reject) => {
          sprechProcess.on('close', async (code: number) => {
            try {
              if (code === 0) {
                await this.videoRepository.logProcessingStep(videoId, 'transcription', 'completed')

                const outputPath = `${audioPath}.json`
                const stats = await this.videoRepository.loadTranscriptionData(videoId, outputPath)

                await this.videoRepository.updateVideoStatus(videoId, 'completed', {
                  transcriptionFile: outputPath
                })

                try {
                  const video = await this.videoRepository.getVideoById(videoId)
                  if (video?.tempInfoFile) {
                    await fs.unlink(video.tempInfoFile)
                  }
                } catch (error) {
                  console.warn('Temp file already deleted:', error)
                }

                await this.videoRepository.logProcessingStep(
                  videoId,
                  'database_import',
                  'completed',
                  `Segments: ${stats.segments}, Vocabulary: ${stats.vocabulary}`
                )

                resolve({
                  success: true,
                  stats,
                  outputPath
                })
              } else {
                const errorMsg = `Sprech command failed (code ${code}): ${stderr}`
                await this.videoRepository.logProcessingStep(videoId, 'transcription', 'failed', errorMsg)
                await this.videoRepository.updateVideoStatus(videoId, 'failed', {
                  errorMessage: errorMsg
                })
                reject(new Error(errorMsg))
              }
            } catch (error: any) {
              await this.videoRepository.updateVideoStatus(videoId, 'failed', {
                errorMessage: error.message
              })
              reject(error)
            }
          })
        })
      } catch (error: any) {
        await this.videoRepository.logProcessingStep(videoId, 'transcription', 'failed', error.message)
        await this.videoRepository.updateVideoStatus(videoId, 'failed', {
          errorMessage: error.message
        })
        throw error
      }
    })
  }

  private setupQueueListeners() {
    this.queue.on('completed', (job: Job<QueueJobData>) => {
      console.info(`✅ Job ${job.id} completed successfully`)
    })

    this.queue.on('failed', (job: Job<QueueJobData>, err: Error) => {
      console.error(`❌ Job ${job.id} failed:`, err.message)
    })

    this.queue.on('progress', (job: Job<QueueJobData>, progress: number) => {
      console.info(`📊 Job ${job.id} progress: ${progress}%`)
    })
  }

  addVideo(data: QueueJobData): Promise<Job<QueueJobData>> {
    return this.queue.add(data)
  }

  async getQueueStatus() {
    const [waiting, active, completed, failed] = await Promise.all([
      this.queue.getWaiting(),
      this.queue.getActive(),
      this.queue.getCompleted(),
      this.queue.getFailed()
    ])

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length
    }
  }

  async cleanQueue(): Promise<void> {
    await this.queue.clean(5000, 'completed')
    await this.queue.clean(5000, 'failed')
  }

  async close(): Promise<void> {
    await this.queue.close()
  }
}
