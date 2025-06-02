import { PermissionService } from '@/application/services/permission.service'
import type { Permission } from '@/domain/models/permission.model'
import { auth } from '../config/auth.config'
import { UnauthorizedError } from './error.middleware'
import type { Context, Next } from 'hono'

const permissionService = new PermissionService()

type AuthUser = {
  id: string
  email: string
  permissions: Permission[]
  isAdmin?: boolean
}

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser
  }
}

export async function authMiddleware(c: Context, next: Next) {
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })

    if (!session) {
      throw new UnauthorizedError('Invalid session')
    }

    const { user } = session

    const permissions = await permissionService.getUserRolesWithPermissions(user.id)

    c.set('user', {
      ...user,
      permissions: permissions.map((perm) => ({
        action: perm.actions,
        subject: perm.resourceType
      })) as unknown as Permission[]
    } as AuthUser)

    await next()
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error
    }
    throw new UnauthorizedError('Authentication failed')
  }
}

export function checkPermission(action: string, subject: string) {
  return async (c: Context, next: Next) => {
    const user = c.get('user')

    const hasPermission = user.permissions.some((perm) => perm.action === action && perm.subject === subject)

    if (!hasPermission) {
      throw new UnauthorizedError(`Missing permission: ${action} ${subject}`)
    }

    await next()
  }
}
