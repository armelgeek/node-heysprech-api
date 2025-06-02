import { App } from './app'
import { PermissionController, UserController } from './infrastructure/controllers'
import * as process from 'node:process'
import { VideoController } from './infrastructure/controllers/video.controller';

const displayBanner = (port: number | string) => {
  console.info(`
\u001B[34m╔══════════════════════════════════════════════════════╗
║               \u001B[1mMEKO ACADEMY API\u001B[0m\u001B[34m                ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  \u001B[0m🚀 Server started successfully                   \u001B[34m║
║  \u001B[0m📡 Listening on: \u001B[36mhttp://localhost:${port}\u001B[34m        ║
║  \u001B[0m📚 API Docs: \u001B[36mhttp://localhost:${port}/docs\u001B[34m    ║
║  \u001B[0m📚 Auth Docs: \u001B[36mhttp://localhost:${port}/api/auth/reference\u001B[34m  ║
║                                                      ║
╚══════════════════════════════════════════════════════╝\u001B[0m
`)
}

const PORT = Bun.env.PORT || 3000

function startServer() {
  try {
    const app = new App([new UserController(),  new VideoController(), new PermissionController()]).getApp()

    displayBanner(PORT)
    return app
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

const app = startServer()
export default app
