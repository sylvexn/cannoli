import * as React from "react"
import { cn } from "@/lib/utils"
import { ChevronUp, ChevronDown } from "lucide-react"

interface NumberInputProps extends Omit<React.ComponentProps<"input">, "type" | "onChange"> {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

function NumberInput({
  className,
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  ...props
}: NumberInputProps) {
  function clamp(v: number) {
    if (min !== undefined && v < min) return min;
    if (max !== undefined && v > max) return max;
    return v;
  }

  function increment() {
    if (!disabled) onChange(clamp(value + step));
  }

  function decrement() {
    if (!disabled) onChange(clamp(value - step));
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    if (raw === '' || raw === '-') return;
    const n = Number(raw);
    if (!isNaN(n)) onChange(clamp(n));
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowUp') { e.preventDefault(); increment(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); decrement(); }
  }

  return (
    <div className={cn(
      "relative flex items-center",
      disabled && "opacity-50 pointer-events-none",
      className,
    )}>
      <input
        type="text"
        inputMode="numeric"
        data-slot="input"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className={cn(
          "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent pl-2.5 pr-7 py-1 text-sm font-mono tabular-nums transition-colors outline-none",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          "disabled:cursor-not-allowed disabled:bg-input/50",
          "dark:bg-input/30",
        )}
        {...props}
      />
      <div className="absolute right-0 inset-y-0 flex flex-col w-6 border-l border-input">
        <button
          type="button"
          tabIndex={-1}
          onClick={increment}
          disabled={disabled || (max !== undefined && value >= max)}
          className="relative flex-1 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-input/40 transition-colors rounded-tr-lg disabled:opacity-30 disabled:pointer-events-none after:absolute after:-inset-x-1 after:-top-0.5 after:bottom-0"
        >
          <ChevronUp size={12} strokeWidth={2.5} />
        </button>
        <div className="h-px bg-input" />
        <button
          type="button"
          tabIndex={-1}
          onClick={decrement}
          disabled={disabled || (min !== undefined && value <= min)}
          className="relative flex-1 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-input/40 transition-colors rounded-br-lg disabled:opacity-30 disabled:pointer-events-none after:absolute after:-inset-x-1 after:top-0 after:-bottom-0.5"
        >
          <ChevronDown size={12} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

export { NumberInput }
