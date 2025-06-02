import type { PermissionService } from '@/application/services/permission.service'
import type { Action, Subject } from '@/domain/types/permission.type'

interface UpdateRoleResponse {
  success: boolean
  data: {
    id: string
  }
}

export class UpdateRoleUseCase {
  constructor(private readonly permissionService: PermissionService) {}

  async execute(params: {
    roleId: string
    currentUserId: string
    name?: string
    description?: string
    permissions?: Array<{
      subject: Subject
      actions: Action[]
    }>
  }): Promise<UpdateRoleResponse> {
    const { roleId, name, description, permissions } = params

    const result = await this.permissionService.updateRole(roleId, {
      name,
      description,
      resources: permissions?.map((p) => ({
        resourceType: p.subject,
        actions: p.actions
      }))
    })

    return {
      success: true,
      data: {
        id: result.id
      }
    }
  }
}
