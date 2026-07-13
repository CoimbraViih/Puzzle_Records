import React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { groupWordsIntoCaptionLines, type WordTimestamp } from "./captions";
import type { VideoTemplateConfig } from "./templateConfig";

export interface PuzzleTemplateV1Props {
  videoUrl: string;
  headline: string;
  words: WordTimestamp[];
  config: VideoTemplateConfig;
  logoUrl: string;
  durationInFrames: number;
}

export function PuzzleTemplateV1({
  videoUrl,
  headline,
  words,
  config,
  logoUrl,
  durationInFrames,
}: PuzzleTemplateV1Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const captionLines = groupWordsIntoCaptionLines(words);
  const titleDurationFrames = Math.round(config.titleBox.durationSeconds * fps);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      <OffthreadVideo src={videoUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />

      {frame < titleDurationFrames && (
        <AbsoluteFill
          style={{
            justifyContent: config.titleBox.position === "bottom-third" ? "flex-end" : "flex-start",
            alignItems: "center",
            paddingBottom: config.titleBox.position === "bottom-third" ? 220 : 0,
            paddingTop: config.titleBox.position === "top-third" ? 220 : 0,
          }}
        >
          <div
            style={{
              backgroundColor: config.titleBox.color,
              color: config.titleBox.textColor,
              padding: "24px 40px",
              fontSize: 56,
              fontWeight: 800,
              textTransform: "uppercase",
              textAlign: "center",
              maxWidth: "90%",
            }}
          >
            {headline}
          </div>
        </AbsoluteFill>
      )}

      {captionLines.map((line, index) => (
        <Sequence key={index} from={line.startFrame} durationInFrames={line.endFrame - line.startFrame}>
          <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 100 }}>
            <div style={{ fontSize: 44, fontWeight: 700, color: "#ffffff", textAlign: "center" }}>
              {line.words.map((w, i) => (
                <span
                  key={i}
                  style={{
                    color: config.captionStyle === "viral" ? config.progressBar.color : "#ffffff",
                    marginRight: 12,
                  }}
                >
                  {w.word}
                </span>
              ))}
            </div>
          </AbsoluteFill>
        </Sequence>
      ))}

      {config.logo.enabled && (
        <Img
          src={logoUrl}
          style={{
            position: "absolute",
            top: 40,
            right: config.logo.position === "top-right" ? 40 : undefined,
            left: config.logo.position === "top-left" ? 40 : undefined,
            width: 90,
            height: 90,
          }}
        />
      )}

      {config.progressBar.enabled && (
        <AbsoluteFill style={{ justifyContent: "flex-end" }}>
          <div style={{ height: 6, backgroundColor: "rgba(255,255,255,0.2)", width: "100%" }}>
            <div
              style={{
                height: "100%",
                width: `${(frame / durationInFrames) * 100}%`,
                backgroundColor: config.progressBar.color,
              }}
            />
          </div>
        </AbsoluteFill>
      )}

      {config.footer.enabled && (
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 24 }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#ffffff" }}>{config.footer.text}</div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
}
