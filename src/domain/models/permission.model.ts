import type { Actions, Subject } from '../types/permission.type'

export interface Permission {
  id: string
  roleId: string
  subject: Subject
  action: (typeof Actions)[keyof typeof Actions]
  createdAt: Date
  updatedAt: Date
}
