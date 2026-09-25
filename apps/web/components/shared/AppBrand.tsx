export function AppBrand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`app-brand-lockup${compact ? ' app-brand-lockup--compact' : ''}`}>
      <span className="app-brand-bars" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="app-brand-copy">
        <strong>Ai Review</strong>
        <small>by Digital Hammerr</small>
      </span>
    </span>
  );
}
