/**
 * Web Audio API director: loads generated BGM/SFX, plays positional-free
 * one-shots with pitch variance, and loops the sanjo BGM with a dynamic
 * playback rate that rises as the round timer runs out.
 */

const BGM_URL = 'assets/audio/bgm_sanjo_fast.mp3';

const SFX_URLS: Record<string, string> = {
  thud_sack: 'assets/audio/sfx/thud_sack.wav',
  pour_grain: 'assets/audio/sfx/pour_grain.wav',
  clatter_wood: 'assets/audio/sfx/clatter_wood.wav',
  mallet_strike: 'assets/audio/sfx/mallet_strike.wav',
  coin_toss: 'assets/audio/sfx/coin_toss.wav',
  cauldron_flip: 'assets/audio/sfx/cauldron_flip.wav',
  // A light metallic tick for the 1-hop spoon: reuse the coin jingle,
  // pitched up and shortened at playback time.
  coin_tick: 'assets/audio/sfx/coin_toss.wav',
};

export class AudioDirector {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private master: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private bgmSource: AudioBufferSourceNode | null = null;
  private ready = false;

  /** Must be called from a user gesture. Safe to call repeatedly. */
  async init(): Promise<void> {
    if (this.ready) return;
    const Ctor: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.value = 0.55;
    this.bgmGain.connect(this.master);

    const jobs: Promise<void>[] = [];
    const load = async (key: string, url: string) => {
      const res = await fetch(url);
      const buf = await this.ctx!.decodeAudioData(await res.arrayBuffer());
      this.buffers.set(key, buf);
    };
    jobs.push(load('bgm', BGM_URL));
    for (const [key, url] of Object.entries(SFX_URLS)) jobs.push(load(key, url));
    await Promise.all(jobs);
    this.ready = true;
  }

  get isReady(): boolean {
    return this.ready;
  }

  /** Fire-and-forget SFX with slight random pitch variance. */
  playSfx(
    name: keyof typeof SFX_URLS | 'bgm',
    opts: { volume?: number; rate?: number } = {}
  ): void {
    if (!this.ctx || !this.master) return;
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const jitter = name === 'coin_tick' ? 1.6 : 1 + (Math.random() - 0.5) * 0.08;
    src.playbackRate.value = (opts.rate ?? 1) * jitter;
    const gain = this.ctx.createGain();
    gain.gain.value = (opts.volume ?? 1) * (name === 'coin_tick' ? 0.35 : 1);
    src.connect(gain).connect(this.master);
    src.start();
    if (name === 'coin_tick') src.stop(this.ctx.currentTime + 0.25);
  }

  /** Start the looping sanjo BGM. */
  startBgm(): void {
    if (!this.ctx || !this.bgmGain || this.bgmSource) return;
    const buffer = this.buffers.get('bgm');
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.playbackRate.value = 1;
    src.connect(this.bgmGain);
    src.start();
    this.bgmSource = src;
  }

  stopBgm(): void {
    try {
      this.bgmSource?.stop();
    } catch {
      /* already stopped */
    }
    this.bgmSource = null;
  }

  /**
   * Dynamic BGM pitching: urgency ramps the loop rate from 1.0 up to ~1.18
   * as the timer drains (comedic panic), smoothly interpolated.
   */
  setBgmUrgency(urgency01: number): void {
    if (!this.ctx || !this.bgmSource) return;
    const target = 1 + Math.min(1, Math.max(0, urgency01)) * 0.18;
    this.bgmSource.playbackRate.setTargetAtTime(
      target,
      this.ctx.currentTime,
      0.15
    );
  }
}
