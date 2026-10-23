# speech-clock-dub

[![CI](https://github.com/Nexplico-Ltd/speech-clock-dub/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Nexplico-Ltd/speech-clock-dub/actions/workflows/ci.yml)

[English](README.md) | **日本語** | [한국어](README.ko.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md)

> これは英語版 [README.md](README.md) の日本語訳です。内容が食い違う場合は英語版が正です。翻訳は更新が遅れることがあります。

YouTube の講義動画向けの吹き替えツール。映像が音声に合わせて動きます。

YouTube の講義動画を、日本語・英語・繁体字中国語・簡体字中国語・韓国語に吹き替える Chrome（MV3）拡張機能です。スライドが中心の動画を想定しています。翻訳した音声を映像に合わせて詰め込むのではなく、**映像のほうが音声に合わせて動きます**。

## 仕組み

```
YouTube 字幕 -> 文単位の cue -> LLM 翻訳 -> TTS (VOICEVOX / edge-tts) -> Web Audio キュー
                                                                            |
                              <video> の playbackRate / pause / play  <------+
```

- 合成した音声が主時計です。元の音声はミュートされます。
- 各 cue で、映像の `playbackRate` を `cue の残り時間 / 音声の長さ` に設定します（`[minRate, maxRate]` の範囲に収めます）。
- 音声が cue の映像区間より長い場合、音声が終わるまで映像を一時停止します（スライドが静止します）。音声のほうが短い場合は、次の cue まで映像を速めに進めます。
- cue と cue の間の長い無音は、`gapRate` で通過します。
- 先読みのプロデューサーループが、再生に先行して cue を翻訳・音声合成します。翻訳は順番に実行し（各翻訳は直前までの訳を文脈として受け取ります）、音声合成は最大 `concurrency` 件の cue を並列に実行します。クラウド TTS は 1 リクエストに数秒かかるため、これが効きます。cue の境界で、準備済みの音声が `lowWaterSec` 秒分を下回っていたら映像を一時停止し、`highWaterSec` 秒分が溜まってから再開します（ヒステリシス）。映像が従属側なので、バッファが尽きても同期はずれず、映像が止まるだけです。文の途中で再生が中断されることはありません。
- ユーザーが一時停止・再生すると音声も一時停止・再開します。ユーザーがシークすると、cue の位置を再同期します。広告は検出され（`.ad-showing`）、その間スケジューラは停止します。

## 必要なもの

1. **OpenAI 互換の LLM エンドポイント**（例: Unsloth サービス）で、Gemma 12B クラスのモデルを動かします。オプションページで `llmBaseUrl`（`/v1` で終わる URL）と `llmModel` を設定してください。拡張機能は `POST {llmBaseUrl}/chat/completions` を呼び出します。
2. **VOICEVOX エンジン**（オープンソースで高品質な日本語 TTS）:

   ```
   # GPU（nvidia-container-toolkit が必要）。イメージの既定コマンドがすでに
   # --use_gpu --host 0.0.0.0 を渡しているので、引数を追加しないでください（既定コマンドが置き換わります）。
   docker run -d --rm --name voicevox --gpus all -p 50021:50021 voicevox/voicevox_engine:nvidia-latest
   # CPU のみ
   docker run --rm -p 50021:50021 voicevox/voicevox_engine:cpu-latest
   ```

   VOICEVOX が必要とする VRAM は 1〜2 GB 程度なので、16 GB の GPU で 12B の LLM と同居できます。

   声のキャラクターごとに利用規約があります。吹き替えた動画を公開する前に確認してください。
   `speakerFemale` / `speakerMale` は VOICEVOX のスタイル ID です（`GET /speakers` で一覧できます）。

   **VRAM:** VOICEVOX は、声を追加するたびに GPU に別のモデルを読み込みます。12B の LLM が 16 GB のカードのほぼ全部を確保していると（たとえばコンテキストウィンドウが非常に大きい場合）、最初の声は動いても、別の声が CUDA のメモリ不足で失敗することがあります（`/synthesis` が HTTP 500）。吹き替えに必要な LLM のコンテキストは数千トークンで足りるので、モデルを読み込むときにコンテキスト長を下げてください。16 GB の RTX 4060 Ti と Gemma 4 12B（Q4）での実測: コンテキスト 262144 トークンでは llama-server が 14.2 GB を使い（空きは約 0.5 GB で、男性の声は失敗）、16384 では 9.5 GB でした（VOICEVOX を読み込んだ状態で空き約 3.9 GB、両方の声が動作）。翻訳も速くなりました（1 文 0.5 秒 -> 0.3 秒）。

   代わりに VOICEVOX を CPU で動かすこともできます（1 文あたり実時間の約 0.5 倍）。イメージのコマンドを上書きして `--use_gpu` を外します: `... voicevox_engine:nvidia-latest gosu user /opt/voicevox_engine/run --host 0.0.0.0`。

3. **edge-tts ブリッジ**（日本語以外をターゲットにする場合。VOICEVOX よりこちらを使いたい場合は日本語でも）。edge-tts は非公式 API 経由で Microsoft のオンライン音声サービスを使うため、**翻訳したテキストが Microsoft に送信されます**。インターネット接続が必要で、サービスの変更で動かなくなる可能性があります。拡張機能からは、小さなローカル HTTP ブリッジを通して使います:

   ```
   python3 -m venv .venv && .venv/bin/pip install edge-tts
   .venv/bin/python tools/edge_tts_server.py        # 127.0.0.1:5050 で待ち受け
   ```

   `--port` でポートを変えられます（その場合は `edgeUrl` も更新してください）。1 文あたり 2〜3 秒かかりますが、バッファが溜まれば並列プロデューサーが隠してくれます。ただし、最初の再生開始までは VOICEVOX より時間がかかります。

`host_permissions` に入っているのは `localhost` / `127.0.0.1` だけです。LLM を別のホストで動かす場合は、`extension/manifest.json` の `host_permissions` に追加してください。

## ターゲット言語

オプションページで `targetLang` を設定します:

| `targetLang` | 言語 | edge-tts の既定の声（女性） |
| --- | --- | --- |
| `ja` | 日本語 | `ja-JP-NanamiNeural`（既定では VOICEVOX を使用） |
| `en` | 英語 | `en-US-AriaNeural` |
| `zh-TW` | 繁体字中国語（台湾） | `zh-TW-HsiaoChenNeural` |
| `zh-CN` | 簡体字中国語 | `zh-CN-XiaoxiaoNeural` |
| `ko` | 韓国語 | `ko-KR-SunHiNeural` |

`voiceGender`（`female` または `male`）で声を選びます:

| `targetLang` | female | male |
| --- | --- | --- |
| `ja`（VOICEVOX） | スタイル `2`（四国めたん） | スタイル `11`（玄野武宏） |
| `ja`（edge-tts） | `ja-JP-NanamiNeural` | `ja-JP-KeitaNeural` |
| `en` | `en-US-AriaNeural` | `en-US-GuyNeural` |
| `zh-TW` | `zh-TW-HsiaoChenNeural` | `zh-TW-YunJheNeural` |
| `zh-CN` | `zh-CN-XiaoxiaoNeural` | `zh-CN-YunxiNeural` |
| `ko` | `ko-KR-SunHiNeural` | `ko-KR-InJoonNeural` |

`ttsProvider` の既定は `auto` で、`ja` は VOICEVOX、それ以外は edge-tts を使います。`edgeVoice` で edge-tts の声を上書きでき（`.venv/bin/edge-tts --list-voices` で一覧できます）、`edgeRate`（例: `+10%`）で速度を変えられます。言語を追加するには、`extension/defaults.js` の `YTD_LANGS` にエントリを追加します。

`speakerVoices`（既定は `off`）は、インタビューやポッドキャストのような対話向けです。手動字幕の多くは、話者の交代を行頭の `- ` や `>>` で示しています。`alternate` にすると、この印を本文から取り除き、話者が替わるたびに声を切り替えます。最初の話者には `voiceGender` の声、もう一人には反対の性別の声を使います。印には名前がないため、対応できるのは 2 人までです。また、自動生成字幕には通常この印がありません。

印のない字幕向けに、実験的な `llm` モードもあります。翻訳に使う LLM が、15 cue ごとにテキストだけを見て、どの行が司会者（`voiceGender` の声）で、どの行がゲスト（反対の性別の声）かを判定します。プロンプトはインタビューを想定しており、15 cue あたり約 1 回のリクエストが増えます。自動生成字幕でも使えます。印を取り除いた Lex Fridman #494 の字幕での事前テスト（Gemma 4 12B、300 文 × 3 区間）では、話者交代の 70〜80% を同程度の適合率で検出できました。交代を見逃すと、しばらく声の役割が入れ替わることがあり、リクエストが失敗した場合は直前の声のままになります。話者を確実に識別するものではなく、おおまかな補助として使ってください。

## 画面上の字幕

プレイヤーの **Sub** ボタンで、`off` -> `translated` -> `both`（訳＋原文）と切り替わります。選択は `subtitles` 設定（既定は `off`）に保存されます。いま喋っている cue のテキストがプレイヤー下部に表示され、cue の間は非表示になります。ユーザーが一時停止している間は表示されたままです。フォントはプレイヤーの幅に合わせて拡縮するので、全画面でも使えます。YouTube 自身の字幕行より上に表示されるため、YouTube の字幕がオンでも重なりません。 長い文は、最大 `subtitleMaxLines` 行（既定 2、`0` で無制限）のページに分けて表示され、ページは音声の進みに合わせて切り替わります。そのため、字幕が映像を大きく隠すことはありません。`both` では、訳と原文をそれぞれ別に制限します。

## インストール（開発用）

1. `chrome://extensions` を開き、デベロッパー モードを有効にして「パッケージ化されていない拡張機能を読み込む」を押し、`extension/` を選びます。
2. 拡張機能のオプションページを開き、設定を調整します。
3. 字幕付きの YouTube 動画を開き、プレイヤー左上の **Dub (xx)** を押します（**Sub** で画面上の翻訳表示を切り替えます）。拡張機能を再読み込みしたら、YouTube のタブも毎回再読み込みしてください。

## 試せる講義の例

この拡張機能は、スライド中心の講義向けです。試せる再生リストを 2 つと、ポッドキャストを 1 本挙げます。

- Adi Teman 氏の [Digital Integrated Circuits (2020-21)](https://www.youtube.com/playlist?list=PLZU5hLL_713yF0Lkwjj9O3ttVIuhPV-me)（Bar-Ilan University 83-313、66 本）。確認した講義には手動の英語字幕があり、もっとも対応が進んでいるケースです。
- Tony Chan Carusone 教授の [CMOS Analog Integrated Circuit Design Fundamentals](https://www.youtube.com/playlist?list=PLUJOuapA83-QlWbnMJvoyQucGaBlpBF0F)（Microelectronics チャンネルの大学院レベルの動画 37 本）。これらの動画には自動生成の英語字幕しかなく、最もテストが少ない経路です（下の「既知の制限 / TODO」を参照）。
- Lex Fridman Podcast の [#494 Jensen Huang](https://www.youtube.com/watch?v=vif8NQcjVf0)（スライドのない 2 時間 26 分の対談、英語字幕あり）。長い音声中心の動画での動作を見られますが、上の講義ほどテストしていません。

手動字幕のある動画のほうが、うまく動きます。これらの動画はこのプロジェクトの一部ではなく、制作者とも無関係です。制作者の権利を尊重し、許可なく吹き替えたコピーを再公開しないでください。

## ファイル

| ファイル | 役割 |
| --- | --- |
| `extension/manifest.json` | MV3 マニフェスト |
| `extension/defaults.js` | すべてのコンテキストで共有する既定設定 |
| `extension/page-hook.js` | MAIN ワールドのスクリプト。プレイヤー API 経由で字幕 JSON を取得 |
| `extension/asr.js` | ASR 字幕のヘルパー。単語の平坦化、句読点の窓、突き合わせ、文単位の cue |
| `extension/speakers.js` | 対話用ヘルパー。話者交代の印で字幕を区切り、声を交互に割り当てる |
| `extension/subtitle.js` | 字幕のページ分割ヘルパー。長い文を数行ずつのページに分ける |
| `extension/content.js` | cue の生成、先読みループ、再生スケジューラ、HUD |
| `extension/background.js` | サービスワーカー。LLM・VOICEVOX・edge-tts との HTTP ブリッジ |
| `extension/options.html`, `options.js` | 設定 UI |
| `tools/edge_tts_server.py` | `edge-tts` を包むローカル HTTP ブリッジ |
| `tests/` | ユニットテスト（拡張機能は Node 標準のテストランナー、ブリッジは `unittest`） |
| `.github/workflows/ci.yml` | GitHub Actions の CI |

## 開発

```
npm test                                                  # 拡張機能のテスト（Node 22 以上、依存なし）
.venv/bin/pip install ruff
.venv/bin/ruff check tools tests                          # ブリッジとそのテストを lint
.venv/bin/python -m unittest discover -s tests -p "test_*.py"   # ブリッジのテスト
```

GitHub Actions（`.github/workflows/ci.yml`）が、`main` への push と、すべてのプルリクエストで、拡張機能の全スクリプトの構文チェックと、2 つのテストスイートを実行します。

貢献の方法と Issue の報告の仕方は、[CONTRIBUTING.md](CONTRIBUTING.md)（英語）を参照してください。

## 既知の制限 / TODO

- 自動生成（ASR）字幕には句読点がありません。`asrPunctuation` が `on`（既定）のとき、LLM が単語列を重なりのある窓に分けて先に句読点を復元し、cue が文の境界で終わるようにします。動画 1 分あたり約 1.2 秒かかり（16 GB の GPU 上のローカル 12B モデルでの実測）、その間は映像を一時停止して進捗を表示します。字幕が YouTube から来る場合、結果は動画ごとに保存されるので、2 回目以降は待ちません。43 分の講義では、文末で終わる cue が 74% になりました（この手順がないと、70% が長さの上限で文の途中で切られていました）。モデルが単語を変えてしまった窓（このテストでは 52 窓中 3 窓）は、長さで区切る方式に戻ります。この手順を省くには `asrPunctuation` を `off` にします。手動字幕がもっとも確実です。
- YouTube が `timedtext` エンドポイントに PO トークンを要求し、字幕の取得が空の応答になることがあります。その場合は **Load captions** ボタンで SRT / WebVTT / JSON3 ファイルを渡してください。たとえば `yt-dlp --skip-download --write-subs --sub-langs en --convert-subs srt <url>` で作れます。オプションページで `localCaptionLang`（`English` などの*元の*言語名）を設定してください。読み込んだファイルは、別の動画に移動すると破棄されます。ローリング形式の自動字幕 VTT は重複を除去しないので、この経路では手動字幕を使ってください。
- 翻訳は 1 cue ずつで、直前の `contextCues` 件の訳を文脈として渡します。まとめて翻訳する方式や用語集に対応すると、用語の一貫性が良くなります。
- 優先順位に合った最初の字幕トラックだけを使います。言語を選ぶ UI はありません。
- 再生位置より 4 つ以上前の cue のデコード済み音声は解放されます。後ろへシークすると再合成されます。
- テストが対象とするのは、設定、マニフェスト、サービスワーカー、ASR ヘルパー、edge-tts ブリッジです。content script（cue の生成、スケジューラ、HUD）と page hook には、まだ自動テストがありません。ブラウザで手動確認しています。
## ライセンス

Copyright 2026 Nexplico-Ltd. Apache License 2.0 の下で提供されます。[LICENSE](LICENSE) と [NOTICE](NOTICE) を参照してください。これはこのリポジトリのコードにだけ適用されます。連携するサービスやモデルには、それぞれ別の利用規約があります。VOICEVOX と各声のキャラクター、edge-tts の裏にある Microsoft のオンライン音声サービス、実行する LLM（たとえば Gemma）です。吹き替えた動画を公開する前に確認してください。
