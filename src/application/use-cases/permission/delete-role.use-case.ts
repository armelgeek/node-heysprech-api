import type { PermissionService } from '@/application/services/permission.service'

interface DeleteRoleResponse {
  success: boolean
}

export class DeleteRoleUseCase {
  constructor(private readonly permissionService: PermissionService) {}

  async execute(params: { roleId: string; currentUserId: string }): Promise<DeleteRoleResponse> {
    const { roleId } = params

    const role = await this.permissionService.getRoleById(roleId)
    if (!role) {
      throw new Error('Role not found')
    }

    if (role.name.toLowerCase() === 'super_admin') {
      throw new Error('Cannot delete super admin role')
    }

    await this.permissionService.deleteRole(roleId)

    return {
      success: true
    }
  }
}
