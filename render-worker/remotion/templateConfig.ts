export type CaptionStyle = "viral" | "classico" | "karaoke";
export type TitleBoxPosition = "bottom-third" | "top-third";
export type LogoPosition = "top-right" | "top-left";

export interface VideoTemplateConfig {
  titleBox: {
    color: string;
    textColor: string;
    position: TitleBoxPosition;
    durationSeconds: number;
  };
  captionStyle: CaptionStyle;
  logo: { enabled: boolean; position: LogoPosition };
  progressBar: { enabled: boolean; color: string };
  footer: { enabled: boolean; text: string };
}
