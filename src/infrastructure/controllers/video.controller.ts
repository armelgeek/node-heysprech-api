import { serveStatic } from '@hono/node-server/serve-static'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { html } from 'hono/html'
import { VideoService } from '@/application/services/video.service'
import type { Routes } from '@/domain/types'

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
    this.controller.use('/public/*', serveStatic({ root: './' }))
    this.controller.use('/audios/*', serveStatic({ root: './' }))
    this.controller.use('/transcriptions/*', serveStatic({ root: './' }))

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

          const tempPath = `uploads/${Date.now()}-${file.name}`
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

    this.controller.get('/queue/status', async (c) => {
      try {
        const stats = await this.videoService.getQueueStatus()
        return c.json(stats)
      } catch (error: any) {
        return c.json({ error: error.message }, 500)
      }
    })

    this.controller.post('/queue/clean', async (c) => {
      try {
        await this.videoService.cleanQueue()
        return c.json({
          success: true,
          message: 'Queue cleaned'
        })
      } catch (error: any) {
        return c.json({ error: error.message }, 500)
      }
    })

    this.controller.get('/videos/:id', async (c) => {
      const id = Number.parseInt(c.req.param('id'))
      try {
        const video = await this.videoService.getVideoById(id)
        if (!video) {
          return c.json({ error: 'Video not found' }, 404)
        }
        return c.json(video)
      } catch (error: any) {
        return c.json({ error: error.message }, 500)
      }
    })

    this.controller.get('/videos/status', async (c) => {
      try {
        const videos = await this.videoService.getRecentVideos(20)
        return c.json(videos)
      } catch (error: any) {
        return c.json({ error: error.message }, 500)
      }
    })

    this.controller.delete('/videos/:id', async (c) => {
      const id = Number.parseInt(c.req.param('id'))
      try {
        await this.videoService.deleteVideo(id)
        return c.json({
          success: true,
          message: 'Video and associated files deleted'
        })
      } catch (error: any) {
        return c.json({ error: error.message }, 500)
      }
    })

    this.controller.post('/videos/:id/retry', async (c) => {
      const id = Number.parseInt(c.req.param('id'))
      try {
        await this.videoService.retryProcessing(id)
        return c.json({
          success: true,
          message: 'Processing restarted'
        })
      } catch (error: any) {
        return c.json({ error: error.message }, 500)
      }
    })

    this.controller.get('/api/videos/recent', async (c) => {
      try {
        const videos = await this.videoService.getRecentVideos(10)
        return c.json(
          videos.map((v) => ({
            id: v.id,
            title: v.title,
            originalFilename: v.originalFilename,
            fileSize: v.fileSize,
            language: v.language,
            transcriptionStatus: v.transcriptionStatus,
            errorMessage: v.errorMessage,
            createdAt: v.createdAt,
            processedAt: v.processedAt
          }))
        )
      } catch (error: any) {
        console.error('Error fetching recent videos:', error.message)
        return c.json({ error: error.message }, 500)
      }
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
                const response = await fetch('/upload-audio', {
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
