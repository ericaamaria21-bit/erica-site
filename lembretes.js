// Lembretes por notificação (ntfy). Roda no GitHub Actions, sem servidor pago.
// modo "manha": agenda de hoje + pendências | modo "pendentes": só avisa se houver pedido aguardando horário
const { FIREBASE_API_KEY: KEY, FIREBASE_PROJECT_ID: PID, LOGIN_EMAIL: EMAIL, LOGIN_SENHA: PASS, NTFY_TOPIC_PRIVADO: TOPIC } = process.env;
const mode = process.argv[2] || 'manha';
if (!KEY || !PID || !EMAIL || !PASS || !TOPIC) { console.error('Faltam segredos no GitHub (veja as instruções).'); process.exit(1); }

const fromFS = (v) => !v ? null : 'stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue)
  : 'booleanValue' in v ? v.booleanValue : 'arrayValue' in v ? (v.arrayValue.values || []).map(fromFS)
  : 'mapValue' in v ? fields(v.mapValue.fields || {}) : null;
const fields = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fromFS(v)]));
const dBR = (d) => String(d).split('-').reverse().join('/');
const hm = (t, m) => { const [h, mi] = t.split(':').map(Number); const e = h * 60 + mi + (m || 0); return String(Math.floor(e / 60)).padStart(2, '0') + ':' + String(e % 60).padStart(2, '0'); };

(async () => {
  const login = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS, returnSecureToken: true }) });
  const lj = await login.json();
  if (!login.ok) { console.error('Login falhou:', lj.error && lj.error.message); process.exit(1); }
  const q = await fetch(`https://firestore.googleapis.com/v1/projects/${PID}/databases/(default)/documents:runQuery`, {
    method: 'POST', headers: { Authorization: `Bearer ${lj.idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'solicitacoes' }], limit: 1000 } }) });
  if (!q.ok) { console.error('Leitura falhou:', q.status, await q.text()); process.exit(1); }
  const rows = (await q.json()).filter((x) => x.document).map((x) => fields(x.document.fields || {}));

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' });
  const appts = [];
  rows.forEach((x) => {
    const names = (x.services || []).map((v) => v.name).join(', ');
    if (x.status === 'confirmado' && x.appointmentDate === today && x.startTime)
      appts.push({ t: x.startTime, e: hm(x.startTime, x.durationMin || 0), n: x.clientName, l: names });
    if (x.maintStatus === 'confirmado' && x.maintDate === today && x.maintTime)
      appts.push({ t: x.maintTime, e: hm(x.maintTime, x.maintDur || 0), n: x.clientName, l: 'Manutenção — ' + names });
  });
  appts.sort((a, b) => a.t.localeCompare(b.t));
  const nNovos = rows.filter((x) => x.status === 'novo').length;
  const nMan = rows.filter((x) => x.maintenance && (x.maintStatus || 'novo') === 'novo' && x.status !== 'cancelado').length;
  const pend = [];
  if (nNovos) pend.push(`⏳ ${nNovos} ${nNovos === 1 ? 'pedido aguardando horário' : 'pedidos aguardando horário'}`);
  if (nMan) pend.push(`⏳ ${nMan} ${nMan === 1 ? 'manutenção aguardando horário' : 'manutenções aguardando horário'}`);

  let title, message;
  if (mode === 'pendentes') {
    if (!pend.length) { console.log('Nada pendente; sem aviso.'); return; }
    title = 'Aguardando confirmação'; message = pend.join('\n') + '\nAbra o painel para combinar o horário.';
  } else {
    title = `Agenda de hoje (${dBR(today)})`;
    const l = appts.length ? appts.map((a) => `${a.t}–${a.e}  ${a.n} · ${a.l}`) : ['Nenhum atendimento hoje.'];
    message = [...l, ...(pend.length ? ['', ...pend] : [])].join('\n');
  }
  const r = await fetch('https://ntfy.sh/', { method: 'POST', body: JSON.stringify({ topic: TOPIC, title, message, tags: ['calendar'] }) });
  console.log('ntfy:', r.status);
})().catch((e) => { console.error(e); process.exit(1); });
