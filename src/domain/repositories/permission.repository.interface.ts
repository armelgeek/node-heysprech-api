import type { Permission } from '../models/permission.model'

export interface PermissionRepositoryInterface {
  findAll: () => Promise<Permission[]>
  findById: (id: string) => Promise<Permission | null>
  findByRoleId: (roleId: string) => Promise<Permission[]>
  save: (permission: Omit<Permission, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Permission>
  update: (id: string, permission: Partial<Permission>) => Promise<Permission>
  delete: (id: string) => Promise<boolean>
  deleteByRoleId: (roleId: string) => Promise<boolean>
}
