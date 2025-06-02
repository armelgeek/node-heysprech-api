import { IUseCase } from '@/domain/types'
import { ActivityType } from '@/infrastructure/config/activity.config'
import type { User } from '@/domain/models/user.model'
import type { z } from 'zod'

export interface GetUserByIdArgs {
  userId: string
}

export class GetUserByIdUseCase extends IUseCase<GetUserByIdArgs, z.infer<typeof User>> {
  execute({ userId }: GetUserByIdArgs): Promise<z.infer<typeof User>> {
    return new Promise((resolve, reject) => {
      const user: z.infer<typeof User> = {
        id: userId,
        name: 'John Doe',
        email: '',
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        isAdmin: false
      }
      if (user) {
        resolve(user)
      } else {
        reject(new Error('User not found'))
      }
    })
  }

  log(): ActivityType {
    return ActivityType.TEST
  }
}
