import { useState } from 'react'
import './App.css'

type CoinMode = 'null' | 'alternative' | 'custom'

type TrialResult = {
  actualP: number
  flips: boolean[]
  heads: number
  label: string
  pValue: number
  reject: boolean
  signature: string
}

type BatchResult = {
  actualP: number
  averageHeads: number
  experiments: number
  label: string
  rate: number
  rejections: number
  signature: string
}

type Preset = {
  alpha: number
  description: string
  id: string
  label: string
  n: number
  p0: number
  p1: number
  targetPower: number
}

const presets: Preset[] = [
  {
    id: 'subtle',
    label: 'Efecto sutil',
    description: 'La moneda alternativa apenas se separa de H0. Hace falta mas muestra para ganar potencia.',
    p0: 0.5,
    p1: 0.58,
    n: 44,
    alpha: 0.05,
    targetPower: 0.8,
  },
  {
    id: 'moderate',
    label: 'Efecto moderado',
    description: 'Escenario equilibrado para ver la tension entre alpha, beta y tamano muestral.',
    p0: 0.5,
    p1: 0.68,
    n: 24,
    alpha: 0.05,
    targetPower: 0.8,
  },
  {
    id: 'strong',
    label: 'Efecto claro',
    description: 'Con una moneda muy sesgada la potencia sube rapido aunque la muestra sea moderada.',
    p0: 0.5,
    p1: 0.82,
    n: 14,
    alpha: 0.05,
    targetPower: 0.9,
  },
]

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function clampProbability(value: number) {
  return clamp(Number.isFinite(value) ? value : 0.5, 0.01, 0.99)
}

