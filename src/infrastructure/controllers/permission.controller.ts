import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { PermissionService } from '@/application/services/permission.service'
import { AssignRoleToUserUseCase } from '@/application/use-cases/permission/assign-role-to-user.use-case'
import { CreateRoleUseCase } from '@/application/use-cases/permission/create-role.use-case'
import { DeleteRoleUseCase } from '@/application/use-cases/permission/delete-role.use-case'
import { ListRoleDetailsUseCase } from '@/application/use-cases/permission/list-role-details.use-case'
import { UpdateRoleUseCase } from '@/application/use-cases/permission/update-role.use-case'
import { Actions, Subjects } from '@/domain/types/permission.type'

const actionEnum = z.enum([Actions.CREATE, Actions.READ, Actions.UPDATE, Actions.DELETE])

const subjectEnum = z.enum([Subjects.ADMIN, Subjects.STAT, Subjects.ACTIVITY])

export class PermissionController {
  public controller: OpenAPIHono
  private readonly permissionService: PermissionService
  private readonly createRoleUseCase: CreateRoleUseCase
  private readonly assignRoleToUserUseCase: AssignRoleToUserUseCase
  private readonly listRoleDetailsUseCase: ListRoleDetailsUseCase
  private readonly updateRoleUseCase: UpdateRoleUseCase
  private readonly deleteRoleUseCase: DeleteRoleUseCase

  constructor() {
    this.controller = new OpenAPIHono()
    this.permissionService = new PermissionService()
    this.createRoleUseCase = new CreateRoleUseCase(this.permissionService)
    this.assignRoleToUserUseCase = new AssignRoleToUserUseCase(this.permissionService)
    this.listRoleDetailsUseCase = new ListRoleDetailsUseCase(this.permissionService)
    this.updateRoleUseCase = new UpdateRoleUseCase(this.permissionService)
    this.deleteRoleUseCase = new DeleteRoleUseCase(this.permissionService)
    this.initRoutes()
  }

