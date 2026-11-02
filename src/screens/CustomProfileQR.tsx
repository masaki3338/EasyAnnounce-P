import React, {useEffect, useRef, useState} from 'react';
import QRCode from 'qrcode';
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import {exportCustomProfile,importCustomProfile,getCustomProfiles,getActiveCustomProfileId,setActiveCustomProfileId,createCustomProfile,renameCustomProfile,deleteCustomProfile,overwriteCustomProfileSettings,type CustomProfile} from '../lib/customProfiles';

// 同梱の初期設定との差分を圧縮して1枚優先。容量超過時は分割QRにする。
import {initialCustomInGameTexts} from '../lib/customInGameTemplates';
import {defaultCondition,defaultTiming,initialPreGameItems} from '../lib/customPreGameTemplates';
import {bundledPreGameItems,bundledInGameTexts} from '../lib/bundledCustomDefaults';

const QR_PREFIX = 'EA1:';
const QR_MULTI_PREFIX = 'EA2:';
const FILE_MAGIC = 'EAC1';
const hashCode=(s:string)=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(36);};
const QR_MAX_LENGTH = 2400; // スマホで読み取りやすい余裕のある容量 // QR version 40 / L の英数字以外（byte mode）の実用上限内
const toB64=(bytes:Uint8Array)=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
const fromB64=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
const diff=(obj:any,defaults:Record<string,any>)=>{const result:Record<string,any>={};for(const [key,value] of Object.entries(obj||{})){if(JSON.stringify(value)!==JSON.stringify(defaults[key]))result[key]=value;}return Object.keys(result).length?result:null;};
const restore=(defaults:Record<string,any>,extra:any)=>({...defaults,...(extra&&typeof extra==='object'?extra:{})});
// v2: 実際に同梱している初期値との差分だけを保存する。配列内の変更も位置単位で記録する。
// 削除・追加・空文字も保持できるため、インポート時に元の設定を正確に再現できる。
function makePatch(value:any,base:any):any {
 if(JSON.stringify(value)===JSON.stringify(base))return null;
 if(Array.isArray(value)&&Array.isArray(base)){
  const edits:Record<string,any>={};
  for(let i=0;i<value.length;i++){
   const edit=i<base.length?makePatch(value[i],base[i]):{$set:value[i]};
   if(edit!==null)edits[i]=edit;
  }
  return {$arr:[value.length,edits]};
 }
 if(value!==null&&base!==null&&typeof value==='object'&&typeof base==='object'&&!Array.isArray(value)&&!Array.isArray(base)){
  const edits:Record<string,any>={};
  for(const key of Object.keys(base))if(!Object.prototype.hasOwnProperty.call(value,key))edits[key]={$del:1};
  for(const key of Object.keys(value)){
   const edit=Object.prototype.hasOwnProperty.call(base,key)?makePatch(value[key],base[key]):{$set:value[key]};
   if(edit!==null)edits[key]=edit;
  }
  return {$obj:edits};
 }
 return {$set:value};
}
function applyPatch(base:any,patch:any):any {
 if(patch===null||patch===undefined)return base;
 if(Object.prototype.hasOwnProperty.call(patch,'$set'))return patch.$set;
 if(patch.$arr){
  const [length,edits]=patch.$arr;
  const result=Array.isArray(base)?base.slice(0,length):[];
  result.length=length;
  for(const [key,edit] of Object.entries(edits))result[Number(key)]=applyPatch(result[Number(key)],edit);
  return result;
 }
 if(patch.$obj){
  const result={...(base&&typeof base==='object'?base:{})};
  for(const [key,edit] of Object.entries(patch.$obj)){
   if((edit as any)?.$del===1)delete result[key];
   else result[key]=applyPatch(result[key],edit);
  }
  return result;
 }
 throw new Error('QR差分の形式が不正です');
}
function pack(raw:string):string {
 const data=JSON.parse(raw);
 if(data?.format!=='easyannounce-custom-v1')throw new Error('設定形式が不正です');
 const preGame=makePatch(data.preGame,bundledPreGameItems);
 const inGame=makePatch(data.inGame,bundledInGameTexts);
 return JSON.stringify([2,String(data.profile?.name||'カスタマイズ'),preGame,inGame]);
}
function unpack(compact:string):string {
 const value=JSON.parse(compact);
 if(!Array.isArray(value))throw new Error('対応していないQRコードです');
 if(value[0]===2){
  const [,name,preGamePatch,inGamePatch]=value;
  const preGame=applyPatch(bundledPreGameItems,preGamePatch);
  const inGame=applyPatch(bundledInGameTexts,inGamePatch);
  return JSON.stringify({format:'easyannounce-custom-v1',profile:{name},preGame,inGame});
 }
 if(value[0]!==1)throw new Error('対応していないQRコードです');
 const [,name,compactPre,changes]=value;
 const defaults=initialCustomInGameTexts();
 for(const [item,parts] of Object.entries(changes||{}))defaults[item]={...(defaults[item]||{}),...(parts as Record<string,string>)};
 const baseline=initialPreGameItems();
 const preGame=Array.isArray(compactPre)?compactPre.map((x:any[],index:number)=>{
  const [id,title,kind,enabled,target,condition,timing,segments,other]=x;
  return {...(other||{}),id,title,kind,enabled:enabled!==0,target,
   condition:restore(defaultCondition(),condition),timing:restore(defaultTiming(),timing),
   segments:(segments||[]).map((seg:any[],segIndex:number)=>{
    const [sid,text,phase,sc,st,extra]=seg;
    const base=baseline[index];const defaultText=base?.kind===kind&&base?.title===title&&base?.target===target?base.segments?.[segIndex]?.text:'';
    return {...(extra||{}),id:sid,text:text??defaultText,...(phase?{phase}:{}),condition:restore(defaultCondition(),sc),timing:restore(defaultTiming(),st)};
   })};
 }):null;
 return JSON.stringify({format:'easyannounce-custom-v1',profile:{name},preGame,inGame:defaults});
}
async function gzip(bytes:Uint8Array){return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());}
async function gunzip(bytes:Uint8Array){return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());}
async function encode(raw:string):Promise<string[]>{
 const bytes=await gzip(new TextEncoder().encode(pack(raw)));
 const payload=QR_PREFIX+toB64(bytes);
 if(payload.length<=QR_MAX_LENGTH)return [payload];
 // 分割後も単体のQRを生成できる余裕を確保する。
 const encoded=toB64(bytes);
 const group=hashCode(encoded);
 const chunkSize=QR_MAX_LENGTH-80;
 const total=Math.ceil(encoded.length/chunkSize);
 if(total>120)throw new Error('QRの分割数が多すぎます。.eacファイルで共有してください。');
 return Array.from({length:total},(_,i)=>`${QR_MULTI_PREFIX}${group}:${i+1}:${total}:${encoded.slice(i*chunkSize,(i+1)*chunkSize)}`);
}
async function decode(value:string):Promise<string>{
 if(!value.startsWith(QR_PREFIX))throw new Error('カスタマイズ設定のQRコードではありません');
 return unpack(new TextDecoder().decode(await gunzip(fromB64(value.slice(QR_PREFIX.length)))));
}
async function exportFile(raw:string):Promise<Blob>{
 const compressed=await gzip(new TextEncoder().encode(raw));
 const prefix=new TextEncoder().encode(FILE_MAGIC);
 const bytes=new Uint8Array(prefix.length+compressed.length);
 bytes.set(prefix);bytes.set(compressed,prefix.length);
 return new Blob([bytes],{type:'application/octet-stream'});
}
async function importFile(file:File):Promise<string>{
 if(!file.name.toLowerCase().endsWith('.eac'))throw new Error('.eacファイルを選択してください');
 if(file.size>5_000_000)throw new Error('ファイルサイズが大きすぎます');
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(new TextDecoder().decode(bytes.subarray(0,4))!==FILE_MAGIC)throw new Error('Easyアナウンスの設定ファイルではありません');
 return new TextDecoder().decode(await gunzip(bytes.subarray(4)));
}
export default function CustomProfileQR({profileId,onImported,onClose,onBeforeExport}:{profileId:string;onImported:(id:string)=>void;onClose:()=>void;onBeforeExport:()=>void}){
 const [mode,setMode]=useState<'show'|'scan'|'file'>('show');
 const [importedName,setImportedName]=useState<string|null>(null);
 const [codes,setCodes]=useState<string[]>([]);
 const [qrPage,setQrPage]=useState(0);
 const [received,setReceived]=useState<Record<number,string>>({});
 const receivedRef=useRef<Record<number,string>>({});
 const [autoPlay,setAutoPlay]=useState(true);
 const [qrImages,setQrImages]=useState<string[]>([]);
 const scanGroupRef=useRef<{id:string;total:number}|null>(null);
 const [profiles,setProfiles]=useState<CustomProfile[]>(getCustomProfiles);
 const [selectedId,setSelectedId]=useState(()=>getActiveCustomProfileId());
 const [newName,setNewName]=useState('');
 const [dialog,setDialog]=useState<null|{kind:'overwrite'|'delete'|'rename';id:string;name:string}>(null);
 const [renameValue,setRenameValue]=useState('');
 const refreshProfiles=()=>setProfiles(getCustomProfiles());
 const selectProfile=(id:string)=>{setSelectedId(id);setActiveCustomProfileId(id);setStatus('');};
 const performOverwrite=(targetId:string,name:string)=>{
  try{
   onBeforeExport();
   overwriteCustomProfileSettings(selectedId,targetId);
   setActiveCustomProfileId(targetId);
   setSelectedId(targetId);
   refreshProfiles();
   onImported(targetId);
   setNewName('');
   setStatus(`「${name}」の試合前・試合中の設定を上書きしました`);
  }catch(e){setStatus('上書きに失敗しました: '+String((e as Error).message||e));}
 };
 const registerProfile=()=>{
  const name=newName.trim();
  if(!name){setStatus('新しく登録する設定名を入力してください');return;}
  try{
   onBeforeExport();
   const existing=getCustomProfiles().find(p=>p.name.trim()===name);
   if(existing){setDialog({kind:'overwrite',id:existing.id,name:existing.name});return;}
   const p=createCustomProfile(name,selectedId);
   refreshProfiles();setSelectedId(p.id);onImported(p.id);setNewName('');
   setStatus(`「${name}」を登録しました`);
  }catch(e){setStatus('登録に失敗しました: '+String((e as Error).message||e));}
 };
 const removeProfile=()=>{
  const list=getCustomProfiles();
  const current=list.find(p=>p.id===selectedId);
  if(!current)return;
  if(list.length<=1){setStatus('最後の設定グループは削除できません');return;}
  setDialog({kind:'delete',id:current.id,name:current.name});
 };
 const renameProfile=()=>{
  const current=profiles.find(x=>x.id===selectedId);
  if(!current)return;
  setRenameValue(current.name);
  setDialog({kind:'rename',id:current.id,name:current.name});
 };
 const confirmDialog=()=>{
  if(!dialog)return;
  const currentDialog=dialog;
  setDialog(null);
  if(currentDialog.kind==='overwrite'){
   performOverwrite(currentDialog.id,currentDialog.name);
   return;
  }
  if(currentDialog.kind==='delete'){
   try{
    const list=getCustomProfiles();
    if(list.length<=1){setStatus('最後の設定グループは削除できません');return;}
    const next=list.find(p=>p.id!==currentDialog.id);
    if(!next){setStatus('切替先の設定が見つかりません');return;}
    deleteCustomProfile(currentDialog.id);
    setActiveCustomProfileId(next.id);
    setSelectedId(next.id);
    refreshProfiles();
    onImported(next.id);
    setStatus(`「${currentDialog.name}」を削除しました`);
   }catch(e){setStatus('削除に失敗しました: '+String((e as Error).message||e));}
   return;
  }
  const name=renameValue.trim();
  if(!name){setStatus('変更後の設定名を入力してください');return;}
  if(getCustomProfiles().some(p=>p.id!==currentDialog.id&&p.name.trim()===name)){
   setStatus('同じ名前の設定グループが存在します。別の名前を指定してください');
   return;
  }
  try{renameCustomProfile(currentDialog.id,name);refreshProfiles();setStatus(`「${name}」に名前を変更しました`);}
  catch(e){setStatus('名前変更に失敗しました: '+String((e as Error).message||e));}
 };
  const [qrUrl,setQrUrl]=useState('');
 const [status,setStatus]=useState('');
 const videoRef=useRef<HTMLVideoElement>(null);
 const scannerControlsRef=useRef<IScannerControls|null>(null);
 const scannerStreamRef=useRef<MediaStream|null>(null);
 const scannerTimerRef=useRef<number|null>(null);
 const scanHandledRef=useRef(false);
 const scanRef=useRef<(text:string)=>void>(()=>{});
 useEffect(()=>{if(mode!=='show')return;
  let cancelled=false;
  setCodes([]);setQrPage(0);setQrUrl('');setQrImages([]);setStatus('');
  try {
   onBeforeExport();
   const raw=exportCustomProfile(selectedId);
   void encode(raw).then(result=>{if(!cancelled)setCodes(result)}).catch(e=>{if(!cancelled)setStatus(String(e.message||e))});
  }catch(e){setStatus(String((e as Error).message||e))}
  return ()=>{cancelled=true};
 },[mode,selectedId]);
 // 全ページを事前生成し、切替時に空白や生成待ちが発生しないようにする。
 useEffect(()=>{
  let cancelled=false;
  setQrImages([]);
  if(!codes.length)return;
  void Promise.all(codes.map(value=>QRCode.toDataURL(value,{width:640,margin:3,errorCorrectionLevel:'L'})))
   .then(images=>{if(!cancelled)setQrImages(images)})
   .catch(e=>{if(!cancelled)setStatus('QR生成失敗：'+String(e.message||e))});
  return ()=>{cancelled=true};
 },[codes]);
 useEffect(()=>{setQrUrl(qrImages[qrPage]||'')},[qrImages,qrPage]);
 // 受信側のカメラが追従できるよう、1.5秒ごとに巡回する。
 useEffect(()=>{
  if(mode!=='show'||!autoPlay||codes.length<2||qrImages.length!==codes.length)return;
  const timer=window.setInterval(()=>setQrPage(page=>(page+1)%codes.length),1500);
  return ()=>window.clearInterval(timer);
 },[mode,autoPlay,codes.length,qrImages.length]);
 const applyImport=(raw:string)=>{const p=importCustomProfile(raw);refreshProfiles();setSelectedId(p.id);setStatus('読み込み完了: '+p.name);setImportedName(p.name);onImported(p.id);};
 const consume=async(text:string)=>{
  try {
   if(text.startsWith(QR_PREFIX)){applyImport(await decode(text));return;}
   if(text.startsWith(QR_MULTI_PREFIX)){
    const match=/^EA2:([0-9a-z]+):(\d+):(\d+):([A-Za-z0-9_-]+)$/.exec(text);
    if(!match)throw new Error('分割QRの形式が不正です');
    const [,id,nStr,totalStr,chunk]=match;const n=Number(nStr),total=Number(totalStr);
    if(!Number.isInteger(n)||n<1||total<2||total>120||n>total)throw new Error('分割QRの番号が不正です');
    const current=scanGroupRef.current;
    if(current&&(current.id!==id||current.total!==total))throw new Error('別の設定のQRです。読み取りをリセットしてください');
    scanGroupRef.current={id,total};
    const next={...receivedRef.current,[n]:chunk};receivedRef.current=next;setReceived(next);
    if(Object.keys(next).length<total){setStatus(`分割QR：${Object.keys(next).length}/${total}枚を読み取りました`);return;}
    const all=Array.from({length:total},(_,i)=>next[i+1]).join('');
    if(hashCode(all)!==id)throw new Error('QRのデータ整合性が一致しません。読み直してください');
    applyImport(unpack(new TextDecoder().decode(await gunzip(fromB64(all)))));
    scanGroupRef.current=null;receivedRef.current={};setReceived({});return;
   }
   throw new Error('カスタマイズ設定のQRコードではありません');
  }catch(e){setStatus('復元エラー: '+String((e as Error).message||e))}
 };
 const saveEac=async()=>{
  try{onBeforeExport();const raw=exportCustomProfile(selectedId);const blob=await exportFile(raw);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`EasyAnnounce_${(profiles.find(p=>p.id===selectedId)?.name||'custom').replace(/[\\/:*?"<>|]/g,'_')}.eac`;document.body.appendChild(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),10000);setStatus('設定ファイルを保存しました');}catch(e){setStatus('ファイル保存エラー: '+String((e as Error).message||e))}
 };
 const readEac=async(event:React.ChangeEvent<HTMLInputElement>)=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;try{applyImport(await importFile(file))}catch(e){setStatus('ファイル読込エラー: '+String((e as Error).message||e))}};
 scanRef.current=(value:string)=>{
  if(scanHandledRef.current)return;
  scanHandledRef.current=true;
  void consume(value).finally(()=>{scanHandledRef.current=false;});
 };
 useEffect(()=>{
  if(mode!=='scan')return;
  let disposed=false;
  scanHandledRef.current=false;
  setStatus('');
  const stopScanner=()=>{
   if(scannerTimerRef.current!==null){window.clearInterval(scannerTimerRef.current);scannerTimerRef.current=null;}
   try{scannerControlsRef.current?.stop();}catch{}
   scannerControlsRef.current=null;
   scannerStreamRef.current?.getTracks().forEach(track=>{try{track.stop();}catch{}});
   scannerStreamRef.current=null;
   if(videoRef.current){try{videoRef.current.pause();videoRef.current.srcObject=null;}catch{}}
  };
  const startZxing=async()=>{
   if(disposed)return;
   const video=videoRef.current;
   if(!video)return;
   const reader=new BrowserQRCodeReader(undefined,{delayBetweenScanAttempts:60,delayBetweenScanSuccess:400});
   const controls=await reader.decodeFromConstraints({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}},video,(result)=>{
    if(result&&!disposed)scanRef.current(result.getText());
   });
   if(disposed){controls.stop();return;}
   scannerControlsRef.current=controls;
  };
  const start=async()=>{
   const Detector=(window as any).BarcodeDetector;
   if(Detector&&navigator.mediaDevices?.getUserMedia){
    try{
     if(typeof Detector.getSupportedFormats==='function'){
      const supported:string[]=await Detector.getSupportedFormats();
      if(!supported.includes('qr_code'))throw new Error('unsupported');
     }
     const video=videoRef.current;
     if(!video||disposed)return;
     const detector=new Detector({formats:['qr_code']});
     const media=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}});
     if(disposed){media.getTracks().forEach(t=>t.stop());return;}
     scannerStreamRef.current=media;
     video.srcObject=media;
     await video.play();
     let elapsed=0;
     let busy=false;
     scannerTimerRef.current=window.setInterval(async()=>{
      if(disposed||busy||video.readyState<2||scanHandledRef.current)return;
      busy=true;
      elapsed+=150;
      try{const found=await detector.detect(video);if(found?.[0]?.rawValue)scanRef.current(String(found[0].rawValue));}catch{}
      finally{busy=false;}
      // 標準検出で読めない端末はチーム登録と同じZXingに切り替える。
      if(elapsed>=2500&&!disposed){
       stopScanner();
       try{await startZxing();}catch{if(!disposed)setStatus('QR読取カメラを開始できませんでした。カメラの権限を確認してください。');}
      }
     },150);
     return;
    }catch{stopScanner();}
   }
   try{await startZxing();}catch{if(!disposed)setStatus('カメラを使用できません。権限またはHTTPS接続を確認してください。');}
  };
  const timer=window.setTimeout(()=>{void start();},120);
  return ()=>{disposed=true;window.clearTimeout(timer);stopScanner();};
 },[mode]);
 const readQrImage=async(event:React.ChangeEvent<HTMLInputElement>)=>{
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  const url=URL.createObjectURL(file);
  try{
   const img=new Image();
   await new Promise<void>((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(new Error('画像を開けません'));img.src=url;});
   const reader=new BrowserQRCodeReader();
   const result=await reader.decodeFromImageElement(img);
   scanRef.current(result.getText());
  }catch{setStatus('画像からQRコードを読み取れませんでした。QR全体が写った画像を選んでください。');}
  finally{URL.revokeObjectURL(url);}
 };
 return <div className="fixed inset-0 z-[300] bg-black/80 flex items-center justify-center p-3"><section className="w-full max-w-md max-h-[95dvh] overflow-y-auto rounded-2xl bg-slate-800 border border-white/25 p-4 text-white space-y-3"><div className="flex justify-between items-center"><h2 className="font-extrabold text-lg">カスタマイズ設定の共有</h2><button className="rounded-lg bg-white/20 px-3 py-2" onClick={onClose}>✕ 閉じる</button></div><div className="rounded-xl border border-white/20 bg-slate-700/70 p-3 space-y-3"><label className="block text-sm font-bold">カスタマイズ設定グループ<select className="mt-1 w-full rounded-xl bg-slate-800 border border-white/20 p-3 text-white" value={selectedId} onChange={e=>selectProfile(e.target.value)}>{profiles.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label><div className="flex gap-2"><input aria-label="新しく登録するカスタマイズ名" placeholder="新しく登録する設定名" className="min-w-0 flex-1 rounded-lg bg-white p-2 text-slate-900" value={newName} onChange={e=>setNewName(e.target.value)}/><button type="button" onClick={registerProfile} className="rounded-lg bg-blue-600 px-3 py-2 font-bold">登録</button></div><div className="grid grid-cols-2 gap-2"><button type="button" onClick={renameProfile} className="rounded-lg bg-slate-600 p-2 font-bold">名前を変更</button><button type="button" onClick={removeProfile} disabled={profiles.length<=1} className="rounded-lg bg-red-700 p-2 font-bold disabled:opacity-40 disabled:cursor-not-allowed">選択中の設定を削除</button></div><p className="text-xs text-slate-200">現在選択中のグループは自動保存されます。「登録」は、その時点の試合前・試合中の設定を保存します。同じ名前がある場合は上書き確認を表示します。QRから読み込んだ設定も新しいグループとして保存します。</p></div><div className="grid grid-cols-3 gap-2 text-sm"><button className={'rounded-xl p-2 '+(mode==='show'?'bg-blue-600':'bg-slate-600')} onClick={()=>setMode('show')}>QRを表示</button><button className={'rounded-xl p-2 '+(mode==='scan'?'bg-blue-600':'bg-slate-600')} onClick={()=>setMode('scan')}>QRを読込</button><button className={'rounded-xl p-2 '+(mode==='file'?'bg-blue-600':'bg-slate-600')} onClick={()=>setMode('file')}>ファイル共有</button></div>
 {mode==='show'?<><p className="text-sm">選択中のカスタマイズ設定を初期設定との差分でQR化します。容量を超えた場合は自動で分割します。</p>{qrUrl&&<img alt={`設定共有QRコード ${qrPage+1}/${codes.length}`} src={qrUrl} className="mx-auto w-full max-w-[540px] rounded-xl bg-white p-2"/>}<p className="text-center text-sm">{codes.length?`QRコード ${qrPage+1} / ${codes.length} 枚`:status?'':'圧縮してQRを作成中…'}</p>{codes.length>1&&<div className="flex items-center justify-between gap-2 rounded-lg bg-slate-700 p-2"><span className="text-sm">自動切替（1.5秒ごと）</span><button type="button" onClick={()=>setAutoPlay(v=>!v)} className="rounded-lg bg-blue-600 px-4 py-2 font-bold">{autoPlay?'一時停止':'自動再生'}</button></div>}{codes.length>1&&<div className="grid grid-cols-2 gap-2"><button type="button" disabled={qrPage===0} onClick={()=>setQrPage(x=>x-1)} className="rounded-lg bg-slate-600 p-3 font-bold disabled:opacity-40">◀ 前のQR</button><button type="button" disabled={qrPage===codes.length-1} onClick={()=>setQrPage(x=>x+1)} className="rounded-lg bg-blue-600 p-3 font-bold disabled:opacity-40">次のQR ▶</button></div>}</>:mode==='scan'?<><p className="text-sm">相手端末の自動切替QRにカメラをかざし続けてください。順不同で自動収集し、全部そろうと復元します。</p><p className="text-sm font-bold text-emerald-300">{scanGroupRef.current?`読み取り進捗：${Object.keys(received).length} / ${scanGroupRef.current.total} 枚`:'QRの読み取りを待っています…'}</p><video ref={videoRef} muted playsInline className="w-full rounded-xl bg-black aspect-[4/3] object-cover"/><label className="block text-center rounded-xl bg-blue-600 px-4 py-3 font-bold cursor-pointer">🖼️ 画像からQRを読み取る<input type="file" accept="image/*" onChange={readQrImage} className="hidden"/></label><button type="button" onClick={()=>{scanGroupRef.current=null;receivedRef.current={};setReceived({});setStatus('分割QRの読み取り状況をリセットしました')}} className="w-full rounded-xl bg-slate-600 p-2 text-sm">分割QRを最初から読み直す</button></>:<><p className="text-sm">通信不要。選手登録用JSONとは別の .eac ファイルで設定を共有します。</p><button type="button" onClick={()=>void saveEac()} className="w-full rounded-xl bg-blue-600 p-4 font-bold">⬇ 設定を.eacファイルに保存</button><label className="block text-center rounded-xl bg-emerald-600 p-4 font-bold cursor-pointer">⬆ .eacファイルを読み込む<input type="file" accept=".eac,application/octet-stream" onChange={readEac} className="hidden"/></label><p className="text-xs text-slate-200">読み込み時は新しい設定グループを作成します。既存グループは上書きしません。</p></>}
 {status&&<p role="status" className="text-sm text-yellow-200 break-words">{status}</p>}</section>
 {importedName!==null&&<div className="fixed inset-0 z-[320] flex items-center justify-center bg-black/75 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="custom-import-complete-title" className="w-full max-w-sm rounded-2xl bg-white p-6 text-center text-slate-800 shadow-2xl"><div className="mb-3 text-4xl text-emerald-600" aria-hidden="true">✓</div><h3 id="custom-import-complete-title" className="text-lg font-extrabold">読み込み完了</h3><p className="my-5 break-words text-base">「{importedName}」の読み込みが完了しました</p><button type="button" autoFocus onClick={()=>setImportedName(null)} className="w-full rounded-xl bg-blue-600 px-4 py-3 font-bold text-white">OK</button></section></div>}
 {dialog&&<div className="fixed inset-0 z-[310] flex items-center justify-center bg-black/75 p-4" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setDialog(null)}}>
  <section role="dialog" aria-modal="true" aria-labelledby="custom-profile-dialog-title" className="w-full max-w-sm overflow-hidden rounded-2xl bg-white text-slate-800 shadow-2xl">
   <div className={'flex items-center gap-3 px-5 py-4 text-white '+(dialog.kind==='delete'?'bg-rose-600':'bg-blue-600')}>
    <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/20 text-xl">{dialog.kind==='rename'?'✎':dialog.kind==='delete'?'🗑':'↻'}</span>
    <h3 id="custom-profile-dialog-title" className="text-lg font-extrabold">{dialog.kind==='rename'?'設定名の変更':dialog.kind==='delete'?'設定グループの削除':'既存の設定を上書き'}</h3>
   </div>
   <div className="space-y-3 px-5 py-5">
    {dialog.kind==='rename'?<><p className="text-sm">「{dialog.name}」の名前を変更します。</p><label className="block text-sm font-bold">新しい設定名<input autoFocus type="text" value={renameValue} onChange={e=>setRenameValue(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')confirmDialog()}} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base text-slate-900 outline-none focus:border-blue-500"/></label></>:
     dialog.kind==='delete'?<><p className="font-bold break-words">「{dialog.name}」を削除しますか？</p><p className="rounded-lg bg-rose-50 px-3 py-3 text-sm text-rose-800">試合前・試合中の保存済み設定も削除されます。この操作は元に戻せません。</p></>:
     <><p className="font-bold break-words">「{dialog.name}」は既に登録されています。</p><p className="rounded-lg bg-blue-50 px-3 py-3 text-sm text-blue-900">現在の試合前・試合中の設定で、登録済みの内容を上書きしますか？</p></>}
   </div>
   <div className="grid grid-cols-2 gap-3 border-t border-slate-100 bg-slate-50 px-5 py-4">
    <button type="button" onClick={()=>setDialog(null)} className="min-h-12 rounded-xl border border-slate-300 bg-white px-3 py-3 font-bold text-slate-700">キャンセル</button>
    <button type="button" onClick={confirmDialog} disabled={dialog.kind==='rename'&&!renameValue.trim()} className={'min-h-12 rounded-xl px-3 py-3 font-bold text-white disabled:opacity-40 '+(dialog.kind==='delete'?'bg-rose-600':'bg-blue-600')}>{dialog.kind==='rename'?'変更する':dialog.kind==='delete'?'削除する':'上書きする'}</button>
   </div>
  </section>
 </div>}</div>
}
