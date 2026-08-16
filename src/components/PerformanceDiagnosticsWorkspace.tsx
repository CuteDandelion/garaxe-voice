import { useEffect, useState } from 'react'
import { Activity, Clock3, Cpu, HardDrive, ListChecks } from 'lucide-react'
import { getLocalPerformanceDiagnostics, type LocalPerformanceDiagnostics } from '../lib/api'
import { Icon } from './Icon'
import './PerformanceDiagnosticsWorkspace.css'

const seconds = (milliseconds: number) => `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 2 : 1)}s`
const optionalSeconds = (milliseconds: number) => milliseconds > 0 ? seconds(milliseconds) : '—'
const percentile = (values: number[], ratio: number) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * ratio) - 1)] || 0
type PlotSeries = { label: string; color: string; values: number[]; unit: string }

function TimeSeries({ label, times, series, empty }: { label: string; times: string[]; series: PlotSeries[]; empty: string }) {
  const [activePoint, setActivePoint] = useState<{ label: string; left: string; top: string } | null>(null)
  if (times.length < 1 || series.every((item) => item.values.length < 1)) return <p className="performance-diagnostics__empty">{empty}</p>
  const width = 320; const height = 112; const maximum = Math.max(1, ...series.flatMap((item) => item.values))
  const x = (index: number) => times.length === 1 ? width / 2 : 8 + index * ((width - 16) / (times.length - 1))
  const y = (value: number) => height - 12 - (value / maximum) * (height - 24)
  return <div className="performance-diagnostics__chart-wrap"><svg className="performance-diagnostics__chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
    {[0, .5, 1].map((ratio) => <line key={ratio} x1="8" x2={width - 8} y1={y(maximum * ratio)} y2={y(maximum * ratio)} />)}
    {series.map((item) => <g key={item.label}>{item.values.length > 1 ? <polyline points={item.values.map((value, index) => `${x(index)},${y(value)}`).join(' ')} style={{ stroke: item.color }} /> : null}{item.values.map((value, index) => { const title = `${item.label}, ${new Date(times[index]).toLocaleTimeString()}: ${value.toFixed(item.unit === '%' ? 1 : 0)}${item.unit}`; const point = { label: title, left: `${x(index) / width * 100}%`, top: `${y(value) / height * 100}%` }; return <circle key={`${item.label}:${times[index]}`} cx={x(index)} cy={y(value)} r="3" tabIndex={0} aria-label={title} onMouseEnter={() => setActivePoint(point)} onMouseLeave={() => setActivePoint(null)} onFocus={() => setActivePoint(point)} onBlur={() => setActivePoint(null)} style={{ fill: item.color }}><title>{title}</title></circle> })}</g>)}
  </svg><output className="performance-diagnostics__tooltip" aria-label="Chart value" style={activePoint ? { left: activePoint.left, top: activePoint.top } : undefined}>{activePoint?.label || ''}</output></div>
}

function StageDuration({ run }: { run: LocalPerformanceDiagnostics['runs'][number] }) {
  const stages = [
    { label: 'Parse & validate', value: run.timings.parseValidateMs, hint: 'CSV preflight' },
    { label: 'Save', value: run.timings.csvSaveMs, hint: 'Accepted rows persisted' },
    { label: 'Queue wait', value: run.timings.queueWaitMs, hint: 'Waiting for intelligence capacity' },
    { label: 'Fully covered evidence', value: run.timings.firstEvidenceMs, hint: 'All retained feedback has grounded evidence' },
    { label: 'Model work', value: run.llm.durationMs, hint: `${run.llm.requests} intelligence requests` },
    { label: 'Final persist', value: run.timings.aggregationPersistMs, hint: 'Artifact write after model work' },
  ]
  const maximum = Math.max(1, ...stages.map((stage) => stage.value))
  return <div className="performance-diagnostics__stage-duration" role="img" aria-label={`Measured stage duration for ${run.userLabel}`}>
    {stages.map((stage) => <div key={stage.label}><span>{stage.label}</span><i title={`${stage.label}: ${seconds(stage.value)} · ${stage.hint}`} style={{ width: `${Math.max(2, stage.value / maximum * 100)}%` }} /><strong>{seconds(stage.value)}</strong></div>)}
  </div>
}

function resourceTimeline(report: LocalPerformanceDiagnostics, value: 'cpuPercent' | 'rssMiB') {
  const samples = new Map<string, number>()
  const seen = new Set<string>()
  for (const run of report.runs) for (const sample of run.resources) {
    const key = `${sample.sampledAt}:${sample.service}`
    if (seen.has(key)) continue
    seen.add(key); samples.set(sample.sampledAt, (samples.get(sample.sampledAt) || 0) + sample[value])
  }
  const rows = [...samples].sort(([left], [right]) => left.localeCompare(right)).slice(-60)
  return { times: rows.map(([time]) => time), values: rows.map(([, amount]) => amount) }
}

