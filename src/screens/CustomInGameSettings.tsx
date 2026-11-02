import { getCustomManualPdf, saveCustomManualPdf, removeCustomManualPdf } from '../lib/customManualPdf';
import { speak as ttsSpeak, stop as ttsStop } from '../lib/tts';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { buildDefenseChangeText, CUSTOM_IN_GAME_ITEMS, initialCustomInGameTexts, loadCustomInGameTexts, saveCustomInGameTexts, customInGameMemoKey, substituteTokens, unknownTokens, START_TIME_TIMINGS, customItemEnabled,customPitchPartEnabled,type AnnounceCategory, type CustomInGameTexts } from '../lib/customInGameTemplates';

type Props={profileId:string; profileName?:string; onBack?:()=>void};
const LABELS:{id:AnnounceCategory;label:string}[]=[{id:'offense',label:'攻撃画面'},{id:'defense',label:'守備画面'},{id:'other',label:'その他'}];
const samples:Record<string,string>={
 '中止区分':'ノーゲーム','大会名':'秋季大会','試合番号':'1','次の試合番号':'2','得点':'1','開始時刻':'9時00分','先攻チーム名':'東京ジュニア','後攻チーム名':'横浜ジュニア','打順':'4','守備位置':'ショート','選手名':'山田太郎','選手名（苗字）':'山田','選手名（フルネーム）':'山田太郎','敬称':'くん','背番号':'6','チーム名':'東京ジュニア',
 '交代前選手名':'山田太郎','交代前選手名（苗字）':'山田','交代前選手名（フルネーム）':'山田太郎','交代前敬称':'くん','交代後選手名':'佐藤一郎','交代後選手名（苗字）':'佐藤','交代後選手名（フルネーム）':'佐藤一郎','交代後敬称':'くん','交代後背番号':'12',
 '1,2,3塁':'1塁','ファースト,セカンド,サード':'ファースト','塁(1塁/2塁/3塁)':'1塁','塁(1/2/3)':'1','塁(ファースト/セカンド/サード)':'ファースト',
 '投手名':'山田','投手名（苗字）':'山田','投手名（フルネーム）':'山田太郎','この回の投球数':'16','合計投球数':'70','投球上限':'70','回':'3','表裏':'表',
 '交代前・選手名（苗字）':'山田','交代前・選手名（フルネーム）':'山田太郎','交代後・選手名（苗字）':'佐藤','交代後・選手名（フルネーム）':'佐藤一郎','移動・選手名（苗字）':'鈴木','移動・選手名（フルネーム）':'鈴木次郎','移動・選手名':'鈴木','選手名（苗字）':'高橋','選手名（フルネーム）':'高橋健太','交代前打順':'4番','交代前・守備位置':'ピッチャー','交代前・選手名':'山田','交代前・敬称':'くん','交代後・選手名':'佐藤','交代後・敬称':'くん','交代後・守備位置':'ピッチャー','守備位置':'ピッチャー','交代後・背番号':'12',
 '移動前・守備位置':'ショート','移動・選手名':'鈴木次郎','移動・敬称':'くん','移動後・守備位置':'セカンド',
 '中断時間':'3','先攻得点':'3','後攻得点':'4','勝利チーム名':'横浜ジュニア','給水時間':'3','アウト数':'無死','走者情報':'一塁・二塁','打者の一人前の選手':'山田','打者の一人前の選手敬称':'くん','打者の一人前の選手背番号':'6','打者の二人前の選手':'山田','打者の二人前の選手敬称':'くん','打者の二人前の選手背番号':'6','打者の三人前の選手':'山田','打者の三人前の選手敬称':'くん','打者の三人前の選手背番号':'6'
};
const button='rounded-xl px-3 py-2 font-semibold active:scale-[0.99] transition';
/** 試合中の固定項目を編集する専用画面。マウントは custom 選択時のみ行うこと。 */
export default function CustomInGameSettings({profileId,profileName,onBack}:Props){
 const [manualName,setManualName]=useState('');
 const [manualBusy,setManualBusy]=useState(false);
 const [manualMessage,setManualMessage]=useState('');
 const manualInputRef=useRef<HTMLInputElement>(null);
 const [category,setCategory]=useState<AnnounceCategory>('offense');
 const [helpOpen,setHelpOpen]=useState(false);
 const [deleteTarget,setDeleteTarget]=useState<{id:string;label:string}|null>(null);
 const [itemId,setItemId]=useState<string|null>(null);
 const [partId,setPartId]=useState<string|null>(null);
 const [texts,setTexts]=useState<CustomInGameTexts>(()=>loadCustomInGameTexts(profileId));
 const [dirty,setDirty]=useState(false);
 const [saved,setSaved]=useState(false);
 const [speechError,setSpeechError]=useState('');
 const textareaRef=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{setTexts(loadCustomInGameTexts(profileId));setItemId(null);setPartId(null);setDirty(false);setSaved(false);setDeleteTarget(null);},[profileId]);
 useEffect(()=>()=>{ttsStop();},[]);
 useEffect(()=>{let active=true;setManualName('');setManualMessage('');getCustomManualPdf(profileId).then(v=>{if(active)setManualName(v?.name||'')}).catch(()=>{if(active)setManualMessage('PDFの読み込みに失敗しました。')});return()=>{active=false}},[profileId]);
 const registerManual=async(file?:File)=>{if(!file)return;setManualBusy(true);setManualMessage('');try{await saveCustomManualPdf(profileId,file);setManualName(file.name);setManualMessage('PDFをこの端末に登録しました。')}catch(e){setManualMessage(e instanceof Error?e.message:'PDFの登録に失敗しました。保存容量をご確認ください。')}finally{setManualBusy(false);if(manualInputRef.current)manualInputRef.current.value=''}};
 const deleteManual=async()=>{setManualBusy(true);setManualMessage('');try{await removeCustomManualPdf(profileId);setManualName('');setManualMessage('登録したPDFを削除しました。')}catch{setManualMessage('PDFの削除に失敗しました。')}finally{setManualBusy(false)}};
 const userItems=Object.entries(texts).filter(([id,v])=>id.startsWith('userOther_')&&v?.label).map(([id,v])=>({id,label:v.label,category:'other' as AnnounceCategory,parts:[{id:'main',label:'読み上げ文章',text:'',tokens:['先攻チーム名','後攻チーム名','大会名','試合番号']}]}));
 const allItems=[...CUSTOM_IN_GAME_ITEMS,...userItems];
 const item=allItems.find(x=>x.id===itemId)||null;
 const part=item?.parts.find(x=>x.id===partId)||item?.parts[0]||null;
 const text=item&&part?texts[item.id]?.[part.id]??part.text:'';
 const memo=item&&part?texts[item.id]?.[customInGameMemoKey(part.id)]||'':'';
 // 代走・臨時代走の塁名は、登録文章内の全角／半角括弧の違いも吸収してプレビューへ反映する。
 const runnerPreviewText = (value: string) => {
  if(item?.id !== 'pinchRunner' && item?.id !== 'courtesyRunner') return value;
  return value
   .replace(/【\s*塁\s*[（(]\s*ファースト\s*[/／]\s*セカンド\s*[/／]\s*サード\s*[）)]\s*】/g, 'ファースト')
   .replace(/【\s*塁\s*[（(]\s*1塁\s*[/／]\s*2塁\s*[/／]\s*3塁\s*[）)]\s*】/g, '1塁');
 };
 const previewMemo=useMemo(()=>substituteTokens(memo,samples),[memo]);
 const preview=useMemo(()=>{
  const previewValues = { ...samples };
  // 試合終了の本番処理と同様に、チェックONなら得点の大きい方を先にする。
  // チーム名の差込順は変えず、得点の差込値のみ入れ替える。
  if (item?.id === 'gameEnd' && texts.gameEnd?.higherScoreFirst === 'true') {
    const top = Number(samples['先攻得点']);
    const bottom = Number(samples['後攻得点']);
    if (Number.isFinite(top) && Number.isFinite(bottom) && top < bottom) {
      previewValues['先攻得点'] = String(bottom);
      previewValues['後攻得点'] = String(top);
    }
  }
  if (item?.id === 'defenseChange' && part?.id === 'newPlayerDifferent') {
    previewValues['交代後・守備位置'] = 'センター';
    previewValues['守備位置'] = 'センター';
  }
  return runnerPreviewText(substituteTokens(text, previewValues));
 },[text,item?.id,part?.id,texts.gameEnd?.higherScoreFirst]);
 const example=useMemo(()=>{
  if(item?.id==='defenseChange'){
   // 選択した設定の働きに関係する文章だけを組み立てる。
   // ①〜⑧と接続文では打順・終了文を表示せず、⑩〜⑫でのみ表示する。
   const parts=texts.defenseChange||{};
   const selectedId=part?.id||'';
   // 同じ守備位置は「選手交代のみ」、違う守備位置は「交代＋シート変更」の例を示す。
   const style=selectedId==='introPlayer'||selectedId==='newPlayerSame'?'player':selectedId==='introPosition'||selectedId==='positionMove'?'position':'both';
   // 最後の接続文の例題は、守備位置を変更する1人だけに絞る。
   // 選手交代・打順紹介・終了文は含めず、最後の接続文の働きを確認しやすくする。
   if(selectedId==='last'){
    return buildDefenseChangeText(parts,{
     introVars:samples,
     newPlayers:[],
     positionMoves:[{...samples,'移動前・守備位置':'ショート','移動・選手名':'鈴木次郎','移動・敬称':'くん','移動後・守備位置':'セカンド','交代前打順':'6番'}],
     battingRows:[],includeBatting:false,includeOutro:false
    });
   }
   if(selectedId==='reentryFromPinch'||selectedId==='reentryFromDefense'){
    const intro=selectedId==='reentryFromPinch'?parts.introPlayer:parts.introBoth;
    return [substituteTokens(intro||'',samples),substituteTokens(parts[selectedId]||'',samples)].filter(Boolean).join('\n');
   }
   const connectorExample=selectedId==='last';
   const middleExample=selectedId==='middle';
   const simpleExample=['battingIntro','battingRowNew','battingRowExisting','outro'].includes(selectedId);
   const includePlayer=connectorExample||simpleExample||style!=='position';
   const includePosition=connectorExample||(style!=='player' && selectedId!=='newPlayerDifferent' && !simpleExample);
   const battingSample={...samples,'打順':'4','守備位置':'ピッチャー','選手名':'佐藤一郎','敬称':'くん','背番号':'12','__battingKind':selectedId==='battingRowNew'?'new':'existing'};
   // ④/⑤ は各場面の文章を、他の設定済みの接続文・打順文と組み合わせて通し表示。
   const isNewPlayerPart=part?.id==='newPlayerSame'||part?.id==='newPlayerDifferent';
   const isPinchPart=!!part?.id&&['pinchHitStay','pinchHitReplace','pinchRunStay','pinchRunReplace'].includes(part.id);
   const extraSegments=isPinchPart?[substituteTokens(parts[part!.id]||'',samples)]:[];
   // 「途中の接続文」は、2人の守備移動をつないだ例で確認する。
   // 1人目には途中の接続文、2人目には最後の接続文を適用する。
   if(middleExample){
    return buildDefenseChangeText(parts,{
     introVars:samples,
     newPlayers:[],
     positionMoves:[
      {...samples,'移動前・守備位置':'ショート','移動・選手名':'鈴木次郎','移動・敬称':'くん','移動後・守備位置':'セカンド','交代前打順':'6番'},
      {...samples,'移動前・守備位置':'セカンド','移動・選手名':'高橋三郎','移動・敬称':'くん','移動後・守備位置':'ショート','交代前打順':'8番'}
     ],
     battingRows:[],includeBatting:false,includeOutro:false
    });
   }
   return buildDefenseChangeText(parts,{
    introVars:samples,
    newPlayers:isPinchPart?[]:includePlayer?[isNewPlayerPart&&part?.id==='newPlayerDifferent'?{...samples,'交代後・守備位置':'センター','守備位置':'センター'}:samples]:[],
    // 接続文は選手交代＋守備移動の2人で、打順・終了文は1人の交代で確認。
    // 守備位置のみ変更する例では、2人がポジションを入れ替える流れを示す。
    // 例：ショート鈴木次郎 → セカンド、セカンド高橋三郎 → ショート。
    positionMoves:isPinchPart?[]:includePosition?(selectedId==='positionMove' ? [
      {...samples,'移動前・守備位置':'ショート','移動・選手名':'鈴木次郎','移動・敬称':'くん','移動後・守備位置':'セカンド','交代前打順':'6番'},
      {...samples,'移動前・守備位置':'セカンド','移動・選手名':'高橋三郎','移動・敬称':'くん','移動後・守備位置':'ショート','交代前打順':'8番'}
    ] : [samples]):[],
    extraSegments,
    battingRows:simpleExample?[battingSample]:[],
    includeBatting:simpleExample,
    includeOutro:simpleExample
   });
  }
  if(item?.id==='pitchCount'){
   // 投球数は4種類がそれぞれ別場面のため、選択中の通知文を表示する。
   // ただし選択中以外の文章も含め、設定値を常に texts から取得する。
   return substituteTokens(texts.pitchCount?.[part?.id||'']||'',samples);
  }
  return '';
 },[item?.id,part?.id,texts]);

 const bad=part?unknownTokens(text,part.tokens):[];
 const setFlag=(id:string,key:string,value:boolean)=>{setTexts(prev=>({...prev,[id]:{...prev[id],[key]:value?'true':'false'}}));setDirty(true);setSaved(false)};
 const setTiming=(id:'ground'|'nextGame',key:'triggerInning'|'triggerSide',value:string)=>{setTexts(prev=>({...prev,[id]:{...prev[id],[key]:value}}));setDirty(true);setSaved(false)};
 const setText=(next:string)=>{if(!item||!part)return;setTexts(prev=>({...prev,[item.id]:{...prev[item.id],[part.id]:next}}));setDirty(true);setSaved(false)};
 const setMemo=(next:string)=>{if(!item||!part)return;setTexts(prev=>({...prev,[item.id]:{...prev[item.id],[customInGameMemoKey(part.id)]:next}}));setDirty(true);setSaved(false)};
 const insert=(token:string)=>{
  const area=textareaRef.current;const start=area?.selectionStart??text.length;const end=area?.selectionEnd??start;
  setText(text.slice(0,start)+`【${token}】`+text.slice(end));
  requestAnimationFrame(()=>{area?.focus();area?.setSelectionRange(start+token.length+2,start+token.length+2)});
 };
 const deleteUserItem=(id:string)=>{
  if(!id.startsWith('userOther_'))return;
  setTexts(prev=>{const next={...prev};delete next[id];return next;});
  if(itemId===id){setItemId(null);setPartId(null);stop();}
  setDirty(true);setSaved(false);
 };
 const save=()=>{try{saveCustomInGameTexts(profileId,texts);setDirty(false);setSaved(true)}catch{setSpeechError('保存に失敗しました。ブラウザの保存領域をご確認ください。')}};
 const stop=()=>{ttsStop()};
 const speak=async()=>{setSpeechError('');if(bad.length){setSpeechError('未対応の差し込み項目があります。文章を確認してください。');return;}
   try {stop();await ttsSpeak(preview.replace(/山田太郎/g,'やまだ、たろう').replace(/佐藤一郎/g,'さとう、いちろう').replace(/鈴木次郎/g,'すずき、じろう'));}
   catch {setSpeechError('読み上げに失敗しました。音声設定をご確認ください。');}
 };
 return <div className="mx-auto w-full max-w-3xl space-y-4 px-3 py-4 text-white sm:px-5">
  <div className="flex items-center gap-3">{onBack&&<button className={button+' bg-white/15'} onClick={onBack}>戻る</button>}<div className="min-w-0 flex-1"><h1 className="text-xl font-bold">試合中アナウンス設定</h1><p className="text-xs opacity-75">カスタマイズ専用 / {profileName||profileId}</p></div><button type="button" aria-label="試合中アナウンス設定の使い方" title="使い方" className="shrink-0 flex h-10 w-10 items-center justify-center rounded-full border-2 border-blue-200 bg-blue-600 text-xl font-extrabold text-white shadow-lg active:scale-95" onClick={()=>setHelpOpen(true)}>？</button></div>
  {helpOpen&&<div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-3 sm:p-5" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setHelpOpen(false)}}>
   <div role="dialog" aria-modal="true" aria-labelledby="ingame-help-title" className="flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white text-slate-800 shadow-2xl">
    <div className="flex shrink-0 items-center justify-between gap-3 bg-blue-700 px-4 py-4 text-white"><h2 id="ingame-help-title" className="text-base sm:text-lg font-extrabold">❓ 試合中アナウンス設定の使い方</h2><button type="button" aria-label="ヘルプを閉じる" onClick={()=>setHelpOpen(false)} className="h-9 w-9 shrink-0 rounded-full bg-white/20 text-xl font-bold">×</button></div>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-sm leading-relaxed">
     <section className="rounded-xl border border-blue-200 bg-blue-50 p-3 space-y-2"><h3 className="font-extrabold text-blue-800">① 設定したい画面を選ぶ</h3><p>上部の「攻撃画面」「守備画面」「その他」から選び、一覧のアナウンス項目をタップします。</p><p className="text-xs text-slate-700">チェックを外した項目は、カスタマイズモードの試合中画面に表示されません。チェック変更後は画面下の「保存」ボタンを押してください。攻撃画面で切り替えられるのは「試合開始時刻」「得点」の2項目です。「申告敬遠」は「その他」の先頭で切り替えられます。</p></section>
     <section className="rounded-xl border border-sky-200 bg-sky-50 p-3 space-y-2"><h3 className="font-extrabold text-sky-800">② 攻撃画面の設定</h3><p>代打・代走・得点など、攻撃中に使うアナウンスの文章を編集します。項目によって複数の場面別の文章がある場合は、編集したい種類を選択してください。</p><p className="text-xs text-slate-700">「試合開始時刻」をOFFにすると開始時刻のモーダルは表示しません。「得点」をOFFにすると得点の放送モーダルを省略しますが、得点の記録と試合の進行は継続します。その他の攻撃項目は常にチェックON（変更不可）です。</p></section>
     <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 space-y-2"><h3 className="font-extrabold text-emerald-800">③ 守備画面の設定</h3><p>守備交代・投球数などの文章を編集します。守備交代では選手の交代、守備位置の移動、打順紹介、リエントリーなど、状況別の文章を切り替えて設定できます。</p><p className="text-xs text-slate-700">「投球数の放送」は4種類（守備回終了時・合計あり／なし、事前お知らせ、到達時）を個別にON/OFFできます。チェックOFFの放送・通知モーダルは表示されません。守備交代など、その他の守備項目は常に利用できます。</p></section>
     <section className="rounded-xl border border-violet-200 bg-violet-50 p-3 space-y-2"><h3 className="font-extrabold text-violet-800">④ その他の設定</h3><p>攻撃・守備以外で使うアナウンスを編集します。チェックOFFの項目は試合中の「その他」に表示しません。「グラウンド整備」「次の試合のお知らせ」をOFFにした場合は、指定イニングの自動モーダルも表示しません。ONの場合は各項目で表示する回（1〜9回）と表／裏を指定できます。</p></section>
     <section className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2"><h3 className="font-extrabold text-amber-800">⑤ 差し込み項目の使い方</h3><p>文章の挿入したい位置をタップし、「＋選手名（苗字）」「＋守備位置」「＋背番号」などのボタンを押します。試合中は登録した選手や試合の情報に自動で置き換わります。</p><div className="rounded-lg border border-amber-100 bg-white p-2 text-xs">例：【守備位置】の【選手名（苗字）】【敬称】が入ります。</div><p className="text-xs text-slate-700">差し込み項目はアナウンスの種類ごとに使用できるものが異なります。利用できない項目を入力すると警告が表示されます。</p></section>
     <section className="rounded-xl border border-rose-200 bg-rose-50 p-3 space-y-2"><h3 className="font-extrabold text-rose-800">⑥ 読み上げメモの使い方</h3><p>アナウンスするタイミングや注意事項を入力できます。入力したメモは実際のアナウンス文の上に薄黄色で表示され、<strong>音声では読み上げられません。</strong></p><div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950">⚠️ 例：ファールボールが観客席へ入ったときに案内する</div></section>
     <section className="rounded-xl border border-teal-200 bg-teal-50 p-3 space-y-2"><h3 className="font-extrabold text-teal-800">⑦ プレビュー・読み上げ・保存</h3><p>「アナウンス文言プレビュー」で文章を確認し、「読み上げ」で音声確認、「停止」で中止できます。内容を変更したら画面下の保存ボタンを押してください。</p><p className="text-xs text-slate-700">プレビューでは確認用の仮データが使われます。設定は選択中のカスタマイズグループに保存されます。</p></section>
     <div className="rounded-xl bg-slate-100 p-3 text-xs text-slate-700"><strong>💡 他端末との共有：</strong>リーグ設定画面の「QRコードで設定を共有・読み込み」から、試合前・試合中の設定を引き継げます。</div>
    </div>
    <div className="shrink-0 border-t border-slate-200 bg-white p-3"><button type="button" onClick={()=>setHelpOpen(false)} className="w-full rounded-xl bg-emerald-600 px-4 py-3 font-extrabold text-white active:scale-[.99]">OK</button></div>
   </div>
  </div>}
  {deleteTarget&&<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" role="presentation" onClick={()=>setDeleteTarget(null)}>
   <div role="alertdialog" aria-modal="true" aria-labelledby="delete-custom-item-title" aria-describedby="delete-custom-item-description" className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl" onClick={e=>e.stopPropagation()}>
    <h2 id="delete-custom-item-title" className="text-lg font-extrabold">追加項目の削除</h2>
    <p id="delete-custom-item-description" className="mt-3 whitespace-pre-wrap text-sm leading-6">{`「${deleteTarget.label}」を削除しますか？\n保存すると削除が確定します。`}</p>
    <div className="mt-5 grid grid-cols-2 gap-3">
     <button type="button" autoFocus onClick={()=>setDeleteTarget(null)} className="rounded-xl border border-slate-300 bg-slate-100 px-3 py-3 font-bold text-slate-800">キャンセル</button>
     <button type="button" onClick={()=>{deleteUserItem(deleteTarget.id);setDeleteTarget(null)}} className="rounded-xl bg-rose-600 px-3 py-3 font-bold text-white">削除する</button>
    </div>
   </div>
  </div>}
  <div className="grid grid-cols-3 gap-2">{LABELS.map(c=><button key={c.id} onClick={()=>{setCategory(c.id);setItemId(null);setPartId(null);stop()}} className={button+' text-sm '+(category===c.id?'bg-blue-600':'bg-white/15')}>{c.label}</button>)}</div>
  <div className="rounded-xl border border-sky-300/40 bg-sky-950/40 px-3 py-3 text-sm leading-6" role="note">
   <p className="font-bold text-sky-100">☑ チェックOFFの項目は試合中に表示しません</p>
   {category==='offense'&&<p className="mt-1 text-xs text-slate-100">「試合開始時刻」「得点」のみ切替可能です。その他の攻撃項目は常にON（変更不可）。得点をOFFにしても、得点の記録・試合進行は続きます。</p>}
   {category==='defense'&&<p className="mt-1 text-xs text-slate-100">「投球数の放送」を開くと、回終了時（合計あり／なし）・事前お知らせ・到達時を個別に切り替えられます。OFFの放送モーダルは表示しません。</p>}
   {category==='other'&&<p className="mt-1 text-xs text-slate-100">OFFの項目は試合中の「その他」に表示しません。「グラウンド整備」「次の試合のお知らせ」は指定イニングのモーダルも非表示になります。</p>}
   <p className="mt-1 text-xs text-sky-100">※ 変更後は画面下の「保存」ボタンを押してください。</p>
  </div>
  {category==='other'&&!item&&<section className="rounded-xl border border-sky-300/40 bg-sky-950/40 p-3 space-y-2"><h2 className="font-bold">📄 アナウンスマニュアル</h2><p className="text-xs text-slate-200">PDFをこの端末に登録すると、カスタマイズモードの「連盟🎤マニュアル」から表示できます。設定グループごとに保存されます。</p><input ref={manualInputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={e=>void registerManual(e.target.files?.[0])}/><button type="button" disabled={manualBusy} className="w-full rounded-xl bg-blue-600 px-4 py-3 font-bold disabled:opacity-50" onClick={()=>manualInputRef.current?.click()}>アナウンスマニュアル追加</button>{manualName&&<div className="flex items-center gap-2"><span className="min-w-0 flex-1 break-all text-sm">登録済み：{manualName}</span><button type="button" disabled={manualBusy} onClick={()=>void deleteManual()} className="rounded-lg bg-rose-700 px-3 py-2 text-sm font-bold">削除</button></div>}{manualMessage&&<p role="status" className="text-xs text-yellow-200">{manualMessage}</p>}<p className="text-xs opacity-75">※ PDFはこの端末内に保存されます。QRコードによる設定共有には含まれません。</p></section>}
  {category==='other'&&!item&&<button type="button" className="w-full rounded-xl bg-emerald-600 px-4 py-3 font-bold" onClick={()=>{const title=window.prompt('新しいアナウンス項目名を入力してください');if(!title?.trim())return;const id=`userOther_${Date.now().toString(36)}`;setTexts(prev=>({...prev,[id]:{label:title.trim(),main:'',enabled:'true'}}));setDirty(true);setSaved(false);setItemId(id);setPartId('main');}}>＋ 追加（自由項目）</button>}
  {!item?<div className="space-y-2">{allItems.filter(x=>x.category===category).map(x=><div key={x.id} className="flex w-full items-center gap-3 rounded-xl border border-white/20 bg-white/10 px-3 py-3">
     {category!=='defense'&&<input type="checkbox" aria-label={`${x.label}を試合中に表示`} checked={customItemEnabled(texts,x.id)} disabled={category==='offense'&&!['startTime','score'].includes(x.id)} onChange={e=>setFlag(x.id,'enabled',e.target.checked)} className="h-6 w-6 shrink-0 accent-sky-500 disabled:opacity-60"/>}
     <button type="button" className="flex min-h-9 flex-1 items-center justify-between text-left" onClick={()=>{setItemId(x.id);setPartId(x.parts[0].id)}}><span className="font-semibold">{x.label}</span><span className="opacity-70">›</span></button>
     {x.id.startsWith('userOther_')&&<button type="button" aria-label={`${x.label}を削除`} onClick={()=>setDeleteTarget({id:x.id,label:x.label})} className="shrink-0 rounded-lg bg-rose-700 px-3 py-2 text-sm font-bold text-white active:scale-95">削除</button>}
     </div>)}</div>:
  <div className="space-y-4">
   <button className={button+' bg-white/15'} onClick={()=>{setItemId(null);setPartId(null);stop()}}>← {LABELS.find(x=>x.id===category)?.label}に戻る</button>
   <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold">{item.label}</h2>{item.id.startsWith('userOther_')&&<button type="button" onClick={()=>setDeleteTarget({id:item.id,label:item.label})} className="shrink-0 rounded-lg bg-rose-700 px-3 py-2 text-sm font-bold">削除</button>}</div>
   {item.id==='pitchCount'&&<div className="space-y-2 rounded-xl border border-sky-300/30 bg-sky-950/30 p-3"><p className="font-bold">表示する投球数の放送</p>{item.parts.map(p=><label key={p.id} className="flex items-center gap-3 rounded-lg bg-white/10 px-3 py-2"><input type="checkbox" className="h-5 w-5 accent-sky-500" checked={customPitchPartEnabled(texts,p.id)} onChange={e=>setFlag('pitchCount',`enabled:${p.id}`,e.target.checked)}/><span>{p.label}</span></label>)}</div>}
   {item.id==='nextGame'&&<div className="space-y-3 rounded-xl border border-sky-300/30 bg-sky-950/30 p-3"><h3 className="font-bold">モーダルを表示するイニング</h3><div className="grid grid-cols-2 gap-3"><label className="space-y-1"><span className="text-sm">回</span><select className="w-full rounded-xl bg-white p-3 text-slate-900" value={texts[item.id]?.triggerInning||(item.id==='ground'?'5':'4')} onChange={e=>setTiming(item.id as 'ground'|'nextGame','triggerInning',e.target.value)}>{Array.from({length:9},(_,i)=>String(i+1)).map(n=><option key={n} value={n}>{n}回</option>)}</select></label><label className="space-y-1"><span className="text-sm">表／裏</span><select className="w-full rounded-xl bg-white p-3 text-slate-900" value={texts[item.id]?.triggerSide||'bottom'} onChange={e=>setTiming(item.id as 'ground'|'nextGame','triggerSide',e.target.value)}><option value="top">表</option><option value="bottom">裏</option></select></label></div><p className="text-xs opacity-75">指定した回の終了時に表示するための設定です。</p></div>}

   {item.id==='intentionalWalk'&&<p className="text-xs opacity-75">この項目は試合中の「その他」メニューの一番上に表示されます。</p>}
   {item.id!=='startTime'&&item.id!=='suspendedGame'&&item.id!=='heat'&&<div className="space-y-2">{item.parts.map(p=><button key={p.id} onClick={()=>setPartId(p.id)} className={'w-full rounded-xl border px-3 py-3 text-left text-sm '+(part?.id===p.id?'border-blue-300 bg-blue-600/40':'border-white/20 bg-white/10')}>{p.label}</button>)}</div>}
   {item.id==='gameEnd'&&<label className="flex items-center gap-3 rounded-xl border border-white/20 bg-white/10 p-3"><input type="checkbox" className="h-5 w-5 accent-sky-500" checked={texts.gameEnd?.higherScoreFirst==='true'} onChange={e=>setFlag('gameEnd','higherScoreFirst',e.target.checked)}/><span>得点が多い方を先にする</span></label>}
   {item.id==='score'&&<label className="block space-y-2"><span className="font-semibold">無得点時の読み上げ</span><select className="w-full rounded-xl bg-white p-3 text-gray-900" value={texts.score?.noScoreEnabled||'false'} onChange={e=>{setTexts(prev=>({...prev,score:{...prev.score,noScoreEnabled:e.target.value}}));setDirty(true);setSaved(false)}}><option value="false">読み上げなし</option><option value="true">読み上げあり</option></select><p className="text-xs opacity-75">読み上げなしの場合、無得点時の文章は保存されますが、実際の放送では表示しません。</p></label>}
   {item.id==='startTime'&&<label className="block space-y-2"><span className="font-semibold">表示タイミング</span><select className="w-full rounded-xl bg-white p-3 text-gray-900" value={texts.startTime?.timing||'afterFirstPitch'} onChange={e=>{setTexts(prev=>({...prev,startTime:{...prev.startTime,timing:e.target.value}}));setDirty(true);setSaved(false)}}>{START_TIME_TIMINGS.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}</select></label>}
   <label className="block space-y-2"><span className="font-semibold">読み上げ文章</span><textarea ref={textareaRef} value={text} onChange={e=>setText(e.target.value)} rows={5} className="w-full rounded-xl bg-white p-3 text-base text-gray-900" spellCheck={false}/></label>
   <label className="block space-y-2"><span className="font-semibold">読み上げメモ（任意・読み上げません）</span><textarea value={memo} onChange={e=>setMemo(e.target.value)} rows={2} placeholder="例：ファールボールがバックネット裏、観客席などへ飛んだ時" className="w-full rounded-xl bg-white p-3 text-base text-gray-900"/><span className="text-xs opacity-75">入力した場合のみ、アナウンスの上に薄黄色で表示します。</span></label>
   {!!part?.tokens.length&&<div className="space-y-2"><p className="text-sm font-semibold">差し込み項目（カーソル位置へ挿入）</p><div className="flex flex-wrap gap-2">{part.tokens.map(t=><button key={t} className={button+' border border-white/30 bg-white/10 text-sm'} onClick={()=>insert(t)}>＋{t}</button>)}</div></div>}
   {!!bad.length&&<p className="rounded-lg bg-red-700/60 p-3 text-sm">未対応の差し込み項目：{Array.from(new Set(bad)).join('、')}</p>}
   <div className="rounded-xl border border-rose-300/30 bg-rose-950/35 p-3 space-y-3"><h3 className="font-bold">🎙 アナウンス文言プレビュー</h3>{previewMemo.trim()&&<div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">⚠️ {previewMemo}</div>}<p className="whitespace-pre-wrap leading-7">{preview||'（文章が空です）'}</p><div className="grid grid-cols-2 gap-2"><button className={button+' bg-blue-600'} onClick={speak}>🔊 読み上げ</button><button className={button+' bg-rose-600'} onClick={stop}>■ 停止</button></div>{speechError&&<p className="text-xs text-yellow-200">{speechError}</p>}</div>
   {(item.id==='defenseChange'||item.id==='pitchCount')&&<div className="rounded-xl border border-sky-300/30 bg-sky-950/30 p-3 space-y-2"><h3 className="font-bold">例題文章（選択行に合わせた通しの文章）</h3><p className="whitespace-pre-wrap leading-7">{example||'（文章が空です）'}</p></div>}
   {item.id==='defenseChange'&&<p className="rounded-xl bg-white/10 p-3 text-sm leading-6">例題の開始文は選択した種類（選手交代のみ／守備変更のみ／両方）に合わせて変わります。実際の試合では選手交代データに応じて開始文を自動選択します。</p>}
  </div>}
  <div className="sticky bottom-2 rounded-xl bg-slate-900/95 p-2 shadow-xl"><button className={button+' w-full '+(dirty?'bg-emerald-600':'bg-blue-700')} disabled={!!bad.length} onClick={save}>{dirty?'カスタマイズ設定に保存':'保存済み（再保存）'}</button>{saved&&<p className="mt-1 text-center text-xs text-green-200">この端末に保存しました</p>}</div>
  <p className="text-xs opacity-65">チェックOFFの項目は試合中の対応する表示・放送モーダルから除外します（得点記録など試合進行に必要な処理は維持）。設定は選択中のカスタマイズグループに保存されます。</p>
 </div>;
}
