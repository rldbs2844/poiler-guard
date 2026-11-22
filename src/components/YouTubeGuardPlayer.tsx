"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldAlert, SkipForward, Eye, Loader2 } from "lucide-react";
import type { AnalyzeResult } from "@/types/video";
import type { YTPlayerInstance } from "@/types/youtube";

interface YouTubeGuardPlayerProps {
  videoId: string;
  analysis: AnalyzeResult | null;
  analyzing: boolean;
  overridden: boolean;
  hasNextSafeVideo: boolean;
  onOverride: () => void;
  onNextSafeVideo: () => void;
}

const YT_API_SRC = "https://www.youtube.com/iframe_api";
let ytReadyCallbacks: Array<() => void> = [];
let ytScriptRequested = false;

function ensureYouTubeIframeApi(cb: () => void) {
  if (typeof window === "undefined") return;
  if (window.YT?.Player) {
    cb();
    return;
  }
  ytReadyCallbacks.push(cb);
  if (!ytScriptRequested) {
    ytScriptRequested = true;
    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prevReady) prevReady();
      const pending = [...ytReadyCallbacks];
      ytReadyCallbacks = [];
      pending.forEach((fn) => fn());
    };
    const existing = document.querySelector(`script[src="${YT_API_SRC}"]`);
    if (!existing) {
      const tag = document.createElement("script");
      tag.src = YT_API_SRC;
      tag.async = true;
      document.head.appendChild(tag);
    }
  }
}

