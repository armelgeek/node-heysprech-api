import { z } from 'zod'

export const User = z.object({
  id: z.string(),
  name: z.string(),
  firstname: z.string().optional(),
  lastname: z.string().optional(),
  email: z.string(),
  emailVerified: z.boolean(),
  image: z.string().optional(),
  isAdmin: z.boolean().default(false),
  createdAt: z.date(),
  updatedAt: z.date()
})
