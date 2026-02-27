import { createContext, useContext, useState, useCallback } from 'react';
import { PokemonSideCard } from './pokemon-side-card';

interface SideCardState {
  openSideCard: (name: string) => void;
  closeSideCard: () => void;
}

const PokemonSideCardContext = createContext<SideCardState>({
  openSideCard: () => {},
  closeSideCard: () => {},
});

export function PokemonSideCardProvider({ children }: { children: React.ReactNode }) {
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const openSideCard = useCallback((name: string) => setSelectedName(name), []);
  const closeSideCard = useCallback(() => setSelectedName(null), []);

  return (
    <PokemonSideCardContext.Provider value={{ openSideCard, closeSideCard }}>
      {children}
      <PokemonSideCard name={selectedName} onClose={closeSideCard} />
    </PokemonSideCardContext.Provider>
  );
}

export function usePokemonSideCard() {
  return useContext(PokemonSideCardContext);
}
