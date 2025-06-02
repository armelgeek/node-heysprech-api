import { eq } from 'drizzle-orm'
import type { TestRepositoryInterface } from '@/domain/repositories/test.repository.interface'
import type { BaseSelectModel } from '@/domain/types/drizzle.types'
import { db } from '../database/db'
import { users } from '../database/schema'
import { BaseRepository } from './base.repository'

export interface UserSearchFilter {
  search?: string
  isAdmin?: boolean
}

export class TestRepository extends BaseRepository<typeof users> implements TestRepositoryInterface {
  constructor() {
    super(users)
  }

  async findByEmail(email: string): Promise<BaseSelectModel<typeof users> | null> {
    const [result] = await db
      .select()
      .from(this.table as any)
      .where(eq(this.table.email as any, email))
    return result ? (result as BaseSelectModel<typeof users>) : null
  }
}
