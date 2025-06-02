import type { BaseInsertModel, BaseSelectModel, BaseTable } from '../types/drizzle.types'

export interface BaseRepositoryInterface<T extends BaseTable> {
  findAll: () => Promise<BaseSelectModel<T>[]>
  findById: (id: string) => Promise<BaseSelectModel<T> | null>
  save: (data: BaseInsertModel<T>) => Promise<BaseSelectModel<T>>
  update: (id: string, data: Partial<BaseSelectModel<T>>) => Promise<BaseSelectModel<T>>
  delete: (id: string) => Promise<boolean>
}

export interface PaginatedResult<T> {
  data: T[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}

export interface BaseRepositoryWithPaginationInterface<T extends BaseTable> extends BaseRepositoryInterface<T> {
  findAllPaginated: (page: number, limit: number) => Promise<PaginatedResult<BaseSelectModel<T>>>
}
