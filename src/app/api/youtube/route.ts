import { NextRequest, NextResponse } from "next/server";
import type { VideoCategory } from "@/types/video";
import { fetchYouTubeFeedServer } from "@/lib/youtubeServer";

export const dynamic = "force-dynamic";

const ALLOWED_CATEGORIES = new Set<VideoCategory>([
  "all",
  "drama",
  "variety",
  "gaming",
  "sports",
  "music",
  "vlog",
  "tech",
]);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const rawCat = (searchParams.get("category") ?? "all") as VideoCategory;
  const category: VideoCategory = ALLOWED_CATEGORIES.has(rawCat)
    ? rawCat
    : "all";
  const rawSeed = Number(searchParams.get("seed") ?? "0");
  const seed = Number.isFinite(rawSeed) ? Math.abs(Math.floor(rawSeed)) : 0;

  const result = await fetchYouTubeFeedServer(q, category, seed);

  return NextResponse.json(
    {
      source: result.source,
      note: result.note ?? null,
      hasYoutubeKey: Boolean((process.env.YOUTUBE_API_KEY ?? "").trim()),
      hasGeminiKey: Boolean((process.env.GEMINI_API_KEY ?? "").trim()),
      videos: result.videos,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
