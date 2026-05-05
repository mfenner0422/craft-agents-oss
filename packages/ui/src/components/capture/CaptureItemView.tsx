import type { CaptureItem } from '@craft-agent/shared/capture';

export interface CaptureItemViewProps {
  item?: CaptureItem | null;
}

export function CaptureItemView({ item }: CaptureItemViewProps) {
  if (!item) {
    return <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Select a capture</div>;
  }

  return (
    <article className="h-full overflow-y-auto px-6 py-5">
      <header className="mb-5">
        <h1 className="text-xl font-semibold">{item.title || item.url || 'Untitled capture'}</h1>
        <p className="mt-1 text-xs text-muted-foreground">{item.capturedAt}</p>
      </header>
      {item.url && (
        <a href={item.url} className="text-sm underline break-all">
          {item.url}
        </a>
      )}
      <pre className="mt-5 whitespace-pre-wrap font-sans text-sm leading-6">{item.body}</pre>
    </article>
  );
}
