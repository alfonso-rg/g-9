import { useState } from 'react'
import './App.css'

type CoinMode = 'null' | 'alternative' | 'custom'

type TrialResult = {
  flips: boolean[]
  heads: number
  pValue: number
  reject: boolean
  signature: string
}

type BatchResult = {
  averageHeads: number
  experiments: number
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
    description: 'H1 está muy cerca de H0. La potencia cuesta más.',
    p0: 0.5,
    p1: 0.58,
    n: 44,
    alpha: 0.05,
    targetPower: 0.8,
  },
  {
    id: 'moderate',
    label: 'Efecto moderado',
    description: 'Buen caso para entender la tensión entre alpha, beta y n.',
    p0: 0.5,
    p1: 0.68,
    n: 24,
    alpha: 0.05,
    targetPower: 0.8,
  },
  {
    id: 'strong',
    label: 'Efecto claro',
    description: 'El sesgo es visible y la potencia sube rápido.',
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
  if (start <= 0) return 1
  if (start >= distribution.length) return 0

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
  signature: string,
): TrialResult {
  const flips = Array.from({ length: n }, () => Math.random() < actualP)
  const heads = flips.reduce((total, isHead) => total + (isHead ? 1 : 0), 0)

  return {
    flips,
    heads,
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
  signature: string,
): BatchResult {
  let rejections = 0
  let totalHeads = 0

  for (let experiment = 0; experiment < runs; experiment += 1) {
    const result = runSingleExperiment(n, actualP, nullDistribution, criticalValue, signature)
    totalHeads += result.heads
    if (result.reject) rejections += 1
  }

  return {
    averageHeads: totalHeads / runs,
    experiments: runs,
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
  const actualCoinLabel = coinMode === 'null' ? 'Moneda H0' : coinMode === 'alternative' ? 'Moneda H1' : 'Moneda personalizada'
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
  const expectedHeadsH0 = n * p0
  const expectedHeadsH1 = n * p1
  const expectedHeadsReal = n * actualP
  const thresholdPosition = criticalValue > n ? 100 : (criticalValue / n) * 100
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
    setP1(clampProbability(Math.max(value, p0 + 0.02)))
  }

  function launchSingleExperiment() {
    setTrialResult(runSingleExperiment(n, actualP, nullDistribution, criticalValue, experimentSignature))
  }

  function launchBatchExperiment() {
    setBatchResult(runBatchExperiments(n, actualP, nullDistribution, criticalValue, batchRuns, batchSignature))
  }

  const actualAlphaText = actualAlpha < alpha * 0.8 ? 'Alpha real más conservador que el nominal.' : 'Alpha real muy cercano al nominal.'
  const sampleSizeText = minimumN === null ? 'No llega al objetivo antes de n = 240.' : `Objetivo de potencia alcanzable desde n = ${minimumN}.`
  const decisionText = criticalValue > n ? 'No hay región de rechazo útil.' : `Rechaza H0 con ${criticalValue} o más caras.`

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-copy panel">
          <div className="brand-row">
            <img className="brand-logo" src="/umu-logo.png" alt="Universidad de Murcia" />
            <div>
              <p className="eyebrow">Universidad de Murcia - G-9</p>
              <h1>Monedas trucadas para entender un contraste de hipótesis</h1>
            </div>
          </div>
          <p className="hero-text">
            En esta práctica vas a lanzar una moneda muchas veces, comparar una <strong>moneda de referencia</strong> con una <strong>moneda sesgada</strong> y ver cómo se conectan significatividad, potencia, error tipo I, error tipo II y tamaño muestral.
          </p>
          <div className="preset-strip">
            {presets.map((preset) => {
              const active = preset.p0 === p0 && preset.p1 === p1 && preset.n === n && preset.alpha === alpha
              return (
                <button key={preset.id} className={active ? 'preset-card active' : 'preset-card'} onClick={() => applyPreset(preset)} type="button">
                  <span>{preset.label}</span>
                  <strong>{preset.description}</strong>
                </button>
              )
            })}
          </div>
        </div>

        <div className="hero-visual panel">
          <div className="visual-top">
            <span>Escena del experimento</span>
            <strong>{actualCoinLabel} - p = {formatProbability(actualP)}</strong>
          </div>

          <div className="coin-stage" aria-hidden="true">
            <div className="coin coin-a"><span>C</span></div>
            <div className="coin coin-b"><span>X</span></div>
            <div className="coin coin-c"><span>C</span></div>
            <div className="coin coin-d"><span>X</span></div>
            <div className="coin-shadow coin-shadow-a" />
            <div className="coin-shadow coin-shadow-b" />
          </div>

          <div className="hypothesis-stack">
            <article className="hypothesis-card null">
              <span>H0</span>
              <strong>Moneda de referencia</strong>
              <p>Representa el mundo en el que no hay un sesgo relevante. Parte de p = {formatProbability(p0)}.</p>
            </article>
            <article className="hypothesis-card alt">
              <span>H1</span>
              <strong>Moneda trucada</strong>
              <p>Representa el mundo en el que la moneda favorece caras. Aquí la alternativa usa p = {formatProbability(p1)}.</p>
            </article>
          </div>
        </div>
      </header>

      <section className="experiment-brief panel">
        <div className="brief-intro">
          <p className="section-tag">Antes de empezar</p>
          <h2>Qué vamos a hacer y qué significan H0 y H1</h2>
          <p>
            El experimento consiste en elegir una moneda, lanzarla <strong>n</strong> veces y contar cuántas caras aparecen. Con ese recuento decidimos si los datos son compatibles con la moneda de referencia o si hay evidencia para pensar que la moneda está sesgada.
          </p>
        </div>

        <div className="brief-grid">
          <article className="brief-card">
            <span>La situación</span>
            <strong>Lanzamos una moneda repetidas veces</strong>
            <p>La variable observada es el número de caras. Un resultado extremo hace sospechar que la moneda no se comporta como la de referencia.</p>
          </article>
          <article className="brief-card">
            <span>H0</span>
            <strong>Hipótesis nula</strong>
            <p>Asume que usamos la moneda base. En este momento esa moneda tiene probabilidad de cara {formatProbability(p0)}. Si rechazamos H0 por error, cometemos un error tipo I.</p>
          </article>
          <article className="brief-card">
            <span>H1</span>
            <strong>Hipótesis alternativa</strong>
            <p>Asume que la moneda está trucada y favorece caras con probabilidad {formatProbability(p1)}. Si H1 es cierta y no la detectamos, cometemos un error tipo II.</p>
          </article>
          <article className="brief-card accent">
            <span>La decisión</span>
            <strong>{decisionText}</strong>
            <p>La región crítica depende de alpha. Cuanto más la abras, más fácil es detectar el sesgo, pero mayor es el riesgo de falso positivo.</p>
          </article>
        </div>
      </section>

      <section className="control-room panel">
        <div className="section-line compact">
          <p className="section-tag">Panel de laboratorio</p>
          <h2>Lecturas en tiempo real del experimento</h2>
        </div>
        <div className="instrument-grid">
          <article className="dial-card accent">
            <div className="dial-shell" style={{ ['--fill' as string]: `${actualAlpha * 360}deg`, ['--dial-color' as string]: '#f9423a' }}>
              <div className="dial-core">{formatPercent(actualAlpha, 0)}</div>
            </div>
            <span>error tipo I</span>
            <p>Falso positivo si H0 es cierta.</p>
          </article>
          <article className="dial-card dark">
            <div className="dial-shell" style={{ ['--fill' as string]: `${power * 360}deg`, ['--dial-color' as string]: '#1f1a18' }}>
              <div className="dial-core">{formatPercent(power, 0)}</div>
            </div>
            <span>potencia</span>
            <p>Capacidad para detectar el sesgo.</p>
          </article>
          <article className="dial-card pale">
            <div className="dial-shell" style={{ ['--fill' as string]: `${beta * 360}deg`, ['--dial-color' as string]: '#7d635c' }}>
              <div className="dial-core">{formatPercent(beta, 0)}</div>
            </div>
            <span>error tipo II</span>
            <p>Cuando el sesgo existe pero no lo ves.</p>
          </article>
          <article className="runway-card">
            <div className="runway-head">
              <span>pista de decisión</span>
              <strong>{decisionText}</strong>
            </div>
            <div className="runway">
              <div className="runway-zone" style={{ left: `${thresholdPosition}%` }} />
              <div className="runway-marker h0" style={{ left: `${(expectedHeadsH0 / n) * 100}%` }}>
                <i />
                <span>esperado H0</span>
              </div>
              <div className="runway-marker h1" style={{ left: `${(expectedHeadsH1 / n) * 100}%` }}>
                <i />
                <span>esperado H1</span>
              </div>
              <div className="runway-marker real" style={{ left: `${(expectedHeadsReal / n) * 100}%` }}>
                <i />
                <span>moneda real</span>
              </div>
            </div>
            <div className="runway-scale">
              <span>0 caras</span>
              <span>{n} caras</span>
            </div>
          </article>
        </div>
      </section>

      <main className="main-grid">
        <aside className="control-rail panel">
          <div className="rail-section">
            <p className="section-tag">Paso 1</p>
            <h2>Configura el experimento</h2>
          </div>

          <div className="slider-stack">
            <label className="slider-card">
              <div className="slider-head">
                <span>Probabilidad bajo H0</span>
                <strong>{formatProbability(p0)}</strong>
              </div>
              <input max="0.95" min="0.05" step="0.01" type="range" value={p0} onChange={(event) => handleP0Change(Number(event.target.value))} />
            </label>

            <label className="slider-card">
              <div className="slider-head">
                <span>Probabilidad bajo H1</span>
                <strong>{formatProbability(p1)}</strong>
              </div>
              <input max="0.99" min={Math.min(0.99, p0 + 0.02)} step="0.01" type="range" value={p1} onChange={(event) => handleP1Change(Number(event.target.value))} />
            </label>

            <label className="slider-card">
              <div className="slider-head">
                <span>Tamaño muestral n</span>
                <strong>{n}</strong>
              </div>
              <input max="80" min="4" step="1" type="range" value={n} onChange={(event) => setN(Number(event.target.value))} />
            </label>

            <label className="slider-card">
              <div className="slider-head">
                <span>Alpha nominal</span>
                <strong>{formatProbability(alpha)}</strong>
              </div>
              <input max="0.2" min="0.01" step="0.005" type="range" value={alpha} onChange={(event) => setAlpha(Number(event.target.value))} />
            </label>

            <label className="slider-card">
              <div className="slider-head">
                <span>Potencia objetivo</span>
                <strong>{formatPercent(targetPower, 0)}</strong>
              </div>
              <input max="0.99" min="0.5" step="0.01" type="range" value={targetPower} onChange={(event) => setTargetPower(Number(event.target.value))} />
            </label>
          </div>

          <div className="rail-note">
            <span>Resumen rápido</span>
            <strong>{sampleSizeText}</strong>
            <p>{actualAlphaText}</p>
          </div>
        </aside>

        <section className="stage">
          <section className="metrics-board panel">
            <div className="section-line">
              <p className="section-tag">Paso 2</p>
              <h2>Lee el contraste antes de simular</h2>
            </div>

            <div className="metric-row">
              <article className="metric-tile accent">
                <span>Error tipo I</span>
                <strong>{formatPercent(actualAlpha)}</strong>
                <p>Probabilidad de rechazar H0 siendo cierta.</p>
              </article>
              <article className="metric-tile dark">
                <span>Potencia</span>
                <strong>{formatPercent(power)}</strong>
                <p>Probabilidad de detectar el sesgo si H1 es real.</p>
              </article>
              <article className="metric-tile pale">
                <span>Error tipo II</span>
                <strong>{formatPercent(beta)}</strong>
                <p>Lo que se escapa cuando H1 existe pero no la detectas.</p>
              </article>
              <article className="metric-tile rule">
                <span>Decisión</span>
                <strong>{decisionText}</strong>
                <p>Este corte define la zona crítica del test.</p>
              </article>
            </div>
          </section>

          <section className="visual-grid">
            <article className="panel chart-card">
              <div className="section-line compact">
                <p className="section-tag">Paso 3</p>
                <h2>Dónde se separan H0 y H1</h2>
              </div>
              <p className="chart-lead">Coral: probabilidades bajo H0. Negro: probabilidades bajo H1. Fondo coral: región de rechazo.</p>
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
                      {heads % tickStep === 0 || heads === n ? <span className="bin-label">{heads}</span> : <span className="bin-label faint">.</span>}
                    </div>
                  )
                })}
              </div>
              <div className="legend-row">
                <span><i className="legend-swatch h0" />H0</span>
                <span><i className="legend-swatch h1" />H1</span>
                <span><i className="legend-swatch critical" />Rechazo</span>
              </div>
            </article>

            <article className="panel concept-card">
              <div className="section-line compact">
                <p className="section-tag">Paso 4</p>
                <h2>Qué cambia al mover cada control</h2>
              </div>
              <div className="concept-list">
                <div className="concept-item">
                  <span>Si H1 se acerca a H0</span>
                  <strong>sube beta</strong>
                  <p>Las dos distribuciones se pisan más y el test distingue peor.</p>
                </div>
                <div className="concept-item">
                  <span>Si subes alpha</span>
                  <strong>sube potencia</strong>
                  <p>La zona crítica se ensancha, pero también crece el error tipo I.</p>
                </div>
                <div className="concept-item">
                  <span>Si subes n</span>
                  <strong>baja la ambigüedad</strong>
                  <p>Las curvas se separan mejor y la decisión se vuelve más estable.</p>
                </div>
              </div>

              <div className="power-box">
                <div className="power-head">
                  <span>Curva de potencia</span>
                  <strong>Objetivo {formatPercent(targetPower, 0)}</strong>
                </div>
                <svg className="power-curve" viewBox="0 0 360 210" role="img" aria-label="Curva de potencia según n">
                  <line className="guide-line" x1="18" x2="342" y1="176" y2="176" />
                  <line className="guide-line target" x1="18" x2="342" y1={176 - targetPower * 136} y2={176 - targetPower * 136} />
                  <polyline
                    className="curve-line"
                    fill="none"
                    points={powerCurve
                      .map((point, index) => {
                        const x = 18 + (index / Math.max(powerCurve.length - 1, 1)) * 324
                        const y = 176 - point.power * 136
                        return `${x},${y}`
                      })
                      .join(' ')}
                  />
                  {powerCurve.map((point, index) => {
                    const x = 18 + (index / Math.max(powerCurve.length - 1, 1)) * 324
                    const y = 176 - point.power * 136
                    const active = point.n === n
                    return <circle key={point.n} className={active ? 'curve-point active' : 'curve-point'} cx={x} cy={y} r={active ? 5 : 2.5} />
                  })}
                </svg>
                <p>{sampleSizeText}</p>
              </div>
            </article>
          </section>

          <section className="panel lab-card">
            <div className="lab-top">
              <div className="section-line compact">
                <p className="section-tag">Paso 5</p>
                <h2>Compruébalo con simulación</h2>
              </div>
              <div className="mode-row">
                <button className={coinMode === 'null' ? 'mode-chip active' : 'mode-chip'} onClick={() => setCoinMode('null')} type="button">Moneda H0</button>
                <button className={coinMode === 'alternative' ? 'mode-chip active' : 'mode-chip'} onClick={() => setCoinMode('alternative')} type="button">Moneda H1</button>
                <button className={coinMode === 'custom' ? 'mode-chip active' : 'mode-chip'} onClick={() => setCoinMode('custom')} type="button">Personalizada</button>
                {coinMode === 'custom' ? (
                  <label className="custom-field">
                    <span>p real</span>
                    <input max="0.99" min="0.01" step="0.01" type="number" value={customP} onChange={(event) => setCustomP(clampProbability(Number(event.target.value)))} />
                  </label>
                ) : null}
              </div>
            </div>

            <div className="lab-banner">
              <div>
                <span>Moneda real</span>
                <strong>{actualCoinLabel} - p = {formatProbability(actualP)}</strong>
              </div>
              <div>
                <span>Experimentos repetidos</span>
                <strong>{batchRuns}</strong>
              </div>
              <label className="batch-slider">
                <span>Ajustar repeticiones</span>
                <input max="1200" min="50" step="50" type="range" value={batchRuns} onChange={(event) => setBatchRuns(Number(event.target.value))} />
              </label>
            </div>

            <div className="action-row">
              <button className="action-button primary" onClick={launchSingleExperiment} type="button">Un experimento</button>
              <button className="action-button secondary" onClick={launchBatchExperiment} type="button">Muchos experimentos</button>
            </div>

            <div className="lab-results">
              <article className="result-panel single">
                <span className="result-tag">Muestra concreta</span>
                {visibleTrialResult ? (
                  <>
                    <h3>{visibleTrialResult.reject ? 'La muestra cae en rechazo' : 'La muestra no llega a rechazo'}</h3>
                    <p>
                      Han salido <strong>{visibleTrialResult.heads}</strong> caras de <strong>{n}</strong>. El p-valor unilateral es <strong>{visibleTrialResult.pValue.toFixed(4)}</strong>.
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
                  <>
                    <h3>Una sola muestra puede engañarte</h3>
                    <p>Ejecuta un experimento y observa si, por azar, entra o no en la región crítica.</p>
                  </>
                )}
              </article>

              <article className="result-panel batch">
                <span className="result-tag">Frecuencia a largo plazo</span>
                {visibleBatchResult ? (
                  <>
                    <h3>{formatPercent(visibleBatchResult.rate)} de rechazos observados</h3>
                    <p>
                      En <strong>{visibleBatchResult.experiments}</strong> simulaciones se rechazó H0 en <strong>{visibleBatchResult.rejections}</strong> ocasiones. Así se ve empíricamente el error tipo I o la potencia.
                    </p>
                    <div className="batch-stats">
                      <div>
                        <span>Media de caras</span>
                        <strong>{visibleBatchResult.averageHeads.toFixed(2)}</strong>
                      </div>
                      <div>
                        <span>Valor teórico esperado</span>
                        <strong>{coinMode === 'null' ? formatPercent(actualAlpha) : coinMode === 'alternative' ? formatPercent(power) : 'depende de p real'}</strong>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <h3>Alpha y potencia son frecuencias, no una muestra</h3>
                    <p>Al repetir muchas veces ves que la teoría describe proporciones de decisiones a largo plazo.</p>
                  </>
                )}
              </article>
            </div>
          </section>
        </section>
      </main>
    </div>
  )
}

export default App
