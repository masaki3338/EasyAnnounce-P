import localForage from 'localforage';

// PDFはlocalStorageではなくIndexedDBへ保存する（カスタマイズ設定ごと）。
const storage = localForage.createInstance({name:'EasyAnnounceCustomManual',storeName:'manual_pdfs'});
export type CustomManualPdf = {name:string; blob:Blob; updatedAt:number};
const key=(profileId:string)=>`manual:${profileId}`;
export async function getCustomManualPdf(profileId:string):Promise<CustomManualPdf|null>{
 return (await storage.getItem<CustomManualPdf>(key(profileId)))||null;
}
export async function saveCustomManualPdf(profileId:string,file:File):Promise<void>{
 if(!file || (file.type!=='application/pdf'&&!file.name.toLowerCase().endsWith('.pdf')))throw new Error('PDFファイルを選択してください。');
 const header=new Uint8Array(await file.slice(0,5).arrayBuffer());
 if(String.fromCharCode(...header)!=='%PDF-')throw new Error('有効なPDFファイルではありません。');
 await storage.setItem(key(profileId),{name:file.name,blob:file,updatedAt:Date.now()});
}
export async function removeCustomManualPdf(profileId:string):Promise<void>{await storage.removeItem(key(profileId));}
