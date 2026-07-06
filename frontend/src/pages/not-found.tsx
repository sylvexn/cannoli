import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';

export function NotFoundPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
          <span className="text-loss">Page</span>{' '}
          <span className="text-text-primary">Not Found</span>
        </h1>
      </div>

      <EmptyState
        variant="not-found"
        title="Nothing at this address."
        subtitle="The page you're looking for doesn't exist or may have moved."
        action={
          <Link to="/" className="text-neon hover:underline text-sm inline-flex items-center gap-1">
            <ArrowLeft size={12} />
            Back to Home
          </Link>
        }
      />
    </div>
  );
}
