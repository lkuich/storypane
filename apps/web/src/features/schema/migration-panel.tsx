'use client';
import { useCallback,useEffect,useState } from 'react';
import { migrationChanges,type ManagementToken,type MigrationReview,type SchemaMigration } from '@storypane/core';
import { Button,ErrorNotice,Modal } from '@storypane/ui';
import { api,errorMessage,jsonRequest } from '../editor/api';

export function MigrationPanel({canDeploy,onDeploy}:{canDeploy:boolean;onDeploy:()=>Promise<void>}) {
  const [history,setHistory]=useState<SchemaMigration[]|null>(null);
  const [migrations,setMigrations]=useState<SchemaMigration[]>([]),[review,setReview]=useState<MigrationReview|null>(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [tokens,setTokens]=useState<ManagementToken[]>([]),[name,setName]=useState(''),[capability,setCapability]=useState<ManagementToken['capability']>('stage'),[secret,setSecret]=useState('');
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
  const inspect=(id:string)=>action(async()=>setReview(await api<MigrationReview>(`/migrations/${id}/review`)));
  return <section className="panel migration-panel" aria-label="Schema migrations">
    <header className="panel-heading"><div><h2>Schema migrations</h2><p className="field-hint">{deployed?.version ? `Deployed migration ${deployed.version}` : 'Initial migration needs deployment'}{active ? ` · Migration ${active.version} is active` : ' · No pending changes'}</p></div>
      {active && <Button disabled={busy} onClick={()=>void inspect(active.id)}>Review migration {active.version}</Button>}
    </header>
    <div className="panel-body">
      <ErrorNotice message={error} />
      {active && <p>Schema saves are shared here. Page editing and delivery change when an admin deploys this migration.</p>}
      <details onToggle={event=>{if(event.currentTarget.open && !history)void api<SchemaMigration[]>('/migrations').then(setHistory).catch(cause=>setError(errorMessage(cause)))}}><summary>Migration history ({deployed?.version ?? 0})</summary>
        {(history ?? []).filter(item=>item.status==='deployed' && item.version>0).reverse().map(item=><details key={item.id}><summary>Migration {item.version}: {item.name} · {item.deployedAt && new Date(item.deployedAt).toLocaleString()}</summary><p>Deployed by {item.deployedBy ?? 'setup'}. Contributors: {item.contributors.join(', ') || 'setup'}.</p><ul>{migrationChanges(history?.find(old=>old.version===item.baseVersion)?.definitions ?? [],item.definitions).map((change,index)=><li key={index}>{change.definition}{change.field?`.${change.field}`:''}: {change.kind}</li>)}</ul></details>)}
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
    <Modal open={!!review} wide title={review?`Review migration ${review.migration.version}`:'Review migration'} onClose={()=>{if(!busy)setReview(null)}}>
      {review && <div className="migration-review">
        <ErrorNotice message={error} />
        <p>{review.migration.name}. {review.impacts.filter(item=>item.target==='draft').length} page locales will move to this schema.</p>
        <p>Values deleted: <strong>{review.impacts.reduce((sum,item)=>sum+item.deletedValues,0)}</strong> · Values reset: <strong>{review.impacts.reduce((sum,item)=>sum+item.resetValues,0)}</strong> · Nested blocks deleted: <strong>{review.impacts.reduce((sum,item)=>sum+item.deletedBlocks,0)}</strong>. Counts include drafts and publications separately. Old values remain in history.</p>
        {review.changes.map((change,index)=><details key={index}><summary>{change.definition}{change.field?`.${change.field}`:''} — {change.kind}</summary><div className="migration-diff"><div><strong>Before</strong><pre>{JSON.stringify(change.before ?? null,null,2)}</pre></div><div><strong>After</strong><pre>{JSON.stringify(change.after ?? null,null,2)}</pre></div></div></details>)}
        {!review.changes.length && <p>{review.migration.baseVersion===0?'The initial migration brings existing blocks onto the current schema definitions.':'No schema differences remain. Deployment records this workspace as the next migration version.'}</p>}
        {!!review.blockers.length && <div role="alert"><h3>Resolve before deploying</h3><ul>{review.blockers.map((issue,index)=><li key={index}>{issue.path}: {issue.message}</li>)}</ul></div>}
        <details><summary>Affected pages and locales</summary><ul>{review.impacts.map(item=><li key={`${item.localeId}:${item.target}`}>{item.name} / {item.locale} ({item.target}): {item.deletedValues} values deleted, {item.resetValues} reset, {item.deletedBlocks} blocks deleted</li>)}</ul></details>
        <div className="button-group"><Button disabled={busy} onClick={()=>void inspect(review.migration.id)}>Refresh review</Button>{canDeploy && <Button variant="primary" disabled={busy || !!review.blockers.length} onClick={()=>void action(async()=>{await api(`/migrations/${review.migration.id}/deploy`,jsonRequest('POST',{reviewToken:review.token}));setReview(null);await load();await onDeploy()})}>{busy?'Working…':'Deploy migration'}</Button>}</div>
        {!canDeploy && <p>An administrator can deploy this migration.</p>}
      </div>}
    </Modal>
  </section>;
}
