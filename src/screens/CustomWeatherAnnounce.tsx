import React,{useState} from 'react';
import {speak,stop} from '../lib/tts';
import {getActiveCustomProfileId} from '../lib/customProfiles';
import {loadCustomInGameTexts,CUSTOM_IN_GAME_ITEMS,substituteTokens,customInGameMemoKey} from '../lib/customInGameTemplates';

type Props={onClose:()=>void;vars:Record<string,string>};
export default function CustomWeatherAnnounce({onClose,vars}:Props){
 const [selected,setSelected]=useState('start');
 const [result,setResult]=useState<'noGame'|'called'>('noGame');
 const [inning,setInning]=useState(5);
 const [error,setError]=useState('');
 const texts=loadCustomInGameTexts(getActiveCustomProfileId());
 const def=CUSTOM_IN_GAME_ITEMS.find(x=>x.id==='rainDelay')!;
 const part=def.parts.find(x=>x.id===selected)!;
 const source=texts.rainDelay?.[selected]??part.text;
 const values={...vars,'回':String(inning),'中止区分':result==='noGame'?'ノーゲーム':`${inning}回コールドゲーム`};
 const message=substituteTokens(source,values);
 const memo=substituteTokens(texts.rainDelay?.[customInGameMemoKey(selected)]||'',values);
 const close=()=>{stop();onClose();};
 return <div className="fixed inset-0 z-[2200] flex items-center justify-center bg-black/60 p-3" role="dialog" aria-modal="true" aria-label="雨天中断">
 <div className="flex max-h-[94dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
  <div className="flex items-center justify-between bg-emerald-600 px-4 py-3 font-bold text-white"><span>🎤 雨天中断</span><button className="rounded-full bg-white/20 px-3 py-2" onClick={close}>×</button></div>
  <div className="space-y-3 overflow-y-auto p-3 text-gray-900">
   <div className="space-y-2">{def.parts.map(p=><button key={p.id} onClick={()=>{stop();setSelected(p.id);}} className={`block w-full rounded-xl border p-3 text-left font-bold ${selected===p.id?'border-emerald-500 bg-emerald-50':'border-gray-200 bg-white'}`}>{p.label}</button>)}</div>
   {selected==='cancel'&&<div className="rounded-xl bg-slate-100 p-3 space-y-2"><div className="font-bold">中止区分</div><div className="flex gap-4"><label><input type="radio" checked={result==='noGame'} onChange={()=>setResult('noGame')}/> ノーゲーム</label><label><input type="radio" checked={result==='called'} onChange={()=>setResult('called')}/> コールドゲーム</label></div>{result==='called'&&<label className="block">回数　<select value={inning} onChange={e=>setInning(Number(e.target.value))} className="rounded-lg border bg-white px-4 py-2">{Array.from({length:9},(_,i)=><option key={i+1} value={i+1}>{i+1}回</option>)}</select></label>}</div>}
   <div className="rounded-xl border border-red-400 bg-red-100 p-3 space-y-3">
    {memo.trim()&&<div className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">⚠️ {memo}</div>}
    <div className="whitespace-pre-wrap font-bold leading-7 text-red-700">{message}</div>
    <div className="grid grid-cols-2 gap-2"><button className="rounded-xl bg-blue-600 p-3 font-bold text-white" onClick={async()=>{setError('');try{await speak(message,{progressive:true,cache:true});}catch{setError('読み上げに失敗しました。');}}}>🎙 読み上げ</button><button className="rounded-xl bg-rose-600 p-3 font-bold text-white" onClick={()=>stop()}>停止</button></div>
    {error&&<p className="text-sm text-red-700">{error}</p>}
   </div>
  </div><div className="border-t p-3"><button className="w-full rounded-xl bg-emerald-600 p-3 font-bold text-white" onClick={close}>閉じる</button></div>
 </div></div>;
}
