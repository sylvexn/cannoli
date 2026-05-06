import { Elysia } from 'elysia';
import { userRoutes } from './users';
import { configRoutes } from './config';
import { seasonRoutes } from './seasons';
import { leagueAdminRoutes } from './leagues';
import { teamAdminRoutes } from './teams';
import { miscRoutes } from './misc';

export const adminRoutes = new Elysia()
  .use(userRoutes)
  .use(configRoutes)
  .use(seasonRoutes)
  .use(leagueAdminRoutes)
  .use(teamAdminRoutes)
  .use(miscRoutes);
