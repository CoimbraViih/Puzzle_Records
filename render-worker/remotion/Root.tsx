import React from "react";
import { Composition } from "remotion";
import { PuzzleTemplateV1, type PuzzleTemplateV1Props } from "./PuzzleTemplateV1";

export function RemotionRoot() {
  return (
    <Composition<any, PuzzleTemplateV1Props & Record<string, unknown>>
      id="PuzzleTemplateV1"
      component={PuzzleTemplateV1}
      durationInFrames={900}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{
        videoUrl: "",
        headline: "",
        words: [],
        config: {
          titleBox: { color: "#96DB12", textColor: "#000000", position: "bottom-third", durationSeconds: 3 },
          captionStyle: "viral",
          logo: { enabled: true, position: "top-right" },
          progressBar: { enabled: true, color: "#96DB12" },
          footer: { enabled: false, text: "SIGA @puzzlerecordss" },
        },
        logoUrl: "",
        durationInFrames: 900,
      }}
    />
  );
}
