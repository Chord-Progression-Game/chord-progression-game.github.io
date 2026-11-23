// ゲームの部品のテスト用の、ごく小さな道具。結果は、ページの <pre id="__result"> に JSON で書く（Python が読む）。
export function createT() {
  const t = { checks: 0, fails: 0, failures: [], logs: [] };
  t.eq = (label, got, want) => {
    t.checks++;
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g !== w) { t.fails++; t.failures.push(`${label}: got ${g} want ${w}`); }
  };
  t.ok = (label, cond) => { t.checks++; if (!cond) { t.fails++; t.failures.push(label); } };
  t.log = (s) => t.logs.push(String(s));
  return t;
}

export async function runSuite(name) {
  const t = createT();
  try {
    const mod = await import(`./${name}.test.js`);
    await mod.run(t);
  } catch (err) {
    t.fails++; t.failures.push(`例外: ${err && err.stack ? err.stack : err}`);
  }
  const pre = document.createElement('pre');
  pre.id = '__result';
  pre.textContent = JSON.stringify({ suite: name, checks: t.checks, fails: t.fails, failures: t.failures.slice(0, 40), logs: t.logs.slice(0, 80) });
  document.body.appendChild(pre);
}
