'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { AssetReference } from '@blok/core';
import type { AssetRecord } from '@blok/assets';
import { AssetLibrary, AssetPreview } from './asset-library';
import { assetApi } from './api';

export interface AssetPickerProps { value:AssetReference|null; onChange:(value:AssetReference|null)=>void; disabled?:boolean }
export function AssetPicker({value,onChange,disabled=false}:AssetPickerProps) {
  const [open,setOpen]=useState(false),[asset,setAsset]=useState<AssetRecord|null>(null),[error,setError]=useState('');
  useEffect(()=>{let active=true;setAsset(null);setError('');if(value?.assetId)void assetApi<{asset:AssetRecord}>(`/${value.assetId}`).then(r=>{if(active)setAsset(r.asset);}).catch(()=>{if(active)setError('This asset is unavailable. Its reference is preserved.');});return()=>{active=false;};},[value?.assetId]);
  return <div className="asset-picker">
    {asset&&<div className="asset-picked"><AssetPreview asset={asset}/><div><strong>{asset.title}</strong><small>{asset.archivedAt?'Archived · still available to this story':asset.filename}</small></div></div>}
    {error&&<p role="status">{error}</p>}
    <div className="asset-actions"><button type="button" className="button secondary" disabled={disabled} onClick={()=>setOpen(true)}>{value?'Replace asset':'Choose asset'}</button>{value&&<button type="button" className="button subtle" disabled={disabled} onClick={()=>onChange(null)}>Remove</button>}</div>
    {value&&asset?.mimeType.startsWith('image/')&&<label className="field">Alt text for this use<input value={value.alt??asset.alt} maxLength={1000} disabled={disabled} onChange={e=>onChange({...value,alt:e.target.value})}/></label>}
    {open&&<PickerDialog onClose={()=>setOpen(false)} onSelect={selected=>{onChange({assetId:selected.id,...(selected.alt?{alt:selected.alt}:{})});setOpen(false);}}/>}
  </div>;
}
function PickerDialog({onClose,onSelect}:{onClose:()=>void;onSelect:(asset:AssetRecord)=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),id=useId();
  useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
  return <dialog ref={dialog} className="asset-dialog asset-picker-dialog" aria-labelledby={id} onCancel={onClose}><header><h2 id={id}>Choose an asset</h2><button type="button" className="button secondary" onClick={onClose}>Close</button></header><AssetLibrary onSelect={onSelect}/></dialog>;
}
