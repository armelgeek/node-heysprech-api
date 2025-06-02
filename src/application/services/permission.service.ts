import { and, eq, not } from 'drizzle-orm'
import { db } from '@/infrastructure/database/db'
import { roleResources, roles, userRoles, users } from '@/infrastructure/database/schema'
import type { Action, Subject } from '@/domain/types/permission.type'

export class PermissionService {
  async getUserRolesWithPermissions(userId: string) {
    return await db
      .select({
        roleId: roles.id,
        roleName: roles.name,
        resourceType: roleResources.resourceType,
        actions: roleResources.actions
      })
      .from(userRoles)
      .where(eq(userRoles.userId, userId))
      .leftJoin(roles, eq(userRoles.roleId, roles.id))
      .leftJoin(roleResources, eq(roles.id, roleResources.roleId))
  }

  async getResourcesByRole(roleId: string) {
    return await db
      .select({
        id: roleResources.id,
        resourceType: roleResources.resourceType,
        actions: roleResources.actions
      })
      .from(roleResources)
      .where(eq(roleResources.roleId, roleId))
  }

  async assignRoleToUser(userId: string, roleId: string) {
    await db.insert(userRoles).values({
      id: crypto.randomUUID(),
      userId,
      roleId,
      createdAt: new Date(),
      updatedAt: new Date()
    })
  }

  async createRole(name: string, description: string, resources: { resourceType: Subject; actions: Action[] }[]) {
    const roleId = crypto.randomUUID()

    await db.insert(roles).values({
      id: roleId,
      name,
      description,
      createdAt: new Date(),
      updatedAt: new Date()
    })

    if (resources.length > 0) {
      await db.insert(roleResources).values(
        resources.map((resource) => ({
          id: crypto.randomUUID(),
          roleId,
          resourceType: resource.resourceType,
          actions: resource.actions,
          createdAt: new Date(),
          updatedAt: new Date()
        }))
      )
    }

    return roleId
  }

  async addResourceToRole(roleId: string, resourceType: Subject, actions: Action[]) {
    const id = crypto.randomUUID()
    await db.insert(roleResources).values({
      id,
      roleId,
      resourceType,
      actions,
      createdAt: new Date(),
      updatedAt: new Date()
    })
    return id
  }

  async getCustomRoles() {
    return await db
      .select({
        id: roles.id,
        name: roles.name,
        resources: {
          resourceType: roleResources.resourceType,
          actions: roleResources.actions
        }
      })
      .from(roles)
      .leftJoin(roleResources, eq(roles.id, roleResources.roleId))
      .where(and(not(eq(roles.name, 'admin')), not(eq(roles.name, 'user'))))
  }

  async getAllRolesWithDetails() {
    const result = await db
      .select({
        roleId: roles.id,
        roleName: roles.name,
        roleDescription: roles.description,
        userId: users.id,
        userName: users.name,
        userEmail: users.email,
        resourceId: roleResources.id,
        resourceType: roleResources.resourceType,
        actions: roleResources.actions
      })
      .from(roles)
      .leftJoin(userRoles, eq(userRoles.roleId, roles.id))
      .leftJoin(users, eq(users.id, userRoles.userId))
      .leftJoin(roleResources, eq(roleResources.roleId, roles.id))
      .orderBy(roles.name, users.name)

    const rolesMap = new Map()

    result.forEach((row) => {
      const roleId = row.roleId

      if (!rolesMap.has(roleId)) {
        rolesMap.set(roleId, {
          id: roleId,
          name: row.roleName,
          description: row.roleDescription,
          users: new Map(),
          resources: new Map()
        })
      }

      const role = rolesMap.get(roleId)

      if (row.userId && !role.users.has(row.userId)) {
        role.users.set(row.userId, {
          id: row.userId,
          name: row.userName,
          email: row.userEmail
        })
      }

      if (row.resourceId && !role.resources.has(row.resourceId)) {
        role.resources.set(row.resourceId, {
          id: row.resourceId,
          resourceType: row.resourceType,
          actions: row.actions
        })
      }
    })

    return Array.from(rolesMap.values()).map((role) => ({
      ...role,
      users: Array.from(role.users.values()),
      resources: Array.from(role.resources.values())
    }))
  }

  async getRoleById(roleId: string) {
    const role = await db
      .select({
        id: roles.id,
        name: roles.name,
        description: roles.description
      })
      .from(roles)
      .where(eq(roles.id, roleId))
      .limit(1)

    return role[0]
  }

  async updateRole(
    roleId: string,
    data: {
      name?: string
      description?: string
      resources?: Array<{
        resourceType: Subject
        actions: Action[]
      }>
    }
  ) {
    const { name, description, resources } = data

    // Mise à jour des informations de base du rôle
    if (name || description) {
      await db
        .update(roles)
        .set({
          ...(name && { name }),
          ...(description && { description }),
          updatedAt: new Date()
        })
        .where(eq(roles.id, roleId))
    }

    // Mise à jour des permissions si fournies
    if (resources) {
      // Supprimer les anciennes permissions
      await db.delete(roleResources).where(eq(roleResources.roleId, roleId))

      // Ajouter les nouvelles permissions
      const newResources = resources.map((resource) => ({
        id: crypto.randomUUID(),
        roleId,
        resourceType: resource.resourceType,
        actions: resource.actions,
        conditions: {},
        createdAt: new Date(),
        updatedAt: new Date()
      }))

      await db.insert(roleResources).values(newResources)
    }

    return { id: roleId }
  }

  async deleteRole(roleId: string) {
    // Supprimer d'abord les ressources du rôle
    await db.delete(roleResources).where(eq(roleResources.roleId, roleId))

    // Supprimer les associations utilisateur-rôle
    await db.delete(userRoles).where(eq(userRoles.roleId, roleId))

    // Supprimer le rôle
    await db.delete(roles).where(eq(roles.id, roleId))

    return true
  }
}
