import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setImmediate } from "node:timers/promises";

test("automatic playback cleanup never cancels a later manual replay", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "atlas-audio-"));
  const globals = globalThis as unknown as Record<string, unknown>;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousAudio = Object.getOwnPropertyDescriptor(globalThis, "Audio");
  const instances: FakeAudio[] = [];
  class FakeAudio {
    onended: (() => void) | null = null;
    onpause: (() => void) | null = null;
    pauses = 0;
    playbackRate = 1;
    constructor(public src: string) {
      instances.push(this);
    }
    async play() {}
    pause() {
      this.pauses++;
      this.onpause?.();
    }
  }
  try {
    Object.defineProperty(globalThis, "window", {
      value: {},
      configurable: true,
    });
    Object.defineProperty(globalThis, "Audio", {
      value: FakeAudio,
      configurable: true,
    });
    const file = path.join(dir, "audio.mjs");
    const built = await build({
      entryPoints: ["src/lib/audio.ts"],
      bundle: true,
      format: "esm",
      platform: "node",
      write: false,
      plugins: [
        {
          name: "quiet-sound",
          setup(b) {
            b.onResolve({ filter: /\/sound$/ }, () => ({
              path: "sound",
              namespace: "test",
            }));
            b.onLoad({ filter: /.*/, namespace: "test" }, () => ({
              contents: "export function duck() {}",
              loader: "js",
            }));
          },
        },
      ],
    });
    await writeFile(file, built.outputFiles[0].contents);
    const audio = await import(pathToFileURL(file).href);
    const cancelAutomatic = audio.playAutomatic("/word.mp3", "word", "uk");
    await setImmediate();
    const manual = audio.play("/word.mp3", "word", "uk");
    await setImmediate();
    assert.equal(instances.length, 2, "manual replay stays available");
    assert.equal(
      instances[0].pauses,
      1,
      "manual replay supersedes the automatic voice",
    );
    cancelAutomatic();
    assert.equal(
      instances[1].pauses,
      0,
      "stale automatic cleanup cannot stop the manual voice",
    );
    instances[1].onended?.();
    await manual;
    const cancelCurrent = audio.playAutomatic("/next.mp3", "next", "uk");
    await setImmediate();
    cancelCurrent();
    cancelCurrent();
    assert.equal(
      instances[2].pauses,
      1,
      "the current automatic voice is stopped only once",
    );
    await setImmediate();
  } finally {
    if (previousWindow)
      Object.defineProperty(globalThis, "window", previousWindow);
    else delete globals.window;
    if (previousAudio)
      Object.defineProperty(globalThis, "Audio", previousAudio);
    else delete globals.Audio;
    await rm(dir, { recursive: true, force: true });
  }
});
