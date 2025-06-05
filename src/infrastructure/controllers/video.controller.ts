import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { eq, inArray } from 'drizzle-orm'
import { html } from 'hono/html'
import { VideoService } from '@/application/services/video.service'
import { db } from '../database/db'
import {
  exerciseOptions,
  exerciseQuestions,
  exercises,
  pronunciations,
  wordEntries
} from '../database/schema/exercise.schema'
import { audioSegments, videos, wordSegments } from '../database/schema/video.schema'
import type { Routes } from '../../domain/types'

const baseDir = path.join(os.homedir(), 'heysprech-data')

const errorResponseSchema = z
  .object({
    success: z.boolean(),
    error: z.string()
  })
  .openapi('ErrorResponse')

const successResponseSchema = z
  .object({
    success: z.boolean(),
    message: z.string()
  })
  .openapi('SuccessResponse')

const videoSchema = z
  .object({
    id: z.number(),
    title: z.string(),
    originalFilename: z.string(),
    fileSize: z.number(),
    language: z.string(),
    transcriptionStatus: z.enum(['pending', 'processing', 'completed', 'failed']),
    errorMessage: z.string().optional(),
    createdAt: z.string(),
    processedAt: z.string().optional()
  })
  .openapi('Video')

const queueStatusSchema = z
  .object({
    waiting: z.number(),
    active: z.number(),
    completed: z.number(),
    failed: z.number()
  })
  .openapi('QueueStatus')

// Request Schemas
const uploadRequestSchema = z.object({
  language: z.string().default('de').openapi({
    description: 'The language of the audio file',
    example: 'de'
  }),
  title: z.string().optional().openapi({
    description: 'Optional title for the audio file',
    example: 'My Audio File'
  }),
  audioFile: z.custom<File>().openapi({
    type: 'string',
    format: 'binary',
    description: 'The audio file to process'
  })
})

const uploadResponseSchema = z.object({
  success: z.boolean().openapi({
    description: 'Whether the upload was successful',
    example: true
  }),
  videoId: z.number().openapi({
    description: 'The ID of the uploaded video',
    example: 123
  }),
  filename: z.string().openapi({
    description: 'The name of the uploaded file',
    example: 'audio-recording.mp3'
  }),
  size: z.number().openapi({
    description: 'Size of the uploaded file in bytes',
    example: 1048576
  }),
  message: z.string().openapi({
    description: 'Status message about the upload',
    example: 'File added to processing queue'
  })
})

export class VideoController implements Routes {
  public controller: OpenAPIHono
  app: any
  videoService: VideoService

  constructor() {
    this.controller = new OpenAPIHono()
    this.videoService = new VideoService()
  }

