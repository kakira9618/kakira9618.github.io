// 分析モードの Worker。重い候補ペア計算を UI スレッドから隔離する。
// module worker として起動される（ui/analysis-screen.js 参照）。

import { analyzeGame } from "./analysis-core.js?v=20260722-unlock-analysis";

self.onmessage = (e) => {
  const params = e.data;
  try {
    const result = analyzeGame(params, (ratio, label) => {
      self.postMessage({ type: "progress", ratio, label });
    });
    self.postMessage({ type: "done", result });
  } catch (err) {
    self.postMessage({ type: "error", message: String(err?.message ?? err) });
  }
};
