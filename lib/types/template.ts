export const CAPTION_STYLES = ["viral", "classico", "karaoke"] as const;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];

export const TITLE_BOX_POSITIONS = ["bottom-third", "top-third"] as const;
export type TitleBoxPosition = (typeof TITLE_BOX_POSITIONS)[number];

export const LOGO_POSITIONS = ["top-right", "top-left"] as const;
export type LogoPosition = (typeof LOGO_POSITIONS)[number];

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

export interface VideoTemplate {
  id: string;
  name: string;
  config: VideoTemplateConfig;
  format: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}
