/** Gateway `/api/status` → the badges every surface shows. */
export interface ModelStatus {
  ready: boolean;
  model: string;
  setup?: string;
}

export interface GatewayStatus {
  spark: ModelStatus;
  wonder: ModelStatus;
  image: ModelStatus;
  transcribe: ModelStatus;
  sam3: ModelStatus;
  budget: { spent_usd_today: number; cap_usd: number };
}

export type BadgeTone = 'ready' | 'setup' | 'offline' | 'capped';

export interface Badge {
  key: keyof Omit<GatewayStatus, 'budget'>;
  name: string;
  tone: BadgeTone;
  text: string;
}

const NAMES: Record<Badge['key'], string> = {
  spark: 'Muse Spark',
  wonder: 'Muse Wonder',
  image: 'Muse Image',
  transcribe: 'Muse Voice',
  sam3: 'SAM 3.1',
};

/** `status === null` means the gateway could not be reached at all. */
export function badges(status: GatewayStatus | null, keys: Badge['key'][] = ['spark', 'image', 'transcribe']): Badge[] {
  return keys.map((key) => {
    const name = NAMES[key];
    if (!status) return { key, name, tone: 'offline', text: `${name}: gateway offline` };
    const s = status[key];
    if (!s) return { key, name, tone: 'offline', text: `${name}: not reported` };
    if (s.ready && status.budget.spent_usd_today >= status.budget.cap_usd)
      return { key, name, tone: 'capped', text: `${name}: daily budget reached` };
    if (s.ready) return { key, name, tone: 'ready', text: `${name} · ${s.model}` };
    return { key, name, tone: 'setup', text: `${name}: Setup required (${s.setup ?? 'MODEL_API_KEY'})` };
  });
}
