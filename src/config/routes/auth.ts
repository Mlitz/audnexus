import { FastifyInstance } from 'fastify'

import registerAudibleAuthRoutes from '#helpers/auth/AudibleAuthHelper'

async function _auth(fastify: FastifyInstance) {
  // Register all authentication routes
  await registerAudibleAuthRoutes(fastify)
}

export default _auth