  public initRoutes() {
    this.controller.openapi(
      createRoute({
        method: 'post',
        path: '/v1/roles',
        tags: ['Roles'],
        summary: 'Create a new role',
        description: 'Create a new role with specific permissions for each module',
        request: {
          body: {
            content: {
              'application/json': {
                schema: z.object({
                  name: z.string().min(1),
                  description: z.string(),
                  permissions: z.array(
                    z.object({
                      subject: subjectEnum,
                      actions: z.array(actionEnum)
                    })
                  )
                })
              }
            }
          }
        },
        responses: {
          201: {
            description: 'Role created successfully',
            content: {
              'application/json': {
                schema: z.object({
                  success: z.boolean(),
                  data: z.object({
                    id: z.string().uuid()
                  })
                })
              }
            }
          }
        }
      }),
      async (c: any) => {
        try {
          const { name, description, permissions } = await c.req.json()

          const resources = permissions.map((p: any) => ({
            resourceType: p.subject,
            actions: p.actions
          }))

          const roleId = await this.createRoleUseCase.run({
            currentUserId: c.get('user').id,
            name,
            description,
            resources
          })

          return c.json(
            {
              success: true,
              data: { id: roleId }
            },
            201
          )
        } catch (error: any) {
          return c.json(
            {
              success: false,
              error: error.message
            },
            400
          )
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'post',
        path: '/v1/users/:userId/roles/:roleId',
        tags: ['Roles'],
        summary: 'Assign a role to a user',
        description: 'Assign a role to a specific user. Admin only.',
        request: {
          params: z.object({
            userId: z.string().uuid(),
            roleId: z.string().uuid()
          })
        },
        responses: {
          200: {
            description: 'Role assigned successfully',
            content: {
              'application/json': {
                schema: z.object({
                  success: z.boolean()
                })
              }
            }
          },
          400: {
            description: 'Bad request',
            content: {
              'application/json': {
                schema: z.object({
                  success: z.boolean(),
                  error: z.string()
                })
              }
            }
          }
        }
      }),
      async (c: any) => {
        try {
          const { userId, roleId } = c.req.param()
          const currentUser = c.get('user')

          await this.assignRoleToUserUseCase.run({
            userId,
            roleId,
            currentUserId: currentUser.id
          })

          return c.json({ success: true })
        } catch (error: any) {
          return c.json(
            {
              success: false,
              error: error.message
            },
            400
          )
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'get',
        path: '/v1/roles/details',
        tags: ['Roles'],
        summary: 'Get roles details',
        description: 'Get all roles with their permissions and users',
        responses: {
          200: {
            description: 'Roles details retrieved successfully',
            content: {
              'application/json': {
                schema: z.object({
                  success: z.boolean(),
                  data: z.object({
                    roles: z.array(
                      z.object({
                        id: z.string(),
                        name: z.string(),
                        description: z.string(),
                        permissions: z.array(
                          z.object({
                            subject: z.string(),
                            actions: z.array(z.string())
                          })
                        ),
                        stats: z.object({
                          totalUsers: z.number(),
                          users: z.array(
                            z.object({
                              id: z.string(),
                              name: z.string(),
                              email: z.string()
                            })
                          )
                        })
                      })
                    )
                  })
                })
              }
            }
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: z.object({
                  success: z.boolean(),
                  error: z.string()
                })
              }
            }
          }
        }
      }),
      async (c: any) => {
        try {
          const result = await this.listRoleDetailsUseCase.execute()
          return c.json(result)
        } catch (error: any) {
          return c.json(
            {
              success: false,
              error: error.message
            },
            400
          )
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'put',
        path: '/v1/roles/{roleId}',
        tags: ['Roles'],
        security: [{ Bearer: [] }],
        summary: 'Update a role',
        description: 'Update a role and its permissions',
        request: {
          params: z.object({
            roleId: z.string().uuid()
          }),
          body: {
            content: {
              'application/json': {
                schema: z.object({
                  name: z.string().min(1).optional(),
                  description: z.string().optional(),
                  permissions: z
                    .array(
                      z.object({
                        subject: subjectEnum,
                        actions: z.array(actionEnum)
                      })
                    )
                    .optional()
                })
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Role updated successfully',
            content: {
              'application/json': {
                schema: z.object({
                  success: z.boolean(),
                  data: z.object({
                    id: z.string().uuid()
                  })
                })
              }
            }
          },
          404: {
            description: 'Role not found',
            content: {
              'application/json': {
                schema: z.object({
                  success: z.boolean(),
                  error: z.string()
                })
              }
            }
          }
        }
      }),
      async (c: any) => {
        try {
          const { roleId } = c.req.param()
          const currentUser = c.get('user')
          const body = await c.req.json()

          const result = await this.updateRoleUseCase.execute({
            roleId,
            currentUserId: currentUser.id,
            ...body
          })

          return c.json(result)
        } catch (error: any) {
          if (error.message === 'Role not found') {
            return c.json(
              {
                success: false,
                error: error.message
              },
              404
            )
          }
          return c.json(
            {
              success: false,
              error: error.message
            },
            400
          )
        }
      }
    )

    this.controller.openapi(
      createRoute({
        method: 'delete',
        path: '/v1/roles/{roleId}',
        tags: ['Roles'],
        security: [{ Bearer: [] }],
        summary: 'Delete a role',
        description: 'Delete a role and all its permissions. Cannot delete system roles.',
        request: {
          params: z.object({
            roleId: z.string().uuid()
          })
        },
        responses: {
          200: {
            description: 'Role deleted successfully',
            content: {
              'application/json': {
                schema: z.object({
                  success: z.boolean()
                })
              }
            }
          },
          403: {
            description: 'Cannot delete system role',
            content: {
              'application/json': {
                schema: z.object({
                  success: z.boolean(),
                  error: z.string()
                })
              }
            }
          },
          404: {
            description: 'Role not found',
            content: {
              'application/json': {
                schema: z.object({
                  success: z.boolean(),
                  error: z.string()
                })
              }
            }
          }
        }
      }),
      async (c: any) => {
        try {
          const { roleId } = c.req.param()
          const currentUser = c.get('user')

          const result = await this.deleteRoleUseCase.execute({
            roleId,
            currentUserId: currentUser.id
          })

          return c.json(result)
        } catch (error: any) {
          if (error.message === 'Role not found') {
            return c.json(
              {
                success: false,
                error: error.message
              },
              404
            )
          }
          if (error.message === 'Cannot delete super admin role') {
            return c.json(
              {
                success: false,
                error: error.message
              },
              403
            )
          }
          return c.json(
            {
              success: false,
              error: error.message
            },
            400
          )
        }
      }
    )
  }

  public getRouter() {
    return this.controller
  }
}