export function PerformanceDiagnosticsWorkspace() {
  const [report, setReport] = useState<LocalPerformanceDiagnostics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updatesPaused, setUpdatesPaused] = useState(false)
  const [queueSamples, setQueueSamples] = useState<Array<{ at: string; queued: number; active: number }>>([])
  useEffect(() => {
    if (updatesPaused) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const value = await getLocalPerformanceDiagnostics()
        if (active) {
          setReport(value); setError(null)
          setQueueSamples((current) => current.at(-1)?.at === value.generatedAt ? current : [...current, { at: value.generatedAt, queued: value.runs.reduce((sum, run) => sum + run.queue.queued, 0), active: value.runs.reduce((sum, run) => sum + run.queue.active, 0) }].slice(-30))
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Diagnostics unavailable.')
      } finally {
        if (active) timer = setTimeout(load, 2_000)
      }
    }
    void load()
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [updatesPaused])

  const newestResources = new Map<string, NonNullable<typeof report>['runs'][number]['resources'][number]>()
  for (const run of report?.runs || []) for (const sample of run.resources) newestResources.set(sample.service, sample)
  const resources = [...newestResources.values()]
  const queued = report?.runs.reduce((total, run) => total + run.queue.queued, 0) || 0
  const active = report?.runs.reduce((total, run) => total + run.queue.active, 0) || 0
  const cpu = resources.reduce((maximum, sample) => Math.max(maximum, sample.cpuPercent), 0)
  const ram = resources.reduce((total, sample) => total + sample.rssMiB, 0)
  const cpuTimeline = report ? resourceTimeline(report, 'cpuPercent') : { times: [], values: [] }
  const memoryTimeline = report ? resourceTimeline(report, 'rssMiB') : { times: [], values: [] }
  const ledger = report?.runs.flatMap((run) => run.jobs.map((job) => ({ ...job, run }))) || []
  const isTerminal = (job: typeof ledger[number]) => /^(Completed|Stopped|Cancelled)/.test(job.status)
  const activeJobs = ledger.filter((job) => !isTerminal(job))
  const completedJobs = ledger.filter(isTerminal)
  const jobs = [...activeJobs.slice(0, 6), ...completedJobs.slice(0, 3)]
  const firstEvidenceP95 = report?.fairness?.p95FirstEvidenceMs || percentile((report?.runs || []).map((run) => run.timings.firstEvidenceMs).filter(Boolean), .95)

  return <main className="performance-diagnostics" aria-labelledby="performance-diagnostics-title">
    <header className="performance-diagnostics__heading"><div><span className="eyebrow">Local staging only</span><h1 id="performance-diagnostics-title">Performance diagnostics</h1><p>Real queue, intelligence, and service measurements. No customer content.</p></div><div><span className={`performance-diagnostics__live${updatesPaused ? ' is-paused' : ''}`} role="status" aria-live="polite">{updatesPaused ? `Updates paused · Analysis continues in the background · Last updated ${report ? new Date(report.generatedAt).toLocaleTimeString() : 'not yet'}` : report ? `Live · updated ${new Date(report.generatedAt).toLocaleTimeString()}` : 'Connecting…'}</span><button type="button" className="performance-diagnostics__pause" aria-pressed={updatesPaused} onClick={() => setUpdatesPaused((paused) => !paused)}>{updatesPaused ? 'Resume updates' : 'Pause updates'}</button><a href="/">Back to Voice Lab</a></div></header>
    {error ? <p role="alert">{error}</p> : null}
    {!report ? <p role="status">Loading measured run data…</p> : <>
      <section className="performance-diagnostics__kpis" aria-label="Current service status">
        <article><Icon icon={ListChecks} /><span>Queued</span><strong>{queued}</strong></article>
        <article><Icon icon={Activity} /><span>Active</span><strong>{active}</strong></article>
        <article><Icon icon={Cpu} /><span>Peak current CPU</span><strong>{cpu.toFixed(1)}%</strong></article>
        <article><Icon icon={HardDrive} /><span>Current service RAM</span><strong>{ram.toFixed(1)} MiB</strong></article>
        <article><Icon icon={Clock3} /><span>Fully covered evidence p95</span><strong>{optionalSeconds(firstEvidenceP95)}</strong></article>
      </section>
      <div className="performance-diagnostics__meta">Sampled every {report.window.samplingIntervalMs.toLocaleString()}ms · <time dateTime={report.window.from}>{report.window.from}</time>–<time dateTime={report.window.to}>{report.window.to}</time></div>
      <section className="performance-diagnostics__charts" aria-label="Live service trends">
        <figure><figcaption><strong>Queue and workers</strong><span>Real dashboard samples</span></figcaption>{queueSamples.length < 2 ? <p className="performance-diagnostics__empty">Waiting for a second live queue sample.</p> : <TimeSeries label="Queue depth and active workers over time" times={queueSamples.map((sample) => sample.at)} series={[{ label: 'Queued', color: '#b95f36', values: queueSamples.map((sample) => sample.queued), unit: '' }, { label: 'Active', color: '#56745f', values: queueSamples.map((sample) => sample.active), unit: '' }]} empty="No queue samples yet." />}</figure>
        <figure><figcaption><strong>CPU</strong><span>Local services combined</span></figcaption><TimeSeries label="CPU over time" times={cpuTimeline.times} series={[{ label: 'CPU', color: '#b95f36', values: cpuTimeline.values, unit: '%' }]} empty="No CPU samples for this run yet." /></figure>
        <figure><figcaption><strong>Memory</strong><span>Resident memory across local services</span></figcaption><TimeSeries label="Memory over time" times={memoryTimeline.times} series={[{ label: 'RAM', color: '#56745f', values: memoryTimeline.values, unit: ' MiB' }]} empty="No memory samples for this run yet." /></figure>
        {report.runs[0] ? <figure className="performance-diagnostics__stage-card"><figcaption><strong>Stage duration</strong><span>Latest measured run · elapsed, not estimated</span></figcaption><StageDuration run={report.runs[0]} /></figure> : null}
      </section>
      {report.fairness ? <section className="performance-diagnostics__fairness" aria-label="Three-user fairness"><strong>{report.fairness.users} users · {report.fairness.starvedUsers} starved</strong><span>Fully covered evidence p50 {optionalSeconds(report.fairness.p50FirstEvidenceMs)} / p95 {optionalSeconds(report.fairness.p95FirstEvidenceMs)}</span><span>Completion spread {seconds(report.fairness.completionSpreadMs)}</span></section> : null}
      <section className="performance-diagnostics__tables" aria-label="Live work detail">
        <div><h2>Active and recent jobs</h2>{jobs.length ? <><p className="performance-diagnostics__ledger-note">Showing {Math.min(6, activeJobs.length)} of {activeJobs.length} active jobs and {Math.min(3, completedJobs.length)} recent completions.</p><div className="performance-diagnostics__table-wrap"><table aria-label="Active and recent intelligence jobs"><thead><tr><th>Workspace</th><th>Run</th><th>Status</th><th>Queue wait</th><th>Progress</th><th>Retries</th><th>Elapsed</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.jobId}><td>{job.run.userLabel}</td><td title={job.run.runId}>{job.run.runId.slice(0, 8)}</td><td>{job.status}</td><td>{seconds(job.queueWaitMs)}</td><td>{job.progressPercent}%</td><td>{job.retries}</td><td>{seconds(job.elapsedMs)}</td></tr>)}</tbody></table></div></> : <p className="performance-diagnostics__empty">No intelligence jobs have been created for these runs.</p>}</div>
        <div><h2>Three-user fairness</h2>{report.fairness?.comparisons.length ? <div className="performance-diagnostics__table-wrap"><table aria-label="Three-user fairness comparison"><thead><tr><th>User</th><th>Queue wait</th><th>Covered evidence</th><th>Complete</th><th>Progress</th></tr></thead><tbody>{report.fairness.comparisons.map((item) => <tr key={item.userLabel}><td>{item.userLabel}</td><td>{optionalSeconds(item.queueWaitMs)}</td><td>{optionalSeconds(item.firstEvidenceMs)}</td><td>{item.progressPercent === 100 ? optionalSeconds(item.completionMs) : 'Running'}</td><td><span className="performance-diagnostics__fairness-bar"><i style={{ width: `${item.progressPercent}%` }} /></span>{item.progressPercent}%</td></tr>)}</tbody></table></div> : <p className="performance-diagnostics__empty">Run three isolated users to compare queue fairness.</p>}</div>
      </section>
      <section className="performance-diagnostics__runs" aria-labelledby="performance-runs-title"><h2 id="performance-runs-title">Recent runs</h2><div className="performance-diagnostics__table-wrap"><table aria-label="Recent analysis runs"><thead><tr><th>Workspace</th><th>Stage</th><th>Queue state</th><th>Covered evidence</th><th>Total</th><th>Model work</th><th>Retries</th></tr></thead><tbody>{report.runs.map((run) => <tr key={run.runId}>
        <td><strong>{run.userLabel}</strong><small>{run.lane}</small></td><td><span>{run.stage}</span><span className="performance-diagnostics__table-progress"><i style={{ width: `${run.progressPercent}%` }} /></span>{run.progressPercent}%</td><td>{run.queue.leaseState}</td><td>{optionalSeconds(run.timings.firstEvidenceMs)}</td><td>{optionalSeconds(run.timings.completionMs)}</td><td>{run.llm.requests} requests · {seconds(run.llm.durationMs)}</td><td>{run.llm.retries}</td>
      </tr>)}</tbody></table></div></section>
      <section className="performance-diagnostics__resources" aria-labelledby="resource-health-title"><h2 id="resource-health-title">Resource health</h2><div className="performance-diagnostics__table-wrap"><table><thead><tr><th>Service</th><th>CPU</th><th>RSS</th><th>Heap</th></tr></thead><tbody>{resources.map((sample) => <tr key={sample.service}><td>{sample.service}</td><td>{sample.cpuPercent}%</td><td>{sample.rssMiB} MiB</td><td>{sample.heapMiB === undefined ? '—' : `${sample.heapMiB} MiB`}</td></tr>)}</tbody></table></div></section>
    </>}
  </main>
}
