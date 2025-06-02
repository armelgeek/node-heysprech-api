import { beforeAll, describe, it } from 'vitest'
import { UserController } from './user.controller'

describe('UserController', () => {
  let userController: UserController

  beforeAll(() => {
    userController = new UserController()
    userController.initRoutes()
  })

  it('retrieve user by ID', async () => {
    // const response = await userController.controller.request('/user/3IoDK8qI')
    // const { data } = response as unknown as { data: z.infer<typeof User>[] }
    //   expect(() => User.parse(data[0])).not.toThrow()
  })
})