export default function YouTubeGuardPlayer({
  videoId,
  analysis,
  analyzing,
  overridden,
  hasNextSafeVideo,
  onOverride,
  onNextSafeVideo,
}: YouTubeGuardPlayerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayerInstance | null>(null);
  const loadedVideoRef = useRef<string>("");
  const [usePlainIframe, setUsePlainIframe] = useState<boolean>(false);

  const isBlocked = Boolean(analysis?.isSpoiler && !overridden);
  const isBlockedRef = useRef<boolean>(isBlocked);
  useEffect(() => {
    isBlockedRef.current = isBlocked;
  }, [isBlocked]);

  useEffect(() => {
    let cancelled = false;

    const fallbackTimer = window.setTimeout(() => {
      if (!cancelled && !playerRef.current) {
        setUsePlainIframe(true);
      }
    }, 4000);

    ensureYouTubeIframeApi(() => {
      if (cancelled || !hostRef.current || !window.YT?.Player) return;
      window.clearTimeout(fallbackTimer);

      if (playerRef.current) {
        if (loadedVideoRef.current !== videoId) {
          loadedVideoRef.current = videoId;
          try {
            playerRef.current.loadVideoById(videoId);
          } catch {}
        }
        return;
      }

      const mountEl = document.createElement("div");
      mountEl.className = "w-full h-full";
      hostRef.current.innerHTML = "";
      hostRef.current.appendChild(mountEl);
      loadedVideoRef.current = videoId;

      playerRef.current = new window.YT.Player(mountEl, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: isBlockedRef.current ? 0 : 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
        },
        events: {
          onReady: (ev) => {
            if (isBlockedRef.current) {
              try {
                ev.target.pauseVideo();
                ev.target.mute();
              } catch {}
            }
          },
          onStateChange: (ev) => {
            // 1 = PLAYING
            if (ev.data === 1 && isBlockedRef.current) {
              try {
                ev.target.pauseVideo();
                ev.target.mute();
              } catch {}
            }
          },
          onError: () => {
            if (!cancelled) {
              setUsePlainIframe(true);
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimer);
    };
  }, [videoId]);

  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    try {
      if (isBlocked) {
        p.pauseVideo();
        p.mute();
      } else {
        p.unMute();
        if (overridden) {
          p.playVideo();
        }
      }
    } catch {}
  }, [isBlocked, overridden]);

  useEffect(() => {
    return () => {
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {}
        playerRef.current = null;
      }
    };
  }, []);

  return (
    <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-[#0f172a] border border-[#e2e8f0]">
      {usePlainIframe ? (
        <iframe
          key={`${videoId}-${isBlocked ? "blocked" : "play"}`}
          className="w-full h-full"
          src={`https://www.youtube.com/embed/${encodeURIComponent(
            videoId
          )}?autoplay=${isBlocked ? 0 : 1}&mute=${isBlocked ? 1 : 0}&rel=0&playsinline=1`}
          title="YouTube video player"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <div ref={hostRef} className="w-full h-full" />
      )}

      {/* Subtle top-right live scanning indicator while /api/analyze runs */}
      {analyzing && !isBlocked && (
        <div className="pointer-events-none absolute top-3 right-3 z-20 inline-flex items-center gap-1.5 rounded-md bg-[#0f172a]/85 border border-[#334155] px-2.5 py-1 text-[11px] font-medium text-[#ffffff] backdrop-blur-xs">
          <Loader2 className="w-3 h-3 animate-spin" />
          4단계 스포일러 검사 중
        </div>
      )}

      {/* Spoiler Shield Blur Curtain Overlay */}
      {isBlocked && analysis && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="스포일러 차단 가림막"
          className="absolute inset-0 z-30 flex items-center justify-center bg-[#0f172a]/88 backdrop-blur-md p-4 sm:p-6 text-[#ffffff]"
        >
          <div className="w-full max-w-lg rounded-xl border border-[#334155] bg-[#111827]/95 p-5 sm:p-6 shadow-xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#dc2626]/20 border border-[#dc2626]/50 px-3 py-1 text-xs font-semibold text-[#fca5a5]">
                <ShieldAlert className="w-3.5 h-3.5 text-[#f87171]" />
                스포일러 위험 감지 · 재생 일시정지됨
              </span>
              <span className="text-xs font-bold tabular-nums text-[#f8fafc] bg-[#1e293b] border border-[#334155] px-2.5 py-1 rounded-md">
                위험도 {analysis.riskScore}% (기준 {analysis.threshold}%)
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {analysis.matchedKeywords.map((kw) => (
                  <span
                    key={kw}
                    className="px-2 py-0.5 rounded bg-[#ffffff]/10 border border-[#ffffff]/20 text-[11px] font-semibold text-[#ffffff]"
                  >
                    보호 키워드: {kw}
                  </span>
                ))}
                {analysis.matchedStateWords.slice(0, 4).map((sw) => (
                  <span
                    key={sw}
                    className="px-2 py-0.5 rounded bg-[#dc2626]/15 border border-[#f87171]/30 text-[11px] font-medium text-[#fecaca]"
                  >
                    {sw}
                  </span>
                ))}
              </div>

              <p className="text-sm font-medium leading-relaxed text-[#e2e8f0]">
                {analysis.reason}
              </p>
            </div>

            <div className="grid grid-cols-4 gap-1.5 text-center text-[11px] tabular-nums">
              <div className="rounded-md bg-[#1e293b]/90 border border-[#334155] px-2 py-1.5">
                <div className="text-[#94a3b8]">1. 메타</div>
                <div className="font-bold text-[#f8fafc] mt-0.5">
                  +{Math.round(analysis.stages.stage1Meta.weighted * 100)}%
                </div>
              </div>
              <div className="rounded-md bg-[#1e293b]/90 border border-[#334155] px-2 py-1.5">
                <div className="text-[#94a3b8]">2. OCR</div>
                <div className="font-bold text-[#f8fafc] mt-0.5">
                  +{Math.round(analysis.stages.stage2Ocr.weighted * 100)}%
                </div>
              </div>
              <div className="rounded-md bg-[#1e293b]/90 border border-[#334155] px-2 py-1.5">
                <div className="text-[#94a3b8]">3. STT</div>
                <div className="font-bold text-[#f8fafc] mt-0.5">
                  +{Math.round(analysis.stages.stage3Stt.weighted * 100)}%
                </div>
              </div>
              <div className="rounded-md bg-[#1e293b]/90 border border-[#334155] px-2 py-1.5">
                <div className="text-[#94a3b8]">4. 문맥</div>
                <div className="font-bold text-[#fca5a5] mt-0.5">
                  +{Math.round(analysis.stages.stage4Fusion.bonus * 100)}%
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
              {hasNextSafeVideo && (
                <button
                  type="button"
                  onClick={onNextSafeVideo}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#ffffff] hover:bg-[#f1f5f9] text-[#0f172a] px-4 py-2.5 text-xs font-bold transition cursor-pointer"
                >
                  <SkipForward className="w-4 h-4" />
                  다음 안전 영상 보기
                </button>
              )}
              <button
                type="button"
                onClick={onOverride}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#475569] bg-transparent hover:bg-[#1e293b] text-[#e2e8f0] px-4 py-2.5 text-xs font-semibold transition cursor-pointer"
              >
                <Eye className="w-4 h-4" />
                가림막 해제하고 보기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
