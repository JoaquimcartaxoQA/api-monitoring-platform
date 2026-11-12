export type Event = {
  timestamp:string; method:string; status:number; endpoint:string;
  requestId:string | null; durationMs:number | null;
  log:{timestamp:string; operation:string; method:string; status:number; requestId?:string; durationMs?:number};
};
export type Page = {
  items:Event[]; page:number; totalPages:number; total:number; view:string; malformed:number;
};
export type Status = {state:'available' | 'degraded' | 'empty'; events:number; errors:number};

export class ApiError extends Error {
  constructor(public status:number) { super('HTTP ' + status); }
}

export async function api<T>(path:string, options:RequestInit = {}):Promise<T> {
  const base = import.meta.env.VITE_API_ORIGIN || '';
  const response = await fetch(base + '/api' + path, {credentials:'include', cache:'no-store', ...options});
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<T>;
}

export function post<T>(path:string, data:object) {
  return api<T>(path, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
}

export function eventStream(path:string) {
  const base = import.meta.env.VITE_API_ORIGIN || '';
  return new EventSource(base + '/api' + path, {withCredentials:true});
}