  public initRoutes() {
    this.controller.use('/public/*', serveStatic({ root: baseDir }))
    this.controller.use('/audios/*', serveStatic({ root: baseDir }))
    this.controller.use('/transcriptions/*', serveStatic({ root: baseDir }))

    this.controller.get('/', (c) => {
      return c.html(this.renderHomePage())
    })

    this.controller.openapi(
      createRoute({
        method: 'post',
        path: '/v1/upload-audio',
        tags: ['Upload'],
        summary: 'Upload',
        description: 'Upload',
        request: {
          body: {
            content: {
              'multipart/form-data': {
                schema: uploadRequestSchema
              }
            }
          }
        },
        responses: {
          200: {
            content: {
              'application/json': {
                schema: uploadResponseSchema
              }
            },
            description: 'File uploaded successfully'
          },
          400: {
            content: {
              'application/json': {
                schema: z.object({
                  success: z.boolean(),
                  error: z.string()
                })
              }
            },
            description: 'Invalid request'
          }
        }
      }),
      async (c: any) => {
        try {
          const body = await c.req.parseBody()
          const file = body.audioFile

          if (!file || !(file instanceof File)) {
            return c.json(
              {
                success: false,
                error: 'Audio file is required'
              },
              400
            )
          }

          const allowedTypes = ['audio/mpeg', 'audio/wav', 'audio/x-m4a', 'video/mp4', 'video/avi', 'video/quicktime']
          if (!allowedTypes.includes(file.type)) {
            return c.json(
              {
                success: false,
                error: 'Unsupported file type. Accepted types: MP3, WAV, M4A, MP4, AVI, MOV'
              },
              400
            )
          }

          const formData = {
            language: body.language as string,
            title: body.title as string | undefined
          }

          const result = uploadRequestSchema.safeParse(formData)
          if (!result.success) {
            return c.json(
              {
                success: false,
                error: `Invalid data: ${result.error.message}`
              },
              400
            )
          }

          // Trouve un nom de fichier unique
          const getUniqueFilePath = async (baseName: string) => {
            let counter = 0
            let filePath = path.join(baseDir, 'audios', baseName)

            while (true) {
              try {
                await fs.access(filePath)
                counter++
                const ext = path.extname(baseName)
                const nameWithoutExt = path.basename(baseName, ext)
                filePath = path.join(baseDir, 'audios', `${nameWithoutExt}-${counter}${ext}`)
              } catch {
                // Le fichier n'existe pas, on peut utiliser ce nom
                return filePath
              }
            }
          }

          const tempPath = await getUniqueFilePath(file.name)
          await Bun.write(tempPath, file)

          const videoFile = {
            filename: file.name,
            originalname: file.name,
            path: tempPath,
            size: file.size
          }

          const video = await this.videoService.uploadVideo(videoFile, {
            language: formData.language,
            title: formData.title
          })

          return c.json({
            success: true,
            videoId: video.id,
            filename: video.originalFilename,
            size: video.fileSize,
            message: 'File added to processing queue'
          })
        } catch (error: any) {
          console.error('Upload error:', error.message)
          return c.json(
            {
              success: false,
              error: `Processing error: ${error.message}`
            },
            500
          )
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'get',
        path: '/queue/status',
        tags: ['Queue'],
        summary: 'Get Queue Status',
        description: 'Retrieve current status of the processing queue',
        responses: {
          200: {
            content: {
              'application/json': {
                schema: queueStatusSchema
              }
            },
            description: 'Current queue statistics'
          },
          500: {
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            },
            description: 'Server error'
          }
        }
      }),
      async (c: any) => {
        try {
          const stats = await this.videoService.getQueueStatus()
          return c.json(stats)
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'post',
        path: '/queue/clean',
        tags: ['Queue'],
        summary: 'Clean Queue',
        description: 'Remove completed and failed jobs from the queue',
        responses: {
          200: {
            content: {
              'application/json': {
                schema: successResponseSchema
              }
            },
            description: 'Queue cleaned successfully'
          },
          500: {
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            },
            description: 'Server error'
          }
        }
      }),
      async (c: any) => {
        try {
          await this.videoService.cleanQueue()
          return c.json({
            success: true,
            message: 'Queue cleaned successfully'
          })
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'get',
        path: '/videos/recent',
        tags: ['Videos'],
        summary: 'Get Recent Videos',
        description: 'Retrieve a list of recently processed videos',
        responses: {
          200: {
            content: {
              'application/json': {
                schema: z.array(videoSchema)
              }
            },
            description: 'List of recent videos'
          },
          500: {
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            },
            description: 'Server error'
          }
        }
      }),
      async (c: any) => {
        try {
          const videos = await this.videoService.getRecentVideos(20)
          return c.json(videos)
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'delete',
        path: '/videos/{id}',
        tags: ['Videos'],
        summary: 'Delete Video',
        description: 'Delete a video and its associated files',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'The ID of the video to delete'
          }
        ],
        responses: {
          200: {
            content: {
              'application/json': {
                schema: successResponseSchema
              }
            },
            description: 'Video deleted successfully'
          },
          500: {
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            },
            description: 'Server error'
          }
        }
      }),
      async (c: any) => {
        const id = Number.parseInt(c.req.param('id'))
        if (Number.isNaN(id)) {
          return c.json({ success: false, error: 'Invalid video ID' }, 400)
        }
        try {
          await this.videoService.deleteVideo(id)
          return c.json({
            success: true,
            message: 'Video and associated files deleted'
          })
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'post',
        path: '/videos/{id}/retry',
        tags: ['Videos'],
        summary: 'Retry Video Processing',
        description: 'Retry processing a failed video',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'The ID of the video to retry'
          }
        ],
        responses: {
          200: {
            content: {
              'application/json': {
                schema: successResponseSchema
              }
            },
            description: 'Processing restarted successfully'
          },
          500: {
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            },
            description: 'Server error'
          }
        }
      }),
      async (c: any) => {
        const id = Number.parseInt(c.req.param('id'))
        if (Number.isNaN(id)) {
          return c.json({ success: false, error: 'Invalid video ID' }, 400)
        }
        try {
          await this.videoService.retryProcessing(id)
          return c.json({
            success: true,
            message: 'Processing restarted'
          })
        } catch (error: any) {
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'get',
        path: '/api/videos/recent',
        tags: ['Videos'],
        summary: 'Get Recent Videos API',
        description: 'Retrieve a list of the 10 most recently processed videos',
        responses: {
          200: {
            content: {
              'application/json': {
                schema: z.array(videoSchema)
              }
            },
            description: 'List of recent videos'
          },
          500: {
            content: {
              'application/json': {
                schema: errorResponseSchema
              }
            },
            description: 'Server error'
          }
        }
      }),
      async (c: any) => {
        try {
          const videos = await this.videoService.getRecentVideos(10)
          return c.json(
            videos.map((v) => ({
              id: v.id,
              title: v.title,
              originalFilename: v.originalFilename,
              language: v.language,
              transcriptionStatus: v.transcriptionStatus,
              errorMessage: v.errorMessage,
              createdAt: v.createdAt,
              processedAt: v.processedAt
            }))
          )
        } catch (error: any) {
          console.error('Error fetching recent videos:', error.message)
          return c.json({ success: false, error: error.message }, 500)
        }
      }
    )

    // Nouvel endpoint pour récupérer toutes les vidéos
    this.controller.get('/videos', async (c) => {
      const result = await db
        .select({
          id: videos.id,
          title: videos.title,
          originalFilename: videos.originalFilename,
          filePath: videos.filePath,
          fileSize: videos.fileSize,
          duration: videos.duration,
          language: videos.language,
          transcriptionStatus: videos.transcriptionStatus,
          createdAt: videos.createdAt,
          updatedAt: videos.updatedAt
        })
        .from(videos)
      return c.json(result)
    })

    // Récupérer tous les segments audio
    this.controller.get('/audio-segments', async (c) => {
      const result = await db
        .select({
          id: audioSegments.id,
          videoId: audioSegments.videoId,
          startTime: audioSegments.startTime,
          endTime: audioSegments.endTime,
          text: audioSegments.text,
          translation: audioSegments.translation,
          language: audioSegments.language
        })
        .from(audioSegments)
      return c.json(result)
    })

    // Récupérer tous les segments de mots
    this.controller.get('/word-segments', async (c) => {
      const result = await db
        .select({
          id: wordSegments.id,
          audioSegmentId: wordSegments.audioSegmentId,
          word: wordSegments.word,
          startTime: wordSegments.startTime,
          endTime: wordSegments.endTime,
          confidenceScore: wordSegments.confidenceScore,
          positionInSegment: wordSegments.positionInSegment
        })
        .from(wordSegments)
      return c.json(result)
    })

    // Récupérer toutes les entrées de mots
    this.controller.get('/word-entries', async (c) => {
      const result = await db
        .select({
          id: wordEntries.id,
          word: wordEntries.word,
          language: wordEntries.language,
          translations: wordEntries.translations,
          examples: wordEntries.examples,
          level: wordEntries.level,
          metadata: wordEntries.metadata
        })
        .from(wordEntries)
      return c.json(result)
    })

    // Récupérer tous les exercices
    this.controller.get('/exercises', async (c) => {
      const result = await db
        .select({
          id: exercises.id,
          wordId: exercises.wordId,
          type: exercises.type,
          level: exercises.level,
          createdAt: exercises.createdAt
        })
        .from(exercises)
      return c.json(result)
    })

    // Récupérer toutes les questions d'exercices
    this.controller.get('/exercise-questions', async (c) => {
      const result = await db
        .select({
          id: exerciseQuestions.id,
          exerciseId: exerciseQuestions.exerciseId,
          direction: exerciseQuestions.direction,
          questionDe: exerciseQuestions.questionDe,
          questionFr: exerciseQuestions.questionFr,
          wordToTranslate: exerciseQuestions.wordToTranslate,
          correctAnswer: exerciseQuestions.correctAnswer
        })
        .from(exerciseQuestions)
      return c.json(result)
    })

    // Récupérer toutes les options d'exercices
    this.controller.get('/exercise-options', async (c) => {
      const result = await db
        .select({
          id: exerciseOptions.id,
          questionId: exerciseOptions.questionId,
          optionText: exerciseOptions.optionText,
          isCorrect: exerciseOptions.isCorrect
        })
        .from(exerciseOptions)
      return c.json(result)
    })

    // Récupérer toutes les prononciations
    this.controller.get('/pronunciations', async (c) => {
      const result = await db
        .select({
          id: pronunciations.id,
          wordId: pronunciations.wordId,
          filePath: pronunciations.filePath,
          type: pronunciations.type,
          language: pronunciations.language
        })
        .from(pronunciations)
      return c.json(result)
    })

    // Récupérer les exercices d'une vidéo avec leurs questions et options, groupés par direction
    this.controller.get('/videos/:id/exercises', async (c) => {
      const videoId = Number(c.req.param('id'))

      if (Number.isNaN(videoId)) {
        return c.json({ error: 'ID de vidéo invalide' }, 400)
      }

      // Récupérer d'abord les segments audio de la vidéo
      const audioSegmentsResult = await db
        .select({
          id: audioSegments.id,
          text: audioSegments.text
        })
        .from(audioSegments)
        .where(eq(audioSegments.videoId, videoId))

      // Récupérer les word segments associés aux segments audio
      const wordSegmentsResult = await db
        .select({
          id: wordSegments.id,
          word: wordSegments.word,
          audioSegmentId: wordSegments.audioSegmentId
        })
        .from(wordSegments)
        .where(
          inArray(
            wordSegments.audioSegmentId,
            audioSegmentsResult.map((seg) => seg.id)
          )
        )

      // Récupérer les exercices associés aux mots
      const exercisesResult = await db
        .select({
          id: exercises.id,
          type: exercises.type,
          level: exercises.level
        })
        .from(exercises)
        .where(
          inArray(
            exercises.wordId,
            wordSegmentsResult.map((word) => word.id)
          )
        )

      // Récupérer les questions et options pour ces exercices
      const questionsResult = await db
        .select({
          id: exerciseQuestions.id,
          exerciseId: exerciseQuestions.exerciseId,
          direction: exerciseQuestions.direction,
          questionDe: exerciseQuestions.questionDe,
          questionFr: exerciseQuestions.questionFr,
          wordToTranslate: exerciseQuestions.wordToTranslate,
          correctAnswer: exerciseQuestions.correctAnswer
        })
        .from(exerciseQuestions)
        .where(
          inArray(
            exerciseQuestions.exerciseId,
            exercisesResult.map((ex) => ex.id)
          )
        )

      const optionsResult = await db
        .select({
          id: exerciseOptions.id,
          questionId: exerciseOptions.questionId,
          optionText: exerciseOptions.optionText,
          isCorrect: exerciseOptions.isCorrect
        })
        .from(exerciseOptions)
        .where(
          inArray(
            exerciseOptions.questionId,
            questionsResult.map((q) => q.id)
          )
        )

      // Organiser les résultats par direction
      type DirectionType = 'de_to_fr' | 'fr_to_de'
      const exercisesByDirection: Record<
        DirectionType,
        Array<{
          exercise: (typeof exercisesResult)[0] | undefined
          question: (typeof questionsResult)[0] & { options: typeof optionsResult }
        }>
      > = {
        de_to_fr: [],
        fr_to_de: []
      }

      questionsResult.forEach((question) => {
        const options = optionsResult.filter((opt) => opt.questionId === question.id)
        const exercise = exercisesResult.find((ex) => ex.id === question.exerciseId)

        exercisesByDirection[question.direction as DirectionType].push({
          exercise,
          question: {
            ...question,
            options
          }
        })
      })

      return c.json(exercisesByDirection)
    })
  }

  private renderHomePage() {
    return html`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Audio Processing System</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              max-width: 1000px;
              margin: 0 auto;
              padding: 20px;
            }
            .upload-form {
              border: 2px solid #007bff;
              padding: 20px;
              margin: 20px 0;
              border-radius: 8px;
            }
            .btn {
              background: #007bff;
              color: white;
              padding: 12px 24px;
              border: none;
              cursor: pointer;
              border-radius: 4px;
              font-size: 16px;
              margin: 5px;
            }
            .btn:hover {
              background: #0056b3;
            }
            .btn:disabled {
              background: #ccc;
              cursor: not-allowed;
            }
            .status {
              margin: 20px 0;
              padding: 15px;
              border-radius: 4px;
            }
            .success {
              background: #d4edda;
              color: #155724;
              border: 1px solid #c3e6cb;
            }
            .error {
              background: #f8d7da;
              color: #721c24;
              border: 1px solid #f5c6cb;
            }
            .info {
              background: #d1ecf1;
              color: #0c5460;
              border: 1px solid #bee5eb;
            }
            .progress {
              background: #fff3cd;
              color: #856404;
              border: 1px solid #ffeaa7;
            }
            .queue-status {
              background: #f8f9fa;
              padding: 15px;
              border-radius: 4px;
              margin: 20px 0;
            }
            .file-input {
              margin: 10px 0;
              padding: 10px;
              width: 100%;
            }
            .select-input {
              margin: 10px 0;
              padding: 8px;
            }
            #fileList {
              margin-top: 20px;
            }
            .file-item {
              background: white;
              border: 1px solid #ddd;
              padding: 15px;
              margin: 10px 0;
              border-radius: 4px;
            }
            .file-status {
              font-weight: bold;
              margin: 5px 0;
            }
            .pending {
              color: #856404;
            }
            .processing {
              color: #0c5460;
            }
            .completed {
              color: #155724;
            }
            .failed {
              color: #721c24;
            }
          </style>
        </head>
        <body>
          <h1>🎵 Système de Traitement Audio</h1>

          <div class="upload-form">
            <h3>📤 Upload et Traitement Audio</h3>
            <form id="uploadForm" enctype="multipart/form-data">
              <input
                type="file"
                id="audioFile"
                name="audioFile"
                accept=".mp3,.wav,.m4a,.mp4,.avi,.mov"
                class="file-input"
                required
              />
              <br />
              <select id="language" name="language" class="select-input">
                <option value="de">Allemand</option>
                <option value="fr">Français</option>
                <option value="en">Anglais</option>
                <option value="es">Espagnol</option>
              </select>
              <br />
              <input type="text" id="title" name="title" placeholder="Titre (optionnel)" class="file-input" />
              <br />
              <button type="submit" class="btn" id="uploadBtn">🚀 Upload et Traiter</button>
            </form>
            <div id="uploadResult" class="status" style="display: none;"></div>
          </div>

          <div class="queue-status">
            <h3>📊 Status de la Queue</h3>
            <button onclick="refreshQueue()" class="btn">🔄 Actualiser</button>
            <div id="queueInfo"></div>
          </div>

          <div>
            <h3>📁 Fichiers en Traitement</h3>
            <button onclick="refreshFiles()" class="btn">🔄 Actualiser la Liste</button>
            <div id="fileList"></div>
          </div>

          <script>
            document.getElementById('uploadForm').addEventListener('submit', async (e) => {
              e.preventDefault()

              const formData = new FormData()
              const fileInput = document.getElementById('audioFile')
              const languageSelect = document.getElementById('language')
              const titleInput = document.getElementById('title')
              const uploadBtn = document.getElementById('uploadBtn')
              const resultDiv = document.getElementById('uploadResult')

              if (!fileInput.files[0]) {
                alert('Veuillez sélectionner un fichier')
                return
              }

              formData.append('audioFile', fileInput.files[0])
              formData.append('language', languageSelect.value)
              if (titleInput.value) {
                formData.append('title', titleInput.value)
              }

              uploadBtn.disabled = true
              uploadBtn.textContent = '⏳ Upload en cours...'
              resultDiv.style.display = 'block'
              resultDiv.className = 'status progress'
              resultDiv.innerHTML = '📤 Upload du fichier en cours...'

              try {
                const response = await fetch('/api/v1/upload-audio', {
                  method: 'POST',
                  body: formData
                })

                const result = await response.json()

                if (result.success) {
                  resultDiv.className = 'status success'
                  resultDiv.innerHTML = \`
                      ✅ Fichier uploadé avec succès!<br>
                      📄 ID: \${result.videoId}<br>
                      🎵 Fichier: \${result.filename}<br>
                      📊 Taille: \${(result.size / 1024 / 1024).toFixed(2)} MB<br>
                      🔄 Status: En file d'attente pour traitement
                    \`

                  // Reset form
                  document.getElementById('uploadForm').reset()

                  // Refresh lists
                  setTimeout(() => {
                    refreshFiles()
                    refreshQueue()
                  }, 1000)
                } else {
                  resultDiv.className = 'status error'
                  resultDiv.innerHTML = '❌ Erreur: ' + result.error
                }
              } catch (error) {
                resultDiv.className = 'status error'
                resultDiv.innerHTML = '❌ Erreur de connexion: ' + error.message
              } finally {
                uploadBtn.disabled = false
                uploadBtn.textContent = '🚀 Upload et Traiter'
              }
            })

            async function refreshQueue() {
              try {
                const response = await fetch('/queue/status')
                const data = await response.json()

                document.getElementById('queueInfo').innerHTML = \`
                  <p><strong>Queue Active:</strong> \${data.active} tâches</p>  
                  <p><strong>En Attente:</strong> \${data.waiting} tâches</p>
                  <p><strong>Complétées:</strong> \${data.completed} tâches</p>
                  <p><strong>Échouées:</strong> \${data.failed} tâches</p>
                \`
              } catch (error) {
                console.error('Queue error:', error)
              }
            }

            async function refreshFiles() {
              try {
                const response = await fetch('/videos/status')
                const videos = await response.json()

                const fileListDiv = document.getElementById('fileList')

                if (videos.length === 0) {
                  fileListDiv.innerHTML = '<p>Aucun fichier en traitement</p>'
                  return
                }

                fileListDiv.innerHTML = videos
                  .map(
                    (video) => \`
                  <div class="file-item">
                    <h4>\${video.title}</h4>
                    <p><strong>Fichier:</strong> \${video.originalFilename}</p>
                    <p><strong>Taille:</strong> \${(video.fileSize / 1024 / 1024).toFixed(2)} MB</p>
                    <p><strong>Langue:</strong> \${video.language}</p>
                    <div class="file-status \${video.transcriptionStatus}">
                      Status: \${video.transcriptionStatus.toUpperCase()}
                    </div>
                    <p><strong>Créé:</strong> \${new Date(video.createdAt).toLocaleString()}</p>
                    \${
                      video.processedAt
                        ? \`<p><strong>Traité:</strong> \${new Date(video.processedAt).toLocaleString()}</p>\`
                        : ''
                    }
                    \${
                      video.errorMessage
                        ? \`<p style="color: red;"><strong>Erreur:</strong> \${video.errorMessage}</p>\`
                        : ''
                    }
                  </div>
                \`
                  )
                  .join('')
              } catch (error) {
                console.error('Files error:', error)
              }
            }

            // Auto-refresh
            setInterval(() => {
              refreshQueue()
              refreshFiles()
            }, 5000)

            // Initial load
            refreshQueue()
            refreshFiles()
          </script>
        </body>
      </html>
    `
  }

  public getRouter() {
    return this.controller
  }
}
