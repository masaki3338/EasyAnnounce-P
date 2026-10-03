import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

// PWAの登録だけを行う。ここではcontrollerchange時の自動再読み込みをしない。
// 画面の更新・再読み込みはApp.tsxの初期メニュー判定と手動更新に任せる。
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  const base = new URL(import.meta.env.BASE_URL, window.location.origin);
  void navigator.serviceWorker.register(new URL("sw.js", base).href, {
    scope: base.pathname,
    updateViaCache: "none",
  }).catch((error) => {
    console.warn("[PWA] Service Workerの登録に失敗しました。", error);
  });
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
