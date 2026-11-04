'use client'

import { useEffect, useState } from 'react'
import type { PageEditors } from '@storypane/core'
import { selectedSpaceId } from '../../lib/space-url'
import { api } from './api'

export function usePageEditors(enabled=true, refreshKey='') {
  const [editors,setEditors]=useState<PageEditors>({})
  const spaceId=selectedSpaceId()
  useEffect(()=>{
    if(!enabled) {setEditors({});return}
    let stopped=false,busy=false
    const controller=new AbortController()
    async function refresh() {
      if(busy || document.visibilityState==='hidden')return
      busy=true
      try {
        const next=await api<PageEditors>('/presence',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8_000)])})
        if(!stopped)setEditors(next)
      } catch {if(!stopped)setEditors({})} // Never leave stale avatars when presence cannot refresh.
      finally {busy=false}
    }
    void refresh()
    const timer=setInterval(()=>void refresh(),10_000)
    window.addEventListener('focus',refresh)
    document.addEventListener('visibilitychange',refresh)
    return ()=>{stopped=true;controller.abort();clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh)}
  },[enabled,spaceId,refreshKey])
  return editors
}
