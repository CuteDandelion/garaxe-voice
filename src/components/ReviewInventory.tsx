import { useEffect, useId, useRef } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  FileText,
  Search,
  SlidersHorizontal,
  Star,
  X,
} from 'lucide-react'
import { Icon } from './Icon'
import './ReviewInventory.css'

export type ReviewInventoryFilters = {
  query: string
  provider: string
  entity: string
  rating: string
  language: string
  textKind: 'all' | 'written' | 'rating_only'
}

export type ReviewInventoryOption = {
  value: string
  label: string
  count?: number
}

export type ReviewInventoryItem = {
  id: string
  provider: string
  entity: string | null
  rating: number | null
  ratingScale: number
  title: string | null
  bodyOriginal: string | null
  language: string | null
  sourceCreatedAt: string | null
  reviewerName?: string | null
  sourceUrl?: string | null
  externalId?: string | null
  importJobId: string
  sourceRecordId: string
  importedAt?: string | null
  isRatingOnly: boolean
  isDuplicate?: boolean
  isExcluded?: boolean
  exclusionReason?: string | null
  metadata?: Record<string, unknown>
}

export type ReviewInventorySummary = {
  total: number
  written: number
  ratingOnly: number
  entities: number
  providers: number
}

export type ReviewInventoryPage = {
  items: ReviewInventoryItem[]
  nextCursor: string | null
  previousCursor: string | null
  rangeStart: number
  rangeEnd: number
  total: number
}

