export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;

interface TemplateAProps {
  headline: string;
  mediaDataUri: string;
  logoDataUri: string;
}

const BANNER_HEIGHT = Math.round(CARD_HEIGHT * 0.32);

export function templateA({ headline, mediaDataUri, logoDataUri }: TemplateAProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        backgroundColor: "#ffffff",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: CARD_WIDTH,
          height: BANNER_HEIGHT,
          padding: "0 64px",
          textAlign: "center",
        }}
      >
        <span
          style={{
            fontFamily: "Inter",
            fontWeight: 700,
            fontSize: 64,
            lineHeight: 1.15,
            color: "#111111",
          }}
        >
          {headline}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          position: "relative",
          width: CARD_WIDTH,
          height: CARD_HEIGHT - BANNER_HEIGHT,
        }}
      >
        <img
          src={mediaDataUri}
          style={{ width: CARD_WIDTH, height: CARD_HEIGHT - BANNER_HEIGHT, objectFit: "cover" }}
        />
        <img
          src={logoDataUri}
          style={{
            position: "absolute",
            top: -60,
            left: CARD_WIDTH / 2 - 60,
            width: 120,
            height: 120,
            borderRadius: 60,
            border: "6px solid #ffffff",
          }}
        />
      </div>
    </div>
  );
}
