import { IUseCase } from '@/domain/types'
import { ActivityType } from '@/infrastructure/config/activity.config'
import type { PermissionService } from '@/application/services/permission.service'
import type { Action, Subject } from '@/domain/types/permission.type'

interface Resource {
  resourceType: Subject
  actions: Action[]
}

interface CreateRoleUseCaseParams {
  name: string
  description: string
  resources: Resource[]
}

export class CreateRoleUseCase extends IUseCase<CreateRoleUseCaseParams, string> {
  constructor(private permissionService: PermissionService) {
    super()
  }

  execute({ name, description, resources }: CreateRoleUseCaseParams): Promise<string> {
    return this.permissionService.createRole(name, description, resources)
  }

  log(): ActivityType {
    return ActivityType.CREATE_ROLE
  }
}
