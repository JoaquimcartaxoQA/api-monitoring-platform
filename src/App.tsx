import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, eventStream, post, type Event, type Page, type Status } from './api';
import './style.css';

const statusNames = {available:'Dados disponíveis', empty:'Sem eventos', degraded:'Dados inválidos'};
const stamp = (value:string) => new Intl.DateTimeFormat('pt-BR', {
  dateStyle:'short', timeStyle:'medium', timeZone:'UTC'
}).format(new Date(value));

function PublicStatus({revision}:{revision:number}) {
  const [status,setStatus] = useState<Status>();
  const [error,setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function refresh() {
      try {
        setStatus(await api<Status>('/status', {signal:controller.signal}));
        setError(false);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally { /* A próxima consulta ocorre somente por ação ou evento de log. */ }
    }
    void refresh();
    return () => controller.abort();
  },[revision]);
  return <section aria-labelledby="status-title">
    <div className="section-head"><h2 id="status-title">Status público</h2><span>Janela de 7 dias · UTC</span></div>
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="metric"><span>Fonte de logs</span><strong role="status">{error ? 'Indisponível' : status ? statusNames[status.state] : 'Consultando…'}</strong></div>
      <div className="metric"><span>Eventos</span><strong>{error ? '—' : status?.events ?? '—'}</strong></div>
      <div className="metric"><span>Erros HTTP 5xx</span><strong>{error ? '—' : status?.errors ?? '—'}</strong></div>
    </div>
  </section>;
}

function Login({onLogin}:{onLogin:()=>void}) {
  const [message,setMessage] = useState('');
  const [busy,setBusy] = useState(false);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setMessage('');
    try {
      await post('/session',{user:data.get('user'),password:data.get('password')});
      onLogin();
    } catch (error) {
      setMessage(error instanceof ApiError && error.status === 401 ? 'Usuário ou senha inválidos.' :
        error instanceof ApiError && error.status === 429 ? 'Muitas tentativas. Aguarde um minuto.' : 'Não foi possível entrar.');
    } finally { setBusy(false); }
  }
  return <section className="panel mt-8 max-w-lg" aria-labelledby="login-title">
    <h2 id="login-title">Acesso aos logs</h2>
    <form className="mt-4 grid gap-4" onSubmit={submit}>
      <label>Usuário<input name="user" autoComplete="username" maxLength={100} required /></label>
      <label>Senha<input name="password" type="password" autoComplete="current-password" maxLength={256} required /></label>
      {message && <p role="alert">{message}</p>}
      <button className="primary justify-self-start" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
    </form>
  </section>;
}

function Detail({item,onClose,onCorrelate}:{item:Event;onClose:()=>void;onCorrelate:(id:string)=>void}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); },[]);
  return <dialog ref={ref} onClose={onClose} aria-labelledby="detail-title">
    <h2 id="detail-title">Detalhes do evento</h2>
    <dl className="my-5 grid gap-3">
      <div><dt>Horário UTC</dt><dd>{stamp(item.timestamp)}</dd></div>
      <div><dt>Operação</dt><dd>{item.method} {item.endpoint}</dd></div>
      <div><dt>Status HTTP</dt><dd>{item.status}</dd></div>
      <div><dt>Duração</dt><dd>{item.durationMs === null ? 'Não registrada' : item.durationMs + ' ms'}</dd></div>
      <div><dt>Request ID</dt><dd className="break-all font-mono">{item.requestId ?? 'Não registrado'}</dd></div>
      <div><dt>Log capturado</dt><dd><pre className="log-record" aria-label="Log capturado">{JSON.stringify(item.log,null,2)}</pre></dd></div>
    </dl>
    <div className="flex flex-wrap gap-2">
      {item.requestId && <button className="primary" onClick={() => { onCorrelate(item.requestId!); ref.current?.close(); }}>Correlacionar eventos</button>}
      <button onClick={() => ref.current?.close()}>Fechar</button>
    </div>
  </dialog>;
}

