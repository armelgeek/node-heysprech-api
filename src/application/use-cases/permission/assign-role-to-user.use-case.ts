import { IUseCase } from '@/domain/types'
import { ActivityType } from '@/infrastructure/config/activity.config'
import type { PermissionService } from '@/application/services/permission.service'

interface AssignRoleToUserUseCaseParams {
  userId: string
  roleId: string
}

export class AssignRoleToUserUseCase extends IUseCase<AssignRoleToUserUseCaseParams, void> {
  constructor(private permissionService: PermissionService) {
    super()
  }

  async execute({ userId, roleId }: AssignRoleToUserUseCaseParams): Promise<void> {
    await this.permissionService.assignRoleToUser(userId, roleId)
  }

  log(): ActivityType {
    return ActivityType.ASSIGN_ROLE
  }
}
