import { ScrollText } from 'lucide-react';
import { AdminSection } from '../admin-section';
import { RulesetsAdmin } from '.';

/** Deep-linkable /admin/rulesets and /admin/rulesets/:id. */
export function AdminRulesetsRoute() {
  return (
    <AdminSection icon={ScrollText} title="Rulesets">
      <RulesetsAdmin basePath="/admin/rulesets" />
    </AdminSection>
  );
}
