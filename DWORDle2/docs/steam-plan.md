# DWORDle2 Steam 化 作業計画

2026-08-06 の議論を整理したもの。次の AI セッションはこのファイルを読めば文脈を再現できる。

## 前提（調査済みの事実）

- DWORDle2 は完全静的な Web アプリ。外部 CDN 依存なし（Three.js は `vendor/` に同梱、MIT ライセンス表記あり）。音は全て WebAudio リアルタイム合成で音源ファイル不要。**オフライン単体で動くゲーム本体はほぼ完成している**。
- `tools/build.mjs` は minify + sourcemap なしの `dist/` を吐く（ソース非公開の意図がコメントに明記済み）。
- 外部への通信は Google Analytics (gtag) と Twitter シェアインテントのみ。gtag は `js/core/analytics.js` + `js/ui/consent-banner.js` などで参照。
- ゲーム内実績・セーブ（localStorage）・デイリー問題（日付計算のみ、サーバー不要）は自前実装済み。
- 単語リストの出典: gwordlist / powerlanguage/word-lists（js 内に URL 記載あり）。

## 方針（議論で決めた/傾いていること）

- **統一コードベース**: ゲーム本体は 1 つ。プラットフォーム差分は `js/platform/` のアダプタ層（`web.js` / `desktop.js`）に隔離し、Web 版と Steam 版で 1 ソース 2 出力にする。
- **配布形態**: 無料配布 (Free to Play) が現実的。Web 版が無料公開のままなので有料販売は厳しい。Steam 実績・Cloud・Deck 対応を付加価値と位置づける。
  - 注意: 一度無料で出すと後から有料化は原則不可（逆は可能）。着手前に最終決定する。
- **ソース非公開化**: GitHub Pro は不要。ソースを無料の Private リポジトリへ移し、GitHub Actions で minify 済み `dist/` だけを Public の `kakira9618.github.io` へ自動デプロイする。
  - クライアントサイドゲームのソースは原理的に隠しきれない（minify が実質の上限）。Electron の asar も展開可能。割り切る。
  - 既に Public だった履歴は回収不能（clone/fork 済みの人の手元には残る）。

## カレンダー上の制約（重要）

作業時間は AI 併用で数日でも、**Valve の手続きで最短 3〜4 週間かかる**：

- Steamworks アカウント登録 + 税務情報 (W-8BEN)・銀行口座の確認: 数日
- Steam Direct 登録料 **$100/タイトル**（無料ゲームでも必要。無料だと売上返金なし＝純出費）
- ストアページの「Coming Soon」公開が**リリース前に最低 2 週間**必須（短縮不可）
- ストアページ審査・ビルド審査: 各 2〜5 営業日

→ 技術作業と手続きを並行させる。**Phase 6（手続き）を最初に着火するのが正しい順序**。

---

## 作業フェーズ

### Phase 0: 意思決定（着手前に確定）

- [ ] 無料 / 有料の最終決定（無料→有料は不可逆）
- [ ] Web 版は継続公開するか（→ 継続前提で計画している）
- [ ] 英語 UI 対応をやるか（出題は英単語・UI は日本語のみ。グローバル露出を狙うなら必要だが i18n 機構が今はなく一定の工事）

### Phase 1: リポジトリ分割（Steam 化と独立に価値あり）

- [ ] 無料 Private リポジトリを新設し、DWORDle2 のソース一式を移す
- [ ] GitHub Actions: Private リポジトリへの push → `npm run build` → `dist/` を `kakira9618.github.io` へデプロイ
- [ ] `kakira9618.github.io` 側の生ソースを dist 配信に置き換え（現状はソースそのまま配信＝リポジトリだけ隠しても意味が薄い）
- [ ] `npm run test:dist` が通ることを確認

### Phase 2: プラットフォームアダプタ抽出（Web 版単独のリファクタとして先行可）

- [ ] localStorage 直叩き箇所を全て洗い出し、アダプタ経由に寄せる（セーブ構造は `migrate.test.mjs` がある程度整理済み）
- [ ] `js/platform/index.js`（`window.__desktop__` の有無で選択）+ `web.js` + `desktop.js` を新設
  - 抽象例: `platform.save(data)` / `platform.share(text)` / `platform.onAchievement(id)`
