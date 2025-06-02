import type { users } from '@/infrastructure/database/schema'
import type { BaseSelectModel } from '../types/drizzle.types'
import type { BaseRepositoryWithPaginationInterface } from './base.repository.interface'

export interface TestRepositoryInterface extends BaseRepositoryWithPaginationInterface<typeof users> {
  findByEmail: (email: string) => Promise<BaseSelectModel<typeof users> | null>
}
