// What the scripts here share: Gradle, and the one device they drive — the one
// attached, or else the named AVD, started headless and killed by close().
// Needs ANDROID_HOME (and ANDROID_AVD_HOME if the AVDs are not in the default
// place).

import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const androidDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const APP = "com.builduseful.soundscape";

const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
if (!sdk) throw new Error("Set ANDROID_HOME to the Android SDK.");
const exe = process.platform === "win32" ? ".exe" : "";
const adbPath = path.join(sdk, "platform-tools", `adb${exe}`);
const emulatorPath = path.join(sdk, "emulator", `emulator${exe}`);

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(what, condition, timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    while (!(await condition())) {
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
        await sleep(500);
    }
}

export function gradle(...tasks) {
    // A .bat runs only through cmd.
    const [command, args] = process.platform === "win32"
        ? ["cmd.exe", ["/c", path.join(androidDir, "gradlew.bat"), ...tasks, "-q"]]
        : [path.join(androidDir, "gradlew"), [...tasks, "-q"]];
    execFileSync(command, args, { cwd: androidDir, stdio: "inherit" });
}

function attachedDevice() {
    const lines = execFileSync(adbPath, ["devices"], { encoding: "utf8" }).split("\n").slice(1);
    return lines.map((line) => line.split("\t")).find(([, state]) => state?.trim() === "device")?.[0];
}

export async function openDevice(avd) {
    let serial = attachedDevice();
    let emulator = null;
    const adb = (...args) => execFileSync(adbPath, serial ? ["-s", serial, ...args] : args, { encoding: "utf8" }).trim();
    const shell = (command) => adb("shell", command);
    const binary = (...args) => execFileSync(adbPath, ["-s", serial, ...args], { maxBuffer: 64 * 1024 * 1024 });

    if (!serial) {
        emulator = spawn(emulatorPath, ["-avd", avd, "-no-window", "-no-audio", "-no-snapshot-save"], { stdio: "ignore" });
        await waitFor("the emulator to appear", () => Boolean(attachedDevice()));
        serial = attachedDevice();
        await waitFor("the emulator to boot", () => {
            try {
                return shell("getprop sys.boot_completed") === "1";
            } catch {
                return false;
            }
        }, 300_000);
    }
    return {
        adb,
        shell,
        binary,
        close() {
            if (emulator) adb("emu", "kill");
        },
    };
}
