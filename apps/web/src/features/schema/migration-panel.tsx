'use client';
import { useCallback,useEffect,useState } from 'react';
import { migrationChanges,type ManagementToken,type MigrationReview,type SchemaMigration } from '@storypane/core';
import { Button,ErrorNotice } from '@storypane/ui';
import { MigrationReviewDialog } from './migration-review';
import { api,errorMessage,jsonRequest } from '../editor/api';

export function MigrationPanel({canDeploy,onDeploy}:{canDeploy:boolean;onDeploy:()=>Promise<void>}) {
  const [history,setHistory]=useState<SchemaMigration[]|null>(null);
  const [migrations,setMigrations]=useState<SchemaMigration[]>([]),[review,setReview]=useState<MigrationReview|null>(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [tokens,setTokens]=useState<ManagementToken[]>([]),[name,setName]=useState(''),[capability,setCapability]=useState<ManagementToken['capability']>('stage'),[secret,setSecret]=useState('');
  useEffect(()=>{
    const id=new URLSearchParams(window.location.search).get('migration');
    if(!id)return;
    let stopped=false;
    setBusy(true);
    void api<MigrationReview>(`/migrations/${encodeURIComponent(id)}/review?destructive=false`).then(value=>{if(!stopped)setReview(value)}).catch(cause=>{if(!stopped)setError(errorMessage(cause))}).finally(()=>{if(!stopped)setBusy(false)});
    return ()=>{stopped=true};
  },[]);
  const load=useCallback(async()=>{setMigrations(await api<SchemaMigration[]>('/migrations?workspace=true'));setHistory(null);},[]);
  useEffect(()=>{
    let stopped=false;
    const refresh=()=>{if(!document.hidden)void api<SchemaMigration[]>('/migrations?workspace=true').then(value=>{if(!stopped)setMigrations(value)}).catch(cause=>{if(!stopped)setError(errorMessage(cause))})};
    refresh();const timer=setInterval(refresh,5000);window.addEventListener('focus',refresh);
    return ()=>{stopped=true;clearInterval(timer);window.removeEventListener('focus',refresh)};
  },[]);
  useEffect(()=>{if(canDeploy)void api<ManagementToken[]>('/management-tokens').then(setTokens).catch(cause=>setError(errorMessage(cause)))},[canDeploy]);
  const active=migrations.find(item=>item.status==='active'),deployed=migrations.filter(item=>item.status==='deployed').at(-1);
  async function action(work:()=>Promise<void>) {setBusy(true);setError('');try{await work()}catch(cause){setError(errorMessage(cause))}finally{setBusy(false)}}
  const inspect=(id:string,destructive=false)=>action(async()=>setReview(await api<MigrationReview>(`/migrations/${id}/review?destructive=${destructive}`)));
  function closeReview() {
    setReview(null);
    const url=new URL(window.location.href);url.searchParams.delete('migration');
    window.history.replaceState(window.history.state,'',url);
  }
  return <section className="panel migration-panel" aria-label="Schema migrations">
    <header className="panel-heading"><div><h2>Schema migrations {active && <span className="pill">Active v{active.version}</span>}</h2><p className="field-hint">{deployed?.version ? `Deployed migration ${deployed.version}` : 'Initial migration needs deployment'}{active ? ` · Migration ${active.version} is active` : ' · No pending changes'}</p></div>
      {active && <Button disabled={busy} onClick={()=>void inspect(active.id)}>Review migration {active.version}</Button>}
    </header>
    <div className="panel-body">
      <ErrorNotice message={error} />
      {active && <p className="migration-staging-note">Changes are shared in the active migration. Review their impact, then deploy to update page editing and delivery for everyone.</p>}
      <details onToggle={event=>{if(event.currentTarget.open && !history)void api<SchemaMigration[]>('/migrations').then(setHistory).catch(cause=>setError(errorMessage(cause)))}}><summary>Migration history ({deployed?.version ?? 0})</summary>
        {(history ?? []).filter(item=>item.status==='deployed' && item.version>0).reverse().map(item=><details key={item.id}><summary>Migration {item.version}: {item.name} · {item.deployedAt && new Date(item.deployedAt).toLocaleString()}{item.destructive?' · Destructive deployment':''}</summary><p>Deployed by {item.deployedBy ?? 'setup'}. Contributors: {item.contributors.join(', ') || 'setup'}.</p><ul>{migrationChanges(history?.find(old=>old.version===item.baseVersion)?.definitions ?? [],item.definitions).map((change,index)=><li key={index}>{change.definition}{change.field?`.${change.field}`:''}: {change.kind}</li>)}</ul></details>)}
      </details>
      {canDeploy && <details><summary>CLI & CI access tokens</summary><p className="field-hint">Use a token as STORYPANE_MANAGEMENT_TOKEN. Tokens are scoped to this space and can be revoked here.</p>
        {secret && <label className="field">Copy this token now<input readOnly aria-label="New management token" value={secret} onFocus={event=>event.target.select()} /></label>}
        <form className="delivery-token-form" onSubmit={event=>{event.preventDefault();void action(async()=>{const result=await api<ManagementToken & {token:string}>('/management-tokens',jsonRequest('POST',{name,capability}));setSecret(result.token);setTokens(items=>[...items,result]);setName('')})}}>
          <label className="field">Token name<input required maxLength={80} value={name} onChange={event=>setName(event.target.value)} /></label>
          <label className="field">Capability<select value={capability} onChange={event=>setCapability(event.target.value as ManagementToken['capability'])}><option value="read">Read migrations</option><option value="stage">Read and stage</option><option value="deploy">Read, stage, and deploy</option></select></label>
          <Button type="submit" disabled={busy || !name.trim()}>Create management token</Button>
        </form>
        <ul className="delivery-token-list">{tokens.map(token=><li key={token.id}><span>{token.name} · {token.capability}</span><Button disabled={busy} onClick={()=>{if(window.confirm(`Revoke “${token.name}”?`))void action(async()=>{await api(`/management-tokens/${token.id}`,{method:'DELETE'});setTokens(items=>items.filter(item=>item.id!==token.id));setSecret('')})}}>Revoke</Button></li>)}</ul>
      </details>}
    </div>
    <MigrationReviewDialog review={review} busy={busy} error={error} canDeploy={canDeploy} onClose={()=>{if(!busy)closeReview()}}
      onInspect={destructive=>{if(review)void inspect(review.migration.id,destructive)}}
      onDeploy={confirmation=>{if(review)void action(async()=>{
        await api(`/migrations/${review.migration.id}/deploy`,jsonRequest('POST',{reviewToken:review.token,destructive:review.destructive,confirmation}));
        closeReview();await load();await onDeploy();
      })}} />
  </section>;
}
