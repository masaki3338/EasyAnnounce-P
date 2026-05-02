// src/lib/displaySizeSettings.ts
// 端末の画面サイズに合わせて、アプリ全体の表示倍率を自動調整します。
// 手動設定は不要です。

type WindowSize = {
  width: number;
  height: number;
  shortSide: number;
  longSide: number;
};

const getWindowSize = (): WindowSize => {
  if (typeof window === "undefined") {
    return { width: 390, height: 844, shortSide: 390, longSide: 844 };
  }

  const width = window.innerWidth || 390;
  const height = window.innerHeight || 844;

  return {
    width,
    height,
    shortSide: Math.min(width, height),
    longSide: Math.max(width, height),
  };
};

const clamp = (value: number, min: number, max: number) => {
  return Math.min(max, Math.max(min, value));
};

export const getAutoDisplayScale = () => {
  const { shortSide, longSide } = getWindowSize();

  // スマホは今までに近い大きさ。
  if (shortSide < 600) {
    if (longSide >= 900 && shortSide >= 430) return 1.08;
    return 1;
  }

  // タブレットは「下の空白が目立つ」ため、前回より強めに拡大します。
  // 600px〜1000pxの短辺に応じて 1.22〜1.50倍。
  if (shortSide < 1000) {
    const t = (shortSide - 600) / 400;
    return Number(clamp(1.22 + t * 0.28, 1.22, 1.5).toFixed(3));
  }

  // 大型タブレット・PC表示。
  if (shortSide < 1200) return 1.55;
  return 1.62;
};

export const getAutoDeviceSizeName = () => {
  const { shortSide } = getWindowSize();

  if (shortSide >= 1000) return "large-tablet";
  if (shortSide >= 600) return "tablet";
  return "phone";
};

export const applyAutoDisplaySizeMode = () => {
  if (typeof document === "undefined") return;

  const { shortSide, longSide } = getWindowSize();
  const scale = getAutoDisplayScale();
  const deviceSize = getAutoDeviceSizeName();

  document.documentElement.style.setProperty("--app-scale", String(scale));
  document.documentElement.style.setProperty("--app-short-side", `${shortSide}px`);
  document.documentElement.style.setProperty("--app-long-side", `${longSide}px`);
  document.documentElement.dataset.displaySizeMode = "auto";
  document.documentElement.dataset.deviceSize = deviceSize;
};

export const setupAutoDisplaySizeMode = () => {
  if (typeof window === "undefined") return () => {};

  applyAutoDisplaySizeMode();

  let timer: number | undefined;

  const handleResize = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      applyAutoDisplaySizeMode();
    }, 80);
  };

  window.addEventListener("resize", handleResize);
  window.addEventListener("orientationchange", handleResize);

  return () => {
    window.clearTimeout(timer);
    window.removeEventListener("resize", handleResize);
    window.removeEventListener("orientationchange", handleResize);
  };
};

// 以前の「手動設定版」を一部の画面が import していても落ちないように残します。
export type AppDisplaySizeMode = "normal" | "large" | "xlarge";

export const getDisplaySizeMode = (): AppDisplaySizeMode => "normal";
export const setDisplaySizeMode = () => {
  applyAutoDisplaySizeMode();
};
export const getDisplaySizeLabel = () => "自動";
export const applyDisplaySizeMode = () => {
  applyAutoDisplaySizeMode();
};
