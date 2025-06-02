import type { PermissionService } from '@/application/services/permission.service'

interface RoleDetailResponse {
  success: boolean
  data: {
    roles: Array<{
      id: string
      name: string
      description: string
      permissions: Array<{
        subject: string
        actions: string[]
      }>
      stats: {
        totalUsers: number
        users: Array<{
          id: string
          name: string
          email: string
        }>
      }
    }>
  }
}

export class ListRoleDetailsUseCase {
  constructor(private readonly permissionService: PermissionService) {}

  async execute(): Promise<RoleDetailResponse> {
    const roles = await this.permissionService.getAllRolesWithDetails()

    return {
      success: true,
      data: {
        roles: roles.map((role) => ({
          id: role.id,
          name: role.name,
          description: role.description || '',
          permissions:
            role.resources?.map((resource: any) => ({
              subject: resource.resourceType,
              actions: resource.actions
            })) || [],
          stats: {
            totalUsers: role.users?.length || 0,
            users:
              role.users?.map((user: any) => ({
                id: user.id,
                name: user.name,
                email: user.email
              })) || []
          }
        }))
      }
    }
  }
}