function formatPercent(value: number, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`
}

function formatProbability(value: number) {
  return value.toFixed(3)
}

function getTickStep(n: number) {
  if (n <= 16) return 1
  if (n <= 30) return 2
  if (n <= 60) return 5
  return 10
}

function buildBinomialDistribution(n: number, p: number) {
  const probability = clampProbability(p)
  const distribution = Array<number>(n + 1).fill(0)

  if (probability <= 0) {
    distribution[0] = 1
    return distribution
  }

  if (probability >= 1) {
    distribution[n] = 1
    return distribution
  }

  const q = 1 - probability
  distribution[0] = Math.pow(q, n)

  for (let k = 1; k <= n; k += 1) {
    distribution[k] = distribution[k - 1] * ((n - k + 1) / k) * (probability / q)
  }

  return distribution
}

function upperTailProbability(distribution: number[], start: number) {
  if (start <= 0) {
    return 1
  }

  if (start >= distribution.length) {
    return 0
  }

  let sum = 0
  for (let index = start; index < distribution.length; index += 1) {
    sum += distribution[index]
  }

  return sum
}

function findCriticalValue(distribution: number[], alpha: number) {
  for (let heads = 0; heads < distribution.length; heads += 1) {
    const tail = upperTailProbability(distribution, heads)
    if (tail <= alpha + 1e-12) {
      return { actualAlpha: tail, criticalValue: heads }
    }
  }

  return { actualAlpha: 0, criticalValue: distribution.length }
}

function findMinimumSampleSize(p0: number, p1: number, alpha: number, targetPower: number, maxN = 200) {
  for (let size = 4; size <= maxN; size += 1) {
    const nullDistribution = buildBinomialDistribution(size, p0)
    const alternativeDistribution = buildBinomialDistribution(size, p1)
    const { criticalValue } = findCriticalValue(nullDistribution, alpha)
    const power = upperTailProbability(alternativeDistribution, criticalValue)

    if (power >= targetPower) {
      return size
    }
  }

  return null
}

function buildPowerCurve(p0: number, p1: number, alpha: number, startN: number, endN: number) {
  const points: Array<{ n: number; power: number }> = []

  for (let size = startN; size <= endN; size += 1) {
    const nullDistribution = buildBinomialDistribution(size, p0)
    const alternativeDistribution = buildBinomialDistribution(size, p1)
    const { criticalValue } = findCriticalValue(nullDistribution, alpha)
    points.push({ n: size, power: upperTailProbability(alternativeDistribution, criticalValue) })
  }

  return points
}

function runSingleExperiment(
  n: number,
  actualP: number,
  nullDistribution: number[],
  criticalValue: number,
  label: string,
  signature: string,
): TrialResult {
  const flips = Array.from({ length: n }, () => Math.random() < actualP)
  const heads = flips.reduce((total, isHead) => total + (isHead ? 1 : 0), 0)

  return {
    actualP,
    flips,
    heads,
    label,
    pValue: upperTailProbability(nullDistribution, heads),
    reject: heads >= criticalValue,
    signature,
  }
}

function runBatchExperiments(
  n: number,
  actualP: number,
  nullDistribution: number[],
  criticalValue: number,
  runs: number,
  label: string,
  signature: string,
): BatchResult {
  let rejections = 0
  let totalHeads = 0

  for (let experiment = 0; experiment < runs; experiment += 1) {
    const result = runSingleExperiment(n, actualP, nullDistribution, criticalValue, label, signature)
    totalHeads += result.heads
    if (result.reject) {
      rejections += 1
    }
  }

  return {
    actualP,
    averageHeads: totalHeads / runs,
    experiments: runs,
    label,
    rate: rejections / runs,
    rejections,
    signature,
  }
}

function App() {
  const initialPreset = presets[1]
  const [p0, setP0] = useState(initialPreset.p0)
  const [p1, setP1] = useState(initialPreset.p1)
  const [n, setN] = useState(initialPreset.n)
  const [alpha, setAlpha] = useState(initialPreset.alpha)
  const [targetPower, setTargetPower] = useState(initialPreset.targetPower)
  const [coinMode, setCoinMode] = useState<CoinMode>('alternative')
  const [customP, setCustomP] = useState(0.74)
  const [batchRuns, setBatchRuns] = useState(400)
  const [trialResult, setTrialResult] = useState<TrialResult | null>(null)
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null)

  const actualP = coinMode === 'null' ? p0 : coinMode === 'alternative' ? p1 : customP
  const currentModeLabel =
    coinMode === 'null' ? 'Moneda bajo H0' : coinMode === 'alternative' ? 'Moneda bajo H1' : 'Moneda personalizada'
  const experimentSignature = [p0, p1, n, alpha, coinMode, customP].join('|')
  const batchSignature = [experimentSignature, batchRuns].join('|')

  const nullDistribution = buildBinomialDistribution(n, p0)
  const alternativeDistribution = buildBinomialDistribution(n, p1)
  const { actualAlpha, criticalValue } = findCriticalValue(nullDistribution, alpha)
  const power = upperTailProbability(alternativeDistribution, criticalValue)
  const beta = 1 - power
  const minimumN = findMinimumSampleSize(p0, p1, alpha, targetPower, 240)
  const curveStart = Math.max(4, n - 10)
  const curveEnd = Math.min(90, Math.max(n + 20, 28))
  const powerCurve = buildPowerCurve(p0, p1, alpha, curveStart, curveEnd)
  const chartPeak = Math.max(...nullDistribution, ...alternativeDistribution)
  const tickStep = getTickStep(n)
  const recommendedPreset = presets.find((preset) => preset.id === 'moderate')
  const visibleTrialResult = trialResult?.signature === experimentSignature ? trialResult : null
  const visibleBatchResult = batchResult?.signature === batchSignature ? batchResult : null

  function applyPreset(preset: Preset) {
    setP0(preset.p0)
    setP1(preset.p1)
    setN(preset.n)
    setAlpha(preset.alpha)
    setTargetPower(preset.targetPower)
    setCoinMode('alternative')
  }

  function handleP0Change(value: number) {
    const nextP0 = clampProbability(value)
    setP0(nextP0)
    setP1((previousP1) => clampProbability(Math.max(previousP1, nextP0 + 0.02)))
    setCustomP((previousCustomP) => clampProbability(Math.max(previousCustomP, nextP0 + 0.01)))
  }

  function handleP1Change(value: number) {
    const nextP1 = clampProbability(Math.max(value, p0 + 0.02))
    setP1(nextP1)
  }

  function handleCustomChange(value: number) {
    setCustomP(clampProbability(value))
  }

  function launchSingleExperiment() {
    setTrialResult(runSingleExperiment(n, actualP, nullDistribution, criticalValue, currentModeLabel, experimentSignature))
  }

  function launchBatchExperiment() {
    setBatchResult(runBatchExperiments(n, actualP, nullDistribution, criticalValue, batchRuns, currentModeLabel, batchSignature))
  }

  const currentPowerMessage =
    power >= targetPower
      ? 'La potencia esta por encima del objetivo docente fijado.'
      : 'La potencia aun es baja: el experimento corre riesgo de no detectar un sesgo real.'

  const alphaMessage =
    actualAlpha < alpha * 0.8
      ? 'El test es discreto: el alpha real queda por debajo del nominal.'
      : 'El alpha real esta cerca del valor nominal elegido.'

  const sampleSizeMessage =
    minimumN === null
      ? 'Con estos parametros no se alcanza la potencia objetivo antes de n = 240.'
      : `Para esta diferencia entre H0 y H1, el primer n que alcanza la potencia objetivo es ${minimumN}.`

  const explainerCards = [
    {
      title: 'Significatividad',
      body: 'Es la probabilidad de entrar en la zona critica cuando H0 es cierta. En una moneda justa, eso controla el error tipo I.',
      value: formatPercent(actualAlpha),
    },
    {
      title: 'Potencia',
      body: 'Es la probabilidad de detectar el sesgo cuando la moneda alternativa es la real. Potencia alta implica beta baja.',
      value: formatPercent(power),
    },
    {
      title: 'Error tipo II',
      body: 'Si H1 es cierta pero la muestra cae fuera de la region critica, no detectas el sesgo. Eso es beta.',
      value: formatPercent(beta),
    },
    {
      title: 'Tamano muestral',
      body: 'Con alpha fijo y efecto pequeno, aumentar n suele ser la forma mas directa de ganar potencia.',
      value: minimumN === null ? '>240' : String(minimumN),
    },
  ]

  return (
    <div className="app-shell">
      <header className="hero panel">
        <div className="hero-copy">
          <div className="brand-row">
            <img className="brand-logo" src="/umu-logo.png" alt="Universidad de Murcia" />
            <div>
              <p className="eyebrow">Diseno de experimentos · Laboratorio interactivo</p>
              <h1>Monedas trucadas para entender significatividad y potencia</h1>
            </div>
          </div>
          <p className="hero-text">
            Ajusta la hipotesis nula, la hipotesis alternativa, el tamano muestral y el nivel alpha. Luego observa como
            cambian la region critica, el error tipo I, el error tipo II y la potencia del contraste.
          </p>
          <div className="preset-row">
            {presets.map((preset) => (
              <button key={preset.id} className="ghost-button" onClick={() => applyPreset(preset)} type="button">
                <strong>{preset.label}</strong>
                <span>{preset.description}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="hero-aside">
          <div className="hero-stat">
            <span>Regla critica</span>
            <strong>{criticalValue > n ? 'No hay rechazo util' : `Rechaza H0 si caras >= ${criticalValue}`}</strong>
          </div>
          <div className="hero-stat">
            <span>Lectura rapida</span>
            <strong>{currentPowerMessage}</strong>
          </div>
          <div className="hero-stat muted">
            <span>Escenario base</span>
            <strong>{recommendedPreset?.label}</strong>
          </div>
        </div>
      </header>

      <main className="workspace">
        <section className="panel controls-panel">
          <div className="section-heading">
            <p className="section-kicker">1 · Configura el experimento</p>
            <h2>Hipotesis, alpha y tamano de muestra</h2>
          </div>
          <div className="controls-grid">
            <label className="control">
              <span>Probabilidad bajo H0</span>
              <input max="0.95" min="0.05" step="0.01" type="range" value={p0} onChange={(event) => handleP0Change(Number(event.target.value))} />
              <strong>{formatProbability(p0)}</strong>
            </label>
            <label className="control">
              <span>Probabilidad bajo H1</span>
              <input max="0.99" min={Math.min(0.99, p0 + 0.02)} step="0.01" type="range" value={p1} onChange={(event) => handleP1Change(Number(event.target.value))} />
              <strong>{formatProbability(p1)}</strong>
            </label>
            <label className="control">
              <span>Tamano muestral n</span>
              <input max="80" min="4" step="1" type="range" value={n} onChange={(event) => setN(Number(event.target.value))} />
              <strong>{n}</strong>
            </label>
            <label className="control">
              <span>Nivel alpha</span>
              <input max="0.2" min="0.01" step="0.005" type="range" value={alpha} onChange={(event) => setAlpha(Number(event.target.value))} />
              <strong>{formatProbability(alpha)}</strong>
            </label>
            <label className="control">
              <span>Potencia objetivo</span>
              <input max="0.99" min="0.5" step="0.01" type="range" value={targetPower} onChange={(event) => setTargetPower(Number(event.target.value))} />
              <strong>{formatPercent(targetPower, 0)}</strong>
            </label>
            <label className="control">
              <span>Experimentos simulados</span>
              <input max="1200" min="50" step="50" type="range" value={batchRuns} onChange={(event) => setBatchRuns(Number(event.target.value))} />
              <strong>{batchRuns}</strong>
            </label>
          </div>
        </section>

        <section className="metrics-grid">
          {explainerCards.map((card) => (
            <article key={card.title} className="panel metric-card">
              <span>{card.title}</span>
              <strong>{card.value}</strong>
              <p>{card.body}</p>
            </article>
          ))}
        </section>

        <section className="panel simulation-panel">
          <div className="section-heading">
            <p className="section-kicker">2 · Elige la moneda real</p>
            <h2>Una muestra concreta frente a muchos experimentos</h2>
          </div>
          <div className="mode-switch">
            <button className={coinMode === 'null' ? 'mode-button active' : 'mode-button'} onClick={() => setCoinMode('null')} type="button">
              Moneda de H0
            </button>
            <button className={coinMode === 'alternative' ? 'mode-button active' : 'mode-button'} onClick={() => setCoinMode('alternative')} type="button">
              Moneda de H1
            </button>
            <button className={coinMode === 'custom' ? 'mode-button active' : 'mode-button'} onClick={() => setCoinMode('custom')} type="button">
              Moneda personalizada
            </button>
            {coinMode === 'custom' ? (
              <label className="inline-control">
                <span>p real</span>
                <input max="0.99" min="0.01" step="0.01" type="number" value={customP} onChange={(event) => handleCustomChange(Number(event.target.value))} />
              </label>
            ) : null}
          </div>
          <div className="simulation-actions">
            <button className="primary-button" onClick={launchSingleExperiment} type="button">
              Simular un experimento
            </button>
            <button className="secondary-button" onClick={launchBatchExperiment} type="button">
              Simular muchos experimentos
            </button>
            <div className="context-pill">
              <span>Moneda real</span>
              <strong>
                {currentModeLabel} · p = {formatProbability(actualP)}
              </strong>
            </div>
          </div>

          <div className="simulation-grid">
            <article className="result-card">
              <h3>Experimento individual</h3>
              {visibleTrialResult ? (
                <>
                  <p>
                    Se han observado <strong>{visibleTrialResult.heads}</strong> caras de <strong>{n}</strong> lanzamientos. El
                    p-valor unilateral es <strong>{visibleTrialResult.pValue.toFixed(4)}</strong>, por lo que{' '}
                    <strong>{visibleTrialResult.reject ? 'se rechaza H0' : 'no se rechaza H0'}</strong>.
                  </p>
                  <div className="flip-grid">
                    {visibleTrialResult.flips.map((isHead, index) => (
                      <span key={`${visibleTrialResult.heads}-${index}`} className={isHead ? 'flip-chip head' : 'flip-chip tail'}>
                        {isHead ? 'C' : 'X'}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <p className="placeholder">Lanza una muestra para ver como una realizacion concreta puede o no caer en la zona critica.</p>
              )}
            </article>

            <article className="result-card emphasis">
              <h3>Experimentos repetidos</h3>
              {visibleBatchResult ? (
                <>
                  <p>
                    En <strong>{visibleBatchResult.experiments}</strong> estudios simulados, el contraste rechazo H0 en{' '}
                    <strong>{visibleBatchResult.rejections}</strong> ocasiones. La tasa observada es{' '}
                    <strong>{formatPercent(visibleBatchResult.rate)}</strong>.
                  </p>
                  <dl className="mini-stats">
                    <div>
                      <dt>Media de caras</dt>
                      <dd>{visibleBatchResult.averageHeads.toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt>Referencia teorica</dt>
                      <dd>{coinMode === 'null' ? 'Debe acercarse a alpha' : coinMode === 'alternative' ? 'Debe acercarse a la potencia' : 'Lectura libre'}</dd>
                    </div>
                  </dl>
                </>
              ) : (
                <p className="placeholder">Repite el estudio muchas veces para ver empiricamente que el error tipo I y la potencia son probabilidades a largo plazo.</p>
              )}
            </article>
          </div>
        </section>

        <section className="panel chart-panel">
          <div className="section-heading compact">
            <p className="section-kicker">3 · Distribuciones y zona critica</p>
            <h2>Donde se separan H0 y H1</h2>
          </div>
          <p className="chart-copy">
            Cada columna representa un numero posible de caras. Las barras coral son probabilidades bajo H0; las barras oscuras, bajo H1.
            La zona sombreada marca la region en la que el test rechaza H0.
          </p>
          <div className="distribution-chart" style={{ ['--bars' as string]: String(n + 1) }}>
            {nullDistribution.map((nullValue, heads) => {
              const alternativeValue = alternativeDistribution[heads]
              const nullHeight = `${(nullValue / chartPeak) * 100}%`
              const alternativeHeight = `${(alternativeValue / chartPeak) * 100}%`
              const isCritical = heads >= criticalValue

              return (
                <div key={heads} className={isCritical ? 'distribution-bin critical' : 'distribution-bin'}>
                  <div className="bar-stack">
                    <span className="bar h1-bar" style={{ height: alternativeHeight }} />
                    <span className="bar h0-bar" style={{ height: nullHeight }} />
                  </div>
                  {heads % tickStep === 0 || heads === n ? <span className="bin-label">{heads}</span> : <span className="bin-label faint">·</span>}
                </div>
              )
            })}
          </div>
          <div className="legend-row">
            <span>
              <i className="legend-swatch h0" />H0
            </span>
            <span>
              <i className="legend-swatch h1" />H1
            </span>
            <span>
              <i className="legend-swatch critical" />Zona critica
            </span>
          </div>
        </section>

        <section className="insight-grid">
          <article className="panel insight-card">
            <div className="section-heading compact">
              <p className="section-kicker">4 · Curva de potencia</p>
              <h2>Como cambia al mover n</h2>
            </div>
            <svg className="power-curve" viewBox="0 0 360 220" role="img" aria-label="Curva de potencia segun n">
              <line className="guide-line" x1="20" x2="340" y1="180" y2="180" />
              <line className="guide-line target" x1="20" x2="340" y1={180 - targetPower * 140} y2={180 - targetPower * 140} />
              <polyline
                className="curve-line"
                fill="none"
                points={powerCurve
                  .map((point, index) => {
                    const x = 20 + (index / Math.max(powerCurve.length - 1, 1)) * 320
                    const y = 180 - point.power * 140
                    return `${x},${y}`
                  })
                  .join(' ')}
              />
              {powerCurve.map((point, index) => {
                const x = 20 + (index / Math.max(powerCurve.length - 1, 1)) * 320
                const y = 180 - point.power * 140
                const highlighted = point.n === n
                return <circle key={point.n} className={highlighted ? 'curve-point active' : 'curve-point'} cx={x} cy={y} r={highlighted ? 5 : 2.6} />
              })}
            </svg>
            <p>{sampleSizeMessage}</p>
          </article>

          <article className="panel insight-card">
            <div className="section-heading compact">
              <p className="section-kicker">5 · Lectura docente</p>
              <h2>Que esta pasando aqui</h2>
            </div>
            <ul className="explanation-list">
              <li>{alphaMessage}</li>
              <li>{currentPowerMessage}</li>
              <li>Si acercas H1 a H0, la superposicion entre distribuciones crece y beta aumenta.</li>
              <li>Si subes alpha, la region critica se ensancha: ganas potencia, pero sube el riesgo de error tipo I.</li>
              <li>Si subes n, H0 y H1 se separan mejor y la decision se vuelve mas informativa.</li>
            </ul>
          </article>
        </section>
      </main>
    </div>
  )
}

export default App
