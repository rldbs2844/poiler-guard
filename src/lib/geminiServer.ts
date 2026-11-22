import type { GeminiDecision } from "@/lib/spoilerEngine";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const CANDIDATE_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"] as const;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function fetchThumbnailBase64(
  thumbnailUrl: string
): Promise<{ mimeType: string; data: string } | null> {
  if (!thumbnailUrl.startsWith("https://")) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2800);
  try {
    const res = await fetch(thumbnailUrl, { signal: controller.signal });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > 2_000_000) return null;
    return { mimeType: contentType, data: arrayBufferToBase64(buf) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function analyzeWithGeminiMultimodal(params: {
  title: string;
  channelTitle: string;
  description: string;
  tags: string[];
  thumbnailUrl: string;
  ocrText: string;
  sttText: string;
  protectedKeywords: string[];
}): Promise<GeminiDecision | null> {
  const apiKey = (process.env.GEMINI_API_KEY ?? "").trim();
  if (!apiKey || params.protectedKeywords.length === 0) {
    return null;
  }

  const imagePart = await fetchThumbnailBase64(params.thumbnailUrl);

  const prompt = `당신은 유튜브 영상 스포일러 감지기입니다.
사용자가 차단하길 원하는 작품/대회 키워드 목록: [${params.protectedKeywords.join(", ")}]

아래 영상 정보와 첨부된 썸네일 이미지를 종합해 판정하세요:
- 제목: ${params.title}
- 채널: ${params.channelTitle}
- 태그: ${params.tags.slice(0, 12).join(", ") || "없음"}
- 설명: ${params.description.slice(0, 500) || "없음"}
- 화면/자막 OCR 힌트: ${params.ocrText.slice(0, 300) || "없음"}
- 초기 음성/자막 STT: ${params.sttText.slice(0, 700) || "없음"}

중요 판별 기준:
1. 제목에는 작품명을 숨기고 썸네일 문자(OCR)나 자막·설명으로 결말·사망·범인·흑막·정체·반전·우승·역전승을 폭로하는 '기습 스포일러'를 반드시 잡아내세요.
2. 반대로 단순 작품명·배우·팀 이름만 나오는 공식 예고편, 티저, 제작발표회, 비하인드 영상이라면 isSafeTrailerOrTeaser=true, isSpoiler=false로 판정해 오탐을 막으세요.
3. 사용자가 요청한 키워드 목록과 무관한 일상/IT/다른 작품 영상이면 isSpoiler=false로 판정하세요.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "detectedOcrText": "썸네일 이미지에서 읽은 텍스트 요약 (없으면 빈 문자열)",
  "matchedWork": "감지된 보호 키워드 문자열 (없으면 null)",
  "isSpoiler": true 또는 false,
  "isSafeTrailerOrTeaser": true 또는 false,
  "confidence": 0.0~1.0 숫자,
  "reason": "한국어 1줄 판단 사유 (60자 이내)"
}`;

  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  if (imagePart) {
    parts.push({
      inlineData: {
        mimeType: imagePart.mimeType,
        data: imagePart.data,
      },
    });
  }

  for (const model of CANDIDATE_MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7500);
    try {
      const res = await fetch(
        `${GEMINI_API_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: "application/json",
            },
          }),
        }
      );

      if (!res.ok) {
        continue;
      }

      const data = (await res.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };
      const rawText =
        data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
      if (!rawText) continue;

      const jsonText = rawText
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```$/i, "")
        .trim();

      const parsed = JSON.parse(jsonText) as Partial<GeminiDecision>;
      return {
        detectedOcrText:
          typeof parsed.detectedOcrText === "string" ? parsed.detectedOcrText : "",
        matchedWork:
          typeof parsed.matchedWork === "string" && parsed.matchedWork.trim()
            ? parsed.matchedWork.trim()
            : null,
        isSpoiler: Boolean(parsed.isSpoiler),
        isSafeTrailerOrTeaser: Boolean(parsed.isSafeTrailerOrTeaser),
        confidence:
          typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
            ? Math.min(1, Math.max(0, parsed.confidence))
            : 0.75,
        reason:
          typeof parsed.reason === "string" && parsed.reason.trim()
            ? parsed.reason.trim()
            : "Gemini 멀티모달 문맥 분석을 완료했습니다.",
        modelUsed: model,
      };
    } catch {
      continue;
    } finally {
      clearTimeout(timer);
    }
  }

  return null;
}
