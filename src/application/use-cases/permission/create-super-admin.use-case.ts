import { Actions, Roles, Subjects, type Subject } from '@/domain/types/permission.type'
import type { PermissionService } from '@/application/services/permission.service'

interface CreateSuperAdminResponse {
  success: boolean
  data: {
    id: string
  }
}

export class CreateSuperAdminUseCase {
  constructor(private readonly permissionService: PermissionService) {}

  async execute(params: { userId: string; currentUserId: string }): Promise<CreateSuperAdminResponse> {
    const { userId, currentUserId } = params

    // Vérifier si l'utilisateur actuel est un super admin
    const currentUserRoles = await this.permissionService.getUserRolesWithPermissions(currentUserId)
    const isSuperAdmin = currentUserRoles.some((permission) => permission.roleName === Roles.SUPER_ADMIN)

    if (!isSuperAdmin) {
      throw new Error('Only super administrators can create other super administrators')
    }

    // Créer le rôle avec toutes les permissions possibles
    const resources = Object.values(Subjects).map((subject: Subject) => ({
      resourceType: subject,
      actions: Object.values(Actions)
    }))

    // Créer le rôle super admin
    const roleId = await this.permissionService.createRole(
      'Super Administrator',
      'Full system access with all permissions',
      resources
    )

    // Assigner le rôle à l'utilisateur
    await this.permissionService.assignRoleToUser(userId, roleId)

    return {
      success: true,
      data: {
        id: roleId
      }
    }
  }
}
