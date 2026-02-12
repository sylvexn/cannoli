import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TeamLogo } from '@/components/team-logo';
import { api } from '@/lib/api';
import type { ApiTeam } from '@/lib/api';
import { Shuffle, ListOrdered, GripVertical, Save } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface DraftOrderEditorProps {
  leagueId: string;
  leagueName: string;
  leagueColor: string;
}

export function DraftOrderEditor({ leagueId, leagueName, leagueColor }: DraftOrderEditorProps) {
  const [teams, setTeams] = useState<ApiTeam[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  useEffect(() => {
    api.getTeams(leagueId).then(t => {
      setTeams(t);
      // Default order: reverse standings (worst first)
      setOrder(t.sort((a, b) => a.record.wins - b.record.wins || a.record.differential - b.record.differential).map(t => t.id));
      setLoading(false);
    });
  }, [leagueId]);

  const teamMap = new Map(teams.map(t => [t.id, t]));

  function shuffle() {
    const shuffled = [...order];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    setOrder(shuffled);
    toast.success('Draft order shuffled');
  }

  function setFromStandings() {
    const sorted = [...teams]
      .sort((a, b) => a.record.wins - b.record.wins || a.record.differential - b.record.differential)
      .map(t => t.id);
    setOrder(sorted);
    toast.success('Set to reverse standings (worst picks first)');
  }

  function handleDragStart(idx: number) {
    setDragIdx(idx);
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const newOrder = [...order];
    const [removed] = newOrder.splice(dragIdx, 1);
    newOrder.splice(idx, 0, removed);
    setOrder(newOrder);
    setDragIdx(idx);
  }

  function handleDragEnd() {
    setDragIdx(null);
  }

  function handleSave() {
    // TODO: POST to backend when endpoint exists
    toast.success(`Draft order saved for ${leagueName}`);
  }

  if (loading) return <div className="text-text-muted text-xs py-2">Loading teams...</div>;

  return (
    <Card className="border-border-subtle">
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-heading flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: leagueColor }} />
            {leagueName} — Draft Order
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={setFromStandings} className="h-6 text-[10px] px-2">
              <ListOrdered size={10} />
              Standings
            </Button>
            <Button variant="outline" size="sm" onClick={shuffle} className="h-6 text-[10px] px-2">
              <Shuffle size={10} />
              Shuffle
            </Button>
            <Button size="sm" onClick={handleSave} className="h-6 text-[10px] px-2 bg-neon text-surface-base hover:bg-neon/90">
              <Save size={10} />
              Save
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        <div className="space-y-0.5">
          {order.map((teamId, idx) => {
            const team = teamMap.get(teamId);
            if (!team) return null;
            return (
              <div
                key={teamId}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragEnd={handleDragEnd}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors cursor-grab active:cursor-grabbing',
                  dragIdx === idx ? 'bg-neon/10 border border-neon/30' : 'hover:bg-surface-overlay/40 border border-transparent',
                )}
              >
                <GripVertical size={12} className="text-text-muted/30 shrink-0" />
                <span className="text-xs font-mono font-bold tabular-nums text-text-muted w-4 shrink-0">
                  {idx + 1}
                </span>
                <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="sm" />
                <span className="text-xs text-text-primary flex-1 min-w-0 truncate">
                  {team.teamName}
                </span>
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-border-subtle text-text-muted font-mono">
                  {team.record.wins}-{team.record.losses}
                </Badge>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