- [ ] Web 版だけに分岐: Service Worker 登録、gtag / consent-banner、Twitter インテント
- [ ] desktop 版の挙動: SW なし、analytics なし（外すのが無難）、シェアは外部ブラウザ起動
- [ ] コアロジック・UI・WebAudio・Three.js 演出・実績システムは分岐不要（触らない）
- [ ] 既存テスト（parity / ui-smoke ほか）が全て通ることを確認

### Phase 3: Electron ガワ

配置: Private リポジトリ内に `desktop/` を追加。

```
DWORDle2/
  js/ css/ test/ tools/   ← 共通（今のまま）
  dist/                   ← 共通ビルド出力
  desktop/
    package.json          ← electron / electron-builder / steamworks.js
    main.js  preload.js   ← ガワ数百行
```

- [ ] `desktop/` セットアップ（Electron。Steamworks 連携の実績がある steamworks.js が使えるため Tauri より Electron 推奨）
- [ ] preload で `window.__desktop__` にファイル I/O と Steamworks API を公開
- [ ] セーブを JSON ファイル書き出しに（Electron プロファイル内 localStorage は消えやすく Steam Cloud 対象にしにくい）
- [ ] Web 版 localStorage → ファイルセーブへの移行パス（既存プレイヤーのインポート）
- [ ] ウィンドウ対応: フルスクリーン切替 / 任意リサイズ / マルチモニタ DPI
- [ ] `?v=` キャッシュトークン機構は desktop では素通し（害なし、対応不要）

### Phase 4: Steam 機能連携

- [ ] Steamworks パートナーサイトに実績を定義登録
- [ ] ゲーム内実績解除 → Steam へ通知する**片方向同期フック 1 本**（二重管理にしない）
- [ ] Steam Cloud 設定（ファイルセーブ前提）
- [ ] Steam オーバーレイの動作確認（Electron はフラグ調整が要ることが多い）

### Phase 5: 入力・表示（技術的に一番重い見込み）

- [ ] Steam Deck: 1280×800 での表示確認
- [ ] ゲームパッドでの文字入力: パッド用オンスクリーンキーボード UI を自作するか、Steam 入力の仮想キーボードに頼るかを決めて実装
- [ ] タッチ操作の確認（Deck 実機 or シミュレーション）

### Phase 6: 手続き・素材（技術作業と並行で最初に着火）

- [ ] Steamworks 登録（$100、税務情報 W-8BEN、銀行口座）
- [ ] ストア素材の制作:
  - カプセル画像（ヘッダー 460×215 / メイン 616×353 / 縦型 600×900 ほか複数サイズ。既存の og 画像だけでは不足）
  - スクリーンショット 5 枚以上
  - できればトレーラー動画
- [ ] 年齢レーティングアンケート回答（ワードパズルなので短時間）
- [ ] 単語リストのライセンス確認（gwordlist / powerlanguage。無料配布なら概ね低リスクだが、powerlanguage は Wordle 由来で権利が微妙な領域）
- [ ] ストアページ公開 →「Coming Soon」2 週間待機
- [ ] プライバシーポリシー（desktop 版で analytics を外すなら不要になる可能性。残すなら掲示必須）

### Phase 7: リリース

- [ ] ビルドを Steam にアップロード、ビルド審査
- [ ] Deck 実機 or Proton 環境での最終確認
- [ ] リリース。以降の更新は Steam デポ配信（Web 版の SW/`?v=` 更新と二本立て）

---

## 期待値の整理（集客について）

- 「Steam に無料で置けば人が来る」は期待できない（1 日 50 本超のリリースに埋もれ、無料タイトルは露出アルゴリズム上もむしろ弱い。外部で話題にならなければ数百 DL 程度が大半）。
- 有利な材料: 実績が充実（実績ハンター層）、Deck 対応（「Deck で遊べるワードパズル」枠）、無料はレビューが付きやすい。
- 最大の制約は「日本語 UI + 英単語ゲー」の組み合わせ。**人に届ける目的なら英語 UI 化 + Wordle コミュニティ（Reddit r/wordle 等）への露出の方が Steam 掲載自体より効く**。
