import { useEffect, useState } from 'react'
import { listWaitlistSignups, type WaitlistPage } from '../lib/api'

export function WaitlistAdminWorkspace({ pageSize = 25 }: { pageSize?: number }) {
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<WaitlistPage | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setError(null)
    void listWaitlistSignups(pageSize, offset).then((result) => { if (active) setPage(result) })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Waitlist monitoring is unavailable.') })
    return () => { active = false }
  }, [offset, pageSize])

  return <section className="waitlist-admin-workspace" aria-labelledby="waitlist-monitoring-title">
    <header className="waitlist-admin-heading">
      <div><span className="eyebrow">Private administration</span><h1 id="waitlist-monitoring-title">Waitlist monitoring</h1></div>
      <strong>{page ? `${page.total.toLocaleString()} ${page.total === 1 ? 'person' : 'people'}` : 'Loading…'}</strong>
    </header>
    {error ? <p role="alert">{error}</p> : null}
    {page ? <>
      <div className="waitlist-admin-table-wrap"><table aria-label="Waitlist signups">
        <thead><tr><th>Name</th><th>Email</th><th>Consent</th><th>Joined</th></tr></thead>
        <tbody>{page.items.map((item) => <tr key={item.email}>
          <td>{item.name}</td><td>{item.email}</td><td>{item.consentVersion}</td><td><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></td>
        </tr>)}</tbody>
      </table></div>
      <nav className="waitlist-admin-pagination" aria-label="Waitlist pages">
        <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Previous page</button>
        <span>{page.total ? `${offset + 1}–${Math.min(offset + page.items.length, page.total)} of ${page.total}` : 'No signups yet'}</span>
        <button type="button" disabled={offset + page.items.length >= page.total} onClick={() => setOffset(offset + pageSize)}>Next page</button>
      </nav>
    </> : null}
  </section>
}
