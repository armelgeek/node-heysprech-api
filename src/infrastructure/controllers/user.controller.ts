import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { UserRepository } from '../repositories/user.repository'
import type { Routes } from '../../domain/types'

export class UserController implements Routes {
  public controller: OpenAPIHono
  private userRepository: UserRepository

  constructor() {
    this.controller = new OpenAPIHono()
    this.userRepository = new UserRepository()
  }

  public initRoutes() {
    this.controller.openapi(
      createRoute({
        method: 'get',
        path: '/v1/users/session',
        tags: ['User'],
        summary: 'Retrieve the user session information',
        description: 'Retrieve the session info of the currently logged in user.',
        operationId: 'getUserSession',
        responses: {
          200: {
            description: 'Session information successfully retrieved',
            content: {
              'application/json': {
                schema: z.object({
                  success: z.boolean().openapi({
                    description: 'Indicates whether the operation was successful',
                    type: 'boolean',
                    example: true
                  }),
                  data: z.object({
                    user: z.object({
                      id: z.string().openapi({
                        description: 'User identifier',
                        type: 'string',
                        example: 'user_ABC123'
                      }),
                      name: z.string().openapi({
                        description: 'User name',
                        type: 'string',
                        example: 'Armel Wanes'
                      }),
                      email: z.string().openapi({
                        description: 'User email',
                        type: 'string',
                        example: 'armelgeek5@gmail.com'
                      }),
                      emailVerified: z.boolean().openapi({
                        description: 'User email verification status',
                        type: 'boolean',
                        example: false
                      }),
                      image: z.string().nullable().openapi({
                        description: 'User image URL',
                        type: 'string',
                        example: null
                      }),
                      createdAt: z.string().openapi({
                        description: 'User creation timestamp',
                        type: 'string',
                        example: '2025-05-06T16:34:49.937Z'
                      }),
                      updatedAt: z.string().openapi({
                        description: 'User update timestamp',
                        type: 'string',
                        example: '2025-05-06T16:34:49.937Z'
                      }),
                      isAdmin: z.boolean().openapi({
                        description: 'Flag indicating if the user has admin privileges',
                        type: 'boolean',
                        example: false
                      }),
                      isOnTrial: z.boolean().openapi({
                        description: 'Flag indicating if the user has an active trial',
                        type: 'boolean',
                        example: false
                      }),
                      trialStartDate: z.string().nullable().openapi({
                        description: 'Trial start date',
                        type: 'string',
                        example: '2025-05-06T16:34:49.937Z'
                      }),
                      trialEndDate: z.string().nullable().openapi({
                        description: 'Trial end date',
                        type: 'string',
                        example: '2025-05-20T16:34:49.937Z'
                      })
                    })
                  })
                })
              }
            }
          }
        }
      }),
      (ctx: any) => {
        const user = ctx.get('user')
        if (!user) {
          return ctx.json({ error: 'Unauthorized' }, 401)
        }
        return ctx.json({ success: true, data: { user } })
      }
    )
  }
}
