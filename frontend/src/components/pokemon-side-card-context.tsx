import { createContext, useContext, useState, useCallback } from 'react';
import { PokemonSideCard } from './pokemon-side-card';
import type { CostFormat } from '@/data/tier-list';

interface SideCardState {
  /** Open the side card for the given Pokemon name.
   *  Pass `format` when opening from a context where the active format is known
   *  (e.g. the global tier-list page). Inside league routes the card resolves
   *  the format from the in-scope league automatically, so callers there can omit it. */
  openSideCard: (name: string, format?: CostFormat) => void;
  closeSideCard: () => void;
}

const PokemonSideCardContext = createContext<SideCardState>({
  openSideCard: () => {},
  closeSideCard: () => {},
});

export function PokemonSideCardProvider({ children }: { children: React.ReactNode }) {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<CostFormat | undefined>(undefined);

  const openSideCard = useCallback((name: string, format?: CostFormat) => {
    setSelectedName(name);
    setSelectedFormat(format);
  }, []);
  const closeSideCard = useCallback(() => {
    setSelectedName(null);
    setSelectedFormat(undefined);
  }, []);

  return (
    <PokemonSideCardContext.Provider value={{ openSideCard, closeSideCard }}>
      {children}
      <PokemonSideCard name={selectedName} format={selectedFormat} onClose={closeSideCard} />
    </PokemonSideCardContext.Provider>
  );
}

export function usePokemonSideCard() {
  return useContext(PokemonSideCardContext);
}
