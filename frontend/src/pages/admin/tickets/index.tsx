/**
 * Admin issue tracker: kanban board / list at /admin/tickets, detail at
 * /admin/tickets/:id.
 */
import { useParams } from 'react-router-dom';
import { Ticket } from 'lucide-react';
import { AdminSection } from '../admin-section';
import { TicketsBoard } from './board';
import { TicketDetail } from './detail';

export function AdminTicketsRoute() {
  const { id } = useParams();
  const n = id ? parseInt(id) : NaN;
  return (
    <AdminSection icon={Ticket} title="Tickets">
      <div className="p-3">
        {Number.isFinite(n) ? <TicketDetail key={n} id={n} /> : <TicketsBoard />}
      </div>
    </AdminSection>
  );
}
