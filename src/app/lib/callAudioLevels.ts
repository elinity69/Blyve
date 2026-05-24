/** Normal conversational speech (~-38 dBFS relative to full scale). */
export const SPEECH_ON_THRESHOLD_DB = -38;

/** Hysteresis: ring disappears below this level. */
export const SPEECH_OFF_THRESHOLD_DB = -48;

export function linearRmsToDb(rms: number): number {
  if (rms <= 0.00001) return -100;
  return 20 * Math.log10(rms);
}

export function shouldShowSpeakingRing(db: number, currentlySpeaking: boolean): boolean {
  if (currentlySpeaking) return db >= SPEECH_OFF_THRESHOLD_DB;
  return db >= SPEECH_ON_THRESHOLD_DB;
}

export const BLYVE_SPEAKING_MESSAGE = 'blyve_speaking';
export const BLYVE_MEDIA_MESSAGE = 'blyve_media';

export interface BlyveSpeakingPayload {
  type: typeof BLYVE_SPEAKING_MESSAGE;
  speaking: boolean;
  levelDb: number;
}

export interface BlyveMediaPayload {
  type: typeof BLYVE_MEDIA_MESSAGE;
  camera: boolean;
  screenShare: boolean;
}

export function parseBlyveSpeakingMessage(text: string): BlyveSpeakingPayload | null {
  try {
    const parsed = JSON.parse(text) as BlyveSpeakingPayload;
    if (parsed?.type !== BLYVE_SPEAKING_MESSAGE) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function parseBlyveMediaMessage(text: string): BlyveMediaPayload | null {
  try {
    const parsed = JSON.parse(text) as BlyveMediaPayload;
    if (parsed?.type !== BLYVE_MEDIA_MESSAGE) return null;
    return parsed;
  } catch {
    return null;
  }
}
