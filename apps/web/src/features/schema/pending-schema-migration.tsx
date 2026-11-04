'use client';

import { useEffect,useState } from 'react';
import { GitBranch } from 'lucide-react';
import { migrationChanges,type SchemaMigration } from '@storypane/core';
import { api } from '../editor/api';

export function PendingSchemaMigration({definitionId,schemaOpen}:{definitionId:string;schemaOpen:boolean}) {
  const [migrations,setMigrations]=useState<SchemaMigration[]>([]);
  useEffect(()=>{
    let stopped=false;
    const refresh=()=>{if(!document.hidden)void api<SchemaMigration[]>('/migrations?workspace=true').then(value=>{if(!stopped)setMigrations(value)}).catch(()=>undefined)};
    refresh();const timer=setInterval(refresh,5000);window.addEventListener('focus',refresh);
    return ()=>{stopped=true;clearInterval(timer);window.removeEventListener('focus',refresh)};
  },[schemaOpen]);
  const active=migrations.find(item=>item.status==='active');
  const deployed=migrations.filter(item=>item.status==='deployed').at(-1)?.definitions.find(item=>item.id===definitionId);
  const staged=active?.definitions.find(item=>item.id===definitionId);
  if(!active || !deployed || !staged)return null;
  const changes=migrationChanges([deployed],[staged]);
  if(!changes.length)return null;
  const added=changes.filter(change=>change.field && change.kind==='added');
  const description=added.length
    ? `${added.length} new ${added.length===1?'field':'fields'} pending in migration ${active.version}: ${added.map(change=>change.field).join(', ')}`
    : `Schema changes pending in migration ${active.version}`;
  const label=`${description}. Review migration (opens in a new tab)`;
  const params=new URLSearchParams({space:active.spaceId,view:'blocks',migration:active.id});
  return <a className="pending-migration-mark pending-migration-link" href={`/?${params}`} target="_blank" rel="noreferrer" aria-label={label} title={label}>
    <GitBranch aria-hidden="true" />{added.length>0 && <span aria-hidden="true">+{added.length}</span>}
  </a>;
}
