import "./preview-loading.css";

/** Decorative placeholders only: never display fabricated account data. */
export function ServiceLoading({ variant = "page" }: { variant?: "page" | "knowledge" }) {
  return (
    <div className={`preview-loading preview-loading-${variant}`} role="status" aria-label={variant === "knowledge" ? "Загрузка базы знаний" : "Загрузка кабинета"} aria-live="polite" aria-busy="true">
      {variant === "page" ? <div className="preview-loading-sidebar" aria-hidden="true">
        <div className="preview-skeleton preview-loading-logo" />
        <div className="preview-skeleton preview-loading-profile" />
        <div className="preview-loading-nav">{Array.from({ length: 6 }, (_, i) => <div className="preview-skeleton preview-loading-nav-item" key={i} />)}</div>
      </div> : null}
      <div className="preview-loading-content" aria-hidden="true">
        <div className="preview-skeleton preview-loading-title" />
        <div className="preview-loading-cards">{Array.from({ length: 4 }, (_, i) => <div className="preview-skeleton preview-loading-card" key={i} />)}</div>
        <div className="preview-skeleton preview-loading-main" />
        <div className="preview-loading-bottom"><div className="preview-skeleton" /><div className="preview-skeleton" /></div>
      </div>
    </div>
  );
}
