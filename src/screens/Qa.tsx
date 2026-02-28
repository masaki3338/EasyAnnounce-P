// ./screens/Qa.tsx
import React from "react";

type Props = { onBack: () => void };

const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="rounded-2xl bg-white/10 border border-white/10 p-4 shadow-lg">
    {children}
  </div>
);

const QAItem: React.FC<{ q: string; children: React.ReactNode; defaultOpen?: boolean }> = ({
  q,
  children,
  defaultOpen,
}) => (
  <details
    className="rounded-2xl bg-white/10 border border-white/10 p-4 shadow-lg"
    open={defaultOpen}
  >
    <summary className="font-semibold cursor-pointer select-none">
      {q}
    </summary>
    <div className="mt-3 text-sm leading-relaxed opacity-90">
      {children}
    </div>
  </details>
);

export default function Qa({ onBack }: Props) {
  return (
    <div
      className="min-h-[100svh] bg-gradient-to-b from-gray-900 to-gray-800 text-white px-6"
      style={{
        paddingTop: "max(16px, env(safe-area-inset-top))",
        paddingBottom: "max(16px, env(safe-area-inset-bottom))",
      }}
    >
      <div className="w-full max-w-2xl mx-auto">
        {/* ヘッダー */}
        <div className="py-4 flex items-center justify-between">
          <button
            className="px-4 py-2 rounded-full bg-white/10 border border-white/10 hover:bg-white/15 transition"
            onClick={onBack}
          >
            ← 戻る
          </button>

          <div className="text-center select-none">
            <div className="text-xl font-extrabold tracking-wide">Q＆A</div>
            <div className="text-xs opacity-70 -mt-0.5">使い方・よくある質問</div>
          </div>

          <div className="w-[72px]" />
        </div>

        {/* 本文 */}
        <div className="space-y-3 pb-6">
          <QAItem q="Q. インストール方法がわかりません" defaultOpen>
            <p>
              本アプリは、通常のApp Store／Google Playからダウンロードするアプリではありません。
              <br />
              WEBアプリ（PWA）形式のため、ブラウザから開いて「ホーム画面に追加」して使用します。
              <br />
              一度追加すると、通常のアプリと同じように使用できます。
            </p>

            <div className="mt-3">
              <div className="font-semibold">📱 アプリをホーム画面に追加する方法</div>

              <div className="mt-2 space-y-3">
                <Card>
                  <div className="font-semibold">▼ Androidの場合（Chrome）</div>
                  <ol className="list-decimal pl-5 mt-2 space-y-1">
                    <li>画面右上の「︙」メニューを開く</li>
                    <li>「アプリをインストール」または「ホーム画面に追加」を選択</li>
                    <li>「インストール」をタップ</li>
                  </ol>
                  <div className="mt-2 text-xs opacity-80">
                    ホーム画面にアイコンが追加されます。
                  </div>
                </Card>

                <Card>
                  <div className="font-semibold">▼ iPhone／iPadの場合（Safari）</div>
                  <ol className="list-decimal pl-5 mt-2 space-y-1">
                    <li>画面下の「共有」ボタン（⬆️）をタップ</li>
                    <li>「ホーム画面に追加」を選択</li>
                    <li>名前を確認して「追加」をタップ</li>
                  </ol>
                  <div className="mt-2 text-xs opacity-80">
                    ホーム画面にアイコンが追加されます。
                  </div>
                </Card>
              </div>
            </div>
          </QAItem>

          <QAItem q="Q. 試合中に画面を閉じてしまいました">
            <p>
              問題ありません。メニュー画面の【試合を継続する】ボタンで復帰できます。
            </p>
          </QAItem>

          <QAItem q="Q. 通信環境がなくても使えますか？">
            <p>
              はい。インストール後は基本的にオフラインで使用できます。
              <br />
              ※初回インストール時は通信環境が必要です。
            </p>
          </QAItem>

          <QAItem q="Q. チーム・選手登録したデータを他の端末で使えますか？">
            <p>
              はい、可能です。【バックアップ保存】を行い、他端末で【バックアップ読込】を行うことで復元できます。
            </p>
          </QAItem>

          <QAItem q="Q. セキュリティは大丈夫ですか？">
            <p>
              本WEBアプリはインストール後、基本的にオフラインで使用します。
              <br />
              データは端末内に保存され、外部へ送信・共有されることはありません。
              <br />
              個人情報が外部に送信されることはありません。
            </p>
          </QAItem>

          <QAItem q="Q. 文字が小さくて見づらいです">
            <p>
              推奨端末は <b>7インチ以上のタブレット</b> です。
              <br />
              スマートフォンでも使用可能ですが、操作性・視認性の面からタブレット利用を推奨します。
            </p>
          </QAItem>

          <QAItem q="Q. 読み上げ音声が機械的に感じます">
            <p>
              現在は標準音声を使用しています。
              <br />
              今後のアップデートで、より滑らかで自然な音声へ改善予定です。
            </p>
          </QAItem>

          <QAItem q="Q. 大会ごとにルールが違う場合対応できますか？">
            <p>
              【運用設定画面】で規定投球数、タイブレークルールの変更が可能です。
            </p>
          </QAItem>
        </div>
      </div>
    </div>
  );
}