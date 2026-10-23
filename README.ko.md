# speech-clock-dub

[![CI](https://github.com/Nexplico-Ltd/speech-clock-dub/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Nexplico-Ltd/speech-clock-dub/actions/workflows/ci.yml)

[English](README.md) | [日本語](README.ja.md) | **한국어** | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md)

> 이 문서는 영어판 [README.md](README.md)의 한국어 번역입니다. 내용이 다르면 영어판이 기준입니다. 번역은 최신 내용보다 늦을 수 있습니다.

영상이 음성을 따라가는 YouTube 강의 더빙 도구입니다.

YouTube 강의 영상을 일본어, 영어, 번체 중국어, 간체 중국어, 한국어로 더빙하는 Chrome(MV3) 확장 프로그램입니다. 슬라이드 위주의 영상을 염두에 두고 만들었습니다. 번역한 음성을 화면 속도에 억지로 맞추는 대신, **화면이 음성을 따라갑니다**.

## 동작 방식

```
YouTube 자막 -> 문장 단위 cue -> LLM 번역 -> TTS (VOICEVOX / edge-tts) -> Web Audio 큐
                                                                            |
                              <video> 의 playbackRate / pause / play  <-----+
```

- 합성된 음성이 마스터 클럭입니다. 원래 음성은 음소거됩니다.
- 각 cue마다 영상의 `playbackRate`를 `cue 남은 시간 / 음성 길이`로 설정합니다(`[minRate, maxRate]` 범위로 제한).
- 음성이 cue의 영상 구간보다 길면, 음성이 끝날 때까지 영상을 일시정지합니다(슬라이드가 멈춘 화면). 음성이 더 짧으면 다음 cue까지 영상을 더 빠르게 재생합니다.
- cue 사이의 긴 무음 구간은 `gapRate`로 지나갑니다.
- 선행 생성(producer) 루프가 재생보다 앞서 cue를 번역하고 음성을 합성합니다. 번역은 순서대로 실행하고(각 번역은 앞선 번역을 문맥으로 받습니다), 음성 합성은 최대 `concurrency`개의 cue를 병렬로 실행합니다. 클라우드 TTS는 요청 하나에 몇 초가 걸리기 때문에 이것이 중요합니다. cue 경계에서 준비된 음성이 `lowWaterSec`초 미만이면 영상을 일시정지하고, `highWaterSec`초 분량이 쌓이면 다시 재생합니다(히스테리시스). 영상이 종속 쪽이므로 버퍼가 바닥나도 동기가 어긋나지 않고 영상만 멈춥니다. 문장 중간에 재생이 끊기지 않습니다.
- 사용자가 일시정지/재생하면 음성도 함께 멈추거나 이어지며, 사용자가 탐색(seek)하면 cue 위치를 다시 맞춥니다. 광고는 감지되어(`.ad-showing`) 그동안 스케줄러가 멈춥니다.

## 필요한 것

1. **OpenAI 호환 LLM 엔드포인트**(예: Unsloth 서비스)에서 Gemma 12B급 모델을 실행합니다. 옵션 페이지에서 `llmBaseUrl`(`/v1`로 끝나는 URL)과 `llmModel`을 설정하세요. 확장 프로그램은 `POST {llmBaseUrl}/chat/completions`를 호출합니다.
2. **VOICEVOX 엔진**(오픈 소스, 고품질 일본어 TTS):

   ```
   # GPU (nvidia-container-toolkit 필요). 이미지의 기본 명령이 이미
   # --use_gpu --host 0.0.0.0 을 넘기므로 인자를 덧붙이지 마세요(기본 명령이 대체됩니다).
   docker run -d --rm --name voicevox --gpus all -p 50021:50021 voicevox/voicevox_engine:nvidia-latest
   # CPU 전용
   docker run --rm -p 50021:50021 voicevox/voicevox_engine:cpu-latest
   ```

   VOICEVOX에는 VRAM이 1~2 GB 정도 필요하므로, 16 GB GPU에서 12B LLM과 함께 쓸 수 있습니다.

   음성 캐릭터마다 이용 약관이 따로 있습니다. 더빙한 영상을 공개하기 전에 확인하세요.
   `speakerFemale` / `speakerMale`은 VOICEVOX 스타일 ID입니다(`GET /speakers`로 목록을 볼 수 있습니다).

   **VRAM:** VOICEVOX는 음성을 하나 추가할 때마다 GPU에 모델을 하나 더 불러옵니다. 12B LLM이 16 GB 카드의 거의 전부를 차지하고 있으면(예: 컨텍스트 창이 매우 큰 경우) 첫 번째 음성은 동작해도 다른 음성은 CUDA 메모리 부족 오류로 실패할 수 있습니다(`/synthesis`가 HTTP 500). 더빙에는 LLM 컨텍스트가 수천 토큰이면 충분하므로, 모델을 불러올 때 컨텍스트 길이를 낮추세요. 16 GB RTX 4060 Ti와 Gemma 4 12B(Q4)에서 측정한 결과: 컨텍스트 262144 토큰에서는 llama-server가 14.2 GB를 사용했고(여유 약 0.5 GB, 남성 음성 실패), 16384에서는 9.5 GB였습니다(VOICEVOX를 불러온 상태에서 여유 약 3.9 GB, 두 음성 모두 동작). 번역도 빨라졌습니다(문장당 0.5초 -> 0.3초).

   또는 VOICEVOX를 CPU에서 실행할 수도 있습니다(문장당 실시간의 약 0.5배). 이미지의 명령을 덮어써서 `--use_gpu`를 뺍니다: `... voicevox_engine:nvidia-latest gosu user /opt/voicevox_engine/run --host 0.0.0.0`.

3. **edge-tts 브리지**(일본어 이외의 언어로 더빙할 때. VOICEVOX 대신 쓰고 싶다면 일본어에서도). edge-tts는 비공식 API로 Microsoft의 온라인 음성 서비스를 사용하므로 **번역된 텍스트가 Microsoft로 전송됩니다**. 인터넷 연결이 필요하며, 서비스가 바뀌면 동작하지 않을 수 있습니다. 작은 로컬 HTTP 브리지로 확장 프로그램에 연결합니다:

   ```
   python3 -m venv .venv && .venv/bin/pip install edge-tts
   .venv/bin/python tools/edge_tts_server.py        # 127.0.0.1:5050 에서 대기
   ```

   `--port`로 포트를 바꿀 수 있습니다(그 경우 `edgeUrl`도 바꾸세요). 문장당 2~3초가 걸리지만, 버퍼가 차고 나면 병렬 producer가 이를 가려 줍니다. 다만 처음 재생을 시작할 때까지는 VOICEVOX보다 오래 걸립니다.

`host_permissions`에는 `localhost` / `127.0.0.1`만 들어 있습니다. LLM이 다른 호스트에서 실행된다면 `extension/manifest.json`의 `host_permissions`에 추가하세요.

## 대상 언어

옵션 페이지에서 `targetLang`을 설정합니다:

| `targetLang` | 언어 | edge-tts 기본 음성(여성) |
| --- | --- | --- |
| `ja` | 일본어 | `ja-JP-NanamiNeural` (기본적으로는 VOICEVOX 사용) |
| `en` | 영어 | `en-US-AriaNeural` |
| `zh-TW` | 번체 중국어(대만) | `zh-TW-HsiaoChenNeural` |
| `zh-CN` | 간체 중국어 | `zh-CN-XiaoxiaoNeural` |
| `ko` | 한국어 | `ko-KR-SunHiNeural` |

`voiceGender`(`female` 또는 `male`)로 음성을 고릅니다:

| `targetLang` | female | male |
| --- | --- | --- |
| `ja` (VOICEVOX) | 스타일 `2` (四国めたん) | 스타일 `11` (玄野武宏) |
| `ja` (edge-tts) | `ja-JP-NanamiNeural` | `ja-JP-KeitaNeural` |
| `en` | `en-US-AriaNeural` | `en-US-GuyNeural` |
| `zh-TW` | `zh-TW-HsiaoChenNeural` | `zh-TW-YunJheNeural` |
| `zh-CN` | `zh-CN-XiaoxiaoNeural` | `zh-CN-YunxiNeural` |
| `ko` | `ko-KR-SunHiNeural` | `ko-KR-InJoonNeural` |

`ttsProvider`의 기본값은 `auto`이며, `ja`는 VOICEVOX, 그 외에는 edge-tts를 사용합니다. `edgeVoice`로 edge-tts 음성을 바꿀 수 있고(`.venv/bin/edge-tts --list-voices`로 목록 확인), `edgeRate`(예: `+10%`)로 속도를 바꿀 수 있습니다. 언어를 추가하려면 `extension/defaults.js`의 `YTD_LANGS`에 항목을 추가하세요.

## 화면 자막

플레이어의 **Sub** 버튼을 누르면 `off` -> `translated` -> `both`(번역 + 원문) 순으로 바뀝니다. 선택은 `subtitles` 설정(기본값 `off`)에 저장됩니다. 지금 말하고 있는 cue의 텍스트가 플레이어 아래쪽에 표시되고 cue 사이에는 숨겨지며, 사용자가 일시정지한 동안에는 계속 보입니다. 글꼴은 플레이어 너비에 맞춰 조절되므로 전체 화면에서도 사용할 수 있습니다. YouTube 자체 자막 줄보다 위에 표시되므로 YouTube 자막을 켜도 겹치지 않습니다. 긴 문장은 최대 `subtitleMaxLines`줄(기본값 2, `0`이면 제한 없음)씩 페이지로 나눠 표시되며, 페이지는 음성의 진행에 맞춰 넘어갑니다. 그래서 자막이 영상을 크게 가리지 않습니다. `both`에서는 번역과 원문을 각각 따로 제한합니다.

## 설치(개발용)

1. `chrome://extensions`를 열고 개발자 모드를 켠 뒤 "압축해제된 확장 프로그램을 로드합니다"를 눌러 `extension/`을 선택합니다.
2. 확장 프로그램의 옵션 페이지를 열어 설정을 조정합니다.
3. 자막이 있는 YouTube 영상을 열고 플레이어 왼쪽 위의 **Dub (xx)** 를 누릅니다(**Sub**는 화면 번역 자막을 켜고 끕니다). 확장 프로그램을 다시 로드할 때마다 YouTube 탭도 새로고침하세요.

## 예시 강의

이 확장 프로그램은 슬라이드 위주의 강의를 위해 만들었습니다. 사용해 볼 수 있는 재생목록 두 개입니다.

- Adi Teman의 [Digital Integrated Circuits (2020-21)](https://www.youtube.com/playlist?list=PLZU5hLL_713yF0Lkwjj9O3ttVIuhPV-me)(Bar-Ilan University 83-313, 영상 66편). 확인한 강의에는 수동 영어 자막이 있어, 가장 잘 지원되는 경우입니다.
- Tony Chan Carusone 교수의 [CMOS Analog Integrated Circuit Design Fundamentals](https://www.youtube.com/playlist?list=PLUJOuapA83-QlWbnMJvoyQucGaBlpBF0F)(Microelectronics 채널의 대학원 수준 영상 37편). 이 영상들에는 자동 생성된 영어 자막만 있는데, 이는 테스트가 가장 적은 경로입니다(아래 "알려진 제한 사항 / TODO" 참고).

수동 자막이 있는 영상이 더 잘 동작합니다. 이 영상들은 이 프로젝트의 일부가 아니며 제작자와도 관련이 없습니다. 제작자의 권리를 존중하여, 허락 없이 더빙한 사본을 다시 공개하지 마세요.

## 파일

| 파일 | 역할 |
| --- | --- |
| `extension/manifest.json` | MV3 매니페스트 |
| `extension/defaults.js` | 모든 컨텍스트가 공유하는 기본 설정 |
| `extension/page-hook.js` | MAIN 월드 스크립트. 플레이어 API로 자막 JSON을 가져옴 |
| `extension/asr.js` | ASR 자막 헬퍼. 단어 평탄화, 구두점 창, 정렬, 문장 단위 cue |
| `extension/subtitle.js` | 자막 페이지 나누기 헬퍼. 긴 문장을 몇 줄씩의 페이지로 나눔 |
| `extension/content.js` | cue 생성, 선행 생성 루프, 재생 스케줄러, HUD |
| `extension/background.js` | 서비스 워커. LLM, VOICEVOX, edge-tts HTTP 브리지 |
| `extension/options.html`, `options.js` | 설정 UI |
| `tools/edge_tts_server.py` | `edge-tts`를 감싸는 로컬 HTTP 브리지 |
| `tests/` | 단위 테스트(확장 프로그램은 Node 내장 테스트 러너, 브리지는 `unittest`) |
| `.github/workflows/ci.yml` | GitHub Actions CI |

## 개발

```
npm test                                                  # 확장 프로그램 테스트 (Node 22 이상, 의존성 없음)
.venv/bin/pip install ruff
.venv/bin/ruff check tools tests                          # 브리지와 그 테스트를 lint
.venv/bin/python -m unittest discover -s tests -p "test_*.py"   # 브리지 테스트
```

GitHub Actions(`.github/workflows/ci.yml`)가 `main`에 push할 때와 모든 풀 리퀘스트마다, 확장 프로그램의 모든 스크립트에 대한 구문 검사와 두 테스트 스위트를 실행합니다.

## 알려진 제한 사항 / TODO

- 자동 생성(ASR) 자막에는 구두점이 없습니다. `asrPunctuation`이 `on`(기본값)이면 LLM이 먼저 단어 열을 서로 겹치는 창으로 나눠 구두점을 복원하므로, cue가 문장 경계에서 끝납니다. 영상 1분당 약 1.2초가 걸리며(16 GB GPU의 로컬 12B 모델에서 측정), 그동안 영상은 일시정지되고 진행 상황이 표시됩니다. 자막이 YouTube에서 올 때는 결과가 영상별로 저장되므로 다음부터는 기다리지 않습니다. 43분짜리 강의에서 cue의 74%가 문장 끝에서 끝났습니다(이 단계가 없으면 70%가 길이 제한 때문에 문장 중간에서 잘렸습니다). 모델이 단어를 바꿔 버린 창(이 테스트에서는 52개 중 3개)은 길이로 자르는 방식으로 되돌아갑니다. 이 단계를 건너뛰려면 `asrPunctuation`을 `off`로 하세요. 수동 자막이 가장 안정적입니다.
- YouTube가 `timedtext` 엔드포인트에 PO 토큰을 요구하여 자막 요청이 빈 응답을 돌려줄 수 있습니다. 그럴 때는 **Load captions** 버튼으로 SRT / WebVTT / JSON3 파일을 제공하세요. 예를 들어 `yt-dlp --skip-download --write-subs --sub-langs en --convert-subs srt <url>`로 만들 수 있습니다. 옵션 페이지에서 `localCaptionLang`(`English` 같은 *원본* 언어 이름)을 설정하세요. 불러온 파일은 다른 영상으로 이동하면 버려집니다. 롤링 방식의 자동 자막 VTT는 중복을 제거하지 않으므로, 이 경로에서는 수동 자막을 사용하세요.
- 번역은 cue 하나씩 진행하며, 앞선 `contextCues`개의 번역을 문맥으로 넘깁니다. 묶음 번역과 용어집을 지원하면 용어 일관성이 좋아질 것입니다.
- 우선순위에 맞는 첫 번째 자막 트랙만 사용합니다. 언어를 고르는 UI는 없습니다.
- 재생 위치보다 4개 넘게 앞선 cue의 디코딩된 오디오는 해제됩니다. 뒤로 탐색하면 다시 합성됩니다.
- 테스트는 설정, 매니페스트, 서비스 워커, ASR 헬퍼, edge-tts 브리지를 다룹니다. content script(cue 생성, 스케줄러, HUD)와 page hook에는 아직 자동 테스트가 없으며, 브라우저에서 직접 확인합니다.
## 라이선스

Copyright 2026 Nexplico-Ltd. Apache License 2.0에 따라 제공됩니다. [LICENSE](LICENSE)와 [NOTICE](NOTICE)를 참고하세요. 이 라이선스는 이 저장소의 코드에만 적용됩니다. 연동하는 서비스와 모델에는 각각 별도의 약관이 있습니다. VOICEVOX와 각 음성 캐릭터, edge-tts 뒤에 있는 Microsoft 온라인 음성 서비스, 그리고 실행하는 LLM(예: Gemma)입니다. 더빙한 영상을 공개하기 전에 확인하세요.
