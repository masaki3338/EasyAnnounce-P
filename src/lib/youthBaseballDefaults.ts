import {bundledPreGameItems, bundledInGameTexts} from './bundledCustomDefaults';

/** 学童野球サンプル。連盟共通の統一アナウンスを示すものではありません。 */
export const youthPreGameItems = (structuredClone(bundledPreGameItems) as any[]).map((item:any)=>{
  const set=(i:number,s:string)=>{if(item.segments[i])item.segments[i].text=s;};
  switch(item.kind){
    case 'startTime': set(0,'【1塁側チーム名】、【3塁側チーム名】の監督または代表者の方は、メンバー表をお持ちのうえ、本部までお越しください。');break;
    case 'warmup': set(0,'【チーム名】の皆さん、ウォーミングアップを開始してください。');set(1,'ウォーミングアップは、残り【残り分数】分です。');set(2,'ウォーミングアップを終了してください。');break;
    case 'sheetKnock':
      set(0,`【${item.target==='top'?'先攻':'後攻'}チーム名】、シートノックを始めてください。時間は【ノック時間】分間です。`);
      set(1,'シートノックは、残り【残り時間】分です。');
      set(2,'シートノックを終了してください。');break;
    case 'lineup':
      if(item.target==='top')set(0,'お待たせいたしました。【大会名】、第【試合番号】試合、【先攻チーム名】対【後攻チーム名】の試合に先立ちまして、両チームのスターティングメンバーをご紹介します。\n先攻、【先攻チーム名】。\n【打順】番、【守備位置】、【選手名（フルネーム）】くん、背番号【背番号】。\n先発ピッチャーは、【投手名(フルネーム)】くん、背番号【投手背番号】。');
      else set(0,'続きまして、後攻、【後攻チーム名】。\n【打順】番、【守備位置】、【選手名（フルネーム）】くん、背番号【背番号】。\n先発ピッチャーは、【投手名(フルネーム)】くん、背番号【投手背番号】。\nこの試合の審判員をご紹介します。球審、【球審名】。一塁塁審、【1塁審名】。二塁塁審、【2塁審名】。三塁塁審、【3塁審名】。\n試合開始まで、今しばらくお待ちください。');break;
    case 'seat':
      for(let i=0;i<item.segments.length;i++)set(i,`1回の${item.segments[i].seatSide==='top'?'裏':'表'}、守備につきます【チーム名】の選手をご紹介します。\n【守備位置】、【選手名（フルネーム）】くん。`);break;
    case 'ground':set(0,'ただいまからグラウンド整備を行います。選手の皆さんは、ベンチでお待ちください。');break;
    case 'greeting':set(0,'本日はご来場ありがとうございます。まもなく、学童野球の試合が始まります。選手の皆さんに、温かいご声援をお願いいたします。');break;
  }
  return item;
});

export const youthInGameTexts: Record<string, Record<string,string>>=structuredClone(bundledInGameTexts);
Object.assign(youthInGameTexts,{
  startTime:{...youthInGameTexts.startTime,main:'お知らせいたします。この試合の開始時刻は【開始時刻】です。'},
  batter:{...youthInGameTexts.batter,leadoff:'【回】回の【表裏】、【チーム名】の攻撃は、',first:'【打順】番、【守備位置】、【選手名（フルネーム）】くん。背番号【背番号】。',later:'【打順】番、【守備位置】、【選手名（フルネーム）】くん。'},
  pinchHitter:{...youthInGameTexts.pinchHitter,main:'【打順】番、【交代前選手名（苗字）】くんに代わりまして、代打、【交代後選手名（苗字）】くん。背番号【交代後背番号】。',leadoff:'【打順】番、【交代前選手名（苗字）】くんに代わりまして、代打、【交代後選手名（苗字）】くん。背番号【交代後背番号】。'},
  pinchRunner:{...youthInGameTexts.pinchRunner,main:'【塁(ファースト/セカンド/サード)】ランナー、【交代前選手名（苗字）】くんに代わりまして、代走、【交代後選手名（苗字）】くん。背番号【交代後背番号】。'},
  courtesyRunner:{...youthInGameTexts.courtesyRunner,main:'【交代前選手名（苗字）】くんに代わり、臨時代走は【交代後選手名（苗字）】くんです。'},
  defenseChange:{...youthInGameTexts.defenseChange,introPlayer:'【チーム名】、選手の交代をお知らせします。',introPosition:'【チーム名】、守備位置の変更をお知らせします。',introBoth:'【チーム名】、選手の交代と守備位置の変更をお知らせします。'},
  water:{...youthInGameTexts.water,start:'これより給水タイムとします。選手の皆さんは、水分を補給してください。ご来場の皆様も、熱中症に十分お気をつけください。',end:'給水タイムを終了します。'},
  foul:{...youthInGameTexts.foul,main:'ファールボールにご注意ください。小さなお子様をお連れの方は、特にご注意ください。'},
  gameEnd:{...youthInGameTexts.gameEnd,main:'ただいまをもちまして、【先攻チーム名】対【後攻チーム名】の試合は終了しました。選手の皆さんに、温かい拍手をお願いいたします。'},
  heat:{...youthInGameTexts.heat,notice:'選手の皆さん、こまめな水分補給をお願いいたします。観客の皆様も、熱中症にご注意ください。'},
});
