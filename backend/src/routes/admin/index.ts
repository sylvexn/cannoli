import { Elysia } from 'elysia';
import { userRoutes } from './users';
import { configRoutes } from './config';
import { seasonRoutes } from './seasons';
import { leagueAdminRoutes } from './leagues';
import { teamAdminRoutes } from './teams';
import { membershipRoutes } from './membership';
import { templateAdminRoutes } from './templates';
import { miscRoutes } from './misc';
import { observabilityRoutes } from './observability';
import { announcementsRoutes } from './announcements';
import { adminNotificationsRoutes } from './notifications';
// Simulator control API. `simRoutesGated` is the real sim route group when
// CANNOLI_MODE=mock, and an empty Elysia otherwise — so the `/api/admin/sim/*`
// routes are physically absent from the live deployment's route tree
// (layer 1 of the sim triple-gate; layer 2 is assertMockMode in each handler).
import { simRoutesGated } from './sim';

export const adminRoutes = new Elysia()
  .use(userRoutes)
  .use(configRoutes)
  .use(seasonRoutes)
  .use(leagueAdminRoutes)
  .use(teamAdminRoutes)
  .use(membershipRoutes)
  .use(templateAdminRoutes)
  .use(miscRoutes)
  .use(observabilityRoutes)
  .use(announcementsRoutes)
  .use(adminNotificationsRoutes)
  .use(simRoutesGated);
