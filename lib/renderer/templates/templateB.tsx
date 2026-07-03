import { CARD_WIDTH, CARD_HEIGHT } from "./templateA";

interface TemplateBProps {
  headline: string;
  mediaDataUri: string;
  logoDataUri: string;
}

export function templateB({ headline, mediaDataUri, logoDataUri }: TemplateBProps) {
  return (
    <div style={{ display: "flex", position: "relative", width: CARD_WIDTH, height: CARD_HEIGHT }}>
      <img
        src={mediaDataUri}
        style={{ position: "absolute", top: 0, left: 0, width: CARD_WIDTH, height: CARD_HEIGHT, objectFit: "cover" }}
      />
      <img
        src={logoDataUri}
        style={{
          position: "absolute",
          top: 48,
          right: 48,
          width: 96,
          height: 96,
          borderRadius: 48,
          border: "4px solid #ffffff",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          display: "flex",
          flexDirection: "column",
          width: CARD_WIDTH,
          padding: "48px 56px 64px",
          background: "linear-gradient(to top, rgba(0,0,0,0.92) 20%, rgba(0,0,0,0) 100%)",
        }}
      >
        <span
          style={{
            fontFamily: "Anton",
            fontWeight: 400,
            fontSize: 72,
            lineHeight: 1.05,
            color: "#ffffff",
            textTransform: "uppercase",
          }}
        >
          {headline}
        </span>
        <span style={{ marginTop: 24, fontFamily: "Inter", fontWeight: 700, fontSize: 28, color: "#96DB12" }}>
          SIGA @puzzlerecordss PARA VER MAIS
        </span>
      </div>
    </div>
  );
}
