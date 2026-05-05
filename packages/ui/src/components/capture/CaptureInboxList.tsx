import type { CaptureItem } from '@craft-agent/shared/capture';

export interface CaptureInboxListProps {
  items: CaptureItem[];
  selectedItemId?: string | null;
  onSelectItem?: (itemId: string) => void;
}

export function CaptureInboxList({ items, selectedItemId, onSelectItem }: CaptureInboxListProps) {
  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {items.length === 0 ? (
          <div className="px-3 py-8 text-sm text-muted-foreground">No captures yet</div>
        ) : items.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectItem?.(item.id)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm hover:bg-foreground/[0.04] ${selectedItemId === item.id ? 'bg-foreground/[0.06]' : ''}`}
          >
            <div className="font-medium truncate">{item.title || item.url || 'Untitled capture'}</div>
            <div className="text-xs text-muted-foreground truncate">{item.body.trim() || item.capturedAt}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