function Logs({onExpired,onLogChange}:{onExpired:()=>void;onLogChange:()=>void}) {
  const [page,setPage] = useState<Page>();
  const [draft,setDraft] = useState('');
  const [query,setQuery] = useState({filter:'',page:1,view:''});
  const [item,setItem] = useState<Event>();
  const [message,setMessage] = useState('');
  const [busy,setBusy] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    let initial = true;
    async function refresh() {
      const params = new URLSearchParams({page:String(query.page)});
      if (query.filter) params.set('requestId',query.filter);
      if (query.view && (initial || query.page > 1)) params.set('view',query.view);
      initial = false;
      try {
        const data = await api<Page>('/logs?' + params,{signal:controller.signal});
        if (!controller.signal.aborted) { setPage(data); setMessage(''); }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) onExpired();
        else setMessage(error instanceof ApiError && error.status === 400 ? 'Informe um Request ID UUID v4 válido.' :
          error instanceof ApiError && error.status === 409 ? 'A consulta expirou. Atualize a lista.' :
          'Falha ao consultar os logs. Os dados exibidos podem estar desatualizados.');
      } finally { if (!controller.signal.aborted) setBusy(false); }
    }
    void refresh();
    return () => controller.abort();
  },[query,onExpired]);
  useEffect(() => {
    const stream = eventStream('/events');
    const onChange = () => {
      setQuery(current => ({...current,page:1,view:''}));
      onLogChange();
    };
    stream.addEventListener('logs_changed', onChange);
    return () => stream.close();
  },[onLogChange]);
  function navigate(next:number, filter = query.filter, view = '') {
    setBusy(true);
    setMessage('');
    if (filter !== query.filter) setPage(undefined);
    setQuery({page:next,filter,view});
  }
  return <section className="mt-8" aria-labelledby="logs-title">
    <div className="section-head"><h2 id="logs-title">Eventos da API</h2><span>Atualização ao concluir a requisição</span></div>
    <form className="panel flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); navigate(1,draft.trim()); }}>
      <label className="min-w-0 grow">Request ID<input value={draft} onChange={event => setDraft(event.target.value)} maxLength={36} placeholder="UUID da requisição" /></label>
      <button className="primary" disabled={busy}>Buscar</button>
      <button type="button" disabled={busy} onClick={() => { setDraft(''); navigate(1,''); }}>Limpar</button>
      <button type="button" disabled={busy} onClick={() => navigate(1)}>Atualizar</button>
    </form>
    {message && <p className="notice" role="alert">{message}</p>}
    {page && page.malformed > 0 && <p className="notice" role="status">{page.malformed} linhas inválidas ignoradas na janela de consulta.</p>}
    {busy && <p className="notice" role="status">Consultando eventos…</p>}
    {page && <>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabela de eventos">
        <table>
          <thead><tr><th scope="col">Horário UTC</th><th scope="col">Operação</th><th scope="col">HTTP</th><th scope="col">Request ID</th><th scope="col">Inspeção</th></tr></thead>
          <tbody>{page.items.map((row,index) => <tr key={index}>
            <td className="whitespace-nowrap">{stamp(row.timestamp)}</td><td>{row.method} {row.endpoint}</td>
            <td><span className={row.status >= 400 ? 'code bad' : 'code'}>{row.status}</span></td>
            <td className="font-mono text-xs">{row.requestId ?? '—'}</td>
            <td><button onClick={() => setItem(row)} aria-label={'Ver evento ' + (index + 1)}>Ver evento</button></td>
          </tr>)}
          {!page.items.length && <tr><td colSpan={5}>Nenhum evento encontrado.</td></tr>}</tbody>
        </table>
      </div>
      <nav className="mt-3 flex flex-wrap items-center gap-2" aria-label="Paginação">
        <button disabled={busy || page.page === 1} onClick={() => navigate(page.page - 1,query.filter,page.view)}>Anterior</button>
        <span>Página {page.page} de {page.totalPages} · {page.total} eventos</span>
        <button disabled={busy || page.page === page.totalPages} onClick={() => navigate(page.page + 1,query.filter,page.view)}>Próxima</button>
      </nav>
    </>}
    {item && <Detail item={item} onClose={() => setItem(undefined)} onCorrelate={id => {setDraft(id);navigate(1,id);}} />}
  </section>;
}

export default function App() {
  const [auth,setAuth] = useState<boolean>();
  const [logoutError,setLogoutError] = useState('');
  const [logRevision,setLogRevision] = useState(0);
  const expire = useCallback(() => { setAuth(false); },[]);
  useEffect(() => {
    const controller = new AbortController();
    api<{authenticated:boolean}>('/session',{signal:controller.signal})
      .then(result => setAuth(result.authenticated))
      .catch(() => { if (!controller.signal.aborted) setAuth(false); });
    return () => controller.abort();
  },[]);
  async function logout() {
    try {
      await post('/logout',{});
      setLogoutError('');
      setAuth(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setAuth(false);
      else setLogoutError('Não foi possível encerrar a sessão.');
    }
  }
  return <main className="mx-auto max-w-6xl px-4 pb-12 sm:px-8">
    <header className="flex flex-wrap items-center justify-between gap-4 py-7">
      <h1>Monitor de APIs</h1>
      {auth && <button onClick={() => void logout()}>Sair</button>}
    </header>
    {logoutError && <p role="alert">{logoutError}</p>}
    <PublicStatus revision={logRevision} />
    {auth === undefined ? <p className="notice" role="status">Verificando sessão…</p> :
      auth ? <Logs onExpired={expire} onLogChange={() => setLogRevision(current => current + 1)} /> : <Login onLogin={() => setAuth(true)} />}
  </main>;
}
