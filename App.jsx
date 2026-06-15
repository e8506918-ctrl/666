import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'];
const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'];

function calcRSI(closes, period = 14) {
  const rsi = new Array(closes.length).fill(null);
  if (closes.length <= period) return rsi;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

function buildVolumeProfile(candles, bins = 15) {
  if (!candles.length) return [];
  const highs = candles.map(c => c.high), lows = candles.map(c => c.low);
  const max = Math.max(...highs), min = Math.min(...lows), step = (max - min) / bins || 1;
  const profile = Array.from({ length: bins }, (_, i) => ({ priceFrom: min + i * step, priceTo: min + (i + 1) * step, volume: 0 }));
  candles.forEach(c => {
    let idx = Math.floor((((c.high + c.low) / 2) - min) / step);
    if (idx >= bins) idx = bins - 1;
    if (idx >= 0) profile[idx].volume += c.volume;
  });
  return profile;
}

export default function CryptoDashboard() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setIntervalValue] = useState('15m');
  const [candles, setCandles] = useState([]);
  const [orderBook, setOrderBook] = useState({ bids: [], asks: [] });
  const [strategy, setStrategy] = useState('counter');

  const svgRef = useRef(null);

  const fetchData = useCallback(async () => {
    try {
      const kRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=120`);
      const kData = await kRes.json();
      setCandles(kData.map(k => ({ time: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]) })));
      
      const dRes = await fetch(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=15`);
      const dData = await dRes.json();
      setOrderBook({
        bids: dData.bids.map(b => ({ price: parseFloat(b[0]), qty: parseFloat(b[1]) })),
        asks: dData.asks.map(a => ({ price: parseFloat(a[0]), qty: parseFloat(a[1]) }))
      });
    } catch (e) { console.error(e); }
  }, [symbol, interval]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 30000);
    return () => clearInterval(id);
  }, [fetchData]);

  const closes = useMemo(() => candles.map(c => c.close), [candles]);
  const rsi = useMemo(() => calcRSI(closes), [closes]);
  const volumeProfile = useMemo(() => buildVolumeProfile(candles), [candles]);
  const lastPrice = candles.length ? candles[candles.length - 1].close : null;

  const setup = useMemo(() => {
    if (candles.length < 20 || !lastPrice) return null;
    const recent = candles.slice(-20);
    const minPrice = Math.min(...recent.map(c => c.low));
    const maxPrice = Math.max(...recent.map(c => c.high));
    const currentRSI = rsi[rsi.length - 1] || 50;

    let dir = 'WATCH', tvh = lastPrice, sl = 0, tp = 0, note = 'Очікування умов...';

    if (strategy === 'counter') {
      if (currentRSI < 33) {
        dir = 'LONG'; sl = minPrice * 0.995; tp = tvh + (tvh - sl) * 2.5;
        note = 'RSI в зоні перепроданості. Розраховано відскок від локального дна.';
      } else if (currentRSI > 67) {
        dir = 'SHORT'; sl = maxPrice * 1.005; tp = tvh - (sl - tvh) * 2.5;
        note = 'RSI в зоні перегрітості. Очікується технічний шорт від хаю.';
      } else { note = 'Ринковий шум. RSI в нейтральній зоні, утримуйтесь від угод.'; }
    } else {
      const last = candles[candles.length - 1];
      if (last.close > last.open && last.volume > (candles[candles.length - 2]?.volume || 1) * 1.5) {
        dir = 'LONG'; sl = last.low; tp = tvh + (tvh - sl) * 2;
        note = 'Імпульсний бичачий пробій на об\'ємах. Вхід по тренду.';
      } else if (last.close < last.open && last.volume > (candles[candles.length - 2]?.volume || 1) * 1.5) {
        dir = 'SHORT'; sl = last.high; tp = tvh - (sl - tvh) * 2;
        note = 'Медвежий імпульс вниз на об\'ємах. Розрахунок продовження тренду.';
      } else { note = 'Немає сильного пробійного об\'єму для входу в тренд.'; }
    }
    return { dir, tvh, sl, tp, note };
  }, [candles, lastPrice, rsi, strategy]);

  const W = 900, H = 400, PAD = { top: 20, right: 60, bottom: 20, left: 10 };
  
  const priceBounds = useMemo(() => {
    if (!candles.length) return { min: 0, max: 1 };
    const arr = [...candles.map(c => c.high), ...candles.map(c => c.low)];
    if (setup && setup.dir !== 'WATCH') arr.push(setup.sl, setup.tp);
    return { min: Math.min(...arr) * 0.997, max: Math.max(...arr) * 1.003 };
  }, [candles, setup]);

  const xS = (i) => PAD.left + (i / Math.max(candles.length - 1, 1)) * (W - PAD.left - PAD.right);
  const yS = (p) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - (p - priceBounds.min) / (priceBounds.max - priceBounds.min || 1));

  return (
    <div className="min-h-screen bg-[#0b0e14] text-[#e6e8ec] p-4 font-sans selection:bg-gray-700">
      <header className="mb-4 flex flex-wrap justify-between items-center gap-2 border-b border-[#2d333b] pb-3">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Ринковий Аналізатор ТВХ</h1>
          <p className="text-xs text-[#7d8590]">Математичні рівні та структура на основі API Binance</p>
        </div>
        <div className="flex gap-2 font-mono">
          <select value={symbol} onChange={e => setSymbol(e.target.value)} className="bg-[#161b22] border border-[#2d333b] rounded p-1 text-sm text-white">
            {SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={interval} onChange={e => setIntervalValue(e.target.value)} className="bg-[#161b22] border border-[#2d333b] rounded p-1 text-sm text-white">
            {INTERVALS.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
          <div className="bg-[#161b22] border border-[#2d333b] rounded px-3 py-1 text-sm font-bold text-[#58a6ff]">{lastPrice?.toFixed(2)}</div>
        </div>
      </header>

      <div className="mb-4 bg-[#11151c] border border-[#2d333b] rounded-md p-4 shadow-xl">
        <div className="flex gap-2 mb-3 border-b border-[#2d333b]/60 pb-2">
          <button onClick={() => setStrategy('counter')} className={`text-xs px-3 py-1.5 rounded font-medium ${strategy === 'counter' ? 'bg-[#58a6ff] text-black font-bold' : 'bg-[#161b22] text-[#c9d1d9]'}`}>Контртренд (RSI)</button>
          <button onClick={() => setStrategy('trend')} className={`text-xs px-3 py-1.5 rounded font-medium ${strategy === 'trend' ? 'bg-[#58a6ff] text-black font-bold' : 'bg-[#161b22] text-[#c9d1d9]'}`}>Пробій Тренду (Volume)</button>
        </div>

        {setup && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center font-mono">
            <div className="bg-[#161b22] p-2 rounded border border-[#2d333b]">
              <div className="text-[10px] text-[#7d8590]">СТРУКТУРА</div>
              <div className={`text-sm font-bold mt-1 ${setup.dir === 'LONG' ? 'text-[#3fb950]' : setup.dir === 'SHORT' ? 'text-[#f85149]' : 'text-gray-400'}`}>{setup.dir}</div>
            </div>
            <div className="bg-[#161b22] p-2 rounded border border-[#2d333b]">
              <div className="text-[10px] text-[#7d8590]">ВХІД (ТВХ)</div>
              <div className="text-sm font-bold text-[#58a6ff] mt-1">{setup.dir !== 'WATCH' ? setup.tvh.toFixed(2) : '—'}</div>
            </div>
            <div className="bg-[#161b22] p-2 rounded border border-[#2d333b]">
              <div className="text-[10px] text-[#7d8590]">STOP LOSS</div>
              <div className="text-sm font-bold text-[#f85149] mt-1">{setup.dir !== 'WATCH' ? setup.sl.toFixed(2) : '—'}</div>
            </div>
            <div className="bg-[#161b22] p-2 rounded border border-[#2d333b]">
              <div className="text-[10px] text-[#7d8590]">TAKE PROFIT</div>
              <div className="text-sm font-bold text-[#3fb950] mt-1">{setup.dir !== 'WATCH' ? setup.tp.toFixed(2) : '—'}</div>
            </div>
          </div>
        )}
        <p className="text-[11px] text-[#7d8590] mt-2 bg-[#161b22]/50 p-2 rounded border border-[#2d333b]/40">⚡ <strong>Логіка:</strong> {setup?.note}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_250px] gap-4">
        <div className="space-y-3">
          <div className="bg-[#11151c] border border-[#2d333b] rounded-md p-2">
            {candles.length === 0 ? <div className="h-[300px] flex items-center justify-center text-xs">Синхронізація з Binance...</div> : (
              <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto max-h-[380px]">
                {[0, 0.25, 0.5, 0.75, 1].map((t, idx) => {
                  const p = priceBounds.max - t * (priceBounds.max - priceBounds.min);
                  return (
                    <g key={idx}>
                      <line x1={PAD.left} x2={W - PAD.right} y1={yS(p)} y2={yS(p)} stroke="#1c2129" strokeWidth="1" />
                      <text x={W - PAD.right + 5} y={yS(p) + 4} fontSize="10" fill="#7d8590">{p.toFixed(2)}</text>
                    </g>
                  );
                })}

                {setup && setup.dir !== 'WATCH' && (
                  <g>
                    <line x1={PAD.left} x2={W - PAD.right} y1={yS(setup.tvh)} y2={yS(setup.tvh)} stroke="#58a6ff" strokeWidth="1" strokeDasharray="3 3" />
                    <line x1={PAD.left} x2={W - PAD.right} y1={yS(setup.sl)} y2={yS(setup.sl)} stroke="#f85149" strokeWidth="1.2" strokeDasharray="4 4" />
                    <line x1={PAD.left} x2={W - PAD.right} y1={yS(setup.tp)} y2={yS(setup.tp)} stroke="#3fb950" strokeWidth="1.2" strokeDasharray="4 4" />
                  </g>
                )}

                {candles.map((c, i) => {
                  const x = xS(i), isUp = c.close >= c.open, col = isUp ? '#3fb950' : '#f85149';
                  return (
                    <g key={i}>
                      <line x1={x} x2={x} y1={yS(c.high)} y2={yS(c.low)} stroke={col} strokeWidth="1" />
                      <rect x={x - 2} y={Math.min(yS(c.open), yS(c.close))} width={4} height={Math.max(1, Math.abs(yS(c.open) - yS(c.close)))} fill={col} />
                    </g>
                  );
                })}
              </svg>
            )}
          </div>

          <div className="bg-[#11151c] border border-[#2d333b] rounded-md p-2">
            <p className="text-[10px] text-[#7d8590] mb-1">RSI Oscillator</p>
            <svg viewBox={`0 0 ${W} 60`} className="w-full h-[50px]">
              <line x1={PAD.left} x2={W - PAD.right} y1={18} y2={18} stroke="#2d333b" strokeDasharray="2 2" />
              <line x1={PAD.left} x2={W - PAD.right} y1={42} y2={42} stroke="#2d333b" strokeDasharray="2 2" />
              <polyline fill="none" stroke="#58a6ff" strokeWidth="1.2" points={rsi.map((v, i) => v === null ? null : `${xS(i)},${60 - v * 0.6}`).filter(Boolean).join(' ')} />
            </svg>
          </div>
        </div>

        <div className="space-y-3">
          <div className="bg-[#11151c] border border-[#2d333b] rounded-md p-3">
            <p className="text-xs text-[#7d8590] mb-2 font-medium">Об'єми за рівнями</p>
            <div className="space-y-1 font-mono text-[10px]">
              {volumeProfile.slice().reverse().map((b, i) => (
                <div key={i} className="flex items-center justify-between gap-1">
                  <span className="text-[#7d8590]">{b.priceTo.toFixed(1)}</span>
                  <div className="flex-1 bg-[#1c2129] h-2 rounded overflow-hidden">
                    <div className="h-full bg-[#388bfd]/80" style={{ width: `${Math.min(100, b.volume / 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#11151c] border border-[#2d333b] rounded-md p-3 font-mono text-[11px]">
            <p className="text-xs text-[#7d8590] font-sans mb-2 font-medium">Поточний Спред (Стакан)</p>
            <div className="text-[#f85149] space-y-0.5">
              {orderBook.asks.slice(0, 3).reverse().map((a, i) => <div key={i} className="flex justify-between"><span>{a.price.toFixed(2)}</span><span className="text-gray-500">{a.qty.toFixed(2)}</span></div>)}
            </div>
            <div className="border-t border-[#2d333b] my-1" />
            <div className="text-[#3fb950] space-y-0.5">
              {orderBook.bids.slice(0, 3).map((b, i) => <div key={i} className="flex justify-between"><span>{b.price.toFixed(2)}</span><span className="text-gray-500">{b.qty.toFixed(2)}</span></div>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
