# Shared subway line colors

Verified on 2026-10-12 against Seoul Metropolitan Government's
[subway map design publication](https://news.seoul.go.kr/culture/archives/522224)
(page last updated 2026-04-03), linked **노선별 색상값 다운로드**:
[official three-page color table](https://news.seoul.go.kr/culture/files/2025/05/68219503904018.57272657.pdf).

The application uses the published **RGB** column. Adobe RGB, CMYK, Pantone,
legacy operator map artwork and third-party hexadecimal palettes are separate
representations. Line labels were checked visually in the PDF because they are
outlines and disappear from its extracted text. No map artwork is bundled.

| Page | Line | RGB | Hex |
| --- | --- | --- | --- |
| 1 | 1호선 | 0, 74, 133 | #004A85 |
| 1 | 2호선 | 0, 162, 63 | #00A23F |
| 1 | 3호선 | 237, 108, 0 | #ED6C00 |
| 1 | 4호선 | 0, 155, 206 | #009BCE |
| 1 | 5호선 | 121, 70, 152 | #794698 |
| 1 | 6호선 | 124, 73, 50 | #7C4932 |
| 1 | 7호선 | 110, 126, 49 | #6E7E31 |
| 1 | 8호선 | 209, 29, 112 | #D11D70 |
| 1 | 9호선 | 164, 157, 135 | #A49D87 |
| 2 | 경의중앙선 | 106, 194, 179 | #6AC2B3 |
| 2 | 수인분당선 | 236, 163, 0 | #ECA300 |
| 2 | 신분당선 | 184, 27, 48 | #B81B30 |
| 2 | 인천1호선 | 180, 199, 231 | #B4C7E7 |
| 2 | 공항철도 | 0, 121, 172 | #0079AC |
| 3 | 우이신설선 | 186, 204, 80 | #BACC50 |
| 3 | 신림선 | 94, 125, 187 | #5E7DBB |
| 3 | 인천2호선 | 240, 131, 30 | #F0831E |
| 3 | 용인경전철 | 68, 164, 54 | #44A436 |
| 3 | 의정부경전철 | 244, 164, 98 | #F4A462 |
| 3 | 김포골드라인 | 149, 115, 38 | #957326 |
| 3 | 경춘선 | 0, 122, 98 | #007A62 |
| 3 | 경강선 | 11, 49, 143 | #0B318F |
| 3 | 서해선 | 94, 172, 65 | #5EAC41 |

`subway-lines.ts` is the single palette used by shared transit SVGs and transfer
labels. Unknown lines retain their label and neutral `#667085`; another city's
numbered line must never inherit Seoul's color. Color supplements text and mode
shape. Domain tests cover transfers, regional ambiguity and fallback; the
375px Chromium/WebKit product test checks the rendered Line 9 and fallback SVGs.
