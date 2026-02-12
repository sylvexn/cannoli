import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAppData } from '@/lib/app-data-context';
import { api } from '@/lib/api';
import type { ApiTeam } from '@/lib/api';
import { TeamLogo } from '@/components/team-logo';
import { toast } from 'sonner';
import { Upload, ImageIcon } from 'lucide-react';

export function AdminTeams() {
  const { leagues } = useAppData();
  const [teamsPerLeague, setTeamsPerLeague] = useState<Record<string, ApiTeam[]>>({});
  const [loading, setLoading] = useState(true);
  const [logos, setLogos] = useState<Record<string, string>>({});

  useEffect(() => {
    if (leagues.length === 0) return;
    Promise.all(
      leagues.map(l => api.getTeams(l.id).then(teams => [l.id, teams] as const))
    ).then(results => {
      setTeamsPerLeague(Object.fromEntries(results));
      setLoading(false);
    });
  }, [leagues]);

  function handleLogoUpload(teamId: string, file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }
    if (file.size > 512 * 1024) {
      toast.error('Image must be under 512KB');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setLogos(prev => ({ ...prev, [teamId]: reader.result as string }));
      toast.success(`Logo uploaded for ${teamId.split('-').pop()?.toUpperCase()}`);
      // TODO: POST to backend when upload endpoint exists
    };
    reader.readAsDataURL(file);
  }

  if (loading) return <div className="text-text-muted text-sm">Loading teams...</div>;

  return (
    <div className="space-y-6">
      <div className="flex gap-4 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Total Teams:</span>
          <span className="text-text-primary font-medium font-mono">
            {Object.values(teamsPerLeague).flat().length}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Logos Set:</span>
          <span className="text-win font-medium font-mono">{Object.keys(logos).length}</span>
        </div>
      </div>

      {leagues.map(league => {
        const teams = teamsPerLeague[league.id] || [];
        if (teams.length === 0) return null;

        return (
          <Card key={league.id}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: league.color }} />
                {league.name}
                <Badge variant="outline" className="text-[10px] ml-auto">{teams.length} teams</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {teams.map(team => (
                  <TeamLogoCard
                    key={team.id}
                    team={team}
                    logo={logos[team.id]}
                    onUpload={(file) => handleLogoUpload(team.id, file)}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function TeamLogoCard({ team, logo, onUpload }: {
  team: ApiTeam;
  logo?: string;
  onUpload: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border-subtle hover:border-border-default transition-colors">
      {/* Current logo or placeholder */}
      <div className="relative shrink-0 group">
        {logo ? (
          <img
            src={logo}
            alt={team.teamAbbrev}
            className="w-10 h-10 rounded-md object-cover"
          />
        ) : (
          <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="md" />
        )}
        <button
          onClick={() => fileRef.current?.click()}
          className="absolute inset-0 flex items-center justify-center rounded-md bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Upload size={14} className="text-white" />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = '';
          }}
        />
      </div>

      {/* Team info */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-text-primary truncate">{team.teamName}</div>
        <div className="text-[10px] text-text-muted">
          {team.teamAbbrev} · {team.name}
        </div>
      </div>

      {/* Status */}
      {logo ? (
        <ImageIcon size={14} className="text-win shrink-0" />
      ) : (
        <span className="text-[10px] text-text-muted/40 shrink-0">No logo</span>
      )}
    </div>
  );
}