export type ReviewInventoryProps = {
  filters: ReviewInventoryFilters
  summary: ReviewInventorySummary
  page: ReviewInventoryPage
  providerOptions: ReviewInventoryOption[]
  entityOptions: ReviewInventoryOption[]
  languageOptions: ReviewInventoryOption[]
  loading?: boolean
  error?: string | null
  selectedReview?: ReviewInventoryItem | null
  onFiltersChange: (filters: ReviewInventoryFilters) => void
  onCursorChange: (cursor: string | null, direction: 'next' | 'previous') => void
  onSelectReview: (review: ReviewInventoryItem) => void
  onCloseReview: () => void
  onRetry?: () => void
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

function formatDate(value: string | null | undefined) {
  if (!value) return 'Date unavailable'
  const parsed = new Date(value)
  return Number.isNaN(parsed.valueOf()) ? 'Date unavailable' : dateFormatter.format(parsed)
}

function displayProvider(provider: string) {
  return provider.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function Rating({ rating, scale }: { rating: number | null; scale: number }) {
  return rating === null ? (
    <span className="review-inventory__muted">No rating</span>
  ) : (
    <span className="review-inventory__rating" aria-label={`${rating} out of ${scale} stars`}>
      <Icon icon={Star} size={13} /> {rating}/{scale}
    </span>
  )
}

export function ReviewInventory({
  filters,
  summary,
  page,
  providerOptions,
  entityOptions,
  languageOptions,
  loading = false,
  error = null,
  selectedReview = null,
  onFiltersChange,
  onCursorChange,
  onSelectReview,
  onCloseReview,
  onRetry,
}: ReviewInventoryProps) {
  const searchId = useId()
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!selectedReview) return
    closeButtonRef.current?.focus()
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onCloseReview()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [selectedReview, onCloseReview])

  function updateFilter<K extends keyof ReviewInventoryFilters>(key: K, value: ReviewInventoryFilters[K]) {
    onFiltersChange({ ...filters, [key]: value })
  }

  const hasFilters = Object.entries(filters).some(([key, value]) =>
    key === 'textKind' ? value !== 'all' : value !== '',
  )

  return (
    <section className="review-inventory" aria-labelledby="review-inventory-title">
      <header className="review-inventory__heading">
        <div>
          <p className="review-inventory__eyebrow">Review inventory</p>
          <h1 id="review-inventory-title">The source material, in full.</h1>
        </div>
        <p>Inspect every normalized record and trace it back to the import that brought it in. Written feedback and rating-only records stay distinct.</p>
      </header>

      <dl className="review-inventory__summary" aria-label="Dataset summary">
        <div><dt>All records</dt><dd>{summary.total.toLocaleString()}</dd></div>
        <div><dt>Written</dt><dd>{summary.written.toLocaleString()}</dd></div>
        <div><dt>Rating-only</dt><dd>{summary.ratingOnly.toLocaleString()}</dd></div>
        <div><dt>Entities</dt><dd>{summary.entities.toLocaleString()}</dd></div>
        <div><dt>Sources</dt><dd>{summary.providers.toLocaleString()}</dd></div>
      </dl>

      <div className="review-inventory__toolbar">
        <label className="review-inventory__search" htmlFor={searchId}>
          <Icon icon={Search} size={17} />
          <span className="review-inventory__sr-only">Search review text</span>
          <input
            id={searchId}
            type="search"
            value={filters.query}
            placeholder="Search exact customer language"
            onChange={(event) => updateFilter('query', event.target.value)}
          />
        </label>
        <span className="review-inventory__filter-label"><Icon icon={SlidersHorizontal} size={15} /> Filter inventory</span>
        <label>Source<select aria-label="Filter by source" value={filters.provider} onChange={(event) => updateFilter('provider', event.target.value)}><option value="">All sources</option>{providerOptions.map((option) => <option key={option.value} value={option.value}>{option.label}{option.count === undefined ? '' : ` (${option.count})`}</option>)}</select></label>
        <label>Entity<select aria-label="Filter by entity" value={filters.entity} onChange={(event) => updateFilter('entity', event.target.value)}><option value="">All entities</option>{entityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}{option.count === undefined ? '' : ` (${option.count})`}</option>)}</select></label>
        <label>Rating<select aria-label="Filter by rating" value={filters.rating} onChange={(event) => updateFilter('rating', event.target.value)}><option value="">All ratings</option>{[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={String(rating)}>{rating} star{rating === 1 ? '' : 's'}</option>)}</select></label>
        <label>Language<select aria-label="Filter by language" value={filters.language} onChange={(event) => updateFilter('language', event.target.value)}><option value="">All languages</option>{languageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}{option.count === undefined ? '' : ` (${option.count})`}</option>)}</select></label>
        <label>Feedback<select aria-label="Filter by feedback type" value={filters.textKind} onChange={(event) => updateFilter('textKind', event.target.value as ReviewInventoryFilters['textKind'])}><option value="all">Written + rating-only</option><option value="written">Written only</option><option value="rating_only">Rating-only</option></select></label>
        {hasFilters ? <button className="review-inventory__clear" type="button" onClick={() => onFiltersChange({ query: '', provider: '', entity: '', rating: '', language: '', textKind: 'all' })}><Icon icon={X} size={14} /> Clear filters</button> : null}
      </div>

      <div className="review-inventory__results" aria-live="polite" aria-busy={loading}>
        {loading ? (
          <div className="review-inventory__state"><span className="review-inventory__loader" aria-hidden="true" /><h2>Loading source records…</h2><p>Applying filters without losing provenance.</p></div>
        ) : error ? (
          <div className="review-inventory__state" role="alert"><Icon icon={CircleAlert} size={27} /><h2>We couldn’t load this inventory.</h2><p>{error}</p>{onRetry ? <button type="button" onClick={onRetry}>Try again</button> : null}</div>
        ) : page.items.length === 0 ? (
          <div className="review-inventory__state"><Icon icon={FileText} size={27} /><h2>{hasFilters ? 'No reviews match these filters.' : 'No reviews imported yet.'}</h2><p>{hasFilters ? 'Clear a filter or search for different customer language.' : 'Import an authorized review export to begin the evidence inventory.'}</p>{hasFilters ? <button type="button" onClick={() => onFiltersChange({ query: '', provider: '', entity: '', rating: '', language: '', textKind: 'all' })}>Clear filters</button> : null}</div>
        ) : (
          <>
            <div className="review-inventory__result-heading"><p><strong>{page.total.toLocaleString()}</strong> matching records</p><span>{page.rangeStart.toLocaleString()}–{page.rangeEnd.toLocaleString()}</span></div>
            <ol className="review-inventory__list">
              {page.items.map((review) => (
                <li key={review.id}>
                  <button className="review-inventory__row" type="button" onClick={() => onSelectReview(review)} aria-label={`Open review from ${review.entity || displayProvider(review.provider)}`}>
                    <span className="review-inventory__row-meta"><strong>{review.entity || 'Unassigned entity'}</strong><span>{displayProvider(review.provider)}</span></span>
                    <span className={`review-inventory__quote${review.isRatingOnly ? ' review-inventory__quote--rating-only' : ''}`}>{review.bodyOriginal || 'Rating-only record — no written feedback supplied.'}</span>
                    <span className="review-inventory__row-facts"><Rating rating={review.rating} scale={review.ratingScale} /><span><Icon icon={CalendarDays} size={13} /> {formatDate(review.sourceCreatedAt)}</span>{review.language ? <span lang={review.language}>{review.language.toUpperCase()}</span> : null}{review.isExcluded ? <span className="review-inventory__badge review-inventory__badge--excluded">Excluded</span> : null}{review.isDuplicate ? <span className="review-inventory__badge">Duplicate</span> : null}</span>
                    <Icon icon={ChevronRight} size={18} />
                  </button>
                </li>
              ))}
            </ol>
            <nav className="review-inventory__pagination" aria-label="Review inventory pages">
              <button type="button" disabled={!page.previousCursor} onClick={() => onCursorChange(page.previousCursor, 'previous')}><Icon icon={ArrowLeft} size={15} /> Previous</button>
              <span>{page.rangeStart.toLocaleString()}–{page.rangeEnd.toLocaleString()} of {page.total.toLocaleString()}</span>
              <button type="button" disabled={!page.nextCursor} onClick={() => onCursorChange(page.nextCursor, 'next')}>Next <Icon icon={ArrowRight} size={15} /></button>
            </nav>
          </>
        )}
      </div>

      {selectedReview ? (
        <div className="review-inventory__drawer-layer" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onCloseReview() }}>
          <aside className="review-inventory__drawer" role="dialog" aria-modal="true" aria-labelledby="review-detail-title">
            <header><div><p className="review-inventory__eyebrow">Original source record</p><h2 id="review-detail-title">{selectedReview.entity || displayProvider(selectedReview.provider)}</h2></div><button ref={closeButtonRef} type="button" aria-label="Close review details" onClick={onCloseReview}><Icon icon={X} size={19} /></button></header>
            <div className="review-inventory__drawer-body">
              <div className="review-inventory__drawer-facts"><Rating rating={selectedReview.rating} scale={selectedReview.ratingScale} /><span>{displayProvider(selectedReview.provider)}</span><span>{formatDate(selectedReview.sourceCreatedAt)}</span>{selectedReview.language ? <span>{selectedReview.language.toUpperCase()}</span> : null}</div>
              {selectedReview.title ? <h3>{selectedReview.title}</h3> : null}
              <blockquote>{selectedReview.bodyOriginal || 'This source record contains a rating without written feedback.'}</blockquote>
              {selectedReview.reviewerName ? <p className="review-inventory__reviewer">— {selectedReview.reviewerName}</p> : null}
              {selectedReview.isExcluded ? <div className="review-inventory__notice"><strong>Excluded from analysis</strong><span>{selectedReview.exclusionReason || 'No exclusion reason was recorded.'}</span></div> : null}
              <section className="review-inventory__provenance" aria-labelledby="review-provenance-title"><p className="review-inventory__eyebrow" id="review-provenance-title">Provenance</p><dl><div><dt>Review ID</dt><dd>{selectedReview.id}</dd></div>{selectedReview.externalId ? <div><dt>Provider record</dt><dd>{selectedReview.externalId}</dd></div> : null}<div><dt>Source row</dt><dd>{selectedReview.sourceRecordId}</dd></div><div><dt>Import job</dt><dd>{selectedReview.importJobId}</dd></div>{selectedReview.importedAt ? <div><dt>Imported</dt><dd>{formatDate(selectedReview.importedAt)}</dd></div> : null}</dl></section>
              {selectedReview.sourceUrl ? <a className="review-inventory__source-link" href={selectedReview.sourceUrl} target="_blank" rel="noreferrer">Open authorized source <Icon icon={ArrowRight} size={14} /></a> : null}
              {selectedReview.metadata && Object.keys(selectedReview.metadata).length > 0 ? <details className="review-inventory__metadata"><summary>Preserved source metadata</summary><pre>{JSON.stringify(selectedReview.metadata, null, 2)}</pre></details> : null}
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  )
}
